using System;

namespace VolleySim.Training.Evaluation
{
    /// <summary>
    /// 파이썬 오라클과 동일한 근사식(7.2절): perf = clamp(50 + (핵심3 − 강도) × 1.5 + N(0, 12)), 승리 = sigmoid((핵심3 − 강도)/8).
    /// 컨디션 보정은 스크립트에 없으므로 넣지 않는다(정합용).
    /// </summary>
    public sealed class StubEvaluationProvider : IEvaluationMatchProvider
    {
        private static readonly string[] OpponentNames = { "지역 대학 선발", "프로 2군", "소속 구단 1군 선발" };

        public EvaluationOutcome Play(EvaluationRequest req, TrainingRandom rng)
        {
            var cfg = req.Config;
            double diff = req.CoreAverage - req.OpponentStrength;
            double perf = 50.0 + diff * cfg.EvalPerfSlope + rng.Gauss(0, cfg.EvalPerfSigma);
            perf = Math.Max(0.0, Math.Min(100.0, perf));
            double winP = 1.0 / (1.0 + Math.Exp(-diff / cfg.EvalWinK));
            bool won = rng.NextDouble() < winP;
            var o = new EvaluationOutcome
            {
                Round = req.Round,
                Turn = req.Turn,
                OpponentStrength = req.OpponentStrength,
                OpponentName = OpponentNames[Math.Min(req.Round, OpponentNames.Length - 1)],
                Won = won,
                Performance = perf,
            };
            int loser = won ? Clamp(14 + (int)Math.Round((100 - perf) / 8.0), 10, 23) : Clamp(10 + (int)Math.Round(perf / 6.0), 8, 23);
            o.ScoreLine = won ? $"25-{loser}" : $"{loser}-25";
            o.Highlights.Add(perf >= cfg.MvpPerf ? "경기 내내 코트를 지배했다." : perf >= cfg.GoodPerf ? "몇 차례 결정적인 장면을 만들었다." : perf >= cfg.PoorPerf ? "평범한 하루." : "공이 손에 붙지 않았다.");
            return o;
        }

        private static int Clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);

        /// <summary>테스트용: 결과를 고정하는 제공자.</summary>
        public sealed class Forced : IEvaluationMatchProvider
        {
            private readonly Func<EvaluationRequest, (bool won, double perf)> _f;
            public Forced(Func<EvaluationRequest, (bool won, double perf)> f) { _f = f; }
            public EvaluationOutcome Play(EvaluationRequest req, TrainingRandom rng)
            {
                var (won, perf) = _f(req);
                return new EvaluationOutcome { Round = req.Round, Turn = req.Turn, OpponentStrength = req.OpponentStrength, Won = won, Performance = perf, ScoreLine = won ? "25-20" : "20-25", OpponentName = "고정" };
            }
        }
    }
}
