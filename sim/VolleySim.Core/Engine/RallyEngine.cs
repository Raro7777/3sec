using System.Collections.Generic;
using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Skills;

namespace VolleySim.Engine
{
    public struct RallyResult
    {
        public TeamSide Winner;
        public PointReason Reason;
        public bool Clutch;
        public int Attacks;
    }

    /// <summary>
    /// 랠리 단위 판정 체인: 서브 → 리시브 → 세트 → 공격 → 블로킹/디그 → (트랜지션 반복).
    /// 각 단계의 품질이 다음 단계의 확률/선택지를 제한한다. 모든 상수는 SimConfig 에서 온다.
    /// </summary>
    public sealed class RallyEngine
    {
        private readonly MatchContext _ctx;
        private readonly SimConfig _cfg;
        private readonly DeterministicRandom _rng;
        private readonly double _sens;

        // 스크래치 버퍼(할당 억제)
        private readonly double[] _w = new double[16];
        private readonly List<Player> _cand = new List<Player>(16);
        private readonly List<AttackType> _candType = new List<AttackType>(16);
        private readonly List<Player> _blockers = new List<Player>(4);
        private readonly List<int> _blockerPos = new List<int>(4);

        private enum SeqKind { PointAttacking, PointDefending, Continue, CoverContinue }

        private struct SeqResult
        {
            public SeqKind Kind;
            public PointReason Reason;
            public Quality NextQuality;
            public Player NextFirstContact;
        }

        public RallyEngine(MatchContext ctx)
        {
            _ctx = ctx;
            _cfg = ctx.Config;
            _rng = ctx.Rng;
            _sens = ctx.Config.StatSensitivity > 0 ? ctx.Config.StatSensitivity : 1e-9;
        }

        /// <summary>전역 민감도가 적용된 실효 k (k / StatSensitivity).</summary>
        private double K(double k) => k / _sens;

        public RallyResult PlayRally(TeamMatchState serving, TeamMatchState receiving)
        {
            bool clutch = _ctx.IsClutch();
            var result = new RallyResult { Clutch = clutch };

            serving.Stats.ServeRallies++;
            receiving.Stats.ReceiveRallies++;
            if (clutch)
            {
                serving.Stats.ClutchRallies++;
                receiving.Stats.ClutchRallies++;
            }

            _ctx.Emit(EventType.RallyStart, serving, serving.PlayerAt(1), 1, clutch: clutch, value: serving.RotationIndex);

            // ---------------- 1. 서브 ----------------
            Player server = serving.PlayerAt(1);
            double aggression = SimMath.Clamp(serving.Tactics.ServeAggression, 0.0, 1.0);
            double serveRating = _ctx.Eff(Ratings.Serve(server, _cfg.Rating), server, serving, clutch);
            var sp = _cfg.Serve;
            double errBase = SimMath.Lerp(sp.ErrorBaseSafe, sp.ErrorBaseAggressive, aggression);
            double homeLogit = serving.Side == TeamSide.Home ? _cfg.Match.HomeCourtLogit : 0.0;
            double pServeErr = SimMath.Contest(errBase, -(serveRating - sp.ErrorRefRating), K(sp.ErrorK),
                -homeLogit - _ctx.SkillLogit(SkillTrigger.ServeError, server, null, clutch));

            var serverBox = _ctx.Box(server);
            serverBox.Serves++;
            serving.Stats.Serves++;

            if (_rng.Chance(pServeErr))
            {
                serverBox.ServeErrors++;
                serving.Stats.ServeErrors++;
                _ctx.Emit(EventType.Serve, serving, server, 1, Quality.Error, Outcome.Error, AttackType.None, pServeErr, clutch: clutch);
                result.Winner = receiving.Side;
                result.Reason = PointReason.ServeError;
                return result;
            }

            // ---------------- 2. 리시브 ----------------
            int receiverPos;
            Player receiver = ChooseReceiver(receiving, aggression, clutch, out receiverPos);
            double recvRating = _ctx.Eff(Ratings.Receive(receiver, _cfg.Rating), receiver, receiving, clutch);
            double formationLogit = FormationLogit(receiving, receiver);
            double x = (recvRating - serveRating) / K(sp.ReceiveK) - sp.AggressionLogit * (aggression - 0.5) + formationLogit
                       + _ctx.SkillLogit(SkillTrigger.Receive, receiver, server, clutch);
            double pAce = SimMath.Sigmoid(SimMath.Logit(sp.AceBase) - x + homeLogit
                                          + _ctx.SkillLogit(SkillTrigger.ServeAce, server, receiver, clutch));

            _ctx.Emit(EventType.Serve, serving, server, 1, Quality.None, Outcome.InPlay, AttackType.None, pAce,
                value: (int)(aggression * 100), clutch: clutch);

            var recvBox = _ctx.Box(receiver);
            recvBox.Receptions++;
            receiving.Stats.Receptions++;

            if (_rng.Chance(pAce))
            {
                serverBox.Aces++;
                serving.Stats.Aces++;
                recvBox.ReceptionErrors++;
                receiving.Stats.ReceptionErrors++;
                _ctx.Emit(EventType.Reception, receiving, receiver, receiverPos, Quality.Error, Outcome.Ace, AttackType.None, pAce, clutch: clutch);
                result.Winner = serving.Side;
                result.Reason = PointReason.Ace;
                return result;
            }

            Quality passQuality = RollQuality(x, _cfg.Receive.PerfectBase, _cfg.Receive.GoodBase);
            switch (passQuality)
            {
                case Quality.Perfect: recvBox.ReceptionPerfect++; receiving.Stats.ReceptionPerfect++; break;
                case Quality.Good: recvBox.ReceptionGood++; receiving.Stats.ReceptionGood++; break;
                default: recvBox.ReceptionPoor++; receiving.Stats.ReceptionPoor++; break;
            }
            _ctx.Emit(EventType.Reception, receiving, receiver, receiverPos, passQuality, Outcome.InPlay, AttackType.None, pAce, clutch: clutch);

            // ---------------- 3. 공격 시퀀스(트랜지션 반복) ----------------
            TeamMatchState attacking = receiving;
            TeamMatchState defending = serving;
            Quality ballQuality = passQuality;
            Player firstContact = receiver;
            int maxAttacks = _cfg.Match.MaxAttacksPerRally;

            for (int n = 0; n < maxAttacks; n++)
            {
                var seq = RunAttackSequence(attacking, defending, ballQuality, firstContact, n, clutch);
                result.Attacks = n + 1;
                switch (seq.Kind)
                {
                    case SeqKind.PointAttacking:
                        result.Winner = attacking.Side;
                        result.Reason = seq.Reason;
                        return result;
                    case SeqKind.PointDefending:
                        result.Winner = defending.Side;
                        result.Reason = seq.Reason;
                        return result;
                    case SeqKind.CoverContinue:
                        ballQuality = seq.NextQuality;
                        firstContact = seq.NextFirstContact;
                        break;
                    default: // Continue: 공수 교대
                        {
                            var t = attacking; attacking = defending; defending = t;
                            ballQuality = seq.NextQuality;
                            firstContact = seq.NextFirstContact;
                            break;
                        }
                }
            }

            // 안전장치: 상한 초과 시 마지막 공격팀의 범실로 처리
            result.Winner = defending.Side;
            result.Reason = PointReason.RallyCap;
            return result;
        }

