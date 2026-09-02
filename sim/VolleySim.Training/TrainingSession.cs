using System;
using System.Collections.Generic;
using VolleySim.Domain;
using VolleySim.Training.Evaluation;

namespace VolleySim.Training
{
    public enum SessionPhase
    {
        /// <summary>턴 행동 선택 대기(치료 턴이면 어떤 행동을 넣어도 치료로 처리)</summary>
        AwaitAction = 0,
        /// <summary>이벤트 선택지 대기</summary>
        AwaitEventChoice = 1,
        Graduated = 2,
    }

    /// <summary>턴 1개의 처리 기록(UI 결과 팝업·로그용).</summary>
    public sealed class TurnRecord
    {
        public int Turn;
        public TrainingAction Requested;
        public TrainingAction Action;
        public SpecialKind SpecialKind;
        public FatigueZone Zone;
        public double ZoneMult;
        public int ComboBefore;
        public double FatigueBefore;
        public double FatigueAfter;
        public Condition ConditionBefore;
        public Condition ConditionAfter;
        public double InjuryP;
        public InjuryKind Injury = InjuryKind.None;
        public bool ShallowRest;
        public Dictionary<StatKind, double> Gains = new Dictionary<StatKind, double>();
        public Dictionary<StatKind, double> Losses = new Dictionary<StatKind, double>();
        public EventOutcome Event;
        public EvaluationOutcome Eval;
        public string Flavor = "";
    }

    /// <summary>턴 시작 시 선택지 1개의 표시 정보(4.2절 예상 상승치, 부상 배지 등).</summary>
    public sealed class ActionOption
    {
        public TrainingAction Action;
        public SpecialKind SpecialKind;
        public bool Available = true;
        public string Label = "";
        public Aptitude Aptitude = Aptitude.B;
        public bool HasAptitude;
        public double InjuryP;
        /// <summary>ε = 0 기대 상승(스탯별)</summary>
        public double[] ExpectedGains = new double[10];
        /// <summary>OVR 가중 기대 상승</summary>
        public double WeightedGain;
        public double FatigueDelta;
        /// <summary>휴식 전용: 컨디션 +1 확률</summary>
        public double RestCondUpP;
        public bool DeepRest;
        public double SupportBonus;
        public int HintGain;
    }

    /// <summary>졸업 결과(8절).</summary>
    public sealed class GraduationResult
    {
        public PlayerInstance Instance;
        /// <summary>반올림 전(소수 누적) OVR — 오라클 정합 비교용</summary>
        public double OvrRaw;
        public double OvrInitial;
        public Grade GradeRaw;
        public double CoreReach;
        public double AllReach;
        public int Hints;
        public int SkillLevel;
        public List<string> UnlockedSkills = new List<string>();
        public List<EvaluationOutcome> Evaluations = new List<EvaluationOutcome>();
        public CampRecord Camp;
        public string Comment = "";
    }

    /// <summary>
    /// 육성 세션 상태기계(2.2절 파이프라인). 12턴 × (행동 → 부상/상승/피로/컨디션 → 이벤트 → 평가전) → 졸업.
    /// 규칙은 tools/training-sim/train_sim.py 와 1:1 (오라클). 같은 시드 + 같은 입력 + 같은 선택 = 같은 결과.
    /// </summary>
    public sealed class TrainingSession
    {
        public readonly TrainingConfig Config;
        public readonly TraineeState Trainee;
        public readonly SupportProfile Support;
        public readonly TrainingRandom Rng;
        public readonly IEvaluationMatchProvider Evaluation;
        public readonly int Seed;
        /// <summary>결정론 모드(워크드 예시): ε=0, 부상·특훈 등장·랜덤/선배 이벤트 없음, 컨디션 드리프트 결정론.</summary>
        public readonly bool Deterministic;

        public int Turn { get; private set; } = 1;
        public SessionPhase Phase { get; private set; } = SessionPhase.AwaitAction;
        public bool SpecialAvailable { get; private set; }
        public SpecialKind SpecialKindPending { get; private set; } = SpecialKind.Position;
        public TrainingEvent PendingEvent { get; private set; }
        public readonly List<TurnRecord> Log = new List<TurnRecord>();
        public readonly List<EvaluationOutcome> Evaluations = new List<EvaluationOutcome>();
        public GraduationResult Result { get; private set; }
        public string InstanceId;
        public string PolicyName = "수동";

