using VolleySim.Skills;

namespace VolleySim.Config
{
    /// <summary>
    /// 시뮬레이션 상수 전부를 모아둔 튜닝 포인트. 모든 확률·계수는 여기서만 정의한다.
    /// 확률 상수는 "동급 대결(diff=0)" 시의 기준 확률(base)이고, k 는 로짓 1 을 움직이는 스탯 차이다.
    /// (자세한 수식은 docs/match-sim.md 참조)
    /// </summary>
    public sealed class SimConfig
    {
        public MatchRules Match = new MatchRules();
        public RatingWeights Rating = new RatingWeights();
        public ServeParams Serve = new ServeParams();
        public ReceiveParams Receive = new ReceiveParams();
        public SetParams Set = new SetParams();
        public AttackParams Attack = new AttackParams();
        public BlockParams Block = new BlockParams();
        public DigParams Dig = new DigParams();
        public FatigueParams Fatigue = new FatigueParams();
        public ClutchParams Clutch = new ClutchParams();
        public ChemistryParams Chemistry = new ChemistryParams();
        public FormationParams Formation = new FormationParams();

        /// <summary>
        /// 전역 스탯 민감도 배수. 모든 스탯 대결의 로짓 기울기(diff/k)에 곱해진다. 1.0 = k 그대로.
        /// 팀 전체 능력치 차이가 승률로 얼마나 빨리 번지는지를 한 번에 조절하는 노브.
        /// </summary>
        public double StatSensitivity = 1.0;

        /// <summary>개인 스킬 훅. null 이면 미적용(프로토타입 기본).</summary>
        public ISkillEffectProvider SkillProvider = null;

        public static SimConfig CreateDefault() => new SimConfig();

        // ------------------------------------------------------------------

        public sealed class MatchRules
        {
            public int SetsToWin = 3;
            public int PointsToWinSet = 25;
            public int PointsToWinFinalSet = 15;
            public int MinPointMargin = 2;
            public int MaxSubstitutionsPerSet = 6;
            /// <summary>안전장치: 한 랠리에서 공격 시퀀스 최대 횟수(초과 시 공격 범실 처리).</summary>
            public int MaxAttacksPerRally = 14;
            /// <summary>안전장치: 세트당 최대 랠리 수.</summary>
            public int MaxRalliesPerSet = 400;
            /// <summary>true 면 1세트 홈 팀이 먼저 서브. false 면 시드 기반 동전 던지기.</summary>
            public bool HomeServesFirst = true;
            /// <summary>홈 코트 이점(로짓). 홈 팀의 공격·서브 판정에 가산. 기본 0(밸런스 측정용).</summary>
            public double HomeCourtLogit = 0.0;
        }

        /// <summary>복합 레이팅 가중치. 각 합은 1.0 이 되도록 유지(0~100 스케일 보존).</summary>
        public sealed class RatingWeights
        {
            public double ServeFromServe = 0.75;
            public double ServeFromPower = 0.25;

            public double ReceiveFromReceive = 0.80;
            public double ReceiveFromSpeed = 0.20;

            public double SetFromSet = 0.85;
            public double SetFromSpeed = 0.15;

            public double AttackFromSpike = 0.65;
            public double AttackFromPower = 0.25;
            public double AttackFromSpeed = 0.10;
            /// <summary>공격 레이팅 신장 보정: (heightCm - HeightPivot) * 계수, [-AttackHeightCap, +AttackHeightCap]</summary>
            public double AttackHeightPerCm = 0.15;
            public double AttackHeightCap = 4.0;

            public double BlockFromBlock = 0.80;
            public double BlockFromSpeed = 0.20;
            public double BlockHeightPerCm = 0.6;
            public double BlockHeightCap = 8.0;

            public double DigFromDig = 0.75;
            public double DigFromSpeed = 0.25;

            public double HeightPivotCm = 176.0;
            /// <summary>실효 배수 하한/상한(컨디션×피로×클러치).</summary>
            public double EffectiveMultiplierMin = 0.6;
            public double EffectiveMultiplierMax = 1.4;
        }

        public sealed class ServeParams
        {
            /// <summary>서브 범실 기준 확률(레이팅 = ErrorRefRating 일 때). 공격성 0↔1 선형 보간.</summary>
            public double ErrorBaseSafe = 0.05;
            public double ErrorBaseAggressive = 0.15;
            public double ErrorRefRating = 65.0;
            public double ErrorK = 70.0;
            /// <summary>서브 공격성이 서브-리시브 대결에 주는 로짓: AggressionLogit * (aggr - 0.5). 에이스↑·리시브 품질↓.</summary>
            public double AggressionLogit = 0.75;
            /// <summary>동급 대결 시 에이스(리시브 실패) 확률(범실 제외, 인플레이 서브 기준).</summary>
            public double AceBase = 0.085;
            /// <summary>서브-리시브 대결 k.</summary>
            public double ReceiveK = 60.0;
            /// <summary>서버가 약한 리시버를 노리는 정도(0=무작위). 가중치 *= 1 + Bias*aggr*(ref - recv)/50.</summary>
            public double TargetingBias = 0.6;
            public double TargetingRefRating = 68.0;
        }

