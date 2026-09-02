using VolleySim.Commentary;
using VolleySim.Domain;
using VolleySim.Result;
using VolleySim.Training;
using VolleySim.Training.Policies;

namespace VolleySim.Play;

/// <summary>대화형 화면(메인 메뉴 → 스카우트 / 육성 / 로스터 / 라인업 / 경기 / 저장·불러오기).</summary>
public sealed class Screens
{
    private readonly Ui _ui;
    private Game _g;
    private readonly bool _fullCommentary;

    public Screens(Ui ui, Game g, bool fullCommentary) { _ui = ui; _g = g; _fullCommentary = fullCommentary; }

    public void MainLoop()
    {
        var st = _g.State;
        _ui.Line("블룸 리그 연맹은 신생 구단의 창단을 승인했다. 여섯 구단의 공개 스카우트 명단에서 원석을 찾아 키우고, 챔피언십에 도달하라.");
        while (true)
        {
            _ui.Header($"{st.ClubName} 감독실");
            _ui.Line($"티켓 {(st.UnlimitedTickets ? "∞" : st.Tickets.ToString())} · 조각 {st.Fragments}/{GameState.FragmentsPerTicket} · 보유 카드 {st.OwnedCards.Count}장 · 로스터 {st.Representatives.Count()}명(보관 {st.Instances.Count(i => !i.IsRepresentative)}) · 육성 {st.TrainingCount}회 · 전적 {st.Wins}승 {st.Losses}패 · 라인업 OVR {_g.LineupOvr():0.0} (연습생 {_g.FillersInLineup()}명)");
            _ui.Line("1) 스카우트  2) 육성  3) 로스터  4) 라인업  5) 경기  6) 저장  7) 불러오기  8) 구단명 변경  9) 기록  0) 종료");
            var c = _ui.Ask("선택> ");
            switch (c)
            {
                case "1": ScoutScreen(); break;
                case "2": TrainingFlow(); break;
                case "3": RosterScreen(); break;
                case "4": LineupScreen(); break;
                case "5": MatchScreen(); break;
                case "6": _g.State.Save(_g.SavePath); _ui.Line($"저장했습니다: {_g.SavePath}"); break;
                case "7": LoadScreen(); break;
                case "8": { var n = _ui.Ask("새 구단명> "); if (n.Length > 0) st.ClubName = n; break; }
                case "9": foreach (var h in st.History.TakeLast(20)) _ui.Line("  " + h); break;
                case "0": case "q": case "quit": case "exit": return;
                default: _ui.Line("메뉴 번호를 입력하세요."); break;
            }
        }
    }

    // ---------------- 스카우트 ----------------
    private void ScoutScreen()
    {
        var st = _g.State;
        _ui.Sub($"스카우트 (티켓 {(st.UnlimitedTickets ? "∞" : st.Tickets.ToString())}) — 확률 R {GameState.ScoutR * 100:0}% / SR {GameState.ScoutSR * 100:0}% / SSR {GameState.ScoutSSR * 100:0}%");
        if (!_g.CanScout) { _ui.Line("티켓이 없습니다. 경기에서 이기면 +1, 참가하면 조각 +1(3개 = 티켓 1)."); return; }
        var (card, dup, lb) = _g.Scout();
        string rar = card.Rarity == Rarity.SSR ? "★★★ SSR" : card.Rarity == Rarity.SR ? "★★ SR" : "★ R";
        _ui.Line($"  ▶ [{rar}] {card.Name} — {card.Position.ToCode()} · {_g.ClubName(card.TeamId)} · #{card.JerseyNumber} · {card.HeightCm}cm · {card.Age}세");
        _ui.Line($"     {card.Bio}");
        _ui.Line($"     초기 OVR {_g.CardBaseOvr(card.Id):0.0} · 스탯 {card.Stats} · 스킬 {(string.IsNullOrEmpty(card.Skill.Name) ? "없음" : card.Skill.Name)}");
        if (dup) _ui.Line($"     이미 보유한 카드 → 한계돌파 {lb}회 (전 스탯 잠재력 +{lb * GameState.LimitBreakPotential})");
        else _ui.Line("     신인 카드로 보관함에 들어갔습니다. [육성] 메뉴에서 캠프에 보낼 수 있습니다.");
    }

