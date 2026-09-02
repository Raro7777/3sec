using System.Collections.Generic;
using System.Text;
using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Commentary
{
    /// <summary>
    /// 이벤트 로그 → 한국어 텍스트 중계 예시 렌더러.
    /// 이벤트 구조가 핵심이고 문장은 예시 수준. 실제 클라이언트는 동일 이벤트를 2D 연출로도 소비한다.
    /// </summary>
    public static class KoreanCommentary
    {
        private sealed class Ctx
        {
            public Dictionary<string, Player> Players = new Dictionary<string, Player>();
            public string HomeName;
            public string AwayName;

            public string Who(string id)
            {
                if (id != null && Players.TryGetValue(id, out var p)) return $"{p.JerseyNumber}번 {p.Name}";
                return id ?? "?";
            }

            public string TeamName(TeamSide s) => s == TeamSide.Home ? HomeName : AwayName;
        }

        public static List<string> Render(MatchResult result, TeamState home, TeamState away, int maxRallies = int.MaxValue)
        {
            var ctx = new Ctx { HomeName = home.Team.Name, AwayName = away.Team.Name };
            foreach (var p in home.Roster) ctx.Players[p.Id] = p;
            foreach (var p in away.Roster) ctx.Players[p.Id] = p;

            var lines = new List<string>();
            if (result.Log == null) return lines;
            var sb = new StringBuilder();
            int ralliesRendered = 0;
            int lastSet = 0;

            foreach (var e in result.Log.Events)
            {
                if (e.Type == EventType.RallyStart)
                {
                    if (sb.Length > 0) { lines.Add(sb.ToString()); sb.Clear(); }
                    ralliesRendered++;
                    if (ralliesRendered > maxRallies) break;
                }
                string t = Line(e, ctx, ref lastSet);
                if (t == null) continue;
                if (e.Type == EventType.SetStart || e.Type == EventType.SetEnd || e.Type == EventType.MatchEnd
                    || e.Type == EventType.Point || e.Type == EventType.LiberoIn || e.Type == EventType.LiberoOut || e.Type == EventType.Rotation)
                {
                    if (sb.Length > 0) { lines.Add(sb.ToString()); sb.Clear(); }
                    lines.Add(t);
                }
                else
                {
                    if (sb.Length > 0) sb.Append(' ');
                    sb.Append(t);
                }
            }
            if (sb.Length > 0) lines.Add(sb.ToString());
            return lines;
        }

        /// <summary>주격 조사 이/가를 마지막 글자의 받침 유무로 붙인다. (예: "채보름" → "채보름이", "하담희" → "하담희가")</summary>
        private static string Ga(string s)
        {
            if (string.IsNullOrEmpty(s)) return s + "가";
            char ch = s[s.Length - 1];
            if (ch >= '가' && ch <= '힣') return s + (((ch - 0xAC00) % 28) != 0 ? "이" : "가");
            return s + "가";
        }

        private static string Line(MatchEvent e, Ctx c, ref int lastSet)
        {
            string who = c.Who(e.PlayerId);
            switch (e.Type)
            {
                case EventType.MatchStart:
                    return $"[경기 시작] {c.HomeName} vs {c.AwayName}";
                case EventType.SetStart:
                    lastSet = e.Set;
                    return $"[{e.Set}세트 시작] {c.TeamName(e.Side)} 서브로 시작합니다. ({e.Value}점 선취)";
                case EventType.RallyStart:
                    return null;
                case EventType.Serve:
                    if (e.Outcome == Outcome.Error) return $"{who}의 서브… 범실! 네트에 걸립니다.";
                    return e.Value >= 65 ? $"{who}의 강서브!" : (e.Value <= 35 ? $"{who}의 안정적인 서브." : $"{who}의 서브.");
                case EventType.Reception:
                    switch (e.Quality)
                    {
                        case Quality.Error: return $"{who}, 리시브 실패! 서브 에이스!";
                        case Quality.Perfect: return $"{who}의 정확한 리시브, 세터에게 완벽하게 연결됩니다.";
                        case Quality.Good: return $"{who}의 리시브가 살짝 흔들리지만 연결.";
                        default: return $"{who}의 리시브가 크게 흔들립니다…";
                    }
                case EventType.Set:
                    {
                        string how;
                        switch (e.AttackType)
                        {
                            case AttackType.Quick: how = "속공으로"; break;
                            case AttackType.BackRow: how = "후위로 길게"; break;
                            case AttackType.Delayed: how = "시간차로"; break;
                            case AttackType.Dump: return $"세터 {who}, 직접 밀어넣습니다!";
                            default: how = e.Quality == Quality.Poor ? "급히 오픈으로" : "오픈으로"; break;
                        }
                        string q = e.Quality == Quality.Perfect ? "깔끔하게" : (e.Quality == Quality.Poor ? "불안하게" : "");
                        return $"세터 {Ga(who)} {how} {q} 올리고,".Replace("  ", " ");
                    }
                case EventType.Attack:
                    switch (e.Outcome)
                    {
                        case Outcome.Kill: return $"{who}의 강타! 득점!";
                        case Outcome.BlockOut: return $"{who}의 공격이 블로커 손을 맞고 밖으로! 득점!";
                        case Outcome.Error: return $"{who}의 공격… 라인을 벗어납니다. 범실.";
                        case Outcome.BlockKill: return $"{who}의 공격이";
                        case Outcome.BlockTouch: return $"{who}의 공격, 블로킹에 걸리고…";
                        case Outcome.Dug: return $"{who}의 공격!";
                        default: return $"{who}의 공격.";
                    }
                case EventType.Block:
                    {
                        string n = e.Value >= 3 ? "3인 블로킹" : (e.Value == 2 ? "2인 블로킹" : "블로킹");
                        if (e.Outcome == Outcome.BlockKill) return $"{who}의 {n}에 완벽하게 막힙니다! 블로킹 득점!";
                        return $"{who}의 {n}이 손끝에 닿습니다.";
                    }
                case EventType.Dig:
                    if (e.AttackType == AttackType.FreeBall) return $"{Ga(who)} 여유 있게 받아냅니다.";
                    switch (e.Quality)
                    {
                        case Quality.Error: return null;
                        case Quality.Perfect: return $"{who}의 완벽한 디그! 랠리가 이어집니다.";
                        case Quality.Good: return $"{Ga(who)} 받아냅니다!";
                        default: return $"{Ga(who)} 가까스로 살려냅니다…";
                    }
                case EventType.Cover:
                    if (e.Outcome == Outcome.Error) return $"{who}의 커버 실패. 블로킹 득점입니다.";
                    return $"{Ga(who)} 커버해서 다시 공격 기회!";
                case EventType.FreeBall:
                    return $"{who}, 공격 대신 프리볼로 넘깁니다.";
                case EventType.Point:
                    {
                        string tag = e.Clutch ? " (클러치!)" : "";
                        return $"  ▶ {c.TeamName(e.Side)} 득점{tag}  [{c.HomeName} {e.HomeScore} : {e.AwayScore} {c.AwayName}]";
                    }
                case EventType.Rotation:
                    return $"  ↻ {c.TeamName(e.Side)} 로테이션. 서버 {who}.";
                case EventType.LiberoIn:
                    return $"  ⇄ {c.TeamName(e.Side)} 리베로 {who} 투입 (OUT: {c.Who(e.SecondaryPlayerIds?[0])}).";
                case EventType.LiberoOut:
                    return $"  ⇄ {c.TeamName(e.Side)} 리베로 {who} 아웃, {c.Who(e.SecondaryPlayerIds?[0])} 복귀.";
                case EventType.Substitution:
                    return $"  ⇄ {c.TeamName(e.Side)} 선수교체: {who} IN, {c.Who(e.SecondaryPlayerIds?[0])} OUT ({e.Value}/6).";
                case EventType.SetEnd:
                    return $"[{e.Value}세트 종료] {c.TeamName(e.Side)} 세트 승리 ({e.HomeScore}-{e.AwayScore})";
                case EventType.MatchEnd:
                    return $"[경기 종료] {c.TeamName(e.Side)} 승리! 세트 스코어 {e.Value / 10}-{e.Value % 10}";
                default:
                    return null;
            }
        }
    }
}
