using VolleySim.Domain;

namespace VolleySim.Tests;

public class SensitivityTests
{
    [Fact]
    public void AllStatsPlus10_RaisesWinRateSignificantly()
    {
        double baseRate = TestHelpers.WinRate(600, null);
        double plus10 = TestHelpers.WinRate(600, h => TestHelpers.AddAll(h, 10));
        Assert.InRange(baseRate, 0.42, 0.58);
        Assert.True(plus10 > 0.65, $"+10 win rate {plus10:P1} not significantly above baseline {baseRate:P1}");
        Assert.True(plus10 - baseRate > 0.15);
    }

    [Fact]
    public void WinRate_IsMonotonicInStatDelta()
    {
        double m10 = TestHelpers.WinRate(500, h => TestHelpers.AddAll(h, -10));
        double p0 = TestHelpers.WinRate(500, null);
        double p5 = TestHelpers.WinRate(500, h => TestHelpers.AddAll(h, 5));
        double p10 = TestHelpers.WinRate(500, h => TestHelpers.AddAll(h, 10));
        double p20 = TestHelpers.WinRate(500, h => TestHelpers.AddAll(h, 20));
        Assert.True(m10 < p0, $"{m10} < {p0}");
        Assert.True(p0 < p5, $"{p0} < {p5}");
        Assert.True(p5 < p10, $"{p5} < {p10}");
        Assert.True(p10 <= p20, $"{p10} <= {p20}"); // +20 은 포화(≈100%)될 수 있어 비강격
        Assert.True(p20 > 0.9, $"+20 should be dominant: {p20}");
    }

    [Fact]
    public void EachPosition_ContributesPositively()
    {
        double baseRate = TestHelpers.WinRate(500, null);
        foreach (var pos in new[] { Position.S, Position.OH, Position.OP, Position.MB, Position.L })
        {
            double r = TestHelpers.WinRate(500, h => TestHelpers.AddAll(h, 20, p => p.Position == pos));
            Assert.True(r > baseRate + 0.03, $"{pos} +20 gave {r:P1} vs base {baseRate:P1}");
        }
    }

    [Fact]
    public void ServeAggression_TradesAcesForErrors()
    {
        var aggr = new Tactics { ServeAggression = 1.0 };
        var safe = new Tactics { ServeAggression = 0.0 };
        var a = new Result.TeamMatchStats();
        var s = new Result.TeamMatchStats();
        for (int i = 0; i < 300; i++)
        {
            var ra = MatchSimulator.Simulate(TestHelpers.Home(i), TestHelpers.Away(i), aggr, null, TestHelpers.Mix(1000, i, 7), collectEvents: false);
            var rs = MatchSimulator.Simulate(TestHelpers.Home(i), TestHelpers.Away(i), safe, null, TestHelpers.Mix(1000, i, 7), collectEvents: false);
            a.Add(ra.HomeStats);
            s.Add(rs.HomeStats);
        }
        Assert.True(a.AceRate > s.AceRate, $"aces {a.AceRate} vs {s.AceRate}");
        Assert.True(a.ServeErrorRate > s.ServeErrorRate, $"errors {a.ServeErrorRate} vs {s.ServeErrorRate}");
    }

    [Fact]
    public void AttackDistribution_FollowsTactics()
    {
        var quick = new Tactics { QuickWeight = 1, OpenWeight = 0, BackRowWeight = 0, DelayedWeight = 0 };
        var open = new Tactics { QuickWeight = 0, OpenWeight = 1, BackRowWeight = 0, DelayedWeight = 0 };
        var q = new Result.TeamMatchStats();
        var o = new Result.TeamMatchStats();
        for (int i = 0; i < 200; i++)
        {
            q.Add(MatchSimulator.Simulate(TestHelpers.Home(i), TestHelpers.Away(i), quick, null, i, collectEvents: false).HomeStats);
            o.Add(MatchSimulator.Simulate(TestHelpers.Home(i), TestHelpers.Away(i), open, null, i, collectEvents: false).HomeStats);
        }
        double qShare = q.AttacksByType[(int)Log.AttackType.Quick] / (double)q.Attacks;
        double oShare = o.AttacksByType[(int)Log.AttackType.Open] / (double)o.Attacks;
        Assert.True(qShare > 0.5, $"quick share {qShare}");
        Assert.True(oShare > 0.9, $"open share {oShare}");
        Assert.Equal(0, o.AttacksByType[(int)Log.AttackType.Quick]);
    }

    [Fact]
    public void ClutchMental_ImprovesClutchRallyWinRate()
    {
        var hi = new Result.TeamMatchStats();
        var lo = new Result.TeamMatchStats();
        for (int i = 0; i < 800; i++)
        {
            var h = TestHelpers.Home(i);
            var a = TestHelpers.Away(i);
            var hHi = TestHelpers.AddAll(h, 0);
            foreach (var p in hHi.Roster) p.Stats.Mental = 95;
            var hLo = TestHelpers.AddAll(h, 0);
            foreach (var p in hLo.Roster) p.Stats.Mental = 25;
            hi.Add(MatchSimulator.Simulate(hHi, a, null, null, i, collectEvents: false).HomeStats);
            lo.Add(MatchSimulator.Simulate(hLo, a, null, null, i, collectEvents: false).HomeStats);
        }
        double hiRate = hi.ClutchRalliesWon / (double)hi.ClutchRallies;
        double loRate = lo.ClutchRalliesWon / (double)lo.ClutchRallies;
        Assert.True(hi.ClutchRallies > 1000);
        Assert.True(hiRate > loRate + 0.02, $"clutch win rate hi {hiRate:P1} vs lo {loRate:P1}");
    }
}