        private TurnRecord _currentRecord;

        public TrainingSession(Player card, SupportProfile support, TrainingConfig config, IEvaluationMatchProvider evaluation, int seed,
            bool deterministic = false, Aptitude[] aptitudeOverride = null, int[] potentialOverride = null)
        {
            Config = config ?? TrainingConfig.CreateDefault();
            Trainee = new TraineeState(card, Config, aptitudeOverride, potentialOverride);
            Support = support ?? SupportProfile.Empty(Config);
            Evaluation = evaluation ?? new StubEvaluationProvider();
            Seed = seed;
            Rng = new TrainingRandom(seed);
            Deterministic = deterministic;
            InstanceId = $"{card.Id}@{seed}";
            BeginTurn();
        }

        // ------------------------------------------------------------------ 조회

        public bool IsTreating => Trainee.TreatmentTurnsLeft > 0;
        public double Fatigue => Trainee.Fatigue;
        public Condition Condition => Trainee.Condition;
        public int Combo => Trainee.Combo;
        public FatigueZone Zone => Config.ZoneOf(Trainee.Fatigue);
        public double ZoneMult => Config.ZoneMult(Trainee.Fatigue);
        public bool IsFinalTurn => Turn >= Config.Turns;
        public double CurrentOvr => Config.Ovr(Trainee.Current, Trainee.Position);
        public double InitialOvr
        {
            get
            {
                var d = new double[10];
                for (int i = 0; i < 10; i++) d[i] = Trainee.Initial[i];
                return Config.Ovr(d, Trainee.Position);
            }
        }

        /// <summary>부상 확률 배수 = 서포터 방지 × 부상 이력</summary>
        public double InjuryMultiplier()
        {
            double m = Support.Count > 0 ? Support.InjuryMult : 1.0;
            if (Trainee.Injuries > 0) m *= Config.ReinjuryMult;
            return m;
        }

        /// <summary>선택 시점 피로 기준 부상 확률(5.4절 배지).</summary>
        public double InjuryProbability(TrainingAction a)
        {
            if (a == TrainingAction.Special) return InjuryProbability(a, SpecialKindPending);
            return Config.InjuryProbability(Trainee.Fatigue, Config.RiskOf(a), InjuryMultiplier());
        }

        public double InjuryProbability(TrainingAction a, SpecialKind kind)
        {
            double risk = a == TrainingAction.Special ? (kind == SpecialKind.MentalCamp ? 0.0 : Config.SpecialRisk) : Config.RiskOf(a);
            return Config.InjuryProbability(Trainee.Fatigue, risk, InjuryMultiplier());
        }

        /// <summary>4.1절 M 의 훈련 종류와 무관한 부분 = 컨디션 × 강도 곡선 × (1+콤보)</summary>
        public double BaseMult() => Config.ConditionMult[(int)Trainee.Condition] * Config.ZoneMult(Trainee.Fatigue) * Config.ComboMult(Trainee.Combo);

        /// <summary>(1+서포트): 훈련 종류별 보정 + 라이벌 핫존 가산, 합계 상한.</summary>
        public double SupportMult(TrainingAction a)
        {
            if (Support.Count == 0) return 1.0;
            double sup;
            if (a == TrainingAction.Special)
            {
                sup = 0;
                var core = Config.Core3[(int)Trainee.Position];
                for (int t = 0; t < 5; t++)
                {
                    if (Array.IndexOf(core, Config.TrainingStats[t][0]) >= 0 && Support.TrainBonus[t] > sup) sup = Support.TrainBonus[t];
                }
            }
            else sup = Support.TrainBonus[(int)a];
            if (Config.InHot(Trainee.Fatigue)) sup += Support.HotExtra;
            return 1.0 + Math.Min(Config.SupportCap, sup);
        }

        /// <summary>ε = 0 예상 상승치(4.2절). 특훈은 kind 로 종류 지정(null 이면 대기 중인 종류).</summary>
        public double[] PreviewGains(TrainingAction a, SpecialKind? kind = null)
        {
            var g = new double[10];
            ComputeGains(a, kind ?? SpecialKindPending, g);
            return g;
        }