    // ---------------- 육성 ----------------
    private void TrainingFlow()
    {
        var st = _g.State;
        if (st.OwnedCards.Count == 0) { _ui.Line("육성할 카드가 없습니다. 먼저 스카우트하세요."); return; }
        _ui.Sub("육성 — 카드 선택");
        var ids = st.OwnedCards.Keys.ToList();
        for (int i = 0; i < ids.Count; i++)
        {
            var c = _g.Card(ids[i]);
            var rep = st.Representative(ids[i]);
            _ui.Line($"  {i + 1,2}) {Ui.Pad(c.Name, 8)} {Ui.Pad(c.Position.ToCode(), 3)} {Ui.Pad(c.Rarity.ToString(), 4)} 초기 OVR {_g.CardBaseOvr(ids[i]):0.0}  한계돌파 {st.OwnedCards[ids[i]]}  {(rep != null ? $"대표 인스턴스 OVR {rep.Ovr:0.0} {rep.Grade}" : "미육성")}");
        }
        int pick = _ui.AskInt("카드 번호 (0 취소)> ", 0, ids.Count, 0);
        if (pick == 0) return;
        var card = _g.TrainingCard(ids[pick - 1]);

        // 서포터 편성(추천 자동 선택)
        var cands = _g.SupporterCandidates(card.Id);
        var chosen = new List<SupporterInfo>();
        if (cands.Count == 0) _ui.Line("  서포터: 로스터에 졸업생이 없습니다. 첫 졸업생이 다음 육성의 서포터가 됩니다.");
        else
        {
            var rec = _g.RecommendSupporters(card);
            _ui.Sub("서포터 편성 (3슬롯) — 추천 편성이 선택된 상태입니다");
            var tmpProf = _g.BuildSupport(card, Array.Empty<SupporterInfo>());
            for (int i = 0; i < cands.Count; i++)
            {
                var s = cands[i];
                var one = _g.BuildSupport(card, new[] { s });
                string tags = one.Tags.Count > 0 && one.Tags[0].Length > 0 ? " [" + one.Tags[0] + "]" : "";
                _ui.Line($"  {i + 1,2}) {(rec.Any(r => r.Id == s.Id) ? "★" : " ")} {Ui.Pad(s.Name, 8)} {Ui.Pad(s.Position.ToCode(), 3)} OVR {SupportProfile.OvrOf(s, _g.Config):0.0}{tags} — {one.Summary()}  추천점수 {tmpProf.RecommendScore(s, card.Position, card.TeamId):0.000}");
            }
            var inp = _ui.Ask("번호를 공백으로 구분해 최대 3명 (Enter = 추천 편성, 0 = 없음)> ");
            if (inp == "0") { }
            else if (inp.Length == 0) chosen = rec;
            else
            {
                foreach (var tok in inp.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                    if (int.TryParse(tok, out int n) && n >= 1 && n <= cands.Count && chosen.Count < _g.Config.SupporterSlots && chosen.All(c => c.Id != cands[n - 1].Id)) chosen.Add(cands[n - 1]);
            }
        }
        var support = _g.BuildSupport(card, chosen);
        if (chosen.Count > 0) _ui.Line("  편성 합계: " + support.Summary());

        _ui.Line("진행 방식: 1) 수동  2) 자동(안전)  3) 자동(최적)  4) 스킵(최적, 요약만)  5) 자동(랜덤)");
        int mode = _ui.AskInt("선택> ", 1, 5, 1);
        TrainingPolicy? policy = mode switch { 2 => new SafePolicy(), 3 => new OptimalPolicy(), 4 => new OptimalPolicy(), 5 => new RandomPolicy(), _ => null };
        var session = _g.NewSession(card, support);
        var screen = new TrainingScreen(_ui, session, policy, quiet: mode == 4);
        var result = screen.Run();
        if (mode == 4) TrainingScreen.PrintGraduation(_ui, session, result);

        // 인스턴스 비교·교체 (8.6절)
        var existing = st.Representative(card.Id);
        int decision = 0;
        if (existing != null)
        {
            _ui.Sub("인스턴스 비교 — 기존(대표) vs 신규");
            var n = result.Instance;
            _ui.Line($"  {Ui.Pad("", 10)} {Ui.Pad("기존", 8)} {Ui.Pad("신규", 8)}");
            _ui.Line($"  {Ui.Pad("OVR", 10)} {existing.Ovr,7:0.0}  {n.Ovr,7:0.0}  {(n.Ovr > existing.Ovr ? "▲" : n.Ovr < existing.Ovr ? "▼" : "=")}");
            _ui.Line($"  {Ui.Pad("등급", 10)} {Ui.Pad(existing.Grade.ToString(), 8)} {Ui.Pad(n.Grade.ToString(), 8)}");
            _ui.Line($"  {Ui.Pad("완성도", 10)} {existing.Completion * 100,6:0}%  {n.Completion * 100,6:0}%");
            for (int i = 0; i < 10; i++)
            {
                int d = n.FinalStats[i] - existing.FinalStats[i];
                _ui.Line($"  {Ui.Pad(TrainingText.StatName(Stats.AllKinds[i]), 10)} {existing.FinalStats[i],7}  {n.FinalStats[i],7}  {(d > 0 ? "▲" + d : d < 0 ? "▼" + (-d) : "")}");
            }
            _ui.Line($"  {Ui.Pad("스킬", 10)} Lv{existing.SkillLevel}      Lv{n.SkillLevel}");
            _ui.Line("  1) 신규로 교체 (기존은 보관함)  2) 신규를 보관  3) 신규 방출(조각 +1)");
            decision = _ui.AskInt("선택> ", 1, 3, n.Ovr >= existing.Ovr ? 1 : 2) - 1;
        }
        var msg = _g.Graduate(result, decision);
        _ui.Line($"  ▶ {msg}. 티켓 {(st.UnlimitedTickets ? "∞" : st.Tickets.ToString())}");
        _g.State.Save(_g.SavePath);
        _ui.Line($"  (자동 저장: {_g.SavePath})");
    }

    // ---------------- 로스터 ----------------
    private void RosterScreen()
    {
        var st = _g.State;
        _ui.Sub("로스터 (대표 인스턴스) / 보관함");
        var list = st.Instances.OrderByDescending(i => i.IsRepresentative).ThenByDescending(i => i.Ovr).ToList();
        if (list.Count == 0) { _ui.Line("  졸업생이 없습니다. 연습생 7명만 있습니다."); }
        for (int i = 0; i < list.Count; i++)
        {
            var p = list[i];
            _ui.Line($"  {i + 1,2}) {(p.IsRepresentative ? "대표" : "보관")} {Ui.Pad(p.Name, 8)} {Ui.Pad(p.Position.ToCode(), 3)} {Ui.Pad(p.Rarity.ToString(), 4)} OVR {p.Ovr:0.0} {p.Grade} 완성도 {p.Completion * 100:0}% 스킬 Lv{p.SkillLevel} · {p.Camp.Line()}");
        }
        foreach (var f in st.Fillers) _ui.Line($"      {Ui.Pad(f.Name, 14)} {Ui.Pad(f.Position.ToCode(), 3)} OVR {_g.Config.Ovr(f.Stats, f.Position):0.0}");
        if (list.Count == 0) return;
        _ui.Line("  p<번호>) 보관 인스턴스를 대표로 승격   x<번호>) 방출   Enter) 돌아가기");
        var inp = _ui.Ask("선택> ").ToLowerInvariant();
        if (inp.Length >= 2 && int.TryParse(inp.Substring(1), out int n) && n >= 1 && n <= list.Count)
        {
            var target = list[n - 1];
            if (inp[0] == 'p') { _g.PromoteInstance(target); _ui.Line($"  {target.Name} 인스턴스를 대표로 승격했습니다."); }
            else if (inp[0] == 'x') { _g.ReleaseInstance(target); _ui.Line($"  {target.Name} 인스턴스를 방출했습니다 (조각 +1)."); }
        }
    }

    // ---------------- 라인업 ----------------
    private void LineupScreen()
    {
        var st = _g.State;
        var ts = _g.MyTeamState();
        _ui.Sub($"라인업 (표준 5-1) — {(st.LineupStarters != null ? "수동 편성" : "자동 편성")} · 라인업 OVR {_g.LineupOvr():0.0}");
        string[] slotNames = { "1 S(서버)", "2 OH1", "3 MB1", "4 OP", "5 OH2", "6 MB2" };
        for (int i = 0; i < 6; i++) { var p = ts.GetPlayer(ts.Lineup.StartingIds[i]); _ui.Line($"  {i + 1}) {Ui.Pad(slotNames[i], 10)} {Describe(p)}"); }
        { var p = ts.GetPlayer(ts.Lineup.LiberoId); _ui.Line($"  7) {Ui.Pad("L 리베로", 10)} {Describe(p)}"); }
        _ui.Line("  벤치: " + string.Join(", ", ts.Lineup.BenchIds.Select(id => { var p = ts.GetPlayer(id); return p == null ? id : $"{p.Name}({p.Position.ToCode()})"; })));
        _ui.Line("  a) 자동 편성   <슬롯> <선수번호>) 수동 배치 (예: '2 3')   Enter) 돌아가기");
        var roster = _g.MyRoster();
        for (int i = 0; i < roster.Count; i++) _ui.Line($"     선수 {i + 1,2}: {Describe(roster[i])}");
        var inp = _ui.Ask("선택> ").ToLowerInvariant();
        if (inp == "a") { _g.AutoLineup(); _ui.Line("  자동 편성했습니다."); return; }
        var tok = inp.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tok.Length == 2 && int.TryParse(tok[0], out int slot) && int.TryParse(tok[1], out int pi) && slot >= 1 && slot <= 7 && pi >= 1 && pi <= roster.Count)
        {
            bool ok = _g.SetLineupSlot(slot - 1, roster[pi - 1].Id);
            _ui.Line(ok ? "  배치했습니다." : "  배치할 수 없습니다(포지션/리베로 규칙 위반).");
        }
    }

