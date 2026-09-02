using VolleySim.Domain;
using VolleySim.Result;

namespace VolleySim.Tests;

/// <summary>
/// 분포 테스트. 목표 범위(리포트 기준)보다 넓은 허용 범위를 쓴다:
/// 시드 고정이므로 재현 가능하지만, 상수 튜닝 시 소폭 변동을 허용하기 위해 여유를 둔다.
/// </summary>
public class DistributionTests
{
    private const int Matches = 1000;

    private static (int homeWins, TeamMatchStats both, int sets, int points) Run()
    {
        int wins = 0, sets = 0, points = 0;
        var both = new TeamMatchStats();
        for (int i = 0; i < Matches; i++)
        {
            var r = TestHelpers.Play(i, events: false);
            if (r.Winner == TeamSide.Home) wins++;
            sets += r.Sets.Count;
            points += r.TotalHomePoints + r.TotalAwayPoints;
            both.Add(r.HomeStats);
            both.Add(r.AwayStats);
        }
        return (wins, both, sets, points);
    }

    private static readonly Lazy<(int homeWins, TeamMatchStats both, int sets, int points)> Cached = new(Run);

    [Fact]
    public void EqualTeams_HomeWinRate_45to55()
    {
        var (wins, _, _, _) = Cached.Value;
        Assert.InRange(wins / (double)Matches, 0.45, 0.55);
    }

    [Fact]
    public void SideOutRate_NearTarget_60to65_Tolerance3()
    {
        var (_, b, _, _) = Cached.Value;
        Assert.InRange(b.SideOutRate, 0.57, 0.68);
    }

    [Fact]
    public void KillRate_NearTarget_40to45_Tolerance3()
    {
        var (_, b, _, _) = Cached.Value;
        Assert.InRange(b.KillRate, 0.37, 0.48);
    }

    [Fact]
    public void AceRate_NearTarget_5to8_Tolerance1_5()
    {
        var (_, b, _, _) = Cached.Value;
        Assert.InRange(b.AceRate, 0.035, 0.095);
    }

    [Fact]
    public void ServeErrorRate_NearTarget_8to12_Tolerance2()
    {
        var (_, b, _, _) = Cached.Value;
        Assert.InRange(b.ServeErrorRate, 0.06, 0.14);
    }

    [Fact]
    public void BlockKillRate_NearTarget_8to12_Tolerance2()
    {
        var (_, b, _, _) = Cached.Value;
        double blocked = b.Blocked / (double)b.Attacks;
        Assert.InRange(blocked, 0.06, 0.14);
    }

    [Fact]
    public void PointsPerSet_NearTarget_44to48_Tolerance2()
    {
        var (_, _, sets, points) = Cached.Value;
        Assert.InRange(points / (double)sets, 42.0, 50.0);
    }

    [Fact]
    public void BothTeams_HaveSymmetricStats()
    {
        // 홈/원정 대칭: 동급 팀이므로 사이드아웃률이 서로 3%p 이내
        double hs = 0, aw = 0;
        var h = new TeamMatchStats();
        var a = new TeamMatchStats();
        for (int i = 0; i < 400; i++)
        {
            var r = TestHelpers.Play(i, events: false);
            h.Add(r.HomeStats);
            a.Add(r.AwayStats);
        }
        hs = h.SideOutRate; aw = a.SideOutRate;
        Assert.InRange(Math.Abs(hs - aw), 0, 0.03);
    }
}