        private void ComputeGains(TrainingAction a, SpecialKind kind, double[] outGains)
        {
            double cm = BaseMult() * SupportMult(a);
            var cur = Trainee.Current; var pot = Trainee.Potential;
            if (a == TrainingAction.Special)
            {
                StatKind[] stats; double[] w;
                switch (kind)
                {
                    case SpecialKind.Stamina: stats = Config.StaminaSpecialStats; w = Config.SpecialWeights; break;
                    case SpecialKind.MentalCamp: stats = new[] { StatKind.Mental }; w = new[] { 1.0 }; break;
                    default: stats = Config.Core3[(int)Trainee.Position]; w = Config.SpecialWeights; break;
                }
                for (int i = 0; i < stats.Length && i < w.Length; i++)
                {
                    int s = (int)stats[i];
                    outGains[s] += Config.Base * Config.SpecialBaseMult * w[i] * Config.Diminish(cur[s], pot[s]) * cm;
                }
            }
            else if (Config.IsTraining(a))
            {
                double apt = Config.AptitudeMult[(int)Trainee.Aptitude[(int)a]];
                var stats = Config.TrainingStats[(int)a];
                double[] w = { Config.WPrimary, Config.WSecondary1, Config.WSecondary2 };
                for (int i = 0; i < 3; i++)
                {
                    int s = (int)stats[i];
                    outGains[s] += Config.Base * w[i] * apt * Config.Diminish(cur[s], pot[s]) * cm;
                }
            }
        }

        /// <summary>훈련 5종의 OVR 가중 기대 상승(ε=0). 정책 선택의 근거.</summary>
        public double[] WeightedPreviews()
        {
            var outv = new double[5];
            double bm = BaseMult() * Config.Base;
            var pw = Config.OvrWeights[(int)Trainee.Position];
            var cur = Trainee.Current; var pot = Trainee.Potential;
            for (int t = 0; t < 5; t++)
            {
                var st = Config.TrainingStats[t];
                double a = Config.AptitudeMult[(int)Trainee.Aptitude[t]] * bm * SupportMult((TrainingAction)t);
                int s0 = (int)st[0], s1 = (int)st[1], s2 = (int)st[2];
                outv[t] = a * (Config.WPrimary * pw[s0] * Config.Diminish(cur[s0], pot[s0])
                              + Config.WSecondary1 * pw[s1] * Config.Diminish(cur[s1], pot[s1])
                              + Config.WSecondary2 * pw[s2] * Config.Diminish(cur[s2], pot[s2]));
            }
            return outv;
        }

        public double WeightedPreview(TrainingAction a)
        {
            if (Config.IsTraining(a)) return WeightedPreviews()[(int)a];
            var g = PreviewGains(a);
            var pw = Config.OvrWeights[(int)Trainee.Position];
            double s = 0;
            for (int i = 0; i < 10; i++) s += pw[i] * g[i];
            return s * Config.PositionScale[(int)Trainee.Position];
        }

        /// <summary>가중 기대 상승 최대 훈련(부상 미감안).</summary>
        public TrainingAction BestTrainingByPreview()
        {
            var wp = WeightedPreviews();
            int best = 0;
            for (int t = 1; t < 5; t++) if (wp[t] > wp[best]) best = t;
            return (TrainingAction)best;
        }

        /// <summary>부상 배지를 감안한 기대값 최대 훈련: gain×(1−p) − p×loss_w (12.3절).</summary>
        public TrainingAction BestTrainingByEv(double? lossWeight = null)
        {
            double lw = lossWeight ?? Config.EvLossWeight;
            var wp = WeightedPreviews();
            double im = InjuryMultiplier(); double f = Trainee.Fatigue;
            int best = 0; double bestEv = double.NegativeInfinity;
            for (int t = 0; t < 5; t++)
            {
                double p = Config.InjuryProbability(f, Config.TrainRisk[t], im);
                double ev = wp[t] * (1 - p) - p * lw;
                if (ev > bestEv) { bestEv = ev; best = t; }
            }
            return (TrainingAction)best;
        }

        public bool IsDeepRest => Trainee.Fatigue >= Config.RestDeepAt;
        public double RestCondUpProbability() => IsDeepRest ? Config.RestCondUpDeep : Config.RestCondUpShallow;

