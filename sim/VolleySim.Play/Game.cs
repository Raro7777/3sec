using VolleySim.Config;
using VolleySim.Data;
using VolleySim.Domain;
using VolleySim.Result;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Play;

/// <summary>코어 루프 오케스트레이션(화면과 무관한 규칙). 콘솔 화면은 <see cref="Screens"/>, 자동 모드는 <see cref="AutoMode"/>.</summary>
public sealed class Game
{
    public readonly GameState State;
    public readonly List<Player> Pool;
    public readonly List<Team> Clubs;
    public readonly TrainingConfig Config;
    public IEvaluationMatchProvider Evaluation;
    public readonly string SavePath;
    /// <summary>6구단 선수 성장 가정(0 = players.json 초기치 그대로, 0.6 = 초기치 + 60% × (잠재력 − 초기치)). 관찰용 옵션.</summary>
    public double OpponentGrowth;

    public Game(GameState state, List<Player> pool, List<Team> clubs, TrainingConfig cfg, IEvaluationMatchProvider eval, string savePath)
    {
        State = state; Pool = pool; Clubs = clubs; Config = cfg; Evaluation = eval; SavePath = savePath;
    }

    public static (List<Player> players, List<Team> teams) LoadData(string dataDir)
    {
        var players = JsonDataLoader.LoadPlayers(Path.Combine(dataDir, "players.json"));
        var teams = JsonDataLoader.LoadTeams(Path.Combine(dataDir, "teams.json"));
        return (players, teams);
    }

    public Player Card(string id) => Pool.First(p => p.Id == id);
    public Team? Club(string id) => Clubs.FirstOrDefault(t => t.Id == id);
    public string ClubName(string id) => Club(id)?.Name ?? id;

    // ---------------- 스카우트 ----------------
    public bool CanScout => State.UnlimitedTickets || State.Tickets > 0;

    /// <summary>희귀도 가중 뽑기(R 80 / SR 17 / SSR 3%). 중복이면 한계돌파(+3 잠재력).</summary>
    public (Player card, bool duplicate, int limitBreak) Scout()
    {
        if (!CanScout) throw new InvalidOperationException("스카우트 티켓이 없습니다");
        if (!State.UnlimitedTickets) State.Tickets--;
        var rng = new TrainingRandom(State.NextSeed());
        double r = rng.NextDouble();
        Rarity rarity = r < GameState.ScoutR ? Rarity.R : (r < GameState.ScoutR + GameState.ScoutSR ? Rarity.SR : Rarity.SSR);
        var cands = Pool.Where(p => p.Rarity == rarity).ToList();
        if (cands.Count == 0) cands = Pool.ToList();
        var card = cands[rng.NextInt(cands.Count)];
        bool dup = State.OwnedCards.ContainsKey(card.Id);
        if (dup) State.OwnedCards[card.Id]++;
        else State.OwnedCards[card.Id] = 0;
        State.History.Add($"스카우트: {card.Name} {card.Position.ToCode()} {card.Rarity}{(dup ? " (중복 → 한계돌파)" : "")}");
        return (card, dup, State.OwnedCards[card.Id]);
    }

    /// <summary>육성 시작용 카드(한계돌파 반영 잠재력).</summary>
    public Player TrainingCard(string cardId)
    {
        var c = Card(cardId).Clone();
        int lb = State.OwnedCards.TryGetValue(cardId, out var v) ? v : 0;
        if (lb > 0) c.Potential = c.Potential.WithAllAdded(lb * GameState.LimitBreakPotential);
        return c;
    }

    public double CardBaseOvr(string cardId) => Config.Ovr(Card(cardId).Stats, Card(cardId).Position);

    // ---------------- 서포터 ----------------
    public List<SupporterInfo> SupporterCandidates(string traineeCardId)
        => State.Representatives.Where(i => i.CardId != traineeCardId).Select(i => i.ToSupporter()).ToList();

    public List<SupporterInfo> RecommendSupporters(Player card)
        => SupportProfile.Recommend(card.Position, card.TeamId, SupporterCandidates(card.Id), Config, Config.SupporterSlots);

    public SupportProfile BuildSupport(Player card, IEnumerable<SupporterInfo> sups) => SupportProfile.Build(card.Position, card.TeamId, sups, Config);

