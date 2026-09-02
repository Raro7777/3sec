using System;
using System.Collections.Generic;
using VolleySim.Config;
using VolleySim.Data;
using VolleySim.Domain;
using VolleySim.Result;

namespace VolleySim.Training.Evaluation
{
    /// <summary>
    /// 실제 경기 시뮬(<see cref="MatchSimulator"/>)로 평가전을 치른다. 트레이니를 캠프 팀(생성 NPC, 강도 = 상대 강도)에 넣고
    /// 같은 강도의 생성 상대와 1세트 25점 경기. 활약도는 박스스코어에서 포지션별 순기여 → 50 + 배율 × (순기여 − 기준선) + 점수차 보정.
    /// 문서 7.2절에 없는 세부(강도 → 생성기 overall 매핑, 활약도 공식)는 프로토타입 결정이며 docs/prototype-play.md 에 기록.
    /// </summary>
    public sealed class SimEvaluationProvider : IEvaluationMatchProvider
    {
        public sealed class Params
        {
            /// <summary>"강도 X" = 해당 포지션 핵심3 평균 X → 생성기 overall = X − CoreOffset[pos]. (생성기 프로파일 overall 67 기준 핵심3 평균 − 67)</summary>
            public double[] CoreOffset = { 7.7, 4.3, 7.7, 5.7, 13.7 };
            /// <summary>동급 대결(Δ=0)에서의 순기여 기대값(포지션별). --calibrate-eval 로 측정(n=200, 강도 72).</summary>
            public double[] Baseline = { 5.54, 4.90, 3.06, 2.67, 6.54 };
            /// <summary>핵심3 1점당 순기여 기대 증가(포지션별). 캘리브레이션 값.</summary>
            public double[] NetSlope = { 0.023, 0.10, 0.054, 0.044, 0.11 };
            /// <summary>순기여 편차 1점당 활약도(포지션별). σ(활약도) ≈ 12 가 되도록 캘리브레이션.</summary>
            public double[] Scale = { 6.7, 4.35, 4.5, 5.3, 3.6 };
            /// <summary>세트 점수차 1점당 활약도(팀 결과 반영)</summary>
            public double MarginWeight = 0.5;
            /// <summary>컨디션 → PlayerCondition 배수(최악..절호조)</summary>
            public double[] ConditionMult = { 0.92, 0.96, 1.00, 1.03, 1.06 };
            /// <summary>컨디션 활약도 보정(5.2절): 최악 −8 … 절호조 +8</summary>
            public double[] ConditionAdj = { -8, -4, 0, 4, 8 };
            public int PointsToWin = 25;
            public bool CollectEvents = true;
            public int HighlightCount = 3;
        }

        public readonly Params P;
        private readonly Action<SimConfig> _customize;
        private static readonly string[] OpponentNames = { "지역 대학 선발", "프로 2군", "소속 구단 1군 선발" };

        public SimEvaluationProvider(Params p = null, Action<SimConfig> customizeSimConfig = null)
        {
            P = p ?? new Params();
            _customize = customizeSimConfig;
        }

        public const string TraineeId = "TRAINEE";

        public EvaluationOutcome Play(EvaluationRequest req, TrainingRandom rng)
        {
            int seedCamp = rng.NextSeed(), seedOpp = rng.NextSeed(), seedMatch = rng.NextSeed();
            double overall = req.OpponentStrength - P.CoreOffset[(int)req.Position];
            var camp = RandomPlayerGenerator.GenerateTeamState(seedCamp, "CAMP", req.TraineeTeamName ?? "캠프 팀", overall);
            var trainee = BuildTrainee(req);
            InsertTrainee(camp, trainee);
            camp.PlayerCondition[trainee.Id] = P.ConditionMult[(int)req.Condition];
            string oppName = OpponentNames[Math.Min(req.Round, OpponentNames.Length - 1)];
            var opp = RandomPlayerGenerator.GenerateTeamState(seedOpp, "OPP", oppName, overall);

            var cfg = SimConfig.CreateDefault();
            cfg.Match.SetsToWin = 1;
            cfg.Match.PointsToWinSet = P.PointsToWin;
            cfg.Match.PointsToWinFinalSet = P.PointsToWin;
            _customize?.Invoke(cfg);

            var result = MatchSimulator.Simulate(camp, opp, Tactics.Default(), Tactics.Default(), seedMatch, cfg, P.CollectEvents);
            result.BoxScores.TryGetValue(trainee.Id, out var box);
            if (box == null) box = new PlayerBoxScore { PlayerId = trainee.Id, Name = trainee.Name, PositionCode = trainee.Position.ToCode() };

            int margin = result.TotalHomePoints - result.TotalAwayPoints;
            double net = NetContribution(req.Position, box);
            double perf = Performance(req, net, margin);

            var o = new EvaluationOutcome
            {
                Round = req.Round, Turn = req.Turn, OpponentStrength = req.OpponentStrength, OpponentName = oppName,
                Won = result.Winner == TeamSide.Home, Performance = perf, ScoreLine = result.SetScoreLine(), Box = box, Match = result,
            };
            o.Highlights.AddRange(Highlights(req.Position, box, o.Won));
            return o;
        }