        /// <summary>턴 시작 시 선택지 열거(훈련 5종 · 휴식 · 특훈(등장 시)). 치료 턴이면 전부 잠김.</summary>
        public List<ActionOption> GetOptions()
        {
            var list = new List<ActionOption>();
            bool locked = IsTreating || Phase != SessionPhase.AwaitAction;
            double stamina = Trainee.Current[(int)StatKind.Stamina];
            for (int t = 0; t < 5; t++)
            {
                var a = (TrainingAction)t;
                var o = new ActionOption
                {
                    Action = a, Label = TrainingText.ActionName(a), Available = !locked,
                    Aptitude = Trainee.Aptitude[t], HasAptitude = true,
                    InjuryP = InjuryProbability(a), ExpectedGains = PreviewGains(a),
                    FatigueDelta = Config.FatigueGain(Config.FatigueTrain, stamina) - Config.FatiguePassive,
                    SupportBonus = SupportMult(a) - 1.0,
                };
                o.WeightedGain = WeightedPreview(a);
                list.Add(o);
            }
            list.Add(new ActionOption
            {
                Action = TrainingAction.Rest, Label = "휴식", Available = !locked,
                FatigueDelta = -Math.Min(Config.FatigueRest, Trainee.Fatigue),
                RestCondUpP = RestCondUpProbability(), DeepRest = IsDeepRest,
                ExpectedGains = RestGains(),
            });
            if (SpecialAvailable)
            {
                var k = SpecialKindPending;
                list.Add(new ActionOption
                {
                    Action = TrainingAction.Special, SpecialKind = k, Label = TrainingText.SpecialName(k), Available = !locked,
                    InjuryP = InjuryProbability(TrainingAction.Special, k), ExpectedGains = PreviewGains(TrainingAction.Special, k),
                    FatigueDelta = (k == SpecialKind.MentalCamp ? Config.MentalCampFatigue : Config.FatigueGain(Config.SpecialFatigue, stamina)) - Config.FatiguePassive,
                    WeightedGain = WeightedPreview(TrainingAction.Special), SupportBonus = SupportMult(TrainingAction.Special) - 1.0, HintGain = 1,
                });
            }
            return list;
        }

        private double[] RestGains()
        {
            var g = new double[10];
            g[(int)StatKind.Mental] = Math.Min(Config.RestMental, Math.Max(0, Trainee.Remaining(StatKind.Mental)));
            return g;
        }

        // ------------------------------------------------------------------ 명령

        /// <summary>특훈을 이번 턴에 쓰지 않고 접는다(스크립트의 special_available=False).</summary>
        public void DismissSpecial() { SpecialAvailable = false; }

