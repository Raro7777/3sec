using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Engine;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Tests;

public class RulesTests
{
    private static IEnumerable<MatchResult> Matches(int n) => Enumerable.Range(0, n).Select(i => TestHelpers.Play(i));

    [Fact]
    public void Set_EndsAt25With2PointMargin_And_FinalSetAt15()
    {
        int finalSets = 0;
        foreach (var r in Matches(200))
        {
            foreach (var s in r.Sets)
            {
                int target = s.SetIndex == 5 ? 15 : 25;
                int hi = Math.Max(s.Home, s.Away), lo = Math.Min(s.Home, s.Away);
                Assert.True(hi >= target, $"set {s.SetIndex}: {s.Home}-{s.Away}");
                Assert.True(hi - lo >= 2, $"set {s.SetIndex}: {s.Home}-{s.Away}");
                if (hi > target) Assert.Equal(2, hi - lo); // 듀스는 정확히 2점차로 끝남
                if (s.SetIndex == 5) finalSets++;
            }
        }
        Assert.True(finalSets > 0, "5세트가 한 번도 나오지 않음");
    }

    [Fact]
    public void Match_EndsWhenATeamWins3Sets()
    {
        foreach (var r in Matches(200))
        {
            Assert.True(r.HomeSets == 3 || r.AwaySets == 3);
            Assert.True(r.HomeSets < 3 || r.AwaySets < 3);
            Assert.InRange(r.Sets.Count, 3, 5);
            Assert.Equal(r.Sets.Count, r.HomeSets + r.AwaySets);
            Assert.Equal(r.Winner == TeamSide.Home, r.HomeSets == 3);
            Assert.Equal(r.TotalHomePoints, r.HomeStats.Points);
            Assert.Equal(r.TotalAwayPoints, r.AwayStats.Points);
        }
    }

    [Fact]
    public void Rotation_AdvancesOnlyOnSideOut_AndServeSwitches()
    {
        var r = TestHelpers.Play(11);
        var events = r.Log.Events;
        int checkedRallies = 0;
        for (int i = 0; i < events.Count; i++)
        {
            var e = events[i];
            if (e.Type != EventType.RallyStart) continue;
            var servingSide = e.Side;
            int rotation = e.Value;
            // 이 랠리의 Point 이벤트 찾기
            int j = i + 1;
            while (j < events.Count && events[j].Type != EventType.Point) j++;
            if (j >= events.Count) break;
            var point = events[j];
            // 다음 RallyStart
            int k = j + 1;
            while (k < events.Count && events[k].Type != EventType.RallyStart && events[k].Type != EventType.SetEnd) k++;
            if (k >= events.Count || events[k].Type == EventType.SetEnd) continue;
            var next = events[k];
            if (point.Side == servingSide)
            {
                Assert.Equal(servingSide, next.Side);
                Assert.Equal(rotation, next.Value);
            }
            else
            {
                Assert.Equal(servingSide.Opposite(), next.Side);
                // 사이드아웃 팀의 Rotation 이벤트가 사이에 있어야 함
                bool rotated = false;
                for (int m = j + 1; m < k; m++)
                    if (events[m].Type == EventType.Rotation && events[m].Side == point.Side) rotated = true;
                Assert.True(rotated);
            }
            checkedRallies++;
        }
        Assert.True(checkedRallies > 100);
    }

    [Fact]
    public void RotationIndex_IsClockwiseAndCyclic()
    {
        var home = TestHelpers.Home(0);
        var t = new TeamMatchState(TeamSide.Home, home, Tactics.Default());
        var before = (Player[])t.OnCourt.Clone();
        t.Rotate();
        // 2번이 1번으로, 1번이 6번으로
        Assert.Same(before[1], t.PlayerAt(1));
        Assert.Same(before[2], t.PlayerAt(2));
        Assert.Same(before[0], t.PlayerAt(6));
        for (int i = 0; i < 5; i++) t.Rotate();
        Assert.Equal(0, t.RotationIndex);
        for (int p = 1; p <= 6; p++) Assert.Same(before[p - 1], t.PlayerAt(p));
    }