    private string Describe(Player? p)
    {
        if (p == null) return "(비어 있음)";
        return $"{Ui.Pad(p.Name, 10)} {Ui.Pad(p.Position.ToCode(), 3)} {Ui.Pad(p.Rarity.ToString(), 4)} OVR {_g.Config.Ovr(p.Stats, p.Position):0.0}  {p.Stats}";
    }

    // ---------------- 경기 ----------------
    private void MatchScreen()
    {
        _ui.Sub("경기 — 상대 선택 (홈 경기)");
        for (int i = 0; i < _g.Clubs.Count; i++)
        {
            var c = _g.Clubs[i];
            var ts = _g.ClubTeamState(c);
            double ovr = ts.Lineup.StartingIds.Concat(new[] { ts.Lineup.LiberoId }).Where(id => id != null).Average(id => { var p = ts.GetPlayer(id)!; return _g.Config.Ovr(p.Stats, p.Position); });
            int w = _g.State.WinsByClub.GetValueOrDefault(c.Id), l = _g.State.LossesByClub.GetValueOrDefault(c.Id);
            _ui.Line($"  {i + 1}) {Ui.Pad(c.Name, 12)} 라인업 OVR {ovr:0.0}  전적 {w}승 {l}패  — {c.Identity.Split('.')[0]}");
        }
        int pick = _ui.AskInt("상대 번호 (0 취소)> ", 0, _g.Clubs.Count, 0);
        if (pick == 0) return;
        var club = _g.Clubs[pick - 1];
        var home = _g.MyTeamState();
        var result = _g.PlayMatch(club, collectEvents: true, record: false);
        PrintMatch(_ui, _g, home, _g.ClubTeamState(club), result);
        var reward = _g.RecordMatch(club, result);
        _ui.Line("  " + reward);
        bool full = _fullCommentary;
        if (!full && _ui.In.Interactive) full = _ui.AskYes("전체 중계를 볼까요?", false);
        else if (!full) { var a = _ui.Ask("전체 중계? (y/N)> "); full = a.ToLowerInvariant().StartsWith("y"); }
        if (full) foreach (var line in KoreanCommentary.Render(result, home, _g.ClubTeamState(club))) _ui.Line("    " + line);
        _g.State.Save(_g.SavePath);
    }