        public sealed class ReceiveParams
        {
            /// <summary>에이스가 아닐 때 리시브 A(Perfect) 기준 확률.</summary>
            public double PerfectBase = 0.34;
            /// <summary>A가 아닐 때 B(Good) 기준 확률. 나머지가 C(Poor).</summary>
            public double GoodBase = 0.60;

            // 리시버 선택 가중치(포지션×전후위)
            public double WeightLibero = 1.6;
            public double WeightOhBack = 1.0;
            public double WeightOhFrontLeft = 0.8;   // 4번 OH
            public double WeightOhFrontRight = 0.5;  // 2번 OH
            public double WeightOpBack = 0.45;
            public double WeightOpFront = 0.2;
            public double WeightMbBack = 0.35;
            public double WeightMbFront = 0.0;
            public double WeightSetterBack = 0.12;
            public double WeightSetterFront = 0.03;
            /// <summary>프리볼(상대가 넘겨준 쉬운 공) 리시브 A 확률. 나머지는 B.</summary>
            public double FreeBallPerfectProb = 0.80;
        }

        public sealed class SetParams
        {
            /// <summary>패스 품질별 세트 품질 기준 확률(세터 레이팅 = RefRating 일 때).</summary>
            public double PerfectFromPerfectPass = 0.70;
            public double PerfectFromGoodPass = 0.35;
            public double GoodFromGoodPass = 0.70;     // Perfect 가 아닐 때
            public double GoodFromPoorPass = 0.45;     // Poor 패스에서는 Perfect 불가
            public double RefRating = 70.0;
            public double K = 40.0;
            /// <summary>세터가 첫 터치를 한 경우 다른 선수가 세트: 로짓 페널티.</summary>
            public double NonSetterPenaltyLogit = -0.7;
            /// <summary>세터 직접 공격(덤프) 확률: 세터 전위 + Perfect 패스일 때.</summary>
            public double SetterDumpProb = 0.03;
            /// <summary>Poor 패스에서 공격 대신 프리볼로 넘길 확률.</summary>
            public double FreeBallFromPoorPass = 0.18;
        }

        public sealed class AttackParams
        {
            /// <summary>공격 범실 기준 확률(레이팅 = ErrorRefRating, Good 세트, 오픈).</summary>
            public double ErrorBase = 0.075;
            public double ErrorRefRating = 70.0;
            public double ErrorK = 120.0;
            /// <summary>범실·블로킹이 아닐 때 동급(공격 vs 디그) 킬 기준 확률.</summary>
            public double KillBase = 0.41;
            public double KillK = 120.0;
            /// <summary>디그 레이팅 = (1-Blend)*선택된 디거 + Blend*수비팀 비블로커 평균.</summary>
            public double DigTeamBlend = 0.30;
            /// <summary>킬 대결의 수비 레이팅 = (1-Share)*디그 + Share*블로커 평균 블로킹 레이팅(블록이 공격 코스를 좁힘).</summary>
            public double BlockShareInKill = 0.35;
            /// <summary>리시브 팀의 첫 공격(퍼스트볼)에 가산되는 킬 로짓(조직된 공격 vs 트랜지션).</summary>
            public double FirstBallKillLogit = 0.35;

            // 공격 유형별 보정 (로짓 가산 / 범실 배수)
            public double QuickKillLogit = 0.30;
            public double QuickErrorMult = 1.0;
            public double OpenKillLogit = 0.0;
            public double OpenErrorMult = 1.0;
            public double BackRowKillLogit = -0.10;
            public double BackRowErrorMult = 1.2;
            public double DelayedKillLogit = 0.25;
            public double DelayedErrorMult = 1.1;
            public double DumpKillLogit = 0.10;
            public double DumpErrorMult = 0.8;

            // 세트 품질별 보정
            public double PerfectSetKillLogit = 0.45;
            public double PerfectSetErrorMult = 0.9;
            public double PoorSetKillLogit = -0.70;
            public double PoorSetErrorMult = 1.5;

