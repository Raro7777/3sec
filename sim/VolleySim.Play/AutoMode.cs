using System.Text;
using VolleySim.Domain;
using VolleySim.Result;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Play;

/// <summary>비대화 모드: --auto (정책 자동 육성 N회 후 6구단과 경기), --oracle-table, --calibrate-eval.</summary>
public static class AutoMode
{
    /// <summary>--auto --runs N --seed S: 스카우트 → 정책 자동 육성 → 로스터 편입 → 6구단과 각 M경기. 결과 표 출력.</summary>
    public static void RunAuto(Ui ui, Game g, int runs, TrainingPolicy policy, int matchesPerClub, bool markdown)
    {
        var st = g.State;
        st.UnlimitedTickets = true;
        ui.Line($"# 자동 관찰 — 시드 {st.Seed} · 정책 {policy.Name} · 육성 {runs}회 · 구단당 {matchesPerClub}경기 · 평가전 {(g.Evaluation is SimEvaluationProvider ? "실제 시뮬" : "스텁")} · 상대 성장 {g.OpponentGrowth * 100:0}%");
        ui.Line();
        var clubs = g.Clubs;
        string clubHeader = string.Join(" | ", clubs.Select(c => c.Name.Substring(0, 2)));
        ui.Line($"| 회차 | 카드 | 졸업 | 라인업 OVR | 연습생 | {clubHeader} | 승률 |");
        ui.Line("|---|---|---|---|---|" + string.Concat(Enumerable.Repeat("---|", clubs.Count)) + "---|");
        int firstWinRun = -1;
        var rows = new List<(int run, double winRate, double lineupOvr)>();
        // 0회차: 연습생만으로 경기
        rows.Add(PlayRound(ui, g, 0, "(연습생만)", "—", matchesPerClub, ref firstWinRun));
        for (int run = 1; run <= runs; run++)
        {
            var (card0, dup, lb) = g.Scout();
            var card = g.TrainingCard(card0.Id);
            var sups = g.RecommendSupporters(card);
            var session = g.NewSession(card, g.BuildSupport(card, sups));
            var result = TrainingRunner.Run(session, policy);
            var existing = st.Representative(card.Id);
            int decision = existing == null ? 0 : (result.Instance.Ovr >= existing.Ovr ? 0 : 1);
            g.Graduate(result, decision);
            string cardLabel = $"{card.Name} {card.Position.ToCode()} {card.Rarity}{(dup ? $" LB{lb}" : "")}";
            string grad = $"{result.Instance.Ovr:0.0} {result.Instance.Grade}{(result.Camp.Injuries > 0 ? " 부상" : "")}{(existing != null && decision == 1 ? " 보관" : "")}";
            rows.Add(PlayRound(ui, g, run, cardLabel, grad, matchesPerClub, ref firstWinRun));
        }
        ui.Line();
        ui.Line($"첫 승리까지 육성 횟수: {(firstWinRun < 0 ? "없음(" + runs + "회 내 미승)" : firstWinRun.ToString() + "회")}");
        ui.Line("로스터: " + string.Join(", ", st.Representatives.OrderByDescending(i => i.Ovr).Select(i => $"{i.Name}({i.Position.ToCode()}) {i.Ovr:0.0}{i.Grade}")));
        ui.Line("SUMMARY " + string.Join(" ", rows.Select(r => $"{r.run}:{r.winRate:0.000}:{r.lineupOvr:0.0}")) + $" first={firstWinRun}");
    }