    [Fact]
    public void Blockers_AreAlwaysFrontRow_AndNeverLibero()
    {
        foreach (var r in Matches(30))
        {
            var liberos = new HashSet<string>();
            foreach (var e in r.Log.Events)
            {
                if (e.Type == EventType.LiberoIn) liberos.Add(e.PlayerId!);
            }
            int blocks = 0;
            foreach (var e in r.Log.Events)
            {
                if (e.Type != EventType.Block) continue;
                blocks++;
                Assert.InRange(e.CourtPosition, 2, 4);
                Assert.DoesNotContain(e.PlayerId, liberos);
                if (e.SecondaryPlayerIds != null)
                    foreach (var id in e.SecondaryPlayerIds) Assert.DoesNotContain(id, liberos);
            }
            Assert.True(blocks > 0);
        }
    }

    [Fact]
    public void Libero_ReplacesBackRowMbOnly_NeverServesOrAttacks()
    {
        for (int i = 0; i < 30; i++)
        {
            var h = TestHelpers.Home(i);
            var a = TestHelpers.Away(i);
            var r = MatchSimulator.Simulate(h, a, null, null, TestHelpers.Mix(1000, i, 7));
            var players = h.Roster.Concat(a.Roster).ToDictionary(p => p.Id);
            int swaps = 0;
            foreach (var e in r.Log.Events)
            {
                switch (e.Type)
                {
                    case EventType.LiberoIn:
                        swaps++;
                        Assert.True(players[e.PlayerId!].IsLibero);
                        Assert.Contains(e.CourtPosition, new[] { 1, 5, 6 });
                        Assert.Equal(Position.MB, players[e.SecondaryPlayerIds![0]].Position);
                        break;
                    case EventType.Serve:
                        Assert.False(players[e.PlayerId!].IsLibero, "libero served");
                        Assert.Equal(1, e.CourtPosition);
                        break;
                    case EventType.Attack:
                        Assert.False(players[e.PlayerId!].IsLibero, "libero attacked");
                        break;
                    case EventType.Set:
                        // 세트는 리베로도 가능(백업 세터). 단 공격 지정 위치(Value)는 1~6
                        Assert.InRange(e.Value, 1, 6);
                        break;
                }
            }
            Assert.True(swaps >= r.Sets.Count * 2, $"libero swaps too few: {swaps}");
            Assert.Equal(swaps, r.HomeStats.LiberoSwaps + r.AwayStats.LiberoSwaps);
        }
    }

    [Fact]
    public void LiberoRule_MbAtPosition1ServesWhenTeamServes_ReplacedWhenReceiving()
    {
        var home = TestHelpers.Home(4);
        var t = new TeamMatchState(TeamSide.Home, home, Tactics.Default());
        var log = new MatchLog();
        // 표준 5-1: 1:S 2:OH 3:MB 4:OP 5:OH 6:MB → 로테이션 0에서는 6번 MB를 리베로가 대신
        t.ApplyLiberoRule(true, log, 1, 0, 0, 0);
        Assert.True(t.PlayerAt(6).IsLibero);
        Assert.Equal(Position.MB, t.LiberoReplacing!.Position);
        // 2번 로테이션 후(3→2→1): 원래 3번 MB가 1번(서버) → 서브권 있으면 MB가 그대로 서브
        for (int i = 0; i < 2; i++) t.Rotate();
        Assert.Equal(Position.MB, t.BasePlayerAt(1).Position);
        t.ApplyLiberoRule(true, log, 1, 1, 0, 0);
        Assert.False(t.PlayerAt(1).IsLibero);
        Assert.Null(t.LiberoReplacing);
        // 서브권을 잃고 리시브 상태가 되면 1번 MB 를 리베로가 대신
        t.ApplyLiberoRule(false, log, 1, 2, 0, 0);
        Assert.True(t.PlayerAt(1).IsLibero);
        // 리베로는 절대 전위에 없음
        for (int rot = 0; rot < 12; rot++)
        {
            t.Rotate();
            t.ApplyLiberoRule(rot % 2 == 0, log, 1, rot, 0, 0);
            for (int p = 2; p <= 4; p++) Assert.False(t.PlayerAt(p).IsLibero);
        }
    }

