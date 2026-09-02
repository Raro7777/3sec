using System.Text.Json;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Play.Tests;

public class SaveLoadTests
{
    /// <summary>저장 → 불러오기 뒤 이어 간 결과가, 저장 없이 한 번에 진행한 결과와 바이트 단위로 같아야 한다(시드 카운터·로스터·한계돌파·티켓·전적·라인업 전부).</summary>
    [Fact]
    public void SaveLoad_ThenContinue_MatchesUninterruptedRun()
    {
        var dir = PlayFixtures.TempDir();
        string a1 = Path.Combine(dir, "a1.json"), a2 = Path.Combine(dir, "a2.json"), b = Path.Combine(dir, "b.json");

        static void Phase1(Game g)
        {
            PlayFixtures.ScoutAndTrain(g, new SafePolicy());
            PlayFixtures.ScoutAndTrain(g, new OptimalPolicy());
            g.PlayMatch(g.Clubs[0], collectEvents: false);
            g.PlayMatch(g.Clubs[5], collectEvents: false);
        }
        static void Phase2(Game g)
        {
            // 같은 카드가 다시 나오면 한계돌파 + 인스턴스 비교(교체) 경로, 아니면 편입 경로를 탄다.
            PlayFixtures.ScoutAndTrain(g, new PushPolicy(), decision: 0);
            g.PlayMatch(g.Clubs[2], collectEvents: false);
            g.AutoLineup();
            g.PlayMatch(g.Clubs[1], collectEvents: false);
        }

        // A: 1단계 → 저장 → 불러오기 → 2단계 → 저장 (실제 시뮬 평가전으로 시드 소비 경로까지 포함)
        var ga = PlayFixtures.NewGame(11, a1, new SimEvaluationProvider());
        Phase1(ga);
        ga.State.Save(a1);
        var loaded = GameState.Load(a1);
        var ga2 = PlayFixtures.FromState(loaded, a2, new SimEvaluationProvider());
        Phase2(ga2);
        ga2.State.Save(a2);

        // B: 중단 없이 1단계 → 2단계 → 저장
        var gb = PlayFixtures.NewGame(11, b, new SimEvaluationProvider());
        Phase1(gb);
        Phase2(gb);
        gb.State.Save(b);

        Assert.Equal(File.ReadAllText(b), File.ReadAllText(a2));
        Assert.True(gb.State.Instances.Count >= 2);
        Assert.Equal(gb.State.SeedIndex, ga2.State.SeedIndex);
        Assert.Equal(gb.State.History, ga2.State.History);
    }

    [Fact]
    public void Save_DoesNotDuplicateRepresentativesView()
    {
        var dir = PlayFixtures.TempDir();
        var path = Path.Combine(dir, "s.json");
        var g = PlayFixtures.NewGame(3, path);
        PlayFixtures.ScoutAndTrain(g, new SafePolicy());
        g.State.Save(path);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        Assert.False(doc.RootElement.TryGetProperty("Representatives", out _), "파생 뷰 Representatives 가 세이브에 중복 기록됨");
        Assert.True(doc.RootElement.TryGetProperty("Instances", out var inst) && inst.GetArrayLength() == 1);

        // 옛 세이브(Representatives 키 포함)도 그대로 읽힌다.
        var text = File.ReadAllText(path).Replace("\"Instances\":", "\"Representatives\": [],\n  \"Instances\":");
        File.WriteAllText(path, text);
        var st = GameState.Load(path);
        Assert.Single(st.Instances);
        Assert.Single(st.Representatives);
    }

    [Fact]
    public void Load_PreservesRosterLimitBreakTicketsAndLineup()
    {
        var dir = PlayFixtures.TempDir();
        var path = Path.Combine(dir, "r.json");
        var g = PlayFixtures.NewGame(21, path);
        var st = g.State;
        // 중복이 나올 때까지 스카우트(티켓 무제한으로) → 한계돌파 기록
        st.UnlimitedTickets = true;
        int guard = 0;
        while (!st.OwnedCards.Values.Any(v => v > 0) && guard++ < 200) g.Scout();
        st.UnlimitedTickets = false;
        Assert.Contains(st.OwnedCards.Values, v => v > 0);
        PlayFixtures.ScoutAndTrain(g, new SafePolicy());
        g.AutoLineup();
        g.SetLineupSlot(6, g.MyRoster().First(p => p.IsLibero).Id);
        g.PlayMatch(g.Clubs[3], collectEvents: false);
        st.Save(path);

        var back = GameState.Load(path);
        Assert.Equal(st.OwnedCards, back.OwnedCards);
        Assert.Equal(st.Tickets, back.Tickets);
        Assert.Equal(st.Fragments, back.Fragments);
        Assert.Equal(st.Wins + st.Losses, back.Wins + back.Losses);
        Assert.Equal(st.SeedIndex, back.SeedIndex);
        Assert.Equal(st.LineupStarters, back.LineupStarters);
        Assert.Equal(st.LineupLibero, back.LineupLibero);
        Assert.Equal(st.Instances.Select(i => (i.InstanceId, i.Ovr, i.Grade, i.IsRepresentative)), back.Instances.Select(i => (i.InstanceId, i.Ovr, i.Grade, i.IsRepresentative)));
        Assert.Equal(st.Instances[0].FinalStats, back.Instances[0].FinalStats);
        Assert.Equal(st.Fillers.Select(f => f.Id + f.Stats), back.Fillers.Select(f => f.Id + f.Stats));
        // 불러온 상태로 만든 라인업이 유효하고 같은 선수를 가리킨다.
        var gb = PlayFixtures.FromState(back, path);
        Assert.Equal(g.MyTeamState().Lineup.StartingIds, gb.MyTeamState().Lineup.StartingIds);
        Assert.True(gb.LineupValid());
    }
}