    private static (int run, double winRate, double lineupOvr) PlayRound(Ui ui, Game g, int run, string cardLabel, string grad, int m, ref int firstWinRun)
    {
        var st = g.State;
        var cells = new List<string>();
        int wins = 0, total = 0;
        foreach (var club in g.Clubs)
        {
            int w = 0;
            for (int k = 0; k < m; k++)
            {
                var r = g.PlayMatch(club, collectEvents: false, record: false);
                bool won = r.Winner == TeamSide.Home;
                if (won) { w++; wins++; if (firstWinRun < 0) firstWinRun = run; }
                total++;
                st.History.Add($"[auto {run}] vs {club.Name}: {(won ? "승" : "패")} {r.HomeSets}-{r.AwaySets}");
            }
            cells.Add(m == 1 ? (w == 1 ? "승" : "패") : $"{w}/{m}");
        }
        double rate = total == 0 ? 0 : wins / (double)total;
        double lo = g.LineupOvr();
        ui.Line($"| {run} | {cardLabel} | {grad} | {lo:0.0} | {g.FillersInLineup()} | {string.Join(" | ", cells)} | {rate * 100:0}% |");
        return (run, rate, lo);
    }

    /// <summary>--oracle-table: 문서 12절 정책표를 C# 구현으로 재현(SSR OH 예시 카드, 서포터 없음/풀세팅).</summary>
    public static void OracleTable(Ui ui, int n)
    {
        var cfg = TrainingConfig.CreateDefault();
        Player Card()
        {
            var p = new Player { Id = "card", Name = "SSR OH 예시", TeamId = "t01", Position = Position.OH, Rarity = Rarity.SSR };
            int[] s = { 62, 66, 50, 72, 58, 60, 68, 66, 64, 60 }, q = { 82, 90, 60, 98, 74, 80, 88, 88, 84, 82 };
            for (int i = 0; i < 10; i++) { p.Stats[Stats.AllKinds[i]] = s[i]; p.Potential[Stats.AllKinds[i]] = q[i]; }
            return p;
        }
        SupporterInfo Sup(string name, Position pos, string club, params (StatKind k, int v)[] st)
        {
            var s = new SupporterInfo { Id = name, Name = name, Position = pos, ClubId = club };
            for (int i = 0; i < 10; i++) s.Stats[i] = 60;
            foreach (var (k, v) in st) s.Stats[(int)k] = v;
            return s;
        }
        var full = new List<SupporterInfo>
        {
            Sup("SSR OH S등급(동문)", Position.OH, "t01", (StatKind.Serve, 82), (StatKind.Receive, 90), (StatKind.Spike, 98), (StatKind.Dig, 70), (StatKind.Power, 84), (StatKind.Stamina, 78), (StatKind.Mental, 76)),
            Sup("SSR MB S등급", Position.MB, "t03", (StatKind.Serve, 70), (StatKind.Spike, 88), (StatKind.Block, 98), (StatKind.Power, 92), (StatKind.Speed, 76), (StatKind.Stamina, 78), (StatKind.Mental, 74)),
            Sup("SSR L S등급(라이벌)", Position.L, "t05", (StatKind.Receive, 96), (StatKind.Dig, 94), (StatKind.Set, 66), (StatKind.Speed, 90), (StatKind.Stamina, 80), (StatKind.Mental, 80)),
        };
        ui.Line($"| 정책 | OVR (초기 64.8 대비) | σ | p10 / p90 | 등급 % | 핵심 / 전체 도달 | 부상률 (중상) | 무부상 / 경상 / 중상 OVR | 휴식 / 핫존 훈련 / 훈련 수 | 힌트 |");
        ui.Line("|---|---|---|---|---|---|---|---|---|---|");
        var items = new (string label, TrainingPolicy p, int seed, List<SupporterInfo>? sup)[]
        {
            ("안전(피로 35↑ 휴식)", new SafePolicy(), 1, null), ("최적(배지 >10% 휴식)", new OptimalPolicy(), 1, null), ("푸시(배지 >20% 휴식)", new PushPolicy(), 1, null),
            ("무휴식 몰빵", new NoRestPolicy(), 1, null), ("랜덤", new RandomPolicy(), 1, null), ("스파이크만", new SpikeOnlyPolicy(), 1, null),
            ("최적 + 서포터 풀세팅", new OptimalPolicy(), 4, full), ("안전 + 서포터 풀세팅", new SafePolicy(), 4, full),
        };
        foreach (var (label, p, seed, sup) in items)
        {
            var sum = TrainingRunner.Batch(i =>
            {
                var card = Card();
                var prof = sup == null ? SupportProfile.Empty(cfg) : SupportProfile.Build(card.Position, card.TeamId, sup, cfg);
                return new TrainingSession(card, prof, cfg, new StubEvaluationProvider(), unchecked(seed * 1000003 + i * 7919 + 17));
            }, p, n);
            ui.Line(sum.Line(label, 64.8));
        }
    }

