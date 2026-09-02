using VolleySim.Config;
using VolleySim.Data;
using VolleySim.Domain;
using VolleySim.Result;

namespace VolleySim.Tests;

public static class TestHelpers
{
    public static int Mix(int seed, int a, int b)
    {
        unchecked
        {
            uint h = (uint)seed * 2654435761u;
            h ^= (uint)a * 2246822519u + 0x9E3779B9u;
            h ^= h >> 15;
            h *= 2246822519u;
            h ^= (uint)b * 3266489917u;
            h ^= h >> 13;
            return (int)(h & 0x7FFFFFFF);
        }
    }

    public static TeamState Home(int i, double overall = 67) => RandomPlayerGenerator.GenerateTeamState(Mix(1000, i, 1), "HOME", "홈", overall);
    public static TeamState Away(int i, double overall = 67) => RandomPlayerGenerator.GenerateTeamState(Mix(1000, i, 2), "AWAY", "원정", overall);

    public static MatchResult Play(int i, SimConfig? cfg = null, bool events = true, Func<TeamState, TeamState>? homeMod = null)
    {
        var h = Home(i);
        if (homeMod != null) h = homeMod(h);
        return MatchSimulator.Simulate(h, Away(i), Tactics.Default(), Tactics.Default(), Mix(1000, i, 7), cfg, events);
    }

    public static TeamState AddAll(TeamState src, int delta, Func<Player, bool>? filter = null)
    {
        var t = new TeamState
        {
            Team = src.Team,
            Lineup = src.Lineup.Clone(),
            TeamCondition = src.TeamCondition,
            Chemistry = src.Chemistry,
        };
        foreach (var p in src.Roster)
        {
            var c = p.Clone();
            if (filter == null || filter(c)) c.Stats = c.Stats.WithAllAdded(delta);
            t.Roster.Add(c);
        }
        return t;
    }

    public static double WinRate(int matches, Func<TeamState, TeamState>? homeMod, SimConfig? cfg = null)
    {
        int wins = 0;
        for (int i = 0; i < matches; i++)
        {
            var r = Play(i, cfg, events: false, homeMod: homeMod);
            if (r.Winner == TeamSide.Home) wins++;
        }
        return wins / (double)matches;
    }
}