        // ------------------------------------------------------------------
        // 공격 시퀀스: 세트 → 공격 옵션 → 블로킹 → 킬/디그
        // ------------------------------------------------------------------

        private SeqResult RunAttackSequence(TeamMatchState attacking, TeamMatchState defending, Quality pass, Player firstContact, int attackIndex, bool clutch)
        {
            var ap = _cfg.Attack;
            var bp = _cfg.Block;
            var setp = _cfg.Set;
            double homeLogit = attacking.Side == TeamSide.Home ? _cfg.Match.HomeCourtLogit : 0.0;

            // --- 프리볼 결정(Poor 패스) ---
            if (pass == Quality.Poor && _rng.Chance(setp.FreeBallFromPoorPass))
            {
                Player sender = firstContact ?? attacking.Setter;
                attacking.Stats.FreeBalls++;
                _ctx.Emit(EventType.FreeBall, attacking, sender, attacking.PositionOf(sender), Quality.None, Outcome.InPlay, AttackType.FreeBall, setp.FreeBallFromPoorPass, clutch: clutch);
                int fbPos;
                Player fbReceiver = ChooseFreeBallReceiver(defending, out fbPos);
                Quality fq = _rng.Chance(_cfg.Receive.FreeBallPerfectProb) ? Quality.Perfect : Quality.Good;
                var rb = _ctx.Box(fbReceiver);
                rb.DigAttempts++; rb.Digs++;
                defending.Stats.DigAttempts++; defending.Stats.Digs++;
                _ctx.Emit(EventType.Dig, defending, fbReceiver, fbPos, fq, Outcome.InPlay, AttackType.FreeBall, _cfg.Receive.FreeBallPerfectProb, clutch: clutch);
                return new SeqResult { Kind = SeqKind.Continue, NextQuality = fq, NextFirstContact = fbReceiver };
            }

            // --- 세터 결정 ---
            Player setter = attacking.Setter;
            bool nonSetter = setter == null || ReferenceEquals(setter, firstContact);
            if (nonSetter) setter = ChooseAlternativeSetter(attacking, firstContact);
            int setterPos = attacking.PositionOf(setter);
            bool setterFront = TeamMatchState.IsFrontRow(setterPos);

            // --- 공격 옵션 선택 ---
            AttackType type;
            Player attacker;
            double predictLogit = 0.0;
            if (!nonSetter && setterFront && pass == Quality.Perfect && _rng.Chance(setp.SetterDumpProb))
            {
                type = AttackType.Dump;
                attacker = setter;
            }
            else
            {
                attacker = ChooseAttackOption(attacking, setter, pass, out type);
                predictLogit = PredictabilityPenalty(attacking.Tactics, type);
            }
            int attackPos = attacking.PositionOf(attacker);

            // --- 세트 품질 ---
            double setRating = _ctx.Eff(Ratings.Set(setter, _cfg.Rating), setter, attacking, clutch);
            double chem = attacking.State.Chemistry.Get(setter.Id, attacker.Id);
            double chemLogit = _cfg.Chemistry.LogitScale * (chem - 50.0) / 50.0;
            double setX = (setRating - setp.RefRating) / K(setp.K) + chemLogit
                          + (nonSetter ? setp.NonSetterPenaltyLogit : 0.0)
                          + _ctx.SkillLogit(SkillTrigger.Set, setter, null, clutch);
            Quality setQuality = RollSetQuality(pass, setX);
            if (type == AttackType.Dump) setQuality = Quality.Perfect;

            var setterBox = _ctx.Box(setter);
            if (type != AttackType.Dump) setterBox.Sets++;
            _ctx.Emit(EventType.Set, attacking, setter, setterPos, setQuality, Outcome.InPlay, type, SimMath.Sigmoid(setX), value: attackPos, clutch: clutch);

            // --- 블로커 결정 ---
            ChooseBlockers(defending, type, attackPos, setQuality, clutch);

            // --- 공격 레이팅·범실 ---
            double atk = _ctx.Eff(Ratings.Attack(attacker, _cfg.Rating), attacker, attacking, clutch);
            double typeKillLogit, typeErrMult, typeBlockLogit;
            TypeModifiers(type, out typeKillLogit, out typeErrMult, out typeBlockLogit);
            double setKillLogit = 0, setErrMult = 1, setBlockLogit = 0;
            if (setQuality == Quality.Perfect) { setKillLogit = ap.PerfectSetKillLogit; setErrMult = ap.PerfectSetErrorMult; setBlockLogit = bp.PerfectSetBlockLogit; }
            else if (setQuality == Quality.Poor) { setKillLogit = ap.PoorSetKillLogit; setErrMult = ap.PoorSetErrorMult; setBlockLogit = bp.PoorSetBlockLogit; }

            var atkBox = _ctx.Box(attacker);
            atkBox.Attacks++;
            attacking.Stats.Attacks++;
            attacking.Stats.AttacksByType[(int)type]++;
            if (attackIndex == 0) attacking.Stats.FirstBallAttacks++; else attacking.Stats.TransitionAttacks++;
            if (type == AttackType.Dump) attacking.Stats.Dumps++;

            double pErr = SimMath.Contest(SimMath.Clamp(ap.ErrorBase * typeErrMult * setErrMult, 0.0, 0.95), -(atk - ap.ErrorRefRating), K(ap.ErrorK),
                -homeLogit - _ctx.SkillLogit(SkillTrigger.AttackError, attacker, null, clutch));
            if (_rng.Chance(pErr))
            {
                atkBox.AttackErrors++;
                attacking.Stats.AttackErrors++;
                _ctx.Emit(EventType.Attack, attacking, attacker, attackPos, setQuality, Outcome.Error, type, pErr, value: _blockers.Count, clutch: clutch);
                return new SeqResult { Kind = SeqKind.PointDefending, Reason = PointReason.AttackError };
            }

            // --- 블로킹 ---
            double digBonus = 0.0;
            if (_blockers.Count > 0)
            {
                double blockStrength = BlockStrength(defending, clutch);
                Player primary = _blockers[0];
                double blockExtra = typeBlockLogit + setBlockLogit - homeLogit + predictLogit
                                    + _ctx.SkillLogit(SkillTrigger.BlockKill, primary, attacker, clutch);
                double pBlock = SimMath.Contest(bp.KillBase, blockStrength - atk, K(bp.K), blockExtra);
                if (_rng.Chance(pBlock))
                {
                    atkBox.Blocked++;
                    attacking.Stats.Blocked++;
                    CreditBlock(defending, primary);
                    _ctx.Emit(EventType.Attack, attacking, attacker, attackPos, setQuality, Outcome.BlockKill, type, pBlock, value: _blockers.Count, clutch: clutch);
                    EmitBlockEvent(defending, Outcome.BlockKill, pBlock, clutch);
                    return new SeqResult { Kind = SeqKind.PointDefending, Reason = PointReason.BlockKill };
                }

                double pTouch = SimMath.Contest(bp.TouchBase, blockStrength - atk, K(bp.K), blockExtra);
                if (_rng.Chance(pTouch))
                {
                    _ctx.Box(primary).BlockTouches++;
                    defending.Stats.BlockTouches++;
                    double r = _rng.NextDouble();
                    if (r < bp.TouchOutRatio)
                    {
                        // 블록 아웃: 공격팀 득점(킬로 집계)
                        atkBox.Kills++;
                        attacking.Stats.Kills++;
                        attacking.Stats.KillsByType[(int)type]++;
                        attacking.Stats.BlockOuts++;
                        if (attackIndex == 0) attacking.Stats.FirstBallKills++;
                        if (type != AttackType.Dump) setterBox.Assists++;
                        EmitBlockEvent(defending, Outcome.BlockTouch, pTouch, clutch);
                        _ctx.Emit(EventType.Attack, attacking, attacker, attackPos, setQuality, Outcome.BlockOut, type, pTouch, value: _blockers.Count, clutch: clutch);
                        return new SeqResult { Kind = SeqKind.PointAttacking, Reason = PointReason.BlockOut };
                    }
                    if (r < bp.TouchOutRatio + bp.TouchBackRatio)
                    {
                        // 공격팀 코트로 되돌아옴 → 커버
                        EmitBlockEvent(defending, Outcome.BlockTouch, pTouch, clutch);
                        _ctx.Emit(EventType.Attack, attacking, attacker, attackPos, setQuality, Outcome.BlockTouch, type, pTouch, value: _blockers.Count, clutch: clutch);
                        int coverPos;
                        Player coverer = ChooseCoverer(attacking, attacker, out coverPos);
                        double coverDig = _ctx.Eff(Ratings.Dig(coverer, _cfg.Rating), coverer, attacking, clutch);
                        double pCover = SimMath.Contest(bp.CoverBase, coverDig - _cfg.Attack.ErrorRefRating, K(_cfg.Dig.K));
                        var cb = _ctx.Box(coverer);
                        cb.DigAttempts++;
                        attacking.Stats.DigAttempts++;
                        if (_rng.Chance(pCover))
                        {
                            cb.Digs++;
                            attacking.Stats.Digs++;
                            Quality cq = _rng.Chance(bp.CoverGoodQualityProb) ? Quality.Good : Quality.Poor;
                            _ctx.Emit(EventType.Cover, attacking, coverer, coverPos, cq, Outcome.Covered, type, pCover, clutch: clutch);
                            return new SeqResult { Kind = SeqKind.CoverContinue, NextQuality = cq, NextFirstContact = coverer };
                        }
                        // 커버 실패 = 블로킹 득점
                        atkBox.Blocked++;
                        attacking.Stats.Blocked++;
                        CreditBlock(defending, primary);
                        _ctx.Emit(EventType.Cover, attacking, coverer, coverPos, Quality.Error, Outcome.Error, type, pCover, clutch: clutch);
                        return new SeqResult { Kind = SeqKind.PointDefending, Reason = PointReason.BlockKill };
                    }
                    // 느려진 공: 수비팀 디그 유리
                    digBonus = bp.TouchSlowDigLogit;
                    EmitBlockEvent(defending, Outcome.BlockTouch, pTouch, clutch);
                }
            }

            // --- 킬 vs 디그 ---
            int diggerPos;
            Player digger = ChooseDigger(defending, out diggerPos);
            double digRating = _ctx.Eff(Ratings.Dig(digger, _cfg.Rating), digger, defending, clutch);
            double teamDig = AverageNonBlockerDig(defending, clutch);
            double digBlend = (1.0 - ap.DigTeamBlend) * digRating + ap.DigTeamBlend * teamDig;
            double defense = _blockers.Count > 0
                ? (1.0 - ap.BlockShareInKill) * digBlend + ap.BlockShareInKill * MeanBlockRating(defending, clutch)
                : digBlend;
            double killExtra = typeKillLogit + setKillLogit - digBonus + homeLogit - predictLogit
                               + (attackIndex == 0 ? ap.FirstBallKillLogit : ap.TransitionKillLogitPerAttack * attackIndex)
                               + _ctx.SkillLogit(SkillTrigger.AttackKill, attacker, digger, clutch)
                               - _ctx.SkillLogit(SkillTrigger.Dig, digger, attacker, clutch);
            double pKill = SimMath.Contest(ap.KillBase, atk - defense, K(ap.KillK), killExtra);

            var digBox = _ctx.Box(digger);
            digBox.DigAttempts++;
            defending.Stats.DigAttempts++;

            if (_rng.Chance(pKill))
            {
                atkBox.Kills++;
                attacking.Stats.Kills++;
                attacking.Stats.KillsByType[(int)type]++;
                if (attackIndex == 0) attacking.Stats.FirstBallKills++;
                if (type != AttackType.Dump) setterBox.Assists++;
                _ctx.Emit(EventType.Attack, attacking, attacker, attackPos, setQuality, Outcome.Kill, type, pKill, value: _blockers.Count, clutch: clutch);
                _ctx.Emit(EventType.Dig, defending, digger, diggerPos, Quality.Error, Outcome.Error, type, pKill, clutch: clutch);
                return new SeqResult { Kind = SeqKind.PointAttacking, Reason = PointReason.Kill };
            }

            digBox.Digs++;
            defending.Stats.Digs++;
            double dx = (digRating - atk) / K(_cfg.Dig.K) + digBonus;
            Quality dq = RollQuality(dx, _cfg.Dig.PerfectBase, _cfg.Dig.GoodBase);
            _ctx.Emit(EventType.Attack, attacking, attacker, attackPos, setQuality, Outcome.Dug, type, pKill, value: _blockers.Count, clutch: clutch);
            _ctx.Emit(EventType.Dig, defending, digger, diggerPos, dq, Outcome.InPlay, type, 1.0 - pKill, clutch: clutch);
            return new SeqResult { Kind = SeqKind.Continue, NextQuality = dq, NextFirstContact = digger };
        }

