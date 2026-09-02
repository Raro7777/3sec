using System.Diagnostics;
using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Cli;

public sealed class MatchSetup
{
    public required TeamState Home;
    public required TeamState Away;
    public Tactics HomeTactics = Tactics.Default();
    public Tactics AwayTactics = Tactics.Default();
}

/// <summary>여러 경기의 결과를 모은 집계.</summary>
public sealed class Aggregate
{
    public string Name = "";
    public int Matches;
    public int HomeWins;
    public int TotalSets;
    public int TotalRallies;
    public int TotalPoints;
    public readonly int[] SetScoreDist = new int[6]; // 3-0,3-1,3-2,0-3,1-3,2-3
    public readonly TeamMatchStats Both = new TeamMatchStats();
    public readonly TeamMatchStats Home = new TeamMatchStats();
    public readonly TeamMatchStats Away = new TeamMatchStats();
    public readonly long[] RallyAttackHist = new long[6]; // 0(서브로 종료),1,2,3,4,5+
    public readonly Dictionary<string, int[]> KillsByPosition = new(); // pos → [attacks, kills]
    public readonly Dictionary<string, int[]> PointsByPosition = new(); // pos → [kills, blocks, aces]
    public long SetsDeuce; // 25점 초과로 끝난 세트 수
    public double ElapsedMs;

    public double HomeWinRate => Matches > 0 ? HomeWins / (double)Matches : 0;
    public double SetsPerMatch => Matches > 0 ? TotalSets / (double)Matches : 0;
    public double PointsPerSet => TotalSets > 0 ? TotalPoints / (double)TotalSets : 0;
    public double SideOut => Both.ReceiveRallies > 0 ? Both.ReceiveRalliesWon / (double)Both.ReceiveRallies : 0;
    public double FirstBallSideOut => Both.FirstBallAttacks > 0 ? Both.FirstBallKills / (double)Both.FirstBallAttacks : 0;
    public double KillRate => Both.Attacks > 0 ? Both.Kills / (double)Both.Attacks : 0;
    public double AttackErrorRate => Both.Attacks > 0 ? Both.AttackErrors / (double)Both.Attacks : 0;
    public double BlockedRate => Both.Attacks > 0 ? Both.Blocked / (double)Both.Attacks : 0;
    public double BlockTouchRate => Both.Attacks > 0 ? Both.BlockTouches / (double)Both.Attacks : 0;
    public double AceRate => Both.Serves > 0 ? Both.Aces / (double)Both.Serves : 0;
    public double ServeErrorRate => Both.Serves > 0 ? Both.ServeErrors / (double)Both.Serves : 0;
    public double BlocksPerSet => TotalSets > 0 ? Both.BlockKills / (double)TotalSets : 0;
    public double AcesPerSet => TotalSets > 0 ? Both.Aces / (double)TotalSets : 0;
    public double ReceptionPerfectRate => Both.Receptions > 0 ? Both.ReceptionPerfect / (double)Both.Receptions : 0;
    public double ReceptionGoodRate => Both.Receptions > 0 ? Both.ReceptionGood / (double)Both.Receptions : 0;
    public double ReceptionPoorRate => Both.Receptions > 0 ? Both.ReceptionPoor / (double)Both.Receptions : 0;
    public double ReceptionErrorRate => Both.Receptions > 0 ? Both.ReceptionErrors / (double)Both.Receptions : 0;
    public double AttacksPerRally => TotalRallies > 0 ? Both.Attacks / (double)TotalRallies : 0;
    public double HomeClutchWinRate => Home.ClutchRallies > 0 ? Home.ClutchRalliesWon / (double)Home.ClutchRallies : 0;
    public double ClutchRalliesPerMatch => Matches > 0 ? Home.ClutchRallies / (double)Matches : 0;
    public double DeuceSetRate => TotalSets > 0 ? SetsDeuce / (double)TotalSets : 0;
    public double FreeBallsPerSet => TotalSets > 0 ? Both.FreeBalls / (double)TotalSets : 0;