        /// <summary>턴 행동 적용. 치료 턴이면 행동과 무관하게 치료. 이벤트가 있으면 Phase 가 AwaitEventChoice 가 된다.</summary>
        public TurnRecord Apply(TrainingAction action)
        {
            if (Phase != SessionPhase.AwaitAction) throw new InvalidOperationException($"행동을 받을 수 없는 단계: {Phase}");
            var tr = Trainee; var cfg = Config;
            var rec = new TurnRecord
            {
                Turn = Turn, Requested = action, Action = action, ComboBefore = tr.Combo, FatigueBefore = tr.Fatigue,
                ConditionBefore = tr.Condition, Zone = cfg.ZoneOf(tr.Fatigue), ZoneMult = cfg.ZoneMult(tr.Fatigue),
            };
            bool rested = false;
            if (tr.TreatmentTurnsLeft > 0)
            {
                // 스크립트 동작: 정책이 특훈을 골랐다면(소비) 치료 턴이어도 특훈은 사라진다.
                if (action == TrainingAction.Special) SpecialAvailable = false;
                rec.Action = TrainingAction.Treat;
                tr.TreatmentTurnsLeft--; tr.TurnsLost++;
                tr.Fatigue = Math.Max(0, tr.Fatigue - cfg.FatigueTreat);
                tr.Combo = 0;
            }
            else if (action == TrainingAction.Rest)
            {
                rested = true;
                tr.Rests++; tr.Combo = 0;
                rec.ShallowRest = tr.Fatigue < cfg.RestDeepAt;
                tr.Fatigue = Math.Max(0, tr.Fatigue - cfg.FatigueRest);
                if (cfg.RestMental > 0) rec.Gains[StatKind.Mental] = tr.ApplyGain(StatKind.Mental, cfg.RestMental);
            }
            else
            {
                SpecialKind kind = SpecialKindPending;
                if (action == TrainingAction.Special)
                {
                    if (!SpecialAvailable) throw new InvalidOperationException("이번 턴에는 특훈이 없습니다");
                    SpecialAvailable = false;
                    rec.SpecialKind = kind;
                }
                else if (!cfg.IsTraining(action)) throw new ArgumentException("선택할 수 없는 행동: " + action);

                double p = InjuryProbability(action, kind);
                rec.InjuryP = p;
                bool hit = !Deterministic && Rng.Chance(p);
                if (hit)
                {
                    tr.Injuries++; tr.Combo = 0;
                    if (tr.FirstInjuryTurn < 0) tr.FirstInjuryTurn = Turn;
                    if (Rng.Chance(cfg.SevereRatio))
                    {
                        tr.SevereInjuries++; tr.TreatmentTurnsLeft = cfg.TreatSevere; tr.Condition = Condition.Worst;
                        foreach (var s in TrainingConfig.BodyStats) if (cfg.SevereBodyLoss > 0) { tr.ApplyLoss(s, cfg.SevereBodyLoss); AddLoss(rec, s, cfg.SevereBodyLoss); }
                        for (int i = 0; i < 10; i++) if (cfg.SevereAllLoss > 0) { tr.ApplyLoss(Stats.AllKinds[i], cfg.SevereAllLoss); AddLoss(rec, Stats.AllKinds[i], cfg.SevereAllLoss); }
                        rec.Injury = InjuryKind.Severe;
                    }
                    else
                    {
                        tr.TreatmentTurnsLeft = cfg.TreatLight;
                        tr.Condition = (Condition)Math.Max(0, (int)tr.Condition - 1);
                        foreach (var s in TrainingConfig.BodyStats) if (cfg.LightBodyLoss > 0) { tr.ApplyLoss(s, cfg.LightBodyLoss); AddLoss(rec, s, cfg.LightBodyLoss); }
                        rec.Injury = InjuryKind.Light;
                    }
                }
                else
                {
                    if (cfg.InHot(tr.Fatigue)) tr.HotTrains++;
                    tr.Trains++; tr.ConditionAcc += cfg.ConditionMult[(int)tr.Condition];
                    var g = new double[10];
                    ComputeGains(action, kind, g);
                    double eps = Deterministic ? 0.0 : Rng.Uniform(-cfg.RandEps, cfg.RandEps);
                    for (int i = 0; i < 10; i++)
                    {
                        if (g[i] <= 0) continue;
                        rec.Gains[Stats.AllKinds[i]] = tr.ApplyGain(Stats.AllKinds[i], g[i] * (1 + eps));
                    }
                    double fb = action == TrainingAction.Special ? (kind == SpecialKind.MentalCamp ? cfg.MentalCampFatigue : cfg.SpecialFatigue) : cfg.FatigueTrain;
                    if (action == TrainingAction.Special && kind == SpecialKind.MentalCamp) tr.Fatigue = Math.Min(100, tr.Fatigue + fb);
                    else tr.Fatigue = Math.Min(100, tr.Fatigue + cfg.FatigueGain(fb, tr.Current[(int)StatKind.Stamina]));
                    if (action == TrainingAction.Special)
                    {
                        tr.Hints++;
                        if (kind == SpecialKind.MentalCamp) tr.Condition = (Condition)Math.Min(4, (int)tr.Condition + 1);
                    }
                    tr.Combo++;
                }
            }
            if (rec.Action != TrainingAction.Treat && !rested) tr.Fatigue = Math.Max(0, tr.Fatigue - cfg.FatiguePassive);
            if (rec.Injury == InjuryKind.None && rec.Action != TrainingAction.Treat) DriftCondition(rested, rec.ShallowRest);
            if (tr.Condition == Condition.Best) tr.BestConditionTurns++;
            rec.FatigueAfter = tr.Fatigue; rec.ConditionAfter = tr.Condition;
            rec.Flavor = EventCatalog.FlavorOf(rec.Action, Turn);
            Log.Add(rec);
            _currentRecord = rec;
            AfterAction();
            return rec;
        }

        private static void AddLoss(TurnRecord rec, StatKind s, double v)
        {
            rec.Losses.TryGetValue(s, out var cur);
            rec.Losses[s] = cur + v;
        }