        // ------------------------------------------------------------------
        // 품질 판정
        // ------------------------------------------------------------------

        private Quality RollQuality(double x, double perfectBase, double goodBase)
        {
            double pA = SimMath.Sigmoid(SimMath.Logit(perfectBase) + x);
            if (_rng.Chance(pA)) return Quality.Perfect;
            double pB = SimMath.Sigmoid(SimMath.Logit(goodBase) + x);
            if (_rng.Chance(pB)) return Quality.Good;
            return Quality.Poor;
        }

        private Quality RollSetQuality(Quality pass, double x)
        {
            var s = _cfg.Set;
            switch (pass)
            {
                case Quality.Perfect:
                    return _rng.Chance(SimMath.Sigmoid(SimMath.Logit(s.PerfectFromPerfectPass) + x)) ? Quality.Perfect : Quality.Good;
                case Quality.Good:
                    if (_rng.Chance(SimMath.Sigmoid(SimMath.Logit(s.PerfectFromGoodPass) + x))) return Quality.Perfect;
                    return _rng.Chance(SimMath.Sigmoid(SimMath.Logit(s.GoodFromGoodPass) + x)) ? Quality.Good : Quality.Poor;
                default:
                    return _rng.Chance(SimMath.Sigmoid(SimMath.Logit(s.GoodFromPoorPass) + x)) ? Quality.Good : Quality.Poor;
            }
        }