    public double AttackTypeShare(AttackType t) => Both.Attacks > 0 ? Both.AttacksByType[(int)t] / (double)Both.Attacks : 0;
    public double AttackTypeKillRate(AttackType t) => Both.AttacksByType[(int)t] > 0 ? Both.KillsByType[(int)t] / (double)Both.AttacksByType[(int)t] : 0;

    /// <summary>승률 표준오차(이항 근사).</summary>
    public double HomeWinRateStdErr => Matches > 0 ? Math.Sqrt(HomeWinRate * (1 - HomeWinRate) / Matches) : 0;

    public void Add(MatchResult r)
    {
        Matches++;
        if (r.Winner == TeamSide.Home) HomeWins++;
        TotalSets += r.Sets.Count;
        TotalRallies += r.TotalRallies;
        TotalPoints += r.TotalHomePoints + r.TotalAwayPoints;
        int idx = r.Winner == TeamSide.Home ? r.AwaySets : 3 + r.HomeSets;
        if (idx >= 0 && idx < 6) SetScoreDist[idx]++;
        foreach (var s in r.Sets)
        {
            int target = s.SetIndex == 5 ? 15 : 25;
            if (Math.Max(s.Home, s.Away) > target) SetsDeuce++;
        }
        Home.Add(r.HomeStats);
        Away.Add(r.AwayStats);
        Both.Add(r.HomeStats);
        Both.Add(r.AwayStats);
        foreach (var b in r.BoxScores.Values)
        {
            if (!KillsByPosition.TryGetValue(b.PositionCode, out var arr)) KillsByPosition[b.PositionCode] = arr = new int[2];
            arr[0] += b.Attacks;
            arr[1] += b.Kills;
            if (!PointsByPosition.TryGetValue(b.PositionCode, out var pts)) PointsByPosition[b.PositionCode] = pts = new int[3];
            pts[0] += b.Kills; pts[1] += b.BlockKills; pts[2] += b.Aces;
        }
        if (r.Log != null && r.Log.Enabled)
        {
            int attacks = 0;
            foreach (var e in r.Log.Events)
            {
                if (e.Type == EventType.RallyStart) attacks = 0;
                else if (e.Type == EventType.Attack) attacks++;
                else if (e.Type == EventType.Point) RallyAttackHist[Math.Min(attacks, 5)]++;
            }
        }
    }
}

public static class MonteCarlo
{
    public static int MixSeed(int seed, int a, int b)
    {
        unchecked
        {
            uint h = (uint)seed * 2654435761u;
            h ^= (uint)a * 2246822519u + 0x9E3779B9u;
            h ^= h >> 15;
            h *= 2246822519u;
            h ^= (uint)b * 3266489917u;
            h ^= h >> 13;
            h *= 3266489917u;
            h ^= h >> 16;
            return (int)(h & 0x7FFFFFFF);
        }
    }

    /// <summary>
    /// 시나리오 실행. factory(i) 는 i 번째 경기의 팀/전술을 돌려준다.
    /// 경기 시드는 (seed, i) 에서 유도되므로 시나리오 간 대응 경기는 같은 난수열을 쓴다(공통 난수 → 분산 감소).
    /// </summary>
    public static Aggregate Run(string name, int matches, int seed, Func<int, MatchSetup> factory, SimConfig config, bool collectEvents = false)
    {
        var agg = new Aggregate { Name = name };
        var sw = Stopwatch.StartNew();
        for (int i = 0; i < matches; i++)
        {
            var setup = factory(i);
            int matchSeed = MixSeed(seed, i, 7);
            var r = MatchSimulator.Simulate(setup.Home, setup.Away, setup.HomeTactics, setup.AwayTactics, matchSeed, config, collectEvents);
            agg.Add(r);
        }
        agg.ElapsedMs = sw.Elapsed.TotalMilliseconds;
        return agg;
    }
}
