using VolleySim.Domain;

namespace VolleySim.Cli;

/// <summary>시나리오용 팀 변형 유틸(원본은 건드리지 않고 깊은 복사본을 만든다).</summary>
public static class TeamMods
{
    public static TeamState Clone(TeamState src)
    {
        var t = new TeamState
        {
            Team = src.Team,
            Lineup = src.Lineup.Clone(),
            TeamCondition = src.TeamCondition,
            Chemistry = src.Chemistry,
        };
        foreach (var p in src.Roster) t.Roster.Add(p.Clone());
        foreach (var kv in src.PlayerCondition) t.PlayerCondition[kv.Key] = kv.Value;
        return t;
    }

    public static TeamState AddAllStats(TeamState src, int delta, Func<Player, bool>? filter = null)
    {
        var t = Clone(src);
        foreach (var p in t.Roster)
        {
            if (filter != null && !filter(p)) continue;
            p.Stats = p.Stats.WithAllAdded(delta);
        }
        return t;
    }

    public static TeamState AddStat(TeamState src, StatKind kind, int delta, Func<Player, bool>? filter = null)
    {
        var t = Clone(src);
        foreach (var p in t.Roster)
        {
            if (filter != null && !filter(p)) continue;
            p.Stats = p.Stats.WithAdded(kind, delta);
        }
        return t;
    }

    public static TeamState WithPosition(TeamState src, Position pos, int delta) => AddAllStats(src, delta, p => p.Position == pos);

    /// <summary>라인업 슬롯(0~5)의 선발 선수 1명만 보정.</summary>
    public static TeamState WithStarterSlot(TeamState src, int slot, int delta)
    {
        string id = src.Lineup.StartingIds[slot];
        return AddAllStats(src, delta, p => p.Id == id);
    }

    public static TeamState WithTeamCondition(TeamState src, double cond)
    {
        var t = Clone(src);
        t.TeamCondition = cond;
        return t;
    }

    public static TeamState WithChemistry(TeamState src, int value)
    {
        var t = Clone(src);
        var chem = new ChemistryTable();
        string setter = t.Lineup.StartingIds[0];
        foreach (var p in t.Roster) chem.Set(setter, p.Id, value);
        // 벤치 세터도 동일하게
        foreach (var p in t.Roster)
        {
            if (p.Position == Position.S && p.Id != setter) foreach (var q in t.Roster) chem.Set(p.Id, q.Id, value);
        }
        t.Chemistry = chem;
        return t;
    }
}
