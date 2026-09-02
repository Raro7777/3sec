using System.Text.Json;
using VolleySim.Commentary;
using VolleySim.Data;
using VolleySim.Domain;
using VolleySim.Log;

namespace VolleySim.Tests;

public class DataTests
{
    private static string SamplePlayersJson()
    {
        var sample = new[]
        {
            new
            {
                id = "p001", name = "김서연", teamId = "t01", position = "S", rarity = "SSR", jerseyNumber = 7, heightCm = 176, age = 22,
                stats = new { serve = 60, receive = 55, set = 85, spike = 50, block = 58, dig = 66, speed = 72, power = 50, stamina = 70, mental = 78 },
                potential = new { serve = 70, receive = 65, set = 95, spike = 60, block = 65, dig = 75, speed = 80, power = 60, stamina = 80, mental = 88 },
                skill = new { name = "실크 토스", description = "완벽 리시브 시 세트 품질 상승" },
                appearance = new { hairStyle = "포니테일", hairColor = "흑발", eyeColor = "갈색", bodyType = "슬림" },
                personality = new[] { "차분함", "리더십", "완벽주의" },
                bio = "신생 구단의 사령탑",
            },
        };
        return JsonSerializer.Serialize(sample, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }

    [Fact]
    public void PlayersJson_RoundTripsThroughSystemTextJson()
    {
        var players = JsonDataLoader.ParsePlayers(SamplePlayersJson());
        Assert.Single(players);
        var p = players[0];
        Assert.Equal("p001", p.Id);
        Assert.Equal("김서연", p.Name);
        Assert.Equal("t01", p.TeamId);
        Assert.Equal(Position.S, p.Position);
        Assert.Equal(Rarity.SSR, p.Rarity);
        Assert.Equal(7, p.JerseyNumber);
        Assert.Equal(176, p.HeightCm);
        Assert.Equal(22, p.Age);
        Assert.Equal(85, p.Stats.Set);
        Assert.Equal(78, p.Stats.Mental);
        Assert.Equal(95, p.Potential.Set);
        Assert.Equal("실크 토스", p.Skill.Name);
        Assert.Equal("포니테일", p.Appearance.HairStyle);
        Assert.Equal(new[] { "차분함", "리더십", "완벽주의" }, p.Personality);
        Assert.Equal("신생 구단의 사령탑", p.Bio);
    }

    [Fact]
    public void PlayersJson_WithUnicodeEscapesAndComments_Parses()
    {
        string json = "[ // comment\n {\"id\":\"p1\",\"name\":\"\\uae40\\uc11c\\uc5f0\",\"teamId\":\"t1\",\"position\":\"L\",\"rarity\":\"R\",\"jerseyNumber\":3,\"heightCm\":165,\"age\":20,\"stats\":{\"serve\":40,\"receive\":80,\"set\":55,\"spike\":30,\"block\":30,\"dig\":85,\"speed\":80,\"power\":40,\"stamina\":70,\"mental\":60},}, ]";
        var players = JsonDataLoader.ParsePlayers(json);
        Assert.Single(players);
        Assert.Equal("김서연", players[0].Name);
        Assert.Equal(Position.L, players[0].Position);
        Assert.Equal(85, players[0].Stats.Dig);
    }

    [Fact]
    public void TeamsJson_Parses()
    {
        string json = "[{\"id\":\"t01\",\"name\":\"서울 스파이커즈\",\"city\":\"서울\",\"colors\":{\"primary\":\"#112233\",\"secondary\":\"#FFFFFF\"},\"emblemConcept\":\"매\",\"identity\":\"공격 배구\",\"homeArena\":\"서울 체육관\"}]";
        var teams = JsonDataLoader.ParseTeams(json);
        Assert.Single(teams);
        Assert.Equal("서울 스파이커즈", teams[0].Name);
        Assert.Equal("#112233", teams[0].Colors.Primary);
        Assert.Equal("서울 체육관", teams[0].HomeArena);
    }

    [Fact]
    public void BuildTeamState_FromGeneratedRoster_ProducesValidLineup()
    {
        var gen = RandomPlayerGenerator.GenerateTeamState(5, "t01", "테스트");
        var team = new Team { Id = "t01", Name = "테스트" };
        var state = JsonDataLoader.BuildTeamState(team, gen.Roster);
        state.Validate();
        Assert.Equal(Position.S, state.GetPlayer(state.Lineup.StartingIds[0]).Position);
        Assert.Equal(Position.MB, state.GetPlayer(state.Lineup.StartingIds[2]).Position);
        Assert.Equal(Position.MB, state.GetPlayer(state.Lineup.StartingIds[5]).Position);
        Assert.True(state.GetPlayer(state.Lineup.LiberoId).IsLibero);
        Assert.Equal(12 - 7, state.Lineup.BenchIds.Count);
    }

    [Fact]
    public void RandomGenerator_IsDeterministic_AndFollowsPositionProfiles()
    {
        var a = RandomPlayerGenerator.GenerateTeamState(99, "x", "x");
        var b = RandomPlayerGenerator.GenerateTeamState(99, "x", "x");
        for (int i = 0; i < a.Roster.Count; i++)
        {
            Assert.Equal(a.Roster[i].Name, b.Roster[i].Name);
            Assert.Equal(a.Roster[i].Stats.ToString(), b.Roster[i].Stats.ToString());
        }
        // 프로파일: 여러 팀 평균으로 검증
        var agg = new Dictionary<Position, (double set, double block, double spike, double recv, double height, int n)>();
        for (int s = 0; s < 40; s++)
        {
            foreach (var p in RandomPlayerGenerator.GenerateTeamState(s, "t", "t").Roster)
            {
                agg.TryGetValue(p.Position, out var v);
                agg[p.Position] = (v.set + p.Stats.Set, v.block + p.Stats.Block, v.spike + p.Stats.Spike, v.recv + p.Stats.Receive, v.height + p.HeightCm, v.n + 1);
            }
        }
        double Avg(Position pos, Func<(double set, double block, double spike, double recv, double height, int n), double> f) => f(agg[pos]) / agg[pos].n;
        Assert.True(Avg(Position.S, v => v.set) > Avg(Position.OH, v => v.set) + 15);
        Assert.True(Avg(Position.MB, v => v.block) > Avg(Position.OH, v => v.block) + 8);
        Assert.True(Avg(Position.MB, v => v.height) > Avg(Position.L, v => v.height) + 10);
        Assert.True(Avg(Position.L, v => v.recv) > Avg(Position.OP, v => v.recv) + 15);
        Assert.True(Avg(Position.L, v => v.spike) < Avg(Position.OP, v => v.spike) - 30);
        foreach (var p in a.Roster)
            foreach (var k in Stats.AllKinds) Assert.InRange(p.Stats[k], 0, 100);
    }

    [Fact]
    public void Commentary_RendersKoreanLinesForEveryRally()
    {
        var h = TestHelpers.Home(1);
        var a = TestHelpers.Away(1);
        var r = MatchSimulator.Simulate(h, a, null, null, 3);
        var lines = KoreanCommentary.Render(r, h, a);
        Assert.True(lines.Count > r.TotalRallies);
        Assert.Contains(lines, l => l.Contains("득점"));
        Assert.Contains(lines, l => l.Contains("서브"));
        Assert.Contains(lines, l => l.Contains("경기 종료"));
        int points = r.Log.Events.Count(e => e.Type == EventType.Point);
        Assert.Equal(r.TotalRallies, points);
    }

    [Fact]
    public void EventLog_HasCompleteStructureForEachRally()
    {
        var r = TestHelpers.Play(2);
        var ev = r.Log.Events;
        int rallies = ev.Count(e => e.Type == EventType.RallyStart);
        Assert.Equal(r.TotalRallies, rallies);
        Assert.Equal(rallies, ev.Count(e => e.Type == EventType.Serve && (e.Outcome == Outcome.InPlay || e.Outcome == Outcome.Error)));
        // 모든 Point 이벤트는 사유가 있고 점수는 단조 증가
        int lastHome = 0, lastAway = 0, lastSet = 0;
        foreach (var e in ev)
        {
            if (e.Type == EventType.SetStart) { lastHome = 0; lastAway = 0; lastSet = e.Set; }
            if (e.Type != EventType.Point) continue;
            Assert.NotEqual(PointReason.None, e.Reason);
            Assert.True(e.HomeScore + e.AwayScore == lastHome + lastAway + 1);
            lastHome = e.HomeScore; lastAway = e.AwayScore;
        }
        Assert.True(lastSet >= 3);
    }
}
