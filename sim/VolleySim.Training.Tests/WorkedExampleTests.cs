using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;
using Xunit.Abstractions;

namespace VolleySim.Training.Tests;

/// <summary>4.4절 워크드 예시(기대값, 서포터 없음, 부상 없음, 평가전 승70/승82/승86, 최적 정책 수순) → OVR 80.4 S.</summary>
public class WorkedExampleTests
{
    private readonly ITestOutputHelper _out;
    public WorkedExampleTests(ITestOutputHelper o) { _out = o; }

    private static StubEvaluationProvider.Forced Forced() => new(req => req.Round switch { 0 => (true, 70), 1 => (true, 82), _ => (true, 86) });

    [Fact]
    public void Optimal_Deterministic_Reaches80_4()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 0, eval: Forced(), det: true);
        var r = TrainingRunner.Run(s, new OptimalPolicy());
        var seq = s.Log.Select(l => l.Action).ToArray();
        foreach (var l in s.Log) _out.WriteLine($"T{l.Turn} {l.Action} {l.FatigueBefore:0}->{l.FatigueAfter:0} {l.Zone} combo{l.ComboBefore} inj{l.InjuryP:P1} " + string.Join(" ", l.Gains.Select(g => $"{g.Key}+{g.Value:0.0}")));
        _out.WriteLine($"OVR {r.OvrRaw:0.00} {r.GradeRaw} hints {r.Hints}");
        var expected = new[]
        {
            TrainingAction.Spike, TrainingAction.Spike, TrainingAction.Spike, TrainingAction.Receive, TrainingAction.Rest, TrainingAction.Receive,
            TrainingAction.Spike, TrainingAction.Serve, TrainingAction.Rest, TrainingAction.Special, TrainingAction.Block, TrainingAction.Receive,
        };
        Assert.Equal(expected, seq);
        Assert.InRange(r.OvrRaw, 80.35, 80.45);
        Assert.Equal(Grade.S, r.GradeRaw);
        Assert.Equal(12, r.Hints);
        Assert.Equal(2, s.Trainee.Rests);
        Assert.Equal(3, s.Trainee.HotTrains);
        // 확정치: serve 78 / receive 89 / set 50 / spike 98 / block 66 / dig 69 / speed 73 / power 79 / stamina 73 / mental 67
        Assert.Equal(new[] { 78, 89, 50, 98, 66, 69, 73, 79, 73, 67 }, r.Instance.FinalStats);
    }

    [Fact]
    public void Safe_Deterministic_Reaches77_7()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 0, eval: Forced(), det: true);
        var r = TrainingRunner.Run(s, new SafePolicy());
        Assert.InRange(r.OvrRaw, 77.6, 77.8);
        Assert.Equal(Grade.A, r.GradeRaw);
    }
}
