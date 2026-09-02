using System;
using VolleySim.Domain;

namespace VolleySim.Training
{
    /// <summary>
    /// 육성 중인 카드 인스턴스: 원본 Player + 현재 스탯(소수) + 잠재력 + 피로/컨디션/부상 이력/콤보/힌트 누적.
    /// </summary>
    public sealed class TraineeState
    {
        public readonly Player Card;
        public readonly Position Position;
        public readonly string ClubId;
        /// <summary>현재 스탯(소수 누적). 인덱스 = StatKind</summary>
        public readonly double[] Current = new double[10];
        public readonly int[] Potential = new int[10];
        public readonly int[] Initial = new int[10];
        /// <summary>카드별 적성(기본은 포지션 표). 인덱스 = 훈련 5종</summary>
        public readonly Aptitude[] Aptitude = new Aptitude[5];

        public double Fatigue;
        public Condition Condition = Condition.Normal;
        public int Combo;
        public int Injuries;
        public int SevereInjuries;
        public int TreatmentTurnsLeft;
        public int TurnsLost;
        public int FirstInjuryTurn = -1;
        public int Hints;
        public int RandomEvents;
        public int SeniorEvents;
        public int Rests;
        public int HotTrains;
        public int Trains;
        public double ConditionAcc;
        public int BestConditionTurns;

        public bool HasInjuryHistory => Injuries > 0;

        public TraineeState(Player card, TrainingConfig cfg, Aptitude[] aptitudeOverride = null, int[] potentialOverride = null)
        {
            Card = card ?? throw new ArgumentNullException(nameof(card));
            Position = card.Position;
            ClubId = card.TeamId ?? "";
            for (int i = 0; i < 10; i++)
            {
                var k = Stats.AllKinds[i];
                Initial[i] = card.Stats[k];
                Current[i] = card.Stats[k];
                Potential[i] = potentialOverride != null ? potentialOverride[i] : card.Potential[k];
                if (Potential[i] < Initial[i]) Potential[i] = Initial[i];
                if (Potential[i] > Stats.Max) Potential[i] = Stats.Max;
            }
            var apt = cfg.PositionAptitude[(int)Position];
            for (int t = 0; t < 5; t++) Aptitude[t] = aptitudeOverride != null ? aptitudeOverride[t] : apt[t];
        }

        public double this[StatKind k] => Current[(int)k];

        /// <summary>잠재력 상한을 넘지 않게 상승 적용. 실제 상승량 반환.</summary>
        public double ApplyGain(StatKind k, double raw)
        {
            int i = (int)k;
            double g = Math.Min(raw, Math.Max(0.0, Potential[i] - Current[i]));
            Current[i] += g;
            return g;
        }

        /// <summary>스탯 손실(0 하한).</summary>
        public void ApplyLoss(StatKind k, double amount)
        {
            int i = (int)k;
            Current[i] = Math.Max(0.0, Current[i] - amount);
        }

        public double Remaining(StatKind k) => Potential[(int)k] - Current[(int)k];

        public double StaminaFactorInput => Current[(int)StatKind.Stamina];

        public double CoreAverage(TrainingConfig cfg)
        {
            var core = cfg.Core3[(int)Position];
            double s = 0;
            foreach (var k in core) s += Current[(int)k];
            return s / core.Length;
        }

        /// <summary>핵심 3스탯 도달률, 전체 도달률(잠재력이 초기치보다 큰 스탯만).</summary>
        public void Reach(TrainingConfig cfg, out double core, out double all)
        {
            var c3 = cfg.Core3[(int)Position];
            double cn = 0, cd = 0, an = 0, ad = 0;
            foreach (var k in c3) { cn += Current[(int)k] - Initial[(int)k]; cd += Potential[(int)k] - Initial[(int)k]; }
            for (int i = 0; i < 10; i++)
            {
                if (Potential[i] > Initial[i]) { an += Current[i] - Initial[i]; ad += Potential[i] - Initial[i]; }
            }
            core = cd > 0 ? cn / cd : 1.0;
            all = ad > 0 ? an / ad : 1.0;
        }
    }
}