    public static void PrintMatch(Ui ui, Game g, TeamState home, TeamState away, MatchResult r)
    {
        bool won = r.Winner == TeamSide.Home;
        ui.Line($"  ▶ {home.Team.Name} {r.HomeSets} : {r.AwaySets} {away.Team.Name}  ({r.SetScoreLine()})  → {(won ? "승리!" : "패배")}");
        ui.Line($"     팀 통계 — 킬 {r.HomeStats.Kills}/{r.HomeStats.Attacks} ({r.HomeStats.KillRate * 100:0}%) 에이스 {r.HomeStats.Aces} 블로킹 {r.HomeStats.BlockKills} 범실 {r.HomeStats.AttackErrors + r.HomeStats.ServeErrors} | 상대 킬 {r.AwayStats.Kills}/{r.AwayStats.Attacks} ({r.AwayStats.KillRate * 100:0}%) 에이스 {r.AwayStats.Aces} 블로킹 {r.AwayStats.BlockKills}");
        ui.Line("     " + Ui.Pad("선수", 16) + Ui.Pad("포지션", 7) + " 득점  킬/시도  에이스 블로킹 리시브(A/B/실패) 디그");
        foreach (var id in home.Lineup.StartingIds.Concat(new[] { home.Lineup.LiberoId }))
        {
            if (id == null || !r.BoxScores.TryGetValue(id, out var b)) continue;
            var p = home.GetPlayer(id)!;
            ui.Line($"     {Ui.Pad(p.Name, 16)}{Ui.Pad(p.Position.ToCode(), 7)} {b.Points,4}  {b.Kills,3}/{b.Attacks,-3}  {b.Aces,4}  {b.BlockKills,4}   {b.Receptions,3} ({b.ReceptionPerfect}/{b.ReceptionGood}/{b.ReceptionErrors})  {b.Digs,3}");
        }
        var top = r.BoxScores.Values.Where(b => away.GetPlayer(b.PlayerId) != null).OrderByDescending(b => b.Points).Take(2).ToList();
        ui.Line("     상대 주요 선수: " + string.Join(", ", top.Select(b => $"{b.Name}({b.PositionCode}) {b.Points}점")));
        if (r.Log != null)
        {
            var lines = KoreanCommentary.Render(r, home, away);
            ui.Line("     하이라이트 (세트 종료 직전 랠리):");
            int printed = -1;
            for (int i = 0; i < lines.Count; i++)
            {
                if (lines[i].Contains("세트 종료") || lines[i].Contains("경기 종료"))
                {
                    for (int j = Math.Max(printed + 1, i - 4); j <= i; j++) ui.Line("       " + lines[j]);
                    printed = i;
                }
            }
        }
    }

    // ---------------- 불러오기 ----------------
    private void LoadScreen()
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(_g.SavePath)) ?? "saves";
        var files = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.json").OrderBy(f => f).ToList() : new List<string>();
        if (files.Count == 0) { _ui.Line("세이브 파일이 없습니다."); return; }
        for (int i = 0; i < files.Count; i++) _ui.Line($"  {i + 1}) {Path.GetFileName(files[i])}");
        int pick = _ui.AskInt("파일 번호 (0 취소)> ", 0, files.Count, 0);
        if (pick == 0) return;
        try
        {
            var st = GameState.Load(files[pick - 1]);
            _g = new Game(st, _g.Pool, _g.Clubs, _g.Config, _g.Evaluation, files[pick - 1]);
            _ui.Line($"불러왔습니다: {st.ClubName} (육성 {st.TrainingCount}회, {st.Wins}승 {st.Losses}패)");
        }
        catch (Exception ex) { _ui.Line("불러오기 실패: " + ex.Message); }
    }
}