        private void DriftCondition(bool rested, bool shallow)
        {
            var tr = Trainee; var cfg = Config;
            if (Deterministic)
            {
                if (rested && !shallow) tr.Condition = (Condition)Math.Min(4, (int)tr.Condition + 1);
                else if (!rested && tr.Fatigue >= cfg.DriftOverFrom) tr.Condition = (Condition)Math.Max(0, (int)tr.Condition - 1);
                return;
            }
            double r = Rng.NextDouble();
            double up, down;
            if (rested) { up = shallow ? cfg.RestCondUpShallow : cfg.RestCondUpDeep; down = 0.0; }
            else if (tr.Fatigue < cfg.DriftHotFrom) { up = cfg.DriftMid[0]; down = cfg.DriftMid[2]; }
            else if (tr.Fatigue < cfg.DriftOverFrom) { up = cfg.DriftHot[0]; down = cfg.DriftHot[2]; }
            else { up = cfg.DriftOver[0]; down = cfg.DriftOver[2]; }
            if (Support.Count > 0) down *= Support.CondDownMult;
            if (r < up) tr.Condition = (Condition)Math.Min(4, (int)tr.Condition + 1);
            else if (r < up + down) tr.Condition = (Condition)Math.Max(0, (int)tr.Condition - 1);
        }

        /// <summary>이벤트 우선순위: 스토리(고정 턴) > 선배(T5/T9, 서포터) > 랜덤(40%, 런당 ≤ 6). 인연(T7)은 카드 데이터 부재로 미구현.</summary>
        private void AfterAction()
        {
            var cfg = Config; var tr = Trainee;
            if (cfg.IsStoryTurn(Turn))
            {
                PendingEvent = EventCatalog.Story(cfg.StoryIndex(Turn), tr.Position, cfg);
                Phase = SessionPhase.AwaitEventChoice;
                return;
            }
            if (!Deterministic)
            {
                if (cfg.IsSeniorTurn(Turn) && Support.Count > 0 && tr.SeniorEvents < cfg.SeniorEventCap && Rng.NextDouble() < cfg.SeniorEventP)
                {
                    tr.SeniorEvents++;
                    int idx = Rng.NextInt(Support.SignatureTrainings.Count);
                    PendingEvent = EventCatalog.Senior(Support.Supporters[idx].Name, Support.Tags[idx], Support.SignatureTrainings[idx], cfg);
                    Phase = SessionPhase.AwaitEventChoice;
                    return;
                }
                if (tr.RandomEvents < cfg.RandomEventCap && !(Rng.NextDouble() > cfg.RandomEventP))
                {
                    tr.RandomEvents++;
                    PendingEvent = RollRandomEvent();
                    Phase = SessionPhase.AwaitEventChoice;
                    return;
                }
            }
            FinishTurn();
        }

        private TrainingEvent RollRandomEvent()
        {
            var cfg = Config;
            double r = Rng.NextDouble();
            if (r < 0.50)
            {
                var st = Stats.AllKinds[Rng.NextInt(10)];
                if (Rng.NextDouble() < cfg.EventBranchP) return EventCatalog.RandomStatBranch(st, cfg);
                int v = 1 + Rng.NextInt(3);
                return EventCatalog.RandomStat(st, v);
            }
            if (r < 0.75)
            {
                int[] ds = { -15, -10, 10 };
                return EventCatalog.RandomFatigue(ds[Rng.NextInt(3)]);
            }
            int[] cs = { 1, 1, -1 };
            return EventCatalog.RandomCondition(cs[Rng.NextInt(3)]);
        }

        /// <summary>대기 중인 이벤트의 선택지를 고른다(0/1). 분기 선택지는 여기서 성공 판정.</summary>
        public EventOutcome ResolveEvent(int choiceIndex)
        {
            if (Phase != SessionPhase.AwaitEventChoice || PendingEvent == null) throw new InvalidOperationException("대기 중인 이벤트가 없습니다");
            var ev = PendingEvent;
            if (choiceIndex < 0 || choiceIndex >= ev.Choices.Length || ev.Choices[choiceIndex] == null) choiceIndex = 0;
            var choice = ev.Choices[choiceIndex];
            bool success = !choice.IsBranch || Rng.NextDouble() < choice.SuccessRate;
            var eff = success ? choice.OnSuccess : (choice.OnFail ?? new EventEffect());
            var outcome = new EventOutcome { Event = ev, ChoiceIndex = choiceIndex, Success = success, Applied = eff };
            ApplyEffect(eff, outcome);
            if (_currentRecord != null) _currentRecord.Event = outcome;
            PendingEvent = null;
            Phase = SessionPhase.AwaitAction;
            FinishTurn();
            return outcome;
        }