    // ---------------- 육성 ----------------
    public TrainingSession NewSession(Player card, SupportProfile support, int? seed = null)
    {
        var s = new TrainingSession(card, support, Config, Evaluation, seed ?? State.NextSeed());
        s.InstanceId = $"{card.Id}#{++State.InstanceCounter}";
        return s;
    }

    /// <summary>졸업 처리: 대표 없음 → 자동 편입. 있으면 decision(0 교체 / 1 보관 / 2 방출). 첫 완주 보상 티켓 1.</summary>
    public string Graduate(GraduationResult r, int decision)
    {
        State.TrainingCount++;
        var inst = r.Instance;
        inst.RunIndex = State.TrainingCount;
        var rep = State.Representative(inst.CardId);
        string msg;
        if (rep == null)
        {
            inst.IsRepresentative = true;
            State.Instances.Add(inst);
            msg = "로스터에 편입";
        }
        else
        {
            switch (decision)
            {
                case 0:
                    rep.IsRepresentative = false;
                    inst.IsRepresentative = true;
                    State.Instances.Add(inst);
                    msg = $"대표 교체 (기존 OVR {rep.Ovr:0.0} → 보관함)";
                    break;
                case 1:
                    inst.IsRepresentative = false;
                    State.Instances.Add(inst);
                    msg = "보관함에 보관";
                    break;
                default:
                    msg = "방출 (스카우트 조각 +1)" + (AddFragment() ? " → 조각 3개로 티켓 +1" : "");
                    break;
            }
        }
        if (!State.FirstRunRewardGiven)
        {
            State.FirstRunRewardGiven = true;
            State.Tickets += 1;
            msg += " · 첫 완주 보상 티켓 +1";
        }
        State.History.Add($"졸업 #{State.TrainingCount}: {inst.Name} {inst.Position.ToCode()} OVR {inst.Ovr:0.0} {inst.Grade} ({msg})");
        if (State.LineupStarters != null && !LineupValid()) { State.LineupStarters = null; State.LineupLibero = null; }
        return msg;
    }

    public void PromoteInstance(PlayerInstance inst)
    {
        foreach (var i in State.Instances.Where(i => i.CardId == inst.CardId)) i.IsRepresentative = false;
        inst.IsRepresentative = true;
        if (State.LineupStarters != null && !LineupValid()) { State.LineupStarters = null; State.LineupLibero = null; }
    }

    public void ReleaseInstance(PlayerInstance inst)
    {
        State.Instances.Remove(inst);
        AddFragment();
        if (State.LineupStarters != null && !LineupValid()) { State.LineupStarters = null; State.LineupLibero = null; }
    }

    /// <summary>조각 +1. 3개가 모이면 티켓 1로 바꾼다(경기 패배·방출 공통). 변환됐으면 true.</summary>
    private bool AddFragment()
    {
        State.Fragments++;
        if (State.Fragments < GameState.FragmentsPerTicket) return false;
        State.Fragments -= GameState.FragmentsPerTicket;
        State.Tickets++;
        return true;
    }

    // ---------------- 라인업 ----------------
    public List<Player> MyRoster()
    {
        var list = State.Representatives.Select(i => i.ToPlayer(State.ClubId)).ToList();
        list.AddRange(State.Fillers);
        return list;
    }

    public bool LineupValid()
    {
        if (State.LineupStarters == null) return false;
        var roster = MyRoster();
        var st = new TeamState { Team = MyTeam(), Roster = roster, Lineup = new Lineup { StartingIds = State.LineupStarters, LiberoId = State.LineupLibero } };
        try { st.Validate(); return true; } catch { return false; }
    }

    public Team MyTeam() => new Team { Id = State.ClubId, Name = State.ClubName, City = State.ClubCity, HomeArena = State.ClubCity + " 신생 체육관", Colors = new TeamColors { Primary = "#2E8B57", Secondary = "#F5F5DC" } };

    /// <summary>라인업: 수동 편성이 유효하면 그것, 아니면 포지션별 자동(S1·OH2·MB2·OP1·L1).</summary>
    public TeamState MyTeamState()
    {
        var roster = MyRoster();
        var st = new TeamState { Team = MyTeam(), Roster = roster };
        if (LineupValid())
        {
            st.Lineup = new Lineup { StartingIds = (string[])State.LineupStarters!.Clone(), LiberoId = State.LineupLibero };
            foreach (var p in roster) if (!st.Lineup.StartingIds.Contains(p.Id) && p.Id != State.LineupLibero) st.Lineup.BenchIds.Add(p.Id);
        }
        else st.Lineup = LineupBuilder.Auto(roster);
        return st;
    }

