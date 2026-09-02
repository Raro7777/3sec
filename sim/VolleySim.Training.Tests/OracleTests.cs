using VolleySim.Training;
using VolleySim.Training.Policies;
using Xunit.Abstractions;

namespace VolleySim.Training.Tests;

/// <summary>
/// 파이썬 오라클(tools/training-sim/train_sim.py) 정합. 문서 12절 정책표(n=3,000)와 비교. n=2,000.
/// 파이썬 기준(seed 1, n=2,000): 안전 76.18(σ1.16, 부상 0.1%) / 최적 78.37(σ1.75, S 16.1%, 부상 17.0%) / 푸시 77.49(부상 43%) / 무휴식 74.42(부상 96%) / 랜덤 73.13 / 풀세팅+최적 79.52(S 49%).
/// </summary>
public class OracleTests
{
    private const int N = 2000;
    private readonly ITestOutputHelper _out;
    public OracleTests(ITestOutputHelper o) { _out = o; }

    private RunSummary Run(TrainingPolicy p, int seed = 1, IEnumerable<SupporterInfo>? sups = null)
    {
        var s = OracleFixtures.Batch(OracleFixtures.SsrOh, p, N, seed, sups);
        _out.WriteLine(s.Line(p.Name + (sups != null ? "+sup" : ""), 64.8));
        return s;
    }

    [Fact]
    public void Safe_MatchesOracle()
    {
        var s = Run(new SafePolicy());
        Assert.InRange(s.OvrMean, 76.2 - 0.6, 76.2 + 0.6);
        Assert.InRange(s.InjuryRate, 0.0, 0.03);
        Assert.InRange(s.A + s.S, 0.90, 1.0);
        Assert.InRange(s.Hints, 6.0, 7.4);
    }

    [Fact]
    public void Optimal_MatchesOracle()
    {
        var s = Run(new OptimalPolicy());
        Assert.InRange(s.OvrMean, 78.4 - 0.7, 78.4 + 0.7);
        Assert.InRange(s.InjuryRate, 0.17 - 0.04, 0.17 + 0.04);
        Assert.InRange(s.S, 0.16 - 0.06, 0.16 + 0.06);
        Assert.InRange(s.HotTrains, 2.3, 3.5);
        Assert.InRange(s.Rests, 1.5, 2.5);
    }

    [Fact]
    public void Push_MatchesOracle()
    {
        var s = Run(new PushPolicy());
        Assert.InRange(s.OvrMean, 77.5 - 0.8, 77.5 + 0.8);
        Assert.InRange(s.InjuryRate, 0.43 - 0.06, 0.43 + 0.06);
        Assert.InRange(s.OvrSd, 2.0, 2.9);
    }

    [Fact]
    public void NoRest_InjuryRateAtLeast90()
    {
        var s = Run(new NoRestPolicy());
        Assert.True(s.InjuryRate >= 0.90, $"무휴식 부상률 {s.InjuryRate:P1}");
        Assert.InRange(s.OvrMean, 74.4 - 0.9, 74.4 + 0.9);
    }

    [Fact]
    public void Random_MatchesOracle()
    {
        var s = Run(new RandomPolicy());
        Assert.InRange(s.OvrMean, 73.2 - 0.9, 73.2 + 0.9);
        Assert.InRange(s.InjuryRate, 0.56 - 0.07, 0.56 + 0.07);
    }

    [Fact]
    public void SpikeOnly_MatchesOracle()
    {
        var s = Run(new SpikeOnlyPolicy());
        Assert.InRange(s.OvrMean, 74.2 - 0.7, 74.2 + 0.7);
    }

    [Fact]
    public void FullSupport_Optimal_SRateMatchesOracle()
    {
        var s = Run(new OptimalPolicy(), 4, OracleFixtures.FullSupport());
        Assert.InRange(s.S, 0.49 - 0.10, 0.49 + 0.10);
        Assert.InRange(s.OvrMean, 79.5 - 0.7, 79.5 + 0.7);
        Assert.InRange(s.SeniorEvents, 0.8, 1.2);
    }

    [Fact]
    public void OptimalBeatsSafeBeatsRandom()
    {
        var safe = Run(new SafePolicy(), 11);
        var opt = Run(new OptimalPolicy(), 11);
        var rnd = Run(new RandomPolicy(), 11);
        Assert.InRange(opt.OvrMean - safe.OvrMean, 1.4, 3.0);   // 문서 +2.2
        Assert.InRange(opt.OvrMean - rnd.OvrMean, 4.0, 6.5);    // 문서 +5.2
        // 도박 성립(H9): 최적 부상 런 OVR ≤ 안전 평균 + 0.5
        Assert.True(opt.OvrInjured <= safe.OvrMean + 0.5, $"부상시 {opt.OvrInjured:0.0} vs 안전 {safe.OvrMean:0.0}");
    }

    [Theory]
    [InlineData("SR OH", 68.1, 1.2)]
    [InlineData("R OH", 57.4, 1.2)]
    [InlineData("SSR S", 76.9, 1.0)]
    [InlineData("SSR OP", 77.9, 1.0)]
    [InlineData("SSR MB", 78.8, 1.0)]
    [InlineData("SSR L", 79.1, 1.0)]
    public void OtherCards_Optimal_MatchOracleTable(string label, double expected, double tol)
    {
        Func<VolleySim.Domain.Player> card = label switch
        {
            "SR OH" => OracleFixtures.SrOh,
            "R OH" => OracleFixtures.ROh,
            "SSR S" => OracleFixtures.SsrS,
            "SSR OP" => OracleFixtures.SsrOp,
            "SSR MB" => OracleFixtures.SsrMb,
            _ => OracleFixtures.SsrL,
        };
        var s = OracleFixtures.Batch(card, new OptimalPolicy(), 1000, 5);
        _out.WriteLine(s.Line(label, 0));
        Assert.InRange(s.OvrMean, expected - tol, expected + tol);
    }
}
