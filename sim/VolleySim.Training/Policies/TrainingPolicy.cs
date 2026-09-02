using System;
using System.Collections.Generic;

namespace VolleySim.Training.Policies
{
    /// <summary>자동 진행 정책(12.3절). 스크립트의 policy_* 와 동일한 규칙.</summary>
    public abstract class TrainingPolicy
    {
        public abstract string Name { get; }
        public abstract TrainingAction Choose(TrainingSession s);
        /// <summary>이벤트 선택: 기본은 오라클 선택지(스토리 정답 등).</summary>
        public virtual int ChooseEvent(TrainingSession s, TrainingEvent e) => e.OracleChoice;

        public static TrainingPolicy ByName(string name)
        {
            switch ((name ?? "").ToLowerInvariant())
            {
                case "safe": case "안전": return new SafePolicy();
                case "optimal": case "최적": return new OptimalPolicy();
                case "push": case "도박": case "푸시": return new PushPolicy();
                case "random": case "랜덤": return new RandomPolicy();
                case "norest": case "무휴식": return new NoRestPolicy();
                case "spike": case "스파이크": return new SpikeOnlyPolicy();
                default: throw new ArgumentException("알 수 없는 정책: " + name);
            }
        }

        public static IReadOnlyList<string> Names => new[] { "safe", "optimal", "push", "random", "norest", "spike" };
    }

    /// <summary>최선 훈련(부상 감안 EV)의 부상 배지가 임계를 넘으면 휴식(T12 제외). 특훈은 배지가 specialMaxP 이하일 때 수락.</summary>
    public abstract class ThresholdPolicy : TrainingPolicy
    {
        protected abstract double Threshold(TrainingConfig c);
        protected abstract double SpecialMaxP(TrainingConfig c);

        public override TrainingAction Choose(TrainingSession s)
        {
            var cfg = s.Config;
            if (s.SpecialAvailable)
            {
                if (s.InjuryProbability(TrainingAction.Special) <= SpecialMaxP(cfg)) return TrainingAction.Special;
                if (s.Turn == cfg.Turns) s.DismissSpecial();
            }
            var best = s.BestTrainingByEv();
            if (s.Turn < cfg.Turns && s.InjuryProbability(best) > Threshold(cfg)) return TrainingAction.Rest;
            return best;
        }
    }

    /// <summary>최적: 배지 > 10% 휴식, 특훈 ≤ 20% 수락.</summary>
    public sealed class OptimalPolicy : ThresholdPolicy
    {
        private readonly double? _th;
        public OptimalPolicy(double? threshold = null) { _th = threshold; }
        public override string Name => _th.HasValue ? $"threshold{_th.Value * 100:0}" : "optimal";
        protected override double Threshold(TrainingConfig c) => _th ?? c.OptimalInjuryThreshold;
        protected override double SpecialMaxP(TrainingConfig c) => c.OptimalSpecialMaxP;
    }

    /// <summary>푸시(도박형): 배지 > 20% 휴식, 특훈 ≤ 30% 수락.</summary>
    public sealed class PushPolicy : ThresholdPolicy
    {
        public override string Name => "push";
        protected override double Threshold(TrainingConfig c) => c.PushInjuryThreshold;
        protected override double SpecialMaxP(TrainingConfig c) => c.PushSpecialMaxP;
    }

    /// <summary>안전: 피로 ≥ 35 휴식(T12 제외), 특훈은 배지 ≤ 5% 만 수락, 부상 감안 최대 훈련. 자동 진행(AI 코치) 기본 정책.</summary>
    public sealed class SafePolicy : TrainingPolicy
    {
        private readonly double? _restAt;
        public SafePolicy(double? restAt = null) { _restAt = restAt; }
        public override string Name => _restAt.HasValue ? $"safe{_restAt.Value:0}" : "safe";
        public override TrainingAction Choose(TrainingSession s)
        {
            var cfg = s.Config;
            if (s.SpecialAvailable && s.InjuryProbability(TrainingAction.Special) <= cfg.SafeSpecialMaxP) return TrainingAction.Special;
            if (s.Fatigue >= (_restAt ?? cfg.SafeRestAt) && s.Turn < cfg.Turns) return TrainingAction.Rest;
            return s.BestTrainingByEv();
        }
    }

    /// <summary>랜덤: 훈련 5 + 휴식 (+ 특훈 등장 시) 균등. 이벤트도 균등 선택.</summary>
    public sealed class RandomPolicy : TrainingPolicy
    {
        public override string Name => "random";
        public override TrainingAction Choose(TrainingSession s)
        {
            int n = 6 + (s.SpecialAvailable ? 1 : 0);
            int i = s.Rng.NextInt(n);
            var a = i < 5 ? (TrainingAction)i : (i == 5 ? TrainingAction.Rest : TrainingAction.Special);
            if (a != TrainingAction.Special) s.DismissSpecial();
            return a;
        }
        // 오라클(스크립트)은 이벤트 선택지가 없으므로 정합을 위해 기본 선택지를 쓴다.
    }

    /// <summary>무휴식 몰빵: 항상 가중 최대 훈련(특훈 수락).</summary>
    public sealed class NoRestPolicy : TrainingPolicy
    {
        public override string Name => "norest";
        public override TrainingAction Choose(TrainingSession s)
        {
            if (s.SpecialAvailable) return TrainingAction.Special;
            return s.BestTrainingByPreview();
        }
    }

    /// <summary>스파이크만: 피로 ≥ 55 휴식, 아니면 스파이크. 특훈 무시.</summary>
    public sealed class SpikeOnlyPolicy : TrainingPolicy
    {
        public override string Name => "spike";
        public override TrainingAction Choose(TrainingSession s)
        {
            s.DismissSpecial();
            if (s.Fatigue >= s.Config.SpikeOnlyRestAt && s.Turn < s.Config.Turns) return TrainingAction.Rest;
            return TrainingAction.Spike;
        }
    }
}
