using System;
using VolleySim.Domain;

namespace VolleySim.Training
{
    /// <summary>
    /// 육성 모드 튜닝 테이블(training-mode.md 부록 A, train_sim.py DEFAULT_CFG + 모듈 상수와 1:1).
    /// 모든 필드는 초기값이며 튜닝 전제. 인덱스 규약: 훈련 5종 = <see cref="TrainingAction"/> 0~4, 컨디션 = <see cref="Condition"/> 0~4,
    /// 스탯 = <see cref="StatKind"/> 0~9, 포지션 = <see cref="Position"/> 0~4.
    /// </summary>
    public sealed class TrainingConfig
    {
        public int Turns = 12;

        // ---------- growth (4.1절) ----------
        /// <summary>기본 상승치 B. v0.1 5.0</summary>
        public double Base = 4.6;
        public double WPrimary = 1.0;
        public double WSecondary1 = 0.5;
        public double WSecondary2 = 0.25;
        /// <summary>적성 배수. 인덱스 = <see cref="Aptitude"/> (D,C,B,A,S)</summary>
        public double[] AptitudeMult = { 0.40, 0.70, 1.00, 1.15, 1.30 };
        public double DiminishFull = 20.0;
        public double DiminishMin = 0.25;
        /// <summary>턴 랜덤 편차 U(−ε, +ε)</summary>
        public double RandEps = 0.25;
        /// <summary>컨디션 배수. 인덱스 = <see cref="Condition"/> (최악..절호조)</summary>
        public double[] ConditionMult = { 0.60, 0.85, 1.00, 1.10, 1.30 };

        // ---------- zone (3.6절) ----------
        public double ColdHi = 30;
        public double ColdMult = 0.85;
        public double HotLo = 45;
        public double HotHi = 80;
        public double HotMult = 1.50;
        public double OverheatMult = 0.85;
        public double ComboStep = 0.05;
        public double ComboCap = 0.15;

        // ---------- special (3.4절) ----------
        public double SpecialBaseMult = 1.5;
        public double[] SpecialWeights = { 1.0, 0.7, 0.5 };
        public double SpecialAppearP = 0.25;
        /// <summary>특훈 등장 최소 컨디션(호조)</summary>
        public Condition SpecialMinCondition = Condition.Good;
        /// <summary>특훈 종류 가중(포지션/체력/멘탈). 문서 60/25/15, 오라클(스크립트)은 포지션만 → 기본값 포지션 100%.</summary>
        public double[] SpecialKindWeights = { 1.0, 0.0, 0.0 };
        /// <summary>true 면 등장한 특훈이 수락/거절될 때까지 다음 턴에도 유지(스크립트 동작). false 면 그 턴에만 유효(문서 3.4절).</summary>
        public bool SpecialPersistsUntilUsed = true;
        public double SpecialRisk = 1.5;
        public double SpecialFatigue = 30.0;
        public double MentalCampFatigue = 10.0;

        // ---------- fatigue (5.1절) ----------
        public double FatigueTrain = 20.0;
        public double FatigueMatch = 12.0;
        public double FatiguePassive = 5.0;
        public double FatigueRest = 45.0;
        public double FatigueTreat = 20.0;
        public double StaminaFactorBase = 60.0;
        public double StaminaFactorDiv = 250.0;

        // ---------- rest (3.3절) ----------
        public double RestMental = 1.0;
        public double RestCondUpDeep = 0.70;
        public double RestDeepAt = 50.0;
        public double RestCondUpShallow = 0.30;

        // ---------- condition drift (5.3절) : {+1, 유지, −1} ----------
        public double[] DriftMid = { 0.15, 0.70, 0.15 };
        public double[] DriftHot = { 0.15, 0.70, 0.15 };
        public double[] DriftOver = { 0.0, 0.40, 0.60 };
        public double DriftHotFrom = 60.0;
        public double DriftOverFrom = 80.0;

        // ---------- injury (5.4~5.5절) ----------
        public double InjuryStart = 45.0;
        public double InjuryMax = 0.40;
        public double InjuryExp = 1.6;
        /// <summary>훈련 위험 계수. 인덱스 = 훈련 5종</summary>
        public double[] TrainRisk = { 0.8, 1.0, 0.7, 1.3, 1.2 };
        public double ReinjuryMult = 2.0;
        public double SevereRatio = 0.30;
        public int TreatLight = 1;
        public int TreatSevere = 2;
        /// <summary>경상: speed/power/stamina 손실</summary>
        public int LightBodyLoss = 3;
        /// <summary>중상: 전 스탯 손실</summary>
        public int SevereAllLoss = 3;
        /// <summary>중상: 신체 3스탯 추가 손실(v0.1 3, v0.2 0)</summary>
        public int SevereBodyLoss = 0;