        private void TypeModifiers(AttackType type, out double killLogit, out double errMult, out double blockLogit)
        {
            var a = _cfg.Attack;
            var b = _cfg.Block;
            switch (type)
            {
                case AttackType.Quick: killLogit = a.QuickKillLogit; errMult = a.QuickErrorMult; blockLogit = b.QuickBlockLogit; break;
                case AttackType.BackRow: killLogit = a.BackRowKillLogit; errMult = a.BackRowErrorMult; blockLogit = b.BackRowBlockLogit; break;
                case AttackType.Delayed: killLogit = a.DelayedKillLogit; errMult = a.DelayedErrorMult; blockLogit = b.DelayedBlockLogit; break;
                case AttackType.Dump: killLogit = a.DumpKillLogit; errMult = a.DumpErrorMult; blockLogit = b.DumpBlockLogit; break;
                default: killLogit = a.OpenKillLogit; errMult = a.OpenErrorMult; blockLogit = 0.0; break;
            }
        }

        // ------------------------------------------------------------------
        // 선수 선택
        // ------------------------------------------------------------------

        private double FormationLogit(TeamMatchState team, Player receiver)
        {
            var f = _cfg.Formation;
            switch (team.Tactics.Formation)
            {
                case ReceiveFormation.LiberoCentered:
                    return receiver.IsLibero ? f.LiberoCenteredLiberoLogit : f.LiberoCenteredOtherLogit;
                case ReceiveFormation.Spread:
                    return receiver.IsLibero ? f.SpreadLiberoLogit : f.SpreadOtherLogit;
                default:
                    return 0.0;
            }
        }

