using VolleySim.Domain;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Training.Tests;

/// <summary>tools/training-sim/train_sim.py 의 CARD / SUP_* 와 동일한 픽스처.</summary>
public static class OracleFixtures
{
    public static Player Card(string pos, string club, int[] stats, int[] pot, string name = "카드", string id = "card")
    {
        PositionExtensions.TryParsePosition(pos, out var p);
        var pl = new Player { Id = id, Name = name, TeamId = club, Position = p, Rarity = Rarity.SSR, JerseyNumber = 1, HeightCm = 180, Age = 20 };
        for (int i = 0; i < 10; i++) { pl.Stats[Stats.AllKinds[i]] = stats[i]; pl.Potential[Stats.AllKinds[i]] = pot[i]; }
        return pl;
    }

    // serve, receive, set, spike, block, dig, speed, power, stamina, mental
    public static Player SsrOh() => Card("OH", "t01",
        new[] { 62, 66, 50, 72, 58, 60, 68, 66, 64, 60 },
        new[] { 82, 90, 60, 98, 74, 80, 88, 88, 84, 82 }, "SSR OH 예시");
    public static Player SrOh() => Card("OH", "t02",
        new[] { 52, 56, 42, 62, 48, 52, 58, 56, 54, 50 },
        new[] { 72, 80, 52, 86, 64, 72, 78, 78, 74, 72 }, "SR OH");
    public static Player ROh() => Card("OH", "t03",
        new[] { 42, 46, 34, 52, 40, 44, 48, 46, 46, 42 },
        new[] { 60, 68, 42, 74, 54, 62, 66, 66, 64, 62 }, "R OH");
    public static Player SsrL() => Card("L", "t02",
        new[] { 30, 72, 56, 30, 30, 70, 70, 48, 64, 60 },
        new[] { 36, 96, 70, 36, 36, 94, 90, 60, 84, 82 }, "SSR L");
    public static Player SsrMb() => Card("MB", "t03",
        new[] { 56, 48, 44, 66, 72, 48, 60, 70, 62, 58 },
        new[] { 74, 62, 54, 88, 98, 62, 80, 92, 82, 80 }, "SSR MB");
    public static Player SsrS() => Card("S", "t05",
        new[] { 58, 58, 72, 50, 54, 58, 66, 54, 62, 66 },
        new[] { 76, 74, 98, 62, 70, 74, 88, 68, 80, 90 }, "SSR S");
    public static Player SsrOp() => Card("OP", "t04",
        new[] { 64, 48, 40, 74, 58, 48, 62, 70, 62, 58 },
        new[] { 86, 60, 48, 98, 76, 60, 80, 92, 82, 80 }, "SSR OP");

    private static SupporterInfo Sup(string name, string pos, string club, params (StatKind k, int v)[] st)
    {
        PositionExtensions.TryParsePosition(pos, out var p);
        var s = new SupporterInfo { Id = name, Name = name, Position = p, ClubId = club };
        for (int i = 0; i < 10; i++) s.Stats[i] = 60;
        foreach (var (k, v) in st) s.Stats[(int)k] = v;
        return s;
    }

    public static SupporterInfo SrOhB() => Sup("SR OH B등급", "OH", "t04", (StatKind.Serve, 70), (StatKind.Receive, 76), (StatKind.Spike, 84), (StatKind.Dig, 64), (StatKind.Power, 74), (StatKind.Stamina, 66), (StatKind.Mental, 64));
    public static SupporterInfo SsrOhA() => Sup("SSR OH A등급", "OH", "t02", (StatKind.Serve, 78), (StatKind.Receive, 86), (StatKind.Spike, 95), (StatKind.Dig, 68), (StatKind.Power, 80), (StatKind.Stamina, 72), (StatKind.Mental, 70));
    public static SupporterInfo SsrMbA() => Sup("SSR MB A등급", "MB", "t03", (StatKind.Serve, 66), (StatKind.Spike, 84), (StatKind.Block, 95), (StatKind.Power, 88), (StatKind.Speed, 72), (StatKind.Stamina, 74), (StatKind.Mental, 68));
    public static SupporterInfo SsrOhS() => Sup("SSR OH S등급(동문)", "OH", "t01", (StatKind.Serve, 82), (StatKind.Receive, 90), (StatKind.Spike, 98), (StatKind.Dig, 70), (StatKind.Power, 84), (StatKind.Stamina, 78), (StatKind.Mental, 76));
    public static SupporterInfo SsrMbS() => Sup("SSR MB S등급", "MB", "t03", (StatKind.Serve, 70), (StatKind.Spike, 88), (StatKind.Block, 98), (StatKind.Power, 92), (StatKind.Speed, 76), (StatKind.Stamina, 78), (StatKind.Mental, 74));
    public static SupporterInfo SsrLS() => Sup("SSR L S등급(라이벌)", "L", "t05", (StatKind.Receive, 96), (StatKind.Dig, 94), (StatKind.Set, 66), (StatKind.Speed, 90), (StatKind.Stamina, 80), (StatKind.Mental, 80));

    public static List<SupporterInfo> FullSupport() => new() { SsrOhS(), SsrMbS(), SsrLS() };
    public static List<SupporterInfo> AllSix() => new() { SrOhB(), SsrOhA(), SsrMbA(), SsrOhS(), SsrMbS(), SsrLS() };

    public static int Seed(int baseSeed, int i) => unchecked(baseSeed * 1000003 + i * 7919 + 17);

    public static TrainingSession NewSession(Player card, int seed, TrainingConfig? cfg = null, IEnumerable<SupporterInfo>? sups = null, IEvaluationMatchProvider? eval = null, bool det = false)
    {
        cfg ??= TrainingConfig.CreateDefault();
        var sup = sups == null ? SupportProfile.Empty(cfg) : SupportProfile.Build(card.Position, card.TeamId, sups, cfg);
        return new TrainingSession(card, sup, cfg, eval ?? new StubEvaluationProvider(), seed, det);
    }

    public static RunSummary Batch(Func<Player> card, TrainingPolicy policy, int n, int baseSeed, IEnumerable<SupporterInfo>? sups = null, TrainingConfig? cfg = null)
    {
        var supList = sups?.ToList();
        return TrainingRunner.Batch(i => NewSession(card(), Seed(baseSeed, i), cfg, supList), policy, n);
    }
}