        // ---------- events (6절) ----------
        public double RandomEventP = 0.40;
        public int RandomEventCap = 6;
        public double EventBranchP = 0.50;
        public double EventBranchSuccessP = 0.65;
        public int EventBranchGain = 3;
        public int[] StoryTurns = { 2, 6, 10 };
        public int BondTurn = 7;
        public int[] SeniorTurns = { 5, 9 };
        public double SeniorEventP = 0.50;
        public int SeniorEventCap = 2;
        public int SeniorEventGain = 2;

        // ---------- evaluation (7절) ----------
        public int[] EvalTurns = { 4, 8, 12 };
        public int[] EvalStrength = { 62, 72, 80 };
        public double EvalPerfSlope = 1.5;
        public double EvalPerfSigma = 12.0;
        public double EvalWinK = 8.0;
        public int MvpPerf = 80;
        public int GoodPerf = 60;
        public int PoorPerf = 40;
        public int MvpCoreGain = 2;
        public int MvpHint = 2;
        public int GoodCoreGain = 1;
        public int GoodHint = 1;
        public int WinHint = 1;
        public int LossMental = 1;

        // ---------- graduation (8절) ----------
        /// <summary>등급 컷 S/A/B/C (미만은 D)</summary>
        public double[] GradeCut = { 80, 74, 66, 55 };
        public int[] HintLevels = { 3, 6, 9 };

        // ---------- support (9절) ----------
        public double SupportStatBase = 60;
        public double SupportStatDiv = 800;
        public double SupportTrainCapEach = 0.06;
        public double SupportCap = 0.20;
        public double SupportPosMatch = 0.02;
        public double SupportSameClub = 0.02;
        public double SupportRivalHot = 0.05;
        public double SupportInjDiv = 300;
        public double SupportInjCapEach = 0.10;
        public double SupportInjFloor = 0.80;
        public double SupportCondDiv = 200;
        public double SupportCondCapEach = 0.12;
        public double SupportCondFloor = 0.65;
        public double SupportSpecialS = 0.03;
        public double SupportSpecialA = 0.02;
        public double SupportSpecialCap = 0.06;
        public int SupporterSlots = 3;
        /// <summary>라이벌 구단 쌍(world.md 3절)</summary>
        public string[][] Rivals = { new[] { "t01", "t05" }, new[] { "t02", "t06" }, new[] { "t03", "t04" } };

        // ---------- policy (12.3절) ----------
        public double SafeRestAt = 35;
        public double SafeSpecialMaxP = 0.05;
        public double OptimalInjuryThreshold = 0.10;
        public double OptimalSpecialMaxP = 0.20;
        public double PushInjuryThreshold = 0.20;
        public double PushSpecialMaxP = 0.30;
        public double EvLossWeight = 2.0;
        public double SpikeOnlyRestAt = 55;

        // ---------- position tables (3.1~3.2절, 8.2절) ----------
        /// <summary>훈련별 스탯(주, 부1, 부2). 인덱스 = 훈련 5종</summary>
        public StatKind[][] TrainingStats =
        {
            new[] { StatKind.Serve, StatKind.Power, StatKind.Mental },
            new[] { StatKind.Receive, StatKind.Dig, StatKind.Stamina },
            new[] { StatKind.Set, StatKind.Mental, StatKind.Speed },
            new[] { StatKind.Spike, StatKind.Power, StatKind.Stamina },
            new[] { StatKind.Block, StatKind.Speed, StatKind.Power },
        };

        /// <summary>포지션 적성표 [pos][training]</summary>
        public Aptitude[][] PositionAptitude =
        {
            /* S  */ new[] { Aptitude.B, Aptitude.B, Aptitude.S, Aptitude.C, Aptitude.B },
            /* OH */ new[] { Aptitude.A, Aptitude.A, Aptitude.C, Aptitude.A, Aptitude.B },
            /* OP */ new[] { Aptitude.A, Aptitude.C, Aptitude.D, Aptitude.S, Aptitude.B },
            /* MB */ new[] { Aptitude.B, Aptitude.C, Aptitude.D, Aptitude.A, Aptitude.S },
            /* L  */ new[] { Aptitude.D, Aptitude.S, Aptitude.B, Aptitude.D, Aptitude.D },
        };

        /// <summary>OVR 가중 [pos][stat] (serve, receive, set, spike, block, dig, speed, power, stamina, mental)</summary>
        public double[][] OvrWeights =
        {
            /* S  */ new[] { .10, .08, .30, .06, .08, .08, .10, .04, .04, .12 },
            /* OH */ new[] { .10, .18, .04, .22, .08, .08, .08, .10, .06, .06 },
            /* OP */ new[] { .12, .05, .03, .28, .10, .04, .08, .14, .08, .08 },
            /* MB */ new[] { .08, .04, .03, .18, .26, .03, .10, .14, .08, .06 },
            /* L  */ new[] { .00, .28, .06, .00, .00, .26, .16, .04, .10, .10 },
        };

        public double[] PositionScale = { 1.0, 1.0, 1.0, 1.0, 0.95 };

