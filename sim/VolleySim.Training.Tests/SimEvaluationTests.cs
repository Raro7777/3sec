using VolleySim.Domain;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;
using Xunit.Abstractions;

namespace VolleySim.Training.Tests;

public class SimEvaluationTests
{
    private readonly ITestOutputHelper _out;
    public SimEvaluationTests(ITestOutputHelper o) { _out = o; }

    [Fact]
    public void Smoke_RealSimulation_CompletesWithoutException()
    {
        var s = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 11, eval: new SimEvaluationProvider());
        var r = TrainingRunner.Run(s, new OptimalPolicy());
        Assert.Equal(SessionPhase.Graduated, s.Phase);
        Assert.Equal(3, r.Evaluations.Count);
        foreach (var e in r.Evaluations)
        {
            if (e.Absent) continue;
            Assert.NotNull(e.Match);
            Assert.NotNull(e.Box);
            Assert.InRange(e.Performance, 0, 100);
            Assert.Single(e.Match!.Sets);
            Assert.True(Math.Max(e.Match.Sets[0].Home, e.Match.Sets[0].Away) >= 25);
            _out.WriteLine($"R{e.Round + 1} {e.OpponentName} {e.ResultLabel} {e.ScoreLine} perf {e.Performance:0.0} | {string.Join(" / ", e.Highlights)}");
        }
        _out.WriteLine($"OVR {r.Instance.Ovr:0.0} {r.Instance.Grade} | {r.Camp.Line()}");
    }

    [Theory]
    [InlineData("S")]
    [InlineData("OH")]
    [InlineData("OP")]
    [InlineData("MB")]
    [InlineData("L")]
    public void AllPositions_CanBeInsertedAndPlay(string pos)
    {
        Player card = pos switch { "S" => OracleFixtures.SsrS(), "OH" => OracleFixtures.SsrOh(), "OP" => OracleFixtures.SsrOp(), "MB" => OracleFixtures.SsrMb(), _ => OracleFixtures.SsrL() };
        var s = OracleFixtures.NewSession(card, 21, eval: new SimEvaluationProvider());
        var r = TrainingRunner.Run(s, new SafePolicy());
        var played = r.Evaluations.Where(e => !e.Absent).ToList();
        Assert.NotEmpty(played);
        foreach (var e in played)
        {
            Assert.Equal(SimEvaluationProvider.TraineeId, e.Box!.PlayerId);
            // 트레이니가 실제로 코트에 섰는지(리베로는 리시브/디그, 세터는 세트, 공격수는 공격 시도)
            int touches = e.Box.Attacks + e.Box.Receptions + e.Box.Sets + e.Box.DigAttempts + e.Box.Serves + e.Box.BlockTouches + e.Box.BlockKills;
            Assert.True(touches > 0, $"{pos} 트레이니 터치 0");
        }
    }

    [Fact]
    public void Performance_IncreasesWithTraineeStrength()
    {
        // 강도 62 상대로 핵심3 52 / 62 / 72 트레이니의 평균 활약도가 단조 증가하고 동급이면 50 근처
        var prov = new SimEvaluationProvider(new SimEvaluationProvider.Params { CollectEvents = false });
        double Mean(int delta)
        {
            double sum = 0; int n = 60;
            for (int i = 0; i < n; i++)
            {
                var card = OracleFixtures.Card("OH", "t01", new[] { 62 + delta, 62 + delta, 50, 62 + delta, 58, 60, 66, 64, 64, 60 }, new int[] { 99, 99, 99, 99, 99, 99, 99, 99, 99, 99 });
                var req = new EvaluationRequest { Round = 0, Turn = 4, OpponentStrength = 62, Card = card, Position = Position.OH, CurrentStats = Enumerable.Range(0, 10).Select(k => (double)card.Stats[Stats.AllKinds[k]]).ToArray(), CoreAverage = 62 + delta, Condition = Condition.Normal, Config = TrainingConfig.CreateDefault() };
                sum += prov.Play(req, new TrainingRandom(500 + i)).Performance;
            }
            return sum / n;
        }
        double lo = Mean(-10), mid = Mean(0), hi = Mean(10);
        _out.WriteLine($"perf −10: {lo:0.0} / 0: {mid:0.0} / +10: {hi:0.0}");
        Assert.True(lo < mid && mid < hi);
        Assert.InRange(mid, 38, 62);
    }
}