    public void AutoLineup()
    {
        var l = LineupBuilder.Auto(MyRoster());
        State.LineupStarters = (string[])l.StartingIds.Clone();
        State.LineupLibero = l.LiberoId;
    }

    /// <summary>슬롯(0~5 선발, 6 리베로)에 선수 배치. 유효하지 않으면 false.</summary>
    public bool SetLineupSlot(int slot, string playerId)
    {
        if (State.LineupStarters == null) AutoLineup();
        var starters = (string[])State.LineupStarters!.Clone();
        string? libero = State.LineupLibero;
        var p = MyRoster().FirstOrDefault(x => x.Id == playerId);
        if (p == null) return false;
        if (slot == 6)
        {
            if (!p.IsLibero) return false;
            libero = playerId;
        }
        else
        {
            if (p.IsLibero) return false;
            int existing = Array.IndexOf(starters, playerId);
            if (existing >= 0) starters[existing] = starters[slot];
            starters[slot] = playerId;
        }
        var st = new TeamState { Team = MyTeam(), Roster = MyRoster(), Lineup = new Lineup { StartingIds = starters, LiberoId = libero } };
        try { st.Validate(); } catch { return false; }
        State.LineupStarters = starters; State.LineupLibero = libero;
        return true;
    }

    public TeamState ClubTeamState(Team club)
    {
        if (OpponentGrowth <= 0) return JsonDataLoader.BuildTeamState(club, Pool);
        var grown = Pool.Where(p => p.TeamId == club.Id).Select(p =>
        {
            var c = p.Clone();
            for (int i = 0; i < 10; i++)
            {
                var k = Stats.AllKinds[i];
                c.Stats[k] = Stats.Clamp((int)Math.Round(p.Stats[k] + OpponentGrowth * (p.Potential[k] - p.Stats[k])));
            }
            return c;
        }).ToList();
        return JsonDataLoader.BuildTeamState(club, grown);
    }

    public double RosterAverageOvr()
    {
        var reps = State.Representatives.ToList();
        return reps.Count == 0 ? 0 : reps.Average(i => i.Ovr);
    }

    /// <summary>라인업 7명(선발 6 + 리베로)의 포지션 OVR 평균(연습생 포함).</summary>
    public double LineupOvr()
    {
        var st = MyTeamState();
        double sum = 0; int n = 0;
        foreach (var id in st.Lineup.StartingIds.Concat(new[] { st.Lineup.LiberoId }))
        {
            var p = st.GetPlayer(id);
            if (p == null) continue;
            sum += Config.Ovr(p.Stats, p.Position); n++;
        }
        return n == 0 ? 0 : sum / n;
    }

    public int FillersInLineup()
    {
        var st = MyTeamState();
        return st.Lineup.StartingIds.Concat(new[] { st.Lineup.LiberoId }).Count(id => id != null && id.StartsWith(State.ClubId + "-t"));
    }

    // ---------------- 경기 ----------------
    public MatchResult PlayMatch(Team club, bool collectEvents, int? seed = null, bool record = true)
    {
        var home = MyTeamState();
        var away = ClubTeamState(club);
        var result = MatchSimulator.Simulate(home, away, Tactics.Default(), Tactics.Default(), seed ?? State.NextSeed(), SimConfig.CreateDefault(), collectEvents);
        if (record) RecordMatch(club, result);
        return result;
    }

    public string RecordMatch(Team club, MatchResult r)
    {
        bool won = r.Winner == TeamSide.Home;
        string reward;
        if (won)
        {
            State.Wins++;
            State.WinsByClub[club.Id] = State.WinsByClub.GetValueOrDefault(club.Id) + 1;
            State.Tickets++;
            reward = "승리 보상: 스카우트 티켓 +1";
        }
        else
        {
            State.Losses++;
            State.LossesByClub[club.Id] = State.LossesByClub.GetValueOrDefault(club.Id) + 1;
            bool converted = AddFragment();
            reward = $"참가 보상: 스카우트 조각 +1 ({State.Fragments}/{GameState.FragmentsPerTicket})";
            if (converted) reward += " → 조각 3개로 티켓 +1";
        }
        State.History.Add($"경기 vs {club.Name}: {(won ? "승" : "패")} {r.HomeSets}-{r.AwaySets} ({r.SetScoreLine()})");
        return reward;
    }
}