        private Player ChooseReceiver(TeamMatchState team, double aggression, bool clutch, out int position)
        {
            var r = _cfg.Receive;
            var f = _cfg.Formation;
            double liberoMult = 1.0, ohMult = 1.0;
            if (team.Tactics.Formation == ReceiveFormation.LiberoCentered) { liberoMult = f.LiberoCenteredLiberoMult; ohMult = f.LiberoCenteredOhMult; }
            else if (team.Tactics.Formation == ReceiveFormation.Spread) { liberoMult = f.SpreadLiberoMult; ohMult = f.SpreadOhMult; }

            for (int pos = 1; pos <= 6; pos++)
            {
                var p = team.PlayerAt(pos);
                bool front = TeamMatchState.IsFrontRow(pos);
                double w;
                if (p.IsLibero) w = r.WeightLibero * liberoMult;
                else
                {
                    switch (p.Position)
                    {
                        case Position.OH:
                            w = front ? (pos == 4 ? r.WeightOhFrontLeft : r.WeightOhFrontRight) : r.WeightOhBack;
                            w *= ohMult;
                            break;
                        case Position.OP: w = front ? r.WeightOpFront : r.WeightOpBack; break;
                        case Position.MB: w = front ? r.WeightMbFront : r.WeightMbBack; break;
                        case Position.S: w = front ? r.WeightSetterFront : r.WeightSetterBack; break;
                        default: w = front ? r.WeightOpFront : r.WeightOpBack; break;
                    }
                }
                if (w > 0)
                {
                    // 서버의 약점 공략: 리시브 레이팅이 낮을수록 가중치 상승
                    double recv = Ratings.Receive(p, _cfg.Rating);
                    double t = 1.0 + _cfg.Serve.TargetingBias * aggression * (_cfg.Serve.TargetingRefRating - recv) / 50.0;
                    w *= SimMath.Clamp(t, 0.3, 2.5);
                }
                _w[pos - 1] = w;
            }
            int idx = _rng.WeightedIndex(_w, 6);
            if (idx < 0) idx = 5;
            position = idx + 1;
            return team.PlayerAt(position);
        }

