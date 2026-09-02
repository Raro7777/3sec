using System.Text;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Training.Tests;

public class DeterminismTests
{
    private static string Signature(TrainingSession s)
    {
        var sb = new StringBuilder();
        foreach (var r in s.Log)
        {
            sb.Append(r.Turn).Append(':').Append(r.Action).Append(':').Append(r.FatigueAfter.ToString("0.000")).Append(':').Append(r.ConditionAfter).Append(':').Append(r.Injury);
            foreach (var g in r.Gains) sb.Append(',').Append(g.Key).Append('=').Append(g.Value.ToString("0.0000"));
            if (r.Event != null) sb.Append("|ev:").Append(r.Event.Event.Id).Append('/').Append(r.Event.ChoiceIndex).Append('/').Append(r.Event.Success);
            if (r.Eval != null) sb.Append("|eval:").Append(r.Eval.ResultLabel).Append('/').Append(r.Eval.Performance.ToString("0.00")).Append('/').Append(r.Eval.ScoreLine);
            sb.Append(';');
        }
        sb.Append("OVR=").Append(s.Result!.OvrRaw.ToString("0.0000")).Append(" draws=").Append(s.Rng.DrawCount);
        return sb.ToString();
    }

    [Theory]
    [InlineData("optimal")]
    [InlineData("random")]
    [InlineData("push")]
    public void SameSeed_SameResult(string policy)
    {
        for (int seed = 1; seed <= 20; seed++)
        {
            var a = OracleFixtures.NewSession(OracleFixtures.SsrOh(), seed, sups: OracleFixtures.FullSupport());
            var b = OracleFixtures.NewSession(OracleFixtures.SsrOh(), seed, sups: OracleFixtures.FullSupport());
            TrainingRunner.Run(a, TrainingPolicy.ByName(policy));
            TrainingRunner.Run(b, TrainingPolicy.ByName(policy));
            Assert.Equal(Signature(a), Signature(b));
        }
    }

    [Fact]
    public void DifferentSeed_DifferentResult()
    {
        var a = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 1);
        var b = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 2);
        TrainingRunner.Run(a, new OptimalPolicy());
        TrainingRunner.Run(b, new OptimalPolicy());
        Assert.NotEqual(Signature(a), Signature(b));
    }

    [Fact]
    public void SimProvider_SameSeed_SameResult()
    {
        var a = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 7, eval: new SimEvaluationProvider());
        var b = OracleFixtures.NewSession(OracleFixtures.SsrOh(), 7, eval: new SimEvaluationProvider());
        TrainingRunner.Run(a, new OptimalPolicy());
        TrainingRunner.Run(b, new OptimalPolicy());
        Assert.Equal(Signature(a), Signature(b));
        Assert.Equal(a.Evaluations[0].Match!.Signature(), b.Evaluations[0].Match!.Signature());
    }

    [Fact]
    public void InputCardIsNotMutated()
    {
        var card = OracleFixtures.SsrOh();
        var before = card.Stats.ToString() + card.Potential;
        var s = OracleFixtures.NewSession(card, 3);
        TrainingRunner.Run(s, new OptimalPolicy());
        Assert.Equal(before, card.Stats.ToString() + card.Potential);
    }
}