        private void ApplyEffect(EventEffect eff, EventOutcome outcome)
        {
            var tr = Trainee;
            for (int i = 0; i < 10; i++)
            {
                double v = eff.StatGains[i];
                if (v > 0) outcome.ActualGains[Stats.AllKinds[i]] = tr.ApplyGain(Stats.AllKinds[i], v);
                else if (v < 0) { tr.ApplyLoss(Stats.AllKinds[i], -v); outcome.ActualGains[Stats.AllKinds[i]] = v; }
            }
            if (Math.Abs(eff.Fatigue) > 0) tr.Fatigue = Math.Max(0, Math.Min(100, tr.Fatigue + eff.Fatigue));
            if (eff.Condition != 0) tr.Condition = (Condition)Math.Max(0, Math.Min(4, (int)tr.Condition + eff.Condition));
            if (eff.Hint != 0) tr.Hints += eff.Hint;
        }

        private void FinishTurn()
        {
            if (!Config.SpecialPersistsUntilUsed) SpecialAvailable = false;
            if (Config.IsEvalTurn(Turn)) RunEvaluation();
            if (Turn >= Config.Turns)
            {
                Result = BuildGraduation();
                Phase = SessionPhase.Graduated;
                return;
            }
            Turn++;
            Phase = SessionPhase.AwaitAction;
            BeginTurn();
        }

        /// <summary>턴 시작: 특훈 등장 판정(3.4절). 치료 턴에도 판정한다(스크립트 동작).</summary>
        private void BeginTurn()
        {
            if (Deterministic || SpecialAvailable) return;
            var cfg = Config; var tr = Trainee;
            double p = cfg.SpecialAppearP + (Support.Count > 0 ? Support.SpecialBonus : 0.0);
            if (cfg.InHot(tr.Fatigue) && tr.Condition >= cfg.SpecialMinCondition && Rng.NextDouble() < p)
            {
                SpecialAvailable = true;
                SpecialKindPending = RollSpecialKind();
            }
        }

        private SpecialKind RollSpecialKind()
        {
            var w = Config.SpecialKindWeights;
            int nonZero = 0; double sum = 0;
            for (int i = 0; i < w.Length; i++) { if (w[i] > 0) nonZero++; sum += w[i]; }
            if (nonZero <= 1 || sum <= 0)
            {
                for (int i = 0; i < w.Length; i++) if (w[i] > 0) return (SpecialKind)i;
                return SpecialKind.Position;
            }
            double r = Rng.NextDouble() * sum;
            for (int i = 0; i < w.Length; i++) { r -= w[i]; if (r < 0) return (SpecialKind)i; }
            return SpecialKind.Position;
        }

        private void RunEvaluation()
        {
            var cfg = Config; var tr = Trainee;
            int round = cfg.EvalRound(Turn);
            int opp = cfg.EvalStrength[round];
            EvaluationOutcome o;
            if (tr.TreatmentTurnsLeft > 0)
            {
                o = new EvaluationOutcome { Round = round, Turn = Turn, OpponentStrength = opp, Absent = true, OpponentName = "—" };
                Evaluations.Add(o);
                if (_currentRecord != null) _currentRecord.Eval = o;
                return;
            }
            var req = new EvaluationRequest
            {
                Round = round, Turn = Turn, OpponentStrength = opp, Card = tr.Card, Position = tr.Position,
                CurrentStats = (double[])tr.Current.Clone(), CoreAverage = tr.CoreAverage(cfg), Condition = tr.Condition,
                Config = cfg, SessionSeed = Seed,
            };
            o = Evaluation.Play(req, Rng);
            o.Round = round; o.Turn = Turn; o.OpponentStrength = opp;
            double perf = o.Performance;
            int bonus, hint;
            if (perf >= cfg.MvpPerf) { bonus = cfg.MvpCoreGain; hint = cfg.MvpHint; }
            else if (perf >= cfg.GoodPerf) { bonus = cfg.GoodCoreGain; hint = cfg.GoodHint; }
            else { bonus = 0; hint = 0; }
            foreach (var s in cfg.Core3[(int)tr.Position]) tr.ApplyGain(s, bonus);
            if (o.Won) hint += cfg.WinHint;
            else tr.ApplyGain(StatKind.Mental, cfg.LossMental);
            if (perf < cfg.PoorPerf) { tr.Condition = (Condition)Math.Max(0, (int)tr.Condition - 1); o.ConditionDelta = -1; }
            if (perf >= cfg.MvpPerf)
            {
                tr.Condition = (Condition)Math.Min(4, (int)tr.Condition + 1); o.ConditionDelta = +1; o.Mvp = true;
                SpecialAvailable = true; SpecialKindPending = RollSpecialKind();
            }
            tr.Hints += hint;
            tr.Fatigue = Math.Min(100, tr.Fatigue + cfg.FatigueMatch);
            o.CoreGain = bonus; o.Hint = hint;
            Evaluations.Add(o);
            if (_currentRecord != null) _currentRecord.Eval = o;
        }