        private Player ChooseFreeBallReceiver(TeamMatchState team, out int position)
        {
            var d = _cfg.Dig;
            for (int pos = 1; pos <= 6; pos++)
            {
                var p = team.PlayerAt(pos);
                double w = DigWeight(p, d);
                if (TeamMatchState.IsFrontRow(pos)) w *= 0.3;
                _w[pos - 1] = w;
            }
            int idx = _rng.WeightedIndex(_w, 6);
            if (idx < 0) idx = 5;
            position = idx + 1;
            return team.PlayerAt(position);
        }

        private static double DigWeight(Player p, SimConfig.DigParams d)
        {
            if (p.IsLibero) return d.WeightLibero;
            switch (p.Position)
            {
                case Position.OH: return d.WeightOh;
                case Position.OP: return d.WeightOp;
                case Position.MB: return d.WeightMb;
                case Position.S: return d.WeightSetter;
                default: return d.WeightOp;
            }
        }

        private Player ChooseDigger(TeamMatchState defending, out int position)
        {
            var d = _cfg.Dig;
            for (int pos = 1; pos <= 6; pos++)
            {
                var p = defending.PlayerAt(pos);
                double w = _blockers.Contains(p) ? 0.0 : DigWeight(p, d);
                if (w > 0 && TeamMatchState.IsFrontRow(pos)) w *= 0.5; // 네트 앞 비블로커는 커버 범위가 좁음
                _w[pos - 1] = w;
            }
            int idx = _rng.WeightedIndex(_w, 6);
            if (idx < 0) idx = 5;
            position = idx + 1;
            return defending.PlayerAt(position);
        }

        private Player ChooseCoverer(TeamMatchState attacking, Player attacker, out int position)
        {
            var d = _cfg.Dig;
            for (int pos = 1; pos <= 6; pos++)
            {
                var p = attacking.PlayerAt(pos);
                _w[pos - 1] = ReferenceEquals(p, attacker) ? 0.0 : DigWeight(p, d);
            }
            int idx = _rng.WeightedIndex(_w, 6);
            if (idx < 0) idx = 5;
            position = idx + 1;
            return attacking.PlayerAt(position);
        }

        private Player ChooseAlternativeSetter(TeamMatchState team, Player exclude)
        {
            Player best = null;
            double bestV = double.NegativeInfinity;
            for (int pos = 1; pos <= 6; pos++)
            {
                var p = team.PlayerAt(pos);
                if (ReferenceEquals(p, exclude)) continue;
                double v = Ratings.Set(p, _cfg.Rating);
                if (p.IsLibero) v -= 10; // 리베로는 전위 오버핸드 세트 제한 → 낮은 우선순위
                if (v > bestV) { bestV = v; best = p; }
            }
            return best ?? team.PlayerAt(1);
        }

