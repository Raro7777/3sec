using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Log;

namespace VolleySim.Tests;

/// <summary>
/// v0.2 포지션 가치 보정(match-sim.md 6.9)의 두 가지 계약을 지킨다.
/// 1) 중립값(게인 1.0 · MB 가중 1.0 · MbDecoyK 0 · 디그 가중 1.5 · 블렌드 0.30 · 속공 가용 0.6)으로 되돌리면 v0.1 과 비트 단위로 같다.
///    아래 골든 서명은 v0.1 커밋(f6ad79f)의 Core 를 그대로 빌드해 뽑은 값이다(2026-09 리뷰).
/// 2) 리베로 역할 게인의 스트레치는 클램프가 없어 실효 레이팅이 0~100 을 벗어날 수 있다.
///    그래도 판정 확률은 유한하고 [0,1] 안에 있어야 하며, 방향(좋은 리베로 &gt; 나쁜 리베로)은 유지돼야 한다.
/// </summary>
public class PositionValueRegressionTests
{
    private static SimConfig Neutral()
    {
        var c = SimConfig.CreateDefault();
        c.Receive.LiberoRoleGain = 1.0;
        c.Dig.LiberoRoleGain = 1.0;
        c.Block.MbStrengthWeight = 1.0;
        c.Attack.MbDecoyK = 0.0;
        c.Dig.WeightLibero = 1.5;
        c.Attack.DigTeamBlend = 0.30;
        c.Attack.QuickAvailGoodPass = 0.6;
        return c;
    }

    /// <summary>지정한 선수들의 스탯을 통째로 바꾼 깊은 복사본(원본 불변).</summary>
    private static TeamState Apply(TeamState src, Func<Player, bool> which, Stats stats)
    {
        var t = new TeamState { Team = src.Team, Lineup = src.Lineup.Clone(), TeamCondition = src.TeamCondition, Chemistry = src.Chemistry };
        foreach (var p in src.Roster)
        {
            var c = p.Clone();
            if (which(c)) c.Stats = stats.Clone();
            t.Roster.Add(c);
        }
        foreach (var kv in src.PlayerCondition) t.PlayerCondition[kv.Key] = kv.Value;
        return t;
    }

    private static string Signature(int i, SimConfig cfg, Func<TeamState, TeamState>? homeMod = null, Tactics? ht = null, Tactics? at = null)
    {
        var h = TestHelpers.Home(i);
        if (homeMod != null) h = homeMod(h);
        return MatchSimulator.Simulate(h, TestHelpers.Away(i), ht ?? Tactics.Default(), at ?? Tactics.Default(),
            TestHelpers.Mix(1000, i, 7), cfg, i % 5 == 0).Signature();
    }

    private static readonly Stats All99 = new Stats(99, 99, 99, 99, 99, 99, 99, 99, 99, 99);
    private static readonly Stats All0 = new Stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    [Theory]
    // 기본 전술
    [InlineData(0, "3:2|16-25, 25-22, 22-25, 25-22, 15-13|3812|103,2,8,69,10,14,75,65,157|107,11,8,63,10,15,78,64,162")]
    [InlineData(7, "3:2|25-21, 25-14, 27-29, 22-25, 15-12|3555|114,8,16,72,16,13,69,67,155|101,1,9,57,12,11,62,66,140")]
    public void NeutralConstants_ReproduceV01Signatures(int i, string expected)
    {
        Assert.Equal(expected, Signature(i, Neutral()));
    }

    [Fact]
    public void NeutralConstants_ReproduceV01Signatures_InEdgeScenarios()
    {
        // 속공 전용 전술(디코이·속공 가용 경로), 극단 리베로/MB(스트레치·MB 가중 경로)
        Assert.Equal("3:0|25-22, 27-25, 25-23|2599|77,2,8,45,8,15,50,47,106|70,4,6,39,9,11,49,46,111",
            Signature(2, Neutral(), null, new Tactics { QuickWeight = 1, OpenWeight = 0, BackRowWeight = 0, DelayedWeight = 0 }));
        Assert.Equal("1:3|23-25, 18-25, 25-18, 20-25|2986|86,3,9,59,13,9,54,57,121|93,6,9,56,6,9,53,58,126",
            Signature(5, Neutral(), h => Apply(h, p => p.IsLibero, All99)));
        Assert.Equal("0:3|21-25, 21-25, 16-25|2314|58,1,6,34,13,9,42,42,95|75,4,9,47,5,5,50,44,98",
            Signature(3, Neutral(), h => Apply(h, p => p.IsLibero, All0)));
        Assert.Equal("3:0|25-19, 25-18, 25-15|2156|75,10,7,37,3,15,43,32,82|52,3,6,33,7,6,41,31,93",
            Signature(11, Neutral(), h => Apply(h, p => p.Position == Position.MB, All99)));
    }

    [Fact]
    public void DefaultConstants_DifferFromNeutral()
    {
        // 보정이 실제로 켜져 있는지(중립값과 같으면 위 골든 테스트가 무의미해진다)
        Assert.NotEqual(Signature(0, Neutral()), Signature(0, SimConfig.CreateDefault()));
    }

    [Fact]
    public void LiberoRoleGain_ExtremeRatings_KeepProbabilitiesValid()
    {
        // 스트레치 결과가 0 미만(스탯 0 → 80+2×(0−80) = −80)·100 초과(스탯 99 → 100 이상)로 나가도
        // 확률은 유한하고 [0,1] 안이어야 한다(SimMath.Logit/Sigmoid 의 클램프에 의존).
        foreach (var stats in new[] { All0, All99 })
        {
            for (int i = 0; i < 8; i++)
            {
                var h = Apply(TestHelpers.Home(i), p => p.IsLibero, stats);
                var r = MatchSimulator.Simulate(h, TestHelpers.Away(i), null, null, TestHelpers.Mix(1000, i, 7));
                Assert.True(r.HomeSets == 3 || r.AwaySets == 3);
                foreach (var e in r.Log.Events)
                {
                    Assert.False(double.IsNaN(e.Probability), $"{e.Type} 확률 NaN");
                    Assert.InRange(e.Probability, 0.0, 1.0);
                }
            }
        }
    }

    [Fact]
    public void LiberoRoleGain_IsMonotonic_GoodLiberoBeatsBadLibero()
    {
        int good = 0, bad = 0;
        for (int i = 0; i < 60; i++)
        {
            if (MatchSimulator.Simulate(Apply(TestHelpers.Home(i), p => p.IsLibero, All99), TestHelpers.Away(i), null, null, TestHelpers.Mix(1000, i, 7), collectEvents: false).Winner == TeamSide.Home) good++;
            if (MatchSimulator.Simulate(Apply(TestHelpers.Home(i), p => p.IsLibero, All0), TestHelpers.Away(i), null, null, TestHelpers.Mix(1000, i, 7), collectEvents: false).Winner == TeamSide.Home) bad++;
        }
        Assert.True(good > bad + 10, $"리베로 99 승 {good} vs 리베로 0 승 {bad}");
    }
}
