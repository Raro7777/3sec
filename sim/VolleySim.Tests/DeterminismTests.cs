using VolleySim.Domain;
using VolleySim.Engine;

namespace VolleySim.Tests;

public class DeterminismTests
{
    [Fact]
    public void SameSeedAndInput_ProducesIdenticalResultAndEventLog()
    {
        var a = TestHelpers.Play(3);
        var b = TestHelpers.Play(3);

        Assert.Equal(a.Signature(), b.Signature());
        Assert.Equal(a.Log.Count, b.Log.Count);
        for (int i = 0; i < a.Log.Events.Count; i++)
        {
            Assert.Equal(a.Log.Events[i].ToString(), b.Log.Events[i].ToString());
        }
        Assert.Equal(a.RandomDraws, b.RandomDraws);
    }

    [Fact]
    public void DisablingEventLog_DoesNotChangeOutcome()
    {
        var a = TestHelpers.Play(5, events: true);
        var b = TestHelpers.Play(5, events: false);
        Assert.Equal(a.Signature(), b.Signature());
        Assert.Equal(0, b.Log.Count);
    }

    [Fact]
    public void DifferentSeed_ProducesDifferentSequence()
    {
        var h = TestHelpers.Home(1);
        var aw = TestHelpers.Away(1);
        var a = MatchSimulator.Simulate(h, aw, null, null, 1, collectEvents: false);
        var b = MatchSimulator.Simulate(h, aw, null, null, 2, collectEvents: false);
        Assert.NotEqual(a.Signature(), b.Signature());
    }

    [Fact]
    public void SimulateDoesNotMutateInputs()
    {
        var h = TestHelpers.Home(2);
        var aw = TestHelpers.Away(2);
        var before = string.Join(";", h.Roster.Select(p => p.Stats.ToString())) + string.Join(",", h.Lineup.StartingIds);
        MatchSimulator.Simulate(h, aw, null, null, 9);
        var after = string.Join(";", h.Roster.Select(p => p.Stats.ToString())) + string.Join(",", h.Lineup.StartingIds);
        Assert.Equal(before, after);
    }

    [Fact]
    public void DeterministicRandom_IsReproducibleAndUniform()
    {
        var r1 = new DeterministicRandom(12345);
        var r2 = new DeterministicRandom(12345);
        double sum = 0;
        for (int i = 0; i < 100_000; i++)
        {
            double a = r1.NextDouble();
            double b = r2.NextDouble();
            Assert.Equal(a, b);
            Assert.InRange(a, 0.0, 0.999999999999);
            sum += a;
        }
        Assert.InRange(sum / 100_000, 0.49, 0.51);
    }

    [Fact]
    public void DeterministicMath_MatchesSystemMathClosely()
    {
        for (double x = -30; x <= 30; x += 0.37)
        {
            double e = SimMath.Exp(x);
            Assert.InRange(Math.Abs(e - Math.Exp(x)) / Math.Exp(x), 0, 1e-12);
        }
        for (double x = 1e-6; x < 1e6; x *= 1.7)
        {
            Assert.InRange(Math.Abs(SimMath.Ln(x) - Math.Log(x)), 0, 1e-12);
        }
        Assert.Equal(0.5, SimMath.Sigmoid(0), 12);
        Assert.Equal(0.37, SimMath.Contest(0.37, 0, 20), 10);
        Assert.True(SimMath.Contest(0.5, 20, 20) > 0.7);
        Assert.True(SimMath.Contest(0.5, -20, 20) < 0.3);
    }
}