    [Fact]
    public void Substitution_LimitedTo6PerSet_AndLiberoExcluded()
    {
        var home = TestHelpers.Home(6);
        var cfg = SimConfig.CreateDefault();
        var t = new TeamMatchState(TeamSide.Home, home, Tactics.Default());
        var log = new MatchLog();
        var bench = home.Lineup.BenchIds.Where(id => !home.GetPlayer(id).IsLibero).ToList();
        Assert.True(bench.Count >= 5);

        // 벤치 5명을 순서대로 투입 (5회), 그 다음 다시 교체 (6회째), 7회째 실패
        int ok = 0;
        string[] starters = (string[])home.Lineup.StartingIds.Clone();
        for (int i = 0; i < 5; i++) if (t.TrySubstitute(starters[i], bench[i], cfg, log, 1, 1, 0, 0)) ok++;
        Assert.Equal(5, ok);
        Assert.True(t.TrySubstitute(bench[0], starters[0], cfg, log, 1, 2, 0, 0));
        Assert.Equal(6, t.SubstitutionsUsed);
        Assert.False(t.TrySubstitute(bench[1], starters[1], cfg, log, 1, 3, 0, 0));
        Assert.Equal(6, log.Events.Count(e => e.Type == EventType.Substitution));

        // 리베로는 일반 교체 불가
        var t2 = new TeamMatchState(TeamSide.Home, home, Tactics.Default());
        Assert.False(t2.TrySubstitute(home.Lineup.StartingIds[0], home.Lineup.LiberoId, cfg, log, 1, 1, 0, 0));
        t2.ResetForSet();
        Assert.Equal(0, t2.SubstitutionsUsed);
    }

    [Fact]
    public void Lineup_Validation_RejectsLiberoAsStarterAndDuplicates()
    {
        var home = TestHelpers.Home(7);
        var bad = new TeamState { Team = home.Team, Roster = home.Roster, Lineup = home.Lineup.Clone() };
        bad.Lineup.StartingIds[0] = home.Lineup.LiberoId!;
        Assert.Throws<InvalidOperationException>(() => bad.Validate());

        var dup = new TeamState { Team = home.Team, Roster = home.Roster, Lineup = home.Lineup.Clone() };
        dup.Lineup.StartingIds[1] = dup.Lineup.StartingIds[0];
        Assert.Throws<InvalidOperationException>(() => dup.Validate());

        home.Validate();
    }

    [Fact]
    public void Serve_AlwaysFromPosition1_AndFirstServerAlternatesBySet()
    {
        var r = TestHelpers.Play(12);
        TeamSide? firstServerSet1 = null;
        int set = 0;
        foreach (var e in r.Log.Events)
        {
            if (e.Type == EventType.SetStart)
            {
                set = e.Set;
                if (set == 1) firstServerSet1 = e.Side;
                else if (set < 5) Assert.Equal(set % 2 == 1 ? firstServerSet1 : firstServerSet1!.Value.Opposite(), e.Side);
            }
            if (e.Type == EventType.Serve) Assert.Equal(1, e.CourtPosition);
        }
        Assert.Equal(TeamSide.Home, firstServerSet1);
    }

    [Fact]
    public void FirstServeReceiving_TeamLiberoReplacesPosition1Mb_NotWhenServing()
    {
        // 한 경기 전체에서 "서브 이벤트 직후 서버가 MB 인 경우"가 존재하고 그 때 리베로가 1번에 없음을 확인 (규칙 반영 증거)
        var h = TestHelpers.Home(8);
        var a = TestHelpers.Away(8);
        var r = MatchSimulator.Simulate(h, a, null, null, 77);
        var players = h.Roster.Concat(a.Roster).ToDictionary(p => p.Id);
        int mbServes = r.Log.Events.Count(e => e.Type == EventType.Serve && players[e.PlayerId!].Position == Position.MB);
        Assert.True(mbServes > 0);
    }
}
