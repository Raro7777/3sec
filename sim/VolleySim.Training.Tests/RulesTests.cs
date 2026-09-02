using VolleySim.Domain;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Training.Tests;

public class RulesTests
{
    private static readonly TrainingConfig Cfg = TrainingConfig.CreateDefault();

    [Fact]
    public void TwelveTurns_ThenGraduated()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 3);
        var r = TrainingRunner.Run(s, new OptimalPolicy());
        Assert.Equal(SessionPhase.Graduated, s.Phase);
        Assert.Equal(12, s.Log.Count);
        Assert.Equal(3, r.Evaluations.Count);
        Assert.NotNull(r.Instance);
        Assert.Throws<InvalidOperationException>(() => s.Apply(TrainingAction.Serve));
    }

    [Fact]
    public void FatigueClampedAndStatsNeverExceedPotential()
    {
        foreach (var policy in new TrainingPolicy[] { new NoRestPolicy(), new RandomPolicy(), new PushPolicy() })
        {
            for (int i = 0; i < 200; i++)
            {
                var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 100 + i);
                var guard = 0;
                while (s.Phase != SessionPhase.Graduated && guard++ < 100)
                {
                    Assert.InRange(s.Fatigue, 0.0, 100.0);
                    for (int k = 0; k < 10; k++) Assert.True(s.Trainee.Current[k] <= s.Trainee.Potential[k] + 1e-9);
                    if (s.Phase == SessionPhase.AwaitAction) s.Apply(policy.Choose(s));
                    else s.ResolveEvent(0);
                }
                for (int k = 0; k < 10; k++) Assert.InRange(s.Result!.Instance.FinalStats[k], 0, s.Trainee.Potential[k]);
            }
        }
    }

    [Fact]
    public void NoRest_FatigueTrajectoryMatchesDoc()
    {
        // 5.1절: 무휴식 궤적 0 → 15 → 30 → 45(핫존) → 60 → 75 → 90(과열) (스태미나 60 기준). 결정론 모드.
        var card = OracleFixtures.Card("OH", "t01", new[] { 60, 60, 60, 60, 60, 60, 60, 60, 60, 60 }, new[] { 90, 90, 90, 90, 90, 90, 90, 90, 90, 60 });
        var s = OracleFixtures.NewSession(card, 1, det: true);
        double[] expected = { 15, 30, 45, 60 };
        for (int t = 0; t < 4; t++)
        {
            // 스태미나가 훈련으로 오르면 계수가 1보다 작아지므로 스태미나에 닿지 않는 토스 훈련을 쓴다.
            s.Apply(TrainingAction.Set);
            if (s.Phase == SessionPhase.AwaitEventChoice) s.ResolveEvent(0);
            double f = s.Log[t].FatigueAfter; // 턴 기록은 평가전 +12 이전 값(문서 4.4절 표와 같은 표기)
            Assert.InRange(f, expected[t] - 0.01, expected[t] + 0.01);
        }
        Assert.InRange(s.Fatigue, 72 - 0.01, 72 + 0.01); // T4 평가전 후 +12
        Assert.Equal(FatigueZone.Cold, Cfg.ZoneOf(29));
        Assert.Equal(FatigueZone.Normal, Cfg.ZoneOf(30));
        Assert.Equal(FatigueZone.Hot, Cfg.ZoneOf(45));
        Assert.Equal(FatigueZone.Hot, Cfg.ZoneOf(79));
        Assert.Equal(FatigueZone.Overheat, Cfg.ZoneOf(80));
        Assert.Equal(0.85, Cfg.ZoneMult(10)); Assert.Equal(1.0, Cfg.ZoneMult(35)); Assert.Equal(1.5, Cfg.ZoneMult(60)); Assert.Equal(0.85, Cfg.ZoneMult(90));
    }

    [Fact]
    public void LiberoSpikeTraining_IsAlmostMeaningless()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrL(), 1, det: true);
        s.Trainee.Fatigue = 35; // 적정 구간
        var g = s.PreviewGains(TrainingAction.Spike);
        double total = g.Sum();
        Assert.InRange(g[(int)StatKind.Spike], 0.3, 0.7);   // 4.6 × 0.40 × 0.30 ≈ 0.55
        Assert.True(total < 2.0, $"L 스파이크 훈련 총 상승 {total:0.00}"); // 문서 3.2절: 첫 턴 +0.6, 부 스탯 포함 ≈ 1.6
        var r = s.PreviewGains(TrainingAction.Receive);
        Assert.True(r[(int)StatKind.Receive] > 5.5, "L 리시브(적성 S)는 크게 오른다");
    }

    [Fact]
    public void InjuryProbabilityTable()
    {
        Assert.Equal(0.0, Cfg.InjuryProbability(44.9, 1.3));
        Assert.Equal(0.0, Cfg.InjuryProbability(45, 1.3));
        Assert.InRange(Cfg.InjuryProbability(60, 1.3), 0.064, 0.066);   // 6.5%
        Assert.InRange(Cfg.InjuryProbability(70, 1.5), 0.169, 0.171);   // 17.0%
        Assert.InRange(Cfg.InjuryProbability(100, 1.3), 0.519, 0.521);  // 52.0%
        Assert.InRange(Cfg.InjuryProbability(70, 1.3, 2.0), 0.294, 0.296); // 부상 이력 ×2 → 29.5%
        Assert.InRange(Cfg.InjuryProbability(70, 1.3, 0.80), 0.117, 0.119); // 풀세팅 서포터 → 11.8%
        Assert.Equal(1.0, Cfg.InjuryProbability(100, 1.3, 2.0));
    }

    [Fact]
    public void InjuryHistoryDoublesProbability()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1);
        s.Trainee.Fatigue = 70;
        double before = s.InjuryProbability(TrainingAction.Spike);
        s.Trainee.Injuries = 1;
        double after = s.InjuryProbability(TrainingAction.Spike);
        Assert.InRange(after / before, 1.99, 2.01);
    }

    [Fact]
    public void SupporterTrainBonus_CappedAt20Percent()
    {
        var cfg = TrainingConfig.CreateDefault();
        var sups = new List<SupporterInfo>();
        for (int i = 0; i < 3; i++)
        {
            var s = new SupporterInfo { Id = "x" + i, Name = "x" + i, Position = Position.OH, ClubId = "t01" };
            for (int k = 0; k < 10; k++) s.Stats[k] = 100;
            sups.Add(s);
        }
        var prof = SupportProfile.Build(Position.OH, "t01", sups, cfg);
        foreach (var b in prof.TrainBonus) Assert.InRange(b, 0.2 - 1e-9, 0.2 + 1e-9);
        Assert.InRange(prof.InjuryMult, 0.80 - 1e-9, 0.80 + 1e-9);
        Assert.InRange(prof.CondDownMult, 0.65 - 1e-9, 0.65 + 1e-9);
        Assert.InRange(prof.SpecialBonus, 0.06 - 1e-9, 0.06 + 1e-9);
    }

    [Fact]
    public void SupporterPreset_FullSetting_MatchesDocTable()
    {
        // 9.3절 풀세팅: +8.0 / +12.2 / +4.8 / +12.3 / +8.8 %, 핫존 +5%p, 부상 ×0.81, 컨디션 ×0.75, 특훈 +6%p
        var prof = SupportProfile.Build(Position.OH, "t01", OracleFixtures.FullSupport(), Cfg);
        double[] expect = { 0.080, 0.1225, 0.0475, 0.1225, 0.0875 };
        for (int t = 0; t < 5; t++) Assert.InRange(prof.TrainBonus[t], expect[t] - 1e-9, expect[t] + 1e-9);
        Assert.InRange(prof.HotExtra, 0.05 - 1e-9, 0.05 + 1e-9);
        Assert.InRange(prof.InjuryMult, 0.81, 0.82);
        Assert.InRange(prof.CondDownMult, 0.75 - 1e-9, 0.75 + 1e-9);
        Assert.InRange(prof.SpecialBonus, 0.06 - 1e-9, 0.06 + 1e-9);
    }

    [Fact]
    public void RecommendSupporters_MatchesDocExample()
    {
        var rec = SupportProfile.Recommend(Position.OH, "t01", OracleFixtures.AllSix(), Cfg, 3);
        Assert.Equal(new[] { "SSR OH S등급(동문)", "SSR OH A등급", "SR OH B등급" }, rec.Select(r => r.Name).ToArray());
    }

    [Fact]
    public void ShallowRest_ConditionUp30_DeepRest70()
    {
        int upShallow = 0, upDeep = 0, n = 4000;
        for (int i = 0; i < n; i++)
        {
            var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 5000 + i);
            s.Trainee.Fatigue = 30;
            s.Apply(TrainingAction.Rest);
            if (s.Log[0].ConditionAfter > s.Log[0].ConditionBefore) upShallow++;
            Assert.True(s.Log[0].ShallowRest);

            var d = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 9000 + i);
            d.Trainee.Fatigue = 60;
            d.Apply(TrainingAction.Rest);
            if (d.Log[0].ConditionAfter > d.Log[0].ConditionBefore) upDeep++;
            Assert.False(d.Log[0].ShallowRest);
            Assert.InRange(d.Log[0].FatigueAfter, 14.9, 15.1);
        }
        Assert.InRange(upShallow / (double)n, 0.27, 0.33);
        Assert.InRange(upDeep / (double)n, 0.67, 0.73);
    }

    /// <summary>강도 곡선·부상 시작·휴식 깊이의 경계값(3.6·5.1·5.4절). 부등호 방향이 뒤집히면 여기서 잡힌다.</summary>
    [Fact]
    public void BoundaryValues_ZoneInjuryAndRestDepth()
    {
        // 콜드/적정 경계 30
        Assert.Equal(FatigueZone.Cold, Cfg.ZoneOf(29.999));
        Assert.Equal(FatigueZone.Normal, Cfg.ZoneOf(30));
        Assert.Equal(0.85, Cfg.ZoneMult(29.999));
        Assert.Equal(1.00, Cfg.ZoneMult(30));
        // 적정/핫존 경계 45 — 핫존 진입선과 부상 배지 등장선이 일치해야 한다(5.4절)
        Assert.Equal(FatigueZone.Normal, Cfg.ZoneOf(44.999));
        Assert.Equal(FatigueZone.Hot, Cfg.ZoneOf(45));
        Assert.False(Cfg.InHot(44.999));
        Assert.True(Cfg.InHot(45));
        Assert.Equal(0.0, Cfg.InjuryProbability(44.999, 1.3));
        Assert.Equal(0.0, Cfg.InjuryProbability(45, 1.3));
        Assert.True(Cfg.InjuryProbability(45.001, 1.3) > 0);
        // 핫존/과열 경계 80
        Assert.Equal(FatigueZone.Hot, Cfg.ZoneOf(79.999));
        Assert.Equal(FatigueZone.Overheat, Cfg.ZoneOf(80));
        Assert.True(Cfg.InHot(79.999));
        Assert.False(Cfg.InHot(80));
        Assert.Equal(1.50, Cfg.ZoneMult(79.999));
        Assert.Equal(0.85, Cfg.ZoneMult(80));
        // 깊은 휴식 경계 50(피로 ≥ 50 이면 깊은 휴식 70%)
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1);
        s.Trainee.Fatigue = 49.999;
        Assert.False(s.IsDeepRest);
        Assert.Equal(Cfg.RestCondUpShallow, s.RestCondUpProbability());
        s.Trainee.Fatigue = 50;
        Assert.True(s.IsDeepRest);
        Assert.Equal(Cfg.RestCondUpDeep, s.RestCondUpProbability());
        // 세션이 노출하는 배지도 같은 경계를 쓴다: 45 미만이면 전 훈련 0%, 45 초과면 전 훈련 > 0%
        s.Trainee.Fatigue = 44.999;
        for (int t = 0; t < 5; t++) Assert.Equal(0.0, s.InjuryProbability((TrainingAction)t));
        s.Trainee.Fatigue = 45.001;
        for (int t = 0; t < 5; t++) Assert.True(s.InjuryProbability((TrainingAction)t) > 0, $"훈련 {t} 배지 0");
    }

    /// <summary>WeightedPreview 는 훈련·특훈을 같은 눈금으로 비교해야 한다(포지션 스케일 비대칭 회귀).</summary>
    [Fact]
    public void WeightedPreview_UsesSameScaleForTrainingAndSpecial()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrL(), 1, det: true); // posScale 0.95 인 리베로
        s.Trainee.Fatigue = 50; s.Trainee.Condition = Condition.Best;
        var pw = Cfg.OvrWeights[(int)s.Trainee.Position];
        double Manual(TrainingAction a)
        {
            var g = s.PreviewGains(a);
            double sum = 0;
            for (int i = 0; i < 10; i++) sum += pw[i] * g[i];
            return sum;
        }
        for (int t = 0; t < 5; t++)
            Assert.InRange(s.WeightedPreview((TrainingAction)t) - Manual((TrainingAction)t), -1e-9, 1e-9);
        Assert.InRange(s.WeightedPreview(TrainingAction.Special) - Manual(TrainingAction.Special), -1e-9, 1e-9);
    }

    [Fact]
    public void GradeCuts()
    {
        Assert.Equal(Grade.S, Cfg.GradeOf(80.0));
        Assert.Equal(Grade.A, Cfg.GradeOf(79.99));
        Assert.Equal(Grade.A, Cfg.GradeOf(74.0));
        Assert.Equal(Grade.B, Cfg.GradeOf(73.99));
        Assert.Equal(Grade.B, Cfg.GradeOf(66.0));
        Assert.Equal(Grade.C, Cfg.GradeOf(65.99));
        Assert.Equal(Grade.C, Cfg.GradeOf(55.0));
        Assert.Equal(Grade.D, Cfg.GradeOf(54.99));
    }

    [Fact]
    public void OvrOfExampleCard_Is64_8()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1);
        Assert.InRange(s.InitialOvr, 64.75, 64.85);
    }

    [Fact]
    public void TreatmentTurn_LocksChoices_AndSkipsEvaluation()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1, det: true);
        // T1~T3 훈련 후 T4 직전에 강제로 중상 상태를 만든다.
        s.Apply(TrainingAction.Spike); s.Apply(TrainingAction.Spike); if (s.Phase == SessionPhase.AwaitEventChoice) s.ResolveEvent(0);
        s.Apply(TrainingAction.Spike);
        Assert.Equal(4, s.Turn);
        s.Trainee.TreatmentTurnsLeft = 2; s.Trainee.Injuries = 1;
        foreach (var o in s.GetOptions()) Assert.False(o.Available);
        var rec = s.Apply(TrainingAction.Spike);
        Assert.Equal(TrainingAction.Treat, rec.Action);
        Assert.True(rec.Eval!.Absent);
        Assert.Equal(1, s.Trainee.TreatmentTurnsLeft);
        Assert.Equal(0, s.Combo);
    }

    [Fact]
    public void Special_OnlyAppearsInHotZoneWithGoodCondition()
    {
        int appearedCold = 0, appearedHot = 0, n = 2000;
        for (int i = 0; i < n; i++)
        {
            // 콜드존·보통 컨디션에서 시작: 특훈 등장 불가
            var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 70000 + i);
            if (s.SpecialAvailable) appearedCold++;
        }
        Assert.Equal(0, appearedCold);
        for (int i = 0; i < n; i++)
        {
            // 핫존 + 호조에서 다음 턴을 시작하도록: 피로 60, 컨디션 호조 상태에서 휴식이 아닌 훈련 후 다음 턴 등장률 확인은 드리프트에 섞이므로
            // 여기서는 등장 확률 25%를 직접 확인하기 위해 피로 50·절호조에서 토스 훈련(핫존 유지) 후 관찰
            var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 80000 + i);
            s.Trainee.Fatigue = 50; s.Trainee.Condition = Condition.Best;
            s.Apply(TrainingAction.Set);
            if (s.Phase == SessionPhase.AwaitEventChoice) s.ResolveEvent(1);
            if (s.SpecialAvailable && s.Condition >= Condition.Good && Cfg.InHot(s.Fatigue)) appearedHot++;
        }
        Assert.InRange(appearedHot / (double)n, 0.15, 0.30);
    }

    [Fact]
    public void MvpGrantsSpecialNextTurn()
    {
        var forced = new StubEvaluationProvider.Forced(_ => (true, 90));
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1, eval: forced, det: true);
        for (int t = 0; t < 4; t++) { s.Apply(TrainingAction.Set); if (s.Phase == SessionPhase.AwaitEventChoice) s.ResolveEvent(0); }
        Assert.Equal(5, s.Turn);
        Assert.True(s.SpecialAvailable);
        Assert.True(s.Evaluations[0].Mvp);
        Assert.Equal(2, s.Evaluations[0].CoreGain);
        Assert.Equal(3, s.Evaluations[0].Hint); // MVP 2 + 승리 1
        Assert.Contains(s.GetOptions(), o => o.Action == TrainingAction.Special && o.Available);
    }

    [Fact]
    public void Graduation_FinalStatsRoundedAndSkillLevels()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 42);
        var r = TrainingRunner.Run(s, new OptimalPolicy());
        for (int k = 0; k < 10; k++)
            Assert.Equal((int)Math.Round(Math.Min(s.Trainee.Current[k], s.Trainee.Potential[k]), MidpointRounding.ToEven), r.Instance.FinalStats[k]);
        Assert.Equal(Cfg.SkillLevelForHints(r.Hints), r.SkillLevel);
        Assert.Equal(0, Cfg.SkillLevelForHints(2)); Assert.Equal(1, Cfg.SkillLevelForHints(3)); Assert.Equal(2, Cfg.SkillLevelForHints(6)); Assert.Equal(3, Cfg.SkillLevelForHints(12));
        Assert.InRange(Math.Abs(r.Instance.Ovr - r.OvrRaw), 0, 0.5);
    }

    [Fact]
    public void Options_ExposeExpectedGainsAndBadges()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1, det: true);
        var opts = s.GetOptions();
        Assert.Equal(6, opts.Count);
        var spike = opts.First(o => o.Action == TrainingAction.Spike);
        Assert.Equal(Aptitude.A, spike.Aptitude);
        // 콜드존: 4.6 × 1.15 × 0.85 = 4.4965 (문서 워크드 예시 T1 spike +4.5)
        Assert.InRange(spike.ExpectedGains[(int)StatKind.Spike], 4.49, 4.50);
        Assert.Equal(0.0, spike.InjuryP);
        var rest = opts.First(o => o.Action == TrainingAction.Rest);
        Assert.Equal(0.30, rest.RestCondUpP);
        Assert.False(rest.DeepRest);
    }
}