        private GraduationResult BuildGraduation()
        {
            var cfg = Config; var tr = Trainee; var card = tr.Card;
            var inst = new PlayerInstance
            {
                InstanceId = InstanceId, CardId = card.Id, Name = card.Name, Position = tr.Position, Rarity = card.Rarity, ClubId = tr.ClubId,
                JerseyNumber = card.JerseyNumber, HeightCm = card.HeightCm, Age = card.Age, SkillName = card.Skill?.Name ?? "",
            };
            var fin = new double[10];
            for (int i = 0; i < 10; i++)
            {
                int v = (int)Math.Round(Math.Min(tr.Current[i], tr.Potential[i]), MidpointRounding.ToEven);
                inst.FinalStats[i] = Stats.Clamp(v);
                inst.InitialStats[i] = tr.Initial[i];
                inst.Potential[i] = tr.Potential[i];
                fin[i] = inst.FinalStats[i];
            }
            inst.Ovr = cfg.Ovr(fin, tr.Position);
            inst.Grade = cfg.GradeOf(inst.Ovr);
            tr.Reach(cfg, out double core, out double all);
            inst.Completion = core; inst.AllReach = all;
            inst.Hints = tr.Hints;
            inst.SkillLevel = cfg.SkillLevelForHints(tr.Hints);
            var camp = inst.Camp;
            foreach (var e in Evaluations)
            {
                if (e.Absent) camp.Absent++;
                else if (e.Won) camp.Wins++;
                else camp.Losses++;
                if (e.Mvp) camp.Mvp++;
            }
            camp.Injuries = tr.Injuries; camp.SevereInjuries = tr.SevereInjuries; camp.HotTrains = tr.HotTrains; camp.Rests = tr.Rests;
            camp.Trains = tr.Trains; camp.BestConditionTurns = tr.BestConditionTurns; camp.TurnsLost = tr.TurnsLost; camp.PolicyName = PolicyName;
            foreach (var s in Support.Supporters) camp.SupporterNames.Add(s.Name);

            var res = new GraduationResult
            {
                Instance = inst, OvrRaw = cfg.Ovr(tr.Current, tr.Position), OvrInitial = InitialOvr,
                CoreReach = core, AllReach = all, Hints = tr.Hints, SkillLevel = inst.SkillLevel, Camp = camp,
            };
            res.GradeRaw = cfg.GradeOf(res.OvrRaw);
            res.Evaluations.AddRange(Evaluations);
            string skill = string.IsNullOrEmpty(inst.SkillName) ? "고유 스킬" : inst.SkillName;
            if (inst.SkillLevel > 0) res.UnlockedSkills.Add($"{skill} Lv{inst.SkillLevel}");
            res.Comment = GraduationComment(inst.Grade);
            return res;
        }

        private static string GraduationComment(Grade g)
        {
            switch (g)
            {
                case Grade.S: return "캠프의 모든 것을 흡수했다. 이제 코트가 좁다.";
                case Grade.A: return "즉시 전력. 어느 팀이라도 탐낼 만한 졸업생.";
                case Grade.B: return "기본기는 갖췄다. 실전에서 한 번 더 자란다.";
                case Grade.C: return "아직 원석. 다음 캠프에서 무기를 찾자.";
                default: return "쉽지 않은 캠프였다. 그래도 끝까지 남았다.";
            }
        }
    }
}