        /// <summary>전술 가중치 × 패스 품질 가용성으로 공격 옵션(유형+선수)을 고른다.</summary>
        private Player ChooseAttackOption(TeamMatchState team, Player setter, Quality pass, out AttackType type)
        {
            var a = _cfg.Attack;
            var t = team.Tactics;
            _cand.Clear();
            _candType.Clear();

            bool frontMbExists = false;
            for (int pos = 2; pos <= 4; pos++)
            {
                var p = team.PlayerAt(pos);
                if (p.Position == Position.MB && !ReferenceEquals(p, setter)) frontMbExists = true;
            }

            double quickAvail = pass == Quality.Perfect ? 1.0 : (pass == Quality.Good ? a.QuickAvailGoodPass : 0.0);
            double delayedAvail = pass == Quality.Perfect ? 1.0 : (pass == Quality.Good ? a.DelayedAvailGoodPass : 0.0);
            double backAvail = pass == Quality.Poor ? a.BackRowAvailPoorPass : 1.0;

            // 전위 공격수
            bool anyFrontWing = false;
            for (int pos = 2; pos <= 4; pos++)
            {
                var p = team.PlayerAt(pos);
                if (ReferenceEquals(p, setter) || p.IsLibero) continue;
                if (p.Position == Position.MB)
                {
                    double w = t.QuickWeight * quickAvail;
                    if (w > 0) Add(p, AttackType.Quick, w);
                }
                else
                {
                    anyFrontWing = true;
                    double rel = p.Position == Position.OP ? a.OpenOpRelativeWeight : 1.0;
                    double w = t.OpenWeight * rel;
                    if (w > 0) Add(p, AttackType.Open, w);
                    if (frontMbExists)
                    {
                        double wd = t.DelayedWeight * delayedAvail * rel;
                        if (wd > 0) Add(p, AttackType.Delayed, wd);
                    }
                }
            }
            // 전위에 윙 공격수가 없으면 MB 하이볼(오픈)도 허용
            if (!anyFrontWing)
            {
                for (int pos = 2; pos <= 4; pos++)
                {
                    var p = team.PlayerAt(pos);
                    if (ReferenceEquals(p, setter) || p.IsLibero) continue;
                    double w = t.OpenWeight * 0.7;
                    if (w > 0) Add(p, AttackType.Open, w);
                }
            }
            // 후위 공격: OP 우선, 없으면 OH
            Player backOp = null, backOh = null;
            for (int pos = 1; pos <= 6; pos++)
            {
                if (TeamMatchState.IsFrontRow(pos)) continue;
                var p = team.PlayerAt(pos);
                if (ReferenceEquals(p, setter) || p.IsLibero) continue;
                if (p.Position == Position.OP && backOp == null) backOp = p;
                else if (p.Position == Position.OH && backOh == null) backOh = p;
            }
            var backAttacker = backOp ?? backOh;
            if (backAttacker != null)
            {
                double w = t.BackRowWeight * backAvail;
                if (w > 0) Add(backAttacker, AttackType.BackRow, w);
            }

            if (_cand.Count == 0)
            {
                // 폴백: 전위 비세터 오픈, 그것도 없으면 후위 아무나
                for (int pos = 2; pos <= 4; pos++)
                {
                    var p = team.PlayerAt(pos);
                    if (ReferenceEquals(p, setter) || p.IsLibero) continue;
                    Add(p, AttackType.Open, 1.0);
                }
                if (_cand.Count == 0 && backAttacker != null) Add(backAttacker, AttackType.BackRow, 1.0);
                if (_cand.Count == 0)
                {
                    for (int pos = 1; pos <= 6; pos++)
                    {
                        var p = team.PlayerAt(pos);
                        if (p.IsLibero) continue;
                        Add(p, TeamMatchState.IsFrontRow(pos) ? AttackType.Open : AttackType.BackRow, 1.0);
                    }
                }
            }

            int idx = _rng.WeightedIndex(_w, _cand.Count);
            if (idx < 0) idx = _cand.Count - 1;
            type = _candType[idx];
            return _cand[idx];
        }

        /// <summary>
        /// 예측 가능성 페널티: 전술 배분에서 해당 유형의 비중이 FreeShare 를 초과하는 만큼 상대가 읽는다.
        /// (가용성 조정 전의 "성향" 기준 — 상대는 경기 전 스카우팅으로 성향을 안다고 가정)
        /// </summary>
        private double PredictabilityPenalty(Tactics t, AttackType type)
        {
            var a = _cfg.Attack;
            double q = t.QuickWeight < 0 ? 0 : t.QuickWeight;
            double o = t.OpenWeight < 0 ? 0 : t.OpenWeight;
            double b = t.BackRowWeight < 0 ? 0 : t.BackRowWeight;
            double d = t.DelayedWeight < 0 ? 0 : t.DelayedWeight;
            double sum = q + o + b + d;
            if (sum <= 0) return 0.0;
            double share;
            switch (type)
            {
                case AttackType.Quick: share = q / sum; break;
                case AttackType.Open: share = o / sum; break;
                case AttackType.BackRow: share = b / sum; break;
                case AttackType.Delayed: share = d / sum; break;
                default: return 0.0;
            }
            double over = share - a.PredictabilityFreeShare;
            return over > 0 ? a.PredictabilityLogit * over : 0.0;
        }

        private void Add(Player p, AttackType type, double w)
        {
            if (_cand.Count >= _w.Length) return;
            _w[_cand.Count] = w;
            _cand.Add(p);
            _candType.Add(type);
        }

        // ------------------------------------------------------------------
        // 블로킹
        // ------------------------------------------------------------------

        /// <summary>공격 위치의 거울 포지션(4↔2, 3↔3).</summary>
        private static int Mirror(int attackPos)
        {
            switch (attackPos)
            {
                case 4: return 2;
                case 2: return 4;
                default: return 3;
            }
        }