    /// <summary>--calibrate-eval: 포지션별로 트레이니 핵심3 = 강도 −10 / 0 / +10 일 때 순기여·점수차·활약도 분포를 측정.</summary>
    public static void CalibrateEval(Ui ui, int n)
    {
        var cfg = TrainingConfig.CreateDefault();
        var prov = new SimEvaluationProvider(new SimEvaluationProvider.Params { CollectEvents = false });
        int[] profileOH = { 68, 72, 52, 74, 62, 66, 70, 68, 70, 64 };
        int[][] profiles =
        {
            new[] { 62, 58, 82, 50, 58, 66, 70, 52, 68, 72 }, profileOH, new[] { 70, 52, 48, 78, 64, 55, 64, 76, 66, 64 },
            new[] { 58, 45, 45, 70, 78, 50, 62, 70, 64, 62 }, new[] { 40, 82, 60, 30, 30, 82, 78, 45, 72, 66 },
        };
        ui.Line("| 포지션 | Δ | net 평균 | net σ | margin 평균 | perf 평균 | perf σ | 승률 |");
        ui.Line("|---|---|---|---|---|---|---|---|");
        foreach (var pos in new[] { Position.S, Position.OH, Position.OP, Position.MB, Position.L })
        {
            foreach (int delta in new[] { -10, 0, 10 })
            {
                var nets = new List<double>(); var margins = new List<double>(); var perfs = new List<double>(); int wins = 0;
                for (int i = 0; i < n; i++)
                {
                    int strength = 72;
                    // 프로파일을 "핵심3 평균 = 강도 + Δ" 가 되도록 평행 이동
                    var prof = profiles[(int)pos];
                    var core = cfg.Core3[(int)pos];
                    double coreAvg = core.Average(k => prof[(int)k]);
                    double shift = strength + delta - coreAvg;
                    var card = new Player { Id = "c", Name = "트레이니", TeamId = "t01", Position = pos, HeightCm = pos == Position.MB ? 186 : pos == Position.L ? 166 : 178 };
                    var cur = new double[10];
                    for (int k = 0; k < 10; k++) { cur[k] = Math.Clamp(prof[k] + shift, 20, 99); card.Stats[Stats.AllKinds[k]] = (int)Math.Round(cur[k]); card.Potential[Stats.AllKinds[k]] = 99; }
                    var req = new EvaluationRequest { Round = 1, Turn = 8, OpponentStrength = strength, Card = card, Position = pos, CurrentStats = cur, CoreAverage = strength + delta, Condition = Condition.Normal, Config = cfg };
                    var o = prov.Play(req, new TrainingRandom(unchecked(1000 + i * 31 + (int)pos * 7 + delta)));
                    nets.Add(SimEvaluationProvider.NetContribution(pos, o.Box!));
                    margins.Add(o.Match!.TotalHomePoints - o.Match.TotalAwayPoints);
                    perfs.Add(o.Performance);
                    if (o.Won) wins++;
                }
                double Sd(List<double> xs) { double m = xs.Average(); return Math.Sqrt(xs.Average(x => (x - m) * (x - m))); }
                ui.Line($"| {pos} | {delta:+0;-0;0} | {nets.Average():0.00} | {Sd(nets):0.00} | {margins.Average():0.00} | {perfs.Average():0.0} | {Sd(perfs):0.0} | {wins * 100.0 / n:0}% |");
            }
        }
    }
}
