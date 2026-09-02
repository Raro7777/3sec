using VolleySim.Training;
using VolleySim.Training.Policies;

namespace VolleySim.Play.Tests;

public class EconomyTests
{
    /// <summary>조각 3개 = 티켓 1 규칙은 패배뿐 아니라 방출(로스터 화면·졸업 비교 화면)에서도 성립해야 한다.</summary>
    [Fact]
    public void Fragments_FromRelease_ConvertToTicket()
    {
        var g = PlayFixtures.NewGame(8, Path.Combine(PlayFixtures.TempDir(), "e.json"));
        var st = g.State;
        st.UnlimitedTickets = true;
        // 대표 1명 만들고, 같은 카드를 세 번 더 키워 전부 방출(decision 2)
        var first = PlayFixtures.ScoutAndTrain(g, new SafePolicy());
        st.UnlimitedTickets = false;
        int tickets = st.Tickets;
        Assert.Equal(0, st.Fragments);
        for (int i = 0; i < 3; i++)
        {
            var card = g.TrainingCard(first.CardId);
            var session = g.NewSession(card, g.BuildSupport(card, g.RecommendSupporters(card)));
            var r = TrainingRunner.Run(session, new SafePolicy());
            g.Graduate(r, decision: 2);
        }
        Assert.Equal(0, st.Fragments);
        Assert.Equal(tickets + 1, st.Tickets);
        Assert.Single(st.Instances);

        // 로스터 화면 방출 경로도 같은 규칙
        st.Instances.Add(new VolleySim.Training.PlayerInstance { InstanceId = "x1", CardId = "zzz1", Name = "더미1", IsRepresentative = false });
        st.Instances.Add(new VolleySim.Training.PlayerInstance { InstanceId = "x2", CardId = "zzz2", Name = "더미2", IsRepresentative = false });
        st.Instances.Add(new VolleySim.Training.PlayerInstance { InstanceId = "x3", CardId = "zzz3", Name = "더미3", IsRepresentative = false });
        g.ReleaseInstance(st.Instances[1]); g.ReleaseInstance(st.Instances[1]);
        Assert.Equal(2, st.Fragments);
        g.ReleaseInstance(st.Instances[1]);
        Assert.Equal(0, st.Fragments);
        Assert.Equal(tickets + 2, st.Tickets);
        Assert.InRange(st.Fragments, 0, GameState.FragmentsPerTicket - 1);
    }

    [Fact]
    public void Loss_GivesFragment_ThirdLossGivesTicket_AndWinGivesTicket()
    {
        var g = PlayFixtures.NewGame(2, Path.Combine(PlayFixtures.TempDir(), "l.json"));
        var st = g.State;
        int tickets = st.Tickets, losses = 0, wins = 0;
        for (int i = 0; i < 12; i++)
        {
            var r = g.PlayMatch(g.Clubs[i % g.Clubs.Count], collectEvents: false);
            if (r.Winner == VolleySim.Domain.TeamSide.Home) wins++; else losses++;
            Assert.InRange(st.Fragments, 0, GameState.FragmentsPerTicket - 1);
            Assert.Equal(tickets + wins + losses / GameState.FragmentsPerTicket, st.Tickets);
            Assert.Equal(losses % GameState.FragmentsPerTicket, st.Fragments);
        }
        Assert.Equal(wins, st.Wins);
        Assert.Equal(losses, st.Losses);
    }

    [Fact]
    public void Scout_ConsumesTicket_AndDuplicateRaisesLimitBreakPotential()
    {
        var g = PlayFixtures.NewGame(4, Path.Combine(PlayFixtures.TempDir(), "s.json"));
        var st = g.State;
        int before = st.Tickets;
        var (c1, dup1, lb1) = g.Scout();
        Assert.Equal(before - 1, st.Tickets);
        Assert.False(dup1); Assert.Equal(0, lb1);
        st.UnlimitedTickets = true;
        (VolleySim.Domain.Player card, bool dup, int lb) r = default;
        int guard = 0;
        do { r = g.Scout(); } while (!r.dup && guard++ < 500);
        Assert.True(r.dup);
        Assert.Equal(st.OwnedCards[r.card.Id], r.lb);
        var trained = g.TrainingCard(r.card.Id);
        var baseCard = g.Card(r.card.Id);
        for (int k = 0; k < 10; k++)
        {
            var kind = VolleySim.Domain.Stats.AllKinds[k];
            Assert.Equal(VolleySim.Domain.Stats.Clamp(baseCard.Potential[kind] + r.lb * GameState.LimitBreakPotential), trained.Potential[kind]);
            Assert.Equal(baseCard.Stats[kind], trained.Stats[kind]);
        }
        st.UnlimitedTickets = false;
        st.Tickets = 0;
        Assert.False(g.CanScout);
        Assert.Throws<InvalidOperationException>(() => g.Scout());
    }

    [Fact]
    public void AutoLineup_FollowsPositionRule_AndFillersOnlyWhereNeeded()
    {
        var g = PlayFixtures.NewGame(9, Path.Combine(PlayFixtures.TempDir(), "a.json"));
        var st = g.State;
        st.UnlimitedTickets = true;
        for (int i = 0; i < 6; i++) PlayFixtures.ScoutAndTrain(g, new SafePolicy());
        var ts = g.MyTeamState();
        var pos = ts.Lineup.StartingIds.Select(id => ts.GetPlayer(id)!.Position).ToArray();
        Assert.Equal(new[] { VolleySim.Domain.Position.S, VolleySim.Domain.Position.OH, VolleySim.Domain.Position.MB, VolleySim.Domain.Position.OP, VolleySim.Domain.Position.OH, VolleySim.Domain.Position.MB }, pos);
        Assert.True(ts.GetPlayer(ts.Lineup.LiberoId)!.IsLibero);
        // 졸업생이 있는 포지션은 연습생이 선발에서 밀려난다.
        var reps = st.Representatives.ToList();
        foreach (var p in reps)
        {
            bool inLineup = ts.Lineup.StartingIds.Contains(p.InstanceId) || ts.Lineup.LiberoId == p.InstanceId;
            int sameCount = reps.Count(q => q.Position == p.Position);
            int slots = p.Position switch { VolleySim.Domain.Position.OH => 2, VolleySim.Domain.Position.MB => 2, _ => 1 };
            if (sameCount <= slots) Assert.True(inLineup, $"{p.Name}({p.Position}) 가 연습생에게 밀림");
        }
        ts.Validate();
        // 수동 배치: 리베로 슬롯에 비리베로, 선발 슬롯에 리베로는 거부
        var lib = g.MyRoster().First(p => p.IsLibero);
        var nonLib = g.MyRoster().First(p => !p.IsLibero);
        Assert.False(g.SetLineupSlot(6, nonLib.Id));
        Assert.False(g.SetLineupSlot(0, lib.Id));
        Assert.True(g.SetLineupSlot(6, lib.Id));
        Assert.True(g.LineupValid());
    }
}