        /// <summary>
        /// 활약도 = 50 + 1.5 × (핵심3 − 강도) + 컨디션 보정 + Scale × (순기여 − 기대 순기여(Δ)) + 점수차 × MarginWeight.
        /// 경기 시뮬의 개별 대결 기울기가 평탄(k=120)해 1세트 박스스코어만으로는 문서의 기울기 1.5/점이 나오지 않으므로,
        /// 평균은 7.2절 근사식으로 두고 박스스코어·점수차는 그 주변 편차(σ ≈ 12)로 반영한다(docs/prototype-play.md 편차 절).
        /// </summary>
        public double Performance(EvaluationRequest req, double net, int margin)
        {
            int pos = (int)req.Position;
            double delta = req.CoreAverage - req.OpponentStrength;
            double expectedNet = P.Baseline[pos] + P.NetSlope[pos] * delta;
            double perf = 50.0 + req.Config.EvalPerfSlope * delta + P.ConditionAdj[(int)req.Condition]
                          + P.Scale[pos] * (net - expectedNet) + P.MarginWeight * margin;
            return Math.Max(0.0, Math.Min(100.0, perf));
        }

        public static Player BuildTrainee(EvaluationRequest req)
        {
            var t = req.Card.Clone();
            t.Id = TraineeId;
            t.TeamId = "CAMP";
            for (int i = 0; i < 10; i++) t.Stats[Stats.AllKinds[i]] = Stats.Clamp((int)Math.Round(req.CurrentStats[i]));
            return t;
        }

        /// <summary>같은 포지션의 라인업 자리를 트레이니로 교체(원래 선수는 벤치).</summary>
        public static void InsertTrainee(TeamState team, Player trainee)
        {
            team.Roster.Add(trainee);
            var l = team.Lineup;
            string replaced;
            switch (trainee.Position)
            {
                case Position.L: replaced = l.LiberoId; l.LiberoId = trainee.Id; break;
                case Position.S: replaced = l.StartingIds[0]; l.StartingIds[0] = trainee.Id; break;
                case Position.OH: replaced = l.StartingIds[1]; l.StartingIds[1] = trainee.Id; break;
                case Position.MB: replaced = l.StartingIds[2]; l.StartingIds[2] = trainee.Id; break;
                default: replaced = l.StartingIds[3]; l.StartingIds[3] = trainee.Id; break;
            }
            if (!string.IsNullOrEmpty(replaced)) l.BenchIds.Add(replaced);
            team.Validate();
        }

        /// <summary>포지션별 순기여(박스스코어 → 1개 숫자).</summary>
        public static double NetContribution(Position pos, PlayerBoxScore b)
        {
            double attack = b.Kills - b.AttackErrors - b.Blocked;
            double serve = b.Aces - b.ServeErrors;
            double block = b.BlockKills + 0.5 * b.BlockAssists + 0.25 * b.BlockTouches;
            double rec = b.ReceptionPerfect + 0.5 * b.ReceptionGood - b.ReceptionErrors;
            double dig = b.Digs - 0.5 * (b.DigAttempts - b.Digs);
            switch (pos)
            {
                case Position.S: return 0.35 * b.Assists + 1.0 * attack + serve + block + 0.5 * dig;
                case Position.OH: return attack + serve + block + 0.6 * rec + 0.5 * dig;
                case Position.OP: return attack + serve + block + 0.4 * rec + 0.4 * dig;
                case Position.MB: return attack + serve + 1.5 * block + 0.4 * dig;
                default: return 1.0 * rec + 0.8 * dig + 0.3 * b.Assists;
            }
        }

        private List<string> Highlights(Position pos, PlayerBoxScore b, bool won)
        {
            var h = new List<string>();
            if (b.Attacks > 0) h.Add($"공격 {b.Kills}/{b.Attacks} (범실 {b.AttackErrors}, 피블로킹 {b.Blocked})");
            if (b.Serves > 0) h.Add($"서브 {b.Serves}회, 에이스 {b.Aces}, 범실 {b.ServeErrors}");
            if (b.Receptions > 0) h.Add($"리시브 {b.Receptions}회 (A {b.ReceptionPerfect} / B {b.ReceptionGood} / 실패 {b.ReceptionErrors})");
            if (b.BlockKills + b.BlockAssists > 0) h.Add($"블로킹 득점 {b.BlockKills} (어시스트 {b.BlockAssists})");
            if (b.DigAttempts > 0) h.Add($"디그 {b.Digs}/{b.DigAttempts}");
            if (pos == Position.S && b.Assists > 0) h.Add($"세트 {b.Sets}회, 어시스트 {b.Assists}");
            if (h.Count > P.HighlightCount) h.RemoveRange(P.HighlightCount, h.Count - P.HighlightCount);
            return h;
        }
    }
}