            // 패스 품질에 따른 공격 옵션 가용성 배수
            public double QuickAvailGoodPass = 0.6;   // Perfect=1, Good=0.6, Poor=0
            public double DelayedAvailGoodPass = 0.4; // Perfect=1, Good=0.4, Poor=0
            public double BackRowAvailPoorPass = 0.4; // Perfect/Good=1, Poor=0.4
            /// <summary>오픈 카테고리에서 전위 OP 가 선택될 상대 가중치(OH 대비).</summary>
            public double OpenOpRelativeWeight = 0.8;
            /// <summary>트랜지션(디그 후 공격)에서 공격자에게 가산되는 킬 로짓(랠리 길이 증가 억제).</summary>
            public double TransitionKillLogitPerAttack = 0.05;
            /// <summary>
            /// 예측 가능성 페널티: 선택된 공격 유형의 전술 비중(share)이 FreeShare 를 넘는 만큼
            /// 킬 로짓에서 빼고 블로킹 로짓에 더한다 → 한 유형에 몰빵하면 상대가 읽는다.
            /// penalty = PredictabilityLogit * max(0, share - PredictabilityFreeShare)
            /// </summary>
            public double PredictabilityLogit = 0.4;
            public double PredictabilityFreeShare = 0.45;
        }

        public sealed class BlockParams
        {
            /// <summary>동급 대결(2인 블로킹, 오픈) 블로킹 득점 기준 확률.</summary>
            public double KillBase = 0.115;
            public double K = 120.0;
            /// <summary>블로커 수 - 2 당 블로킹 강도 가산(레이팅 포인트).</summary>
            public double ExtraBlockerBonus = 8.0;
            /// <summary>블로킹 득점이 아닐 때 터치(유효 블로킹) 기준 확률.</summary>
            public double TouchBase = 0.22;
            /// <summary>터치 중 블록 아웃(공격팀 득점) 비율.</summary>
            public double TouchOutRatio = 0.30;
            /// <summary>터치 중 공격팀 코트로 되돌아가 커버되는 비율.</summary>
            public double TouchBackRatio = 0.30;
            /// <summary>터치 후 느려진 공: 수비팀 디그 대결에 가산되는 로짓(공격자에게 불리).</summary>
            public double TouchSlowDigLogit = 0.6;
            /// <summary>커버(블록 터치 후 되돌아온 공)를 살릴 확률 기준(커버어 디그 레이팅 vs Attack.ErrorRefRating).</summary>
            public double CoverBase = 0.75;
            public double CoverGoodQualityProb = 0.35;

            // 유형별 보정
            public double QuickBlockLogit = -0.15;
            public double BackRowBlockLogit = -0.35;
            public double DelayedBlockLogit = -0.10;
            public double DumpBlockLogit = -0.4;
            public double PoorSetBlockLogit = 0.40;
            public double PerfectSetBlockLogit = -0.30;

            // 2번째/3번째 블로커 참여 확률(스피드 대결 기준)
            public double JoinOpen = 0.80;
            public double JoinBackRow = 0.60;
            public double JoinQuick = 0.25;
            public double JoinDelayed = 0.30;
            public double JoinDump = 0.15;
            public double JoinThirdPoorSet = 0.35;
            public double JoinSpeedRef = 65.0;
            public double JoinK = 60.0;
        }

        public sealed class DigParams
        {
            /// <summary>디그 성공 시 품질 A(Perfect) 기준 확률(디그 vs 공격 레이팅 동급).</summary>
            public double PerfectBase = 0.22;
            public double GoodBase = 0.55;
            public double K = 120.0;

            // 디거 선택 가중치
            public double WeightLibero = 1.5;
            public double WeightOh = 1.0;
            public double WeightOp = 0.8;
            public double WeightMb = 0.6;
            public double WeightSetter = 0.5;
        }

        public sealed class FatigueParams
        {
            /// <summary>세트 1개 진행당 (1 - stamina/100) 에 곱해지는 손실 비율. 스태미나 60, 5세트 후반이면 약 4.8% 감소.</summary>
            public double LossPerSet = 0.03;
            /// <summary>세트 내 진행도 환산 기준 점수(총 득점 합).</summary>
            public double PointsPerSetForProgress = 46.0;
            public double MaxLoss = 0.30;
        }

        public sealed class ClutchParams
        {
            /// <summary>양 팀 점수가 (세트 목표점 - ScoreFromEnd) 이상이고 점수 차가 MaxDiff 이하이면 클러치.</summary>
            public int ScoreFromEnd = 5;
            public int MaxDiff = 2;
            /// <summary>클러치 시 실효 배수 = 1 + Scale * (mental - Pivot) / 50.</summary>
            public double MentalScale = 0.15;
            public double MentalPivot = 60.0;
        }

        public sealed class ChemistryParams
        {
            /// <summary>세트 품질 로짓 가산 = Scale * (chem - 50) / 50.</summary>
            public double LogitScale = 0.50;
        }

        public sealed class FormationParams
        {
            public double LiberoCenteredLiberoMult = 1.7;
            public double LiberoCenteredOhMult = 0.8;
            public double LiberoCenteredLiberoLogit = 0.05;
            public double LiberoCenteredOtherLogit = -0.05;

            public double SpreadLiberoMult = 0.7;
            public double SpreadOhMult = 1.2;
            public double SpreadLiberoLogit = 0.0;
            public double SpreadOtherLogit = 0.0;
        }
    }
}