        /// <summary>핵심 3스탯 [pos]</summary>
        public StatKind[][] Core3 =
        {
            /* S  */ new[] { StatKind.Set, StatKind.Mental, StatKind.Speed },
            /* OH */ new[] { StatKind.Spike, StatKind.Receive, StatKind.Serve },
            /* OP */ new[] { StatKind.Spike, StatKind.Power, StatKind.Serve },
            /* MB */ new[] { StatKind.Block, StatKind.Spike, StatKind.Power },
            /* L  */ new[] { StatKind.Receive, StatKind.Dig, StatKind.Speed },
        };

        /// <summary>체력 특훈 대상(stamina/speed/power)</summary>
        public StatKind[] StaminaSpecialStats = { StatKind.Stamina, StatKind.Speed, StatKind.Power };

        public static readonly StatKind[] BodyStats = { StatKind.Speed, StatKind.Power, StatKind.Stamina };

        public static TrainingConfig CreateDefault() => new TrainingConfig();

        // ---------- 파생 함수 ----------
        public FatigueZone ZoneOf(double fatigue)
        {
            if (fatigue >= HotHi) return FatigueZone.Overheat;
            if (fatigue >= HotLo) return FatigueZone.Hot;
            if (fatigue < ColdHi) return FatigueZone.Cold;
            return FatigueZone.Normal;
        }

        public double ZoneMult(double fatigue)
        {
            switch (ZoneOf(fatigue))
            {
                case FatigueZone.Overheat: return OverheatMult;
                case FatigueZone.Hot: return HotMult;
                case FatigueZone.Cold: return ColdMult;
                default: return 1.0;
            }
        }

        public bool InHot(double fatigue) => fatigue >= HotLo && fatigue < HotHi;

        public double ComboMult(int combo) => 1.0 + Math.Min(ComboCap, ComboStep * combo);

        public double Diminish(double cur, double pot)
        {
            double rem = pot - cur;
            if (rem <= 0) return 0.0;
            return Math.Max(DiminishMin, Math.Min(1.0, rem / DiminishFull));
        }

        /// <summary>부상 확률(5.4절). mult = 부상 이력 × 서포터 방지 배수.</summary>
        public double InjuryProbability(double fatigue, double risk, double mult = 1.0)
        {
            if (fatigue < InjuryStart) return 0.0;
            double x = (fatigue - InjuryStart) / (100.0 - InjuryStart);
            return Math.Min(1.0, InjuryMax * Math.Pow(x, InjuryExp) * risk * mult);
        }

        public double FatigueGain(double baseAmount, double stamina) => baseAmount * (1.0 - (stamina - StaminaFactorBase) / StaminaFactorDiv);

        public double RiskOf(TrainingAction a)
        {
            if ((int)a >= 0 && (int)a <= 4) return TrainRisk[(int)a];
            if (a == TrainingAction.Special) return SpecialRisk;
            return 0.0;
        }

        public bool IsTraining(TrainingAction a) => (int)a >= 0 && (int)a <= 4;

        public double Ovr(double[] stats, Position pos)
        {
            var w = OvrWeights[(int)pos];
            double sum = 0;
            for (int i = 0; i < 10; i++) sum += w[i] * stats[i];
            return PositionScale[(int)pos] * sum;
        }

        public double Ovr(Stats stats, Position pos)
        {
            var w = OvrWeights[(int)pos];
            double sum = 0;
            for (int i = 0; i < 10; i++) sum += w[i] * stats[Stats.AllKinds[i]];
            return PositionScale[(int)pos] * sum;
        }

        public Grade GradeOf(double ovr)
        {
            if (ovr >= GradeCut[0]) return Grade.S;
            if (ovr >= GradeCut[1]) return Grade.A;
            if (ovr >= GradeCut[2]) return Grade.B;
            if (ovr >= GradeCut[3]) return Grade.C;
            return Grade.D;
        }

        public bool IsRival(string clubA, string clubB)
        {
            if (string.IsNullOrEmpty(clubA) || string.IsNullOrEmpty(clubB)) return false;
            foreach (var pair in Rivals)
            {
                if ((pair[0] == clubA && pair[1] == clubB) || (pair[0] == clubB && pair[1] == clubA)) return true;
            }
            return false;
        }

        public int SkillLevelForHints(int hints)
        {
            int lv = 0;
            for (int i = 0; i < HintLevels.Length; i++) if (hints >= HintLevels[i]) lv = i + 1;
            return lv;
        }

        public bool IsEvalTurn(int turn) => Array.IndexOf(EvalTurns, turn) >= 0;
        public int EvalRound(int turn) => Array.IndexOf(EvalTurns, turn);
        public bool IsStoryTurn(int turn) => Array.IndexOf(StoryTurns, turn) >= 0;
        public int StoryIndex(int turn) => Array.IndexOf(StoryTurns, turn);
        public bool IsSeniorTurn(int turn) => Array.IndexOf(SeniorTurns, turn) >= 0;
    }
}