        /// <summary>
        /// 수비팀 전위(2,3,4)에서만 블로커를 고른다 → 후위 선수·리베로는 절대 블로킹하지 않는다.
        /// 주 블로커는 공격 위치의 거울, 보조 블로커는 스피드 대결로 참여 여부 결정.
        /// </summary>
        private void ChooseBlockers(TeamMatchState defending, AttackType type, int attackPos, Quality setQuality, bool clutch)
        {
            _blockers.Clear();
            _blockerPos.Clear();
            var b = _cfg.Block;

            int primaryPos;
            int secondaryPos;
            int thirdPos;
            double joinBase;
            bool front = TeamMatchState.IsFrontRow(attackPos);

            if (type == AttackType.BackRow || !front)
            {
                primaryPos = 3;
                // 2/4 중 블로킹 레이팅이 높은 쪽이 보조
                double b2 = Ratings.Block(defending.PlayerAt(2), _cfg.Rating);
                double b4 = Ratings.Block(defending.PlayerAt(4), _cfg.Rating);
                secondaryPos = b2 >= b4 ? 2 : 4;
                thirdPos = secondaryPos == 2 ? 4 : 2;
                joinBase = b.JoinBackRow;
            }
            else if (type == AttackType.Quick || (type == AttackType.Open && attackPos == 3))
            {
                primaryPos = 3;
                double b2 = Ratings.Block(defending.PlayerAt(2), _cfg.Rating);
                double b4 = Ratings.Block(defending.PlayerAt(4), _cfg.Rating);
                secondaryPos = b2 >= b4 ? 2 : 4;
                thirdPos = secondaryPos == 2 ? 4 : 2;
                joinBase = type == AttackType.Quick ? b.JoinQuick : b.JoinOpen;
            }
            else
            {
                primaryPos = Mirror(attackPos);
                secondaryPos = 3;
                thirdPos = primaryPos == 2 ? 4 : 2;
                switch (type)
                {
                    case AttackType.Delayed: joinBase = b.JoinDelayed; break;
                    case AttackType.Dump: joinBase = b.JoinDump; break;
                    default: joinBase = b.JoinOpen; break;
                }
            }

            AddBlocker(defending, primaryPos);

            var sec = defending.PlayerAt(secondaryPos);
            double secSpeed = _ctx.Eff(sec.Stats.Speed, sec, defending, clutch);
            double pJoin = SimMath.Contest(joinBase, secSpeed - b.JoinSpeedRef, K(b.JoinK));
            if (_rng.Chance(pJoin)) AddBlocker(defending, secondaryPos);

            if (setQuality == Quality.Poor && _blockers.Count == 2)
            {
                var third = defending.PlayerAt(thirdPos);
                double thirdSpeed = _ctx.Eff(third.Stats.Speed, third, defending, clutch);
                double pThird = SimMath.Contest(b.JoinThirdPoorSet, thirdSpeed - b.JoinSpeedRef, K(b.JoinK));
                if (_rng.Chance(pThird)) AddBlocker(defending, thirdPos);
            }
        }

        private void AddBlocker(TeamMatchState defending, int pos)
        {
            if (!TeamMatchState.IsFrontRow(pos))
                throw new System.InvalidOperationException($"Back-row position {pos} cannot block"); // 규칙 불변식
            var p = defending.PlayerAt(pos);
            if (p.IsLibero) throw new System.InvalidOperationException("Libero cannot block"); // 규칙 불변식(리베로는 전위 불가)
            if (_blockers.Contains(p)) return;
            _blockers.Add(p);
            _blockerPos.Add(pos);
        }

        private double BlockStrength(TeamMatchState defending, bool clutch)
        {
            double sum = 0;
            for (int i = 0; i < _blockers.Count; i++)
            {
                var p = _blockers[i];
                sum += _ctx.Eff(Ratings.Block(p, _cfg.Rating), p, defending, clutch);
            }
            double mean = sum / _blockers.Count;
            return mean + _cfg.Block.ExtraBlockerBonus * (_blockers.Count - 2);
        }

        private double MeanBlockRating(TeamMatchState defending, bool clutch)
        {
            double sum = 0;
            for (int i = 0; i < _blockers.Count; i++)
            {
                var p = _blockers[i];
                sum += _ctx.Eff(Ratings.Block(p, _cfg.Rating), p, defending, clutch);
            }
            return _blockers.Count > 0 ? sum / _blockers.Count : 0.0;
        }

        private double AverageNonBlockerDig(TeamMatchState defending, bool clutch)
        {
            double sum = 0;
            int n = 0;
            for (int pos = 1; pos <= 6; pos++)
            {
                var p = defending.PlayerAt(pos);
                if (_blockers.Contains(p)) continue;
                sum += _ctx.Eff(Ratings.Dig(p, _cfg.Rating), p, defending, clutch);
                n++;
            }
            return n > 0 ? sum / n : 50.0;
        }

        private void CreditBlock(TeamMatchState defending, Player primary)
        {
            defending.Stats.BlockKills++;
            for (int i = 0; i < _blockers.Count; i++)
            {
                var box = _ctx.Box(_blockers[i]);
                if (ReferenceEquals(_blockers[i], primary)) box.BlockKills++; else box.BlockAssists++;
            }
        }

        private void EmitBlockEvent(TeamMatchState defending, Outcome outcome, double prob, bool clutch)
        {
            if (_blockers.Count == 0) return;
            var e = _ctx.Emit(EventType.Block, defending, _blockers[0], _blockerPos[0], Quality.None, outcome, AttackType.None, prob, value: _blockers.Count, clutch: clutch);
            if (e != null && _blockers.Count > 1)
            {
                e.SecondaryPlayerIds = new List<string>(_blockers.Count - 1);
                for (int i = 1; i < _blockers.Count; i++) e.SecondaryPlayerIds.Add(_blockers[i].Id);
            }
        }
    }
}
