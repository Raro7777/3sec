using VolleySim.Domain;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Play;

/// <summary>12턴 육성 텍스트 루프(11.1절 턴 화면 · 이벤트 팝업 · 평가전 요약 · 졸업 화면).</summary>
public sealed class TrainingScreen
{
    private readonly Ui _ui;
    private readonly TrainingSession _s;
    private TrainingPolicy? _auto;
    private readonly bool _quiet;
    private int _evalsPrinted;

    public TrainingScreen(Ui ui, TrainingSession s, TrainingPolicy? auto = null, bool quiet = false)
    {
        _ui = ui; _s = s; _auto = auto; _quiet = quiet;
    }

    public GraduationResult Run()
    {
        var s = _s;
        if (_auto != null) s.PolicyName = _auto.Name;
        if (!_quiet)
        {
            _ui.Header($"프리시즌 캠프 입소 — {s.Trainee.Card.Name} ({s.Trainee.Position.ToCode()} · {s.Trainee.Card.Rarity})");
            _ui.Line($"초기 OVR {s.InitialOvr:0.0} · 잠재력 합 {s.Trainee.Potential.Sum() - s.Trainee.Initial.Sum()} · 서포터 {(s.Support.Count == 0 ? "없음" : string.Join(", ", s.Support.Supporters.Select(x => x.Name)))}");
            if (s.Support.Count > 0) _ui.Line("  " + s.Support.Summary());
            _ui.Line("팁: 피로가 오르면(핫존 45~79) 훈련이 잘 된다. 대신 부상 배지를 보라. 배지 10%가 분기점.");
        }
        int guard = 0;
        while (s.Phase != SessionPhase.Graduated && guard++ < 500)
        {
            if (s.Phase == SessionPhase.AwaitAction) DoTurn();
            else if (s.Phase == SessionPhase.AwaitEventChoice) DoEvent();
            PrintNewEvaluations();
        }
        var r = s.Result!;
        if (!_quiet) PrintGraduation(r);
        return r;
    }

    private static string Pct(double p) => p <= 0 ? "-" : $"{p * 100:0.0}%";

    private void PrintTurnHeader()
    {
        var s = _s; var t = s.Trainee; var cfg = s.Config;
        string zone = $"{TrainingText.ZoneName(s.Zone)} ×{s.ZoneMult:0.00}";
        string badge = s.Zone == FatigueZone.Hot ? " 🔥" : s.Zone == FatigueZone.Overheat ? " ⚠과열" : "";
        _ui.Line();
        _ui.Line($"┌ T{s.Turn}/{cfg.Turns}{(cfg.IsEvalTurn(s.Turn) ? $" [평가전 {cfg.EvalRound(s.Turn) + 1}차 · 강도 {cfg.EvalStrength[cfg.EvalRound(s.Turn)]}]" : "")}  피로 {t.Fatigue:0} [{zone}{badge}]  컨디션 {TrainingText.ConditionName(t.Condition)} {TrainingText.ConditionArrow(t.Condition)}  콤보 ×{t.Combo}(+{Math.Min(cfg.ComboCap, cfg.ComboStep * t.Combo) * 100:0}%)  힌트 {t.Hints}{(t.HasInjuryHistory ? "  🩹부상이력(×2)" : "")}");
        var parts = new List<string>();
        for (int i = 0; i < 10; i++)
        {
            var k = Stats.AllKinds[i];
            bool core = cfg.Core3[(int)t.Position].Contains(k);
            parts.Add($"{(core ? "*" : "")}{TrainingText.StatShort(k)} {t.Current[i]:0.0}/{t.Potential[i]}");
        }
        _ui.Line("│ " + string.Join("  ", parts.Take(5)));
        _ui.Line("│ " + string.Join("  ", parts.Skip(5)) + $"   OVR {s.CurrentOvr:0.0}");
    }

    private void DoTurn()
    {
        var s = _s; var cfg = s.Config;
        if (s.IsTreating)
        {
            if (!_quiet) { PrintTurnHeader(); _ui.Line($"│ 🩹 치료 중 — 선택지가 잠깁니다 (남은 치료 {s.Trainee.TreatmentTurnsLeft}턴)"); }
            var rec0 = s.Apply(TrainingAction.Rest);
            PrintRecord(rec0);
            return;
        }
        TrainingAction action;
        if (_auto != null)
        {
            action = _auto.Choose(s);
            if (!_quiet) PrintTurnHeader();
        }
        else
        {
            PrintTurnHeader();
            var opts = s.GetOptions();
            for (int i = 0; i < opts.Count; i++)
            {
                var o = opts[i];
                string line;
                if (o.Action == TrainingAction.Rest)
                {
                    line = $"{i + 1}) {Ui.Pad("휴식", 12)} 피로 {o.FatigueDelta:+0;-0;0}, 멘탈 +1, 컨디션↑ {o.RestCondUpP * 100:0}% ({(o.DeepRest ? "깊은 휴식" : "얕은 휴식")}), 콤보 리셋";
                }
                else
                {
                    var stats = o.Action == TrainingAction.Special
                        ? (o.SpecialKind == SpecialKind.Position ? cfg.Core3[(int)s.Trainee.Position] : o.SpecialKind == SpecialKind.Stamina ? cfg.StaminaSpecialStats : new[] { StatKind.Mental })
                        : cfg.TrainingStats[(int)o.Action];
                    string gains = string.Join(" / ", stats.Select(k => $"{TrainingText.StatShort(k)} +{o.ExpectedGains[(int)k]:0.0}"));
                    string apt = o.HasAptitude ? $"[{o.Aptitude}] " : "";
                    string sup = o.SupportBonus > 0 ? $" 서포트 +{o.SupportBonus * 100:0}%" : "";
                    string badge = o.InjuryP <= 0 ? "" : o.InjuryP < 0.10 ? $"  부상 {Pct(o.InjuryP)}" : o.InjuryP < 0.25 ? $"  ⚠부상 {Pct(o.InjuryP)}" : $"  ‼부상 {Pct(o.InjuryP)}";
                    string hint = o.HintGain > 0 ? " 힌트 +1" : "";
                    line = $"{i + 1}) {Ui.Pad(o.Label, 12)} {apt}{gains}  피로 {o.FatigueDelta:+0;-0;0}{sup}{hint}{badge}";
                }
                _ui.Line("│ " + line);
            }
            _ui.Line("│ a) 남은 턴 자동(안전)   o) 남은 턴 자동(최적)   r) 랜덤");
            while (true)
            {
                var inp = _ui.Ask("└ 선택> ").ToLowerInvariant();
                if (inp == "a") { _auto = new SafePolicy(); s.PolicyName = "수동→안전"; action = _auto.Choose(s); break; }
                if (inp == "o") { _auto = new OptimalPolicy(); s.PolicyName = "수동→최적"; action = _auto.Choose(s); break; }
                if (inp == "r") { _auto = new RandomPolicy(); s.PolicyName = "수동→랜덤"; action = _auto.Choose(s); break; }
                if (int.TryParse(inp, out int n) && n >= 1 && n <= opts.Count) { action = opts[n - 1].Action; break; }
                if (inp.Length == 0) { action = s.BestTrainingByEv(); _ui.Line($"  (기본: {TrainingText.ActionName(action)})"); break; }
                _ui.Line("  1~" + opts.Count + " 또는 a/o/r 을 입력하세요.");
            }
        }
        var rec = s.Apply(action);
        PrintRecord(rec);
    }

    private void PrintRecord(TurnRecord rec)
    {
        if (_quiet) return;
        string name = rec.Action == TrainingAction.Special ? TrainingText.SpecialName(rec.SpecialKind) : TrainingText.ActionName(rec.Action);
        if (rec.Injury != InjuryKind.None)
        {
            string loss = string.Join(", ", rec.Losses.Select(l => $"{TrainingText.StatShort(l.Key)} −{l.Value:0}"));
            _ui.Line($"  ✖ {name} 중 {TrainingText.InjuryName(rec.Injury)}! ({(rec.Injury == InjuryKind.Severe ? "무릎 부상" : "발목 염좌")}) 이 턴 상승 0, {loss}, 컨디션 {TrainingText.ConditionName(rec.ConditionAfter)}, 치료 {(rec.Injury == InjuryKind.Severe ? 2 : 1)}턴");
            return;
        }
        string gains = rec.Gains.Count == 0 ? "" : string.Join(", ", rec.Gains.Where(g => g.Value > 0.05).Select(g => $"{TrainingText.StatShort(g.Key)} +{g.Value:0.0}"));
        string cond = rec.ConditionAfter != rec.ConditionBefore ? $" 컨디션 {TrainingText.ConditionName(rec.ConditionBefore)}→{TrainingText.ConditionName(rec.ConditionAfter)}" : "";
        string fire = rec.Zone == FatigueZone.Hot && rec.Action != TrainingAction.Rest && rec.Action != TrainingAction.Treat ? " 🔥핫존" : "";
        _ui.Line($"  ▶ {name}{fire}: {gains}{(gains.Length > 0 ? " · " : "")}피로 {rec.FatigueBefore:0}→{rec.FatigueAfter:0}{cond}  「{rec.Flavor}」");
    }

    private void DoEvent()
    {
        var s = _s; var ev = s.PendingEvent!;
        int choice;
        if (_auto != null) choice = _auto.ChooseEvent(s, ev);
        else
        {
            _ui.Line($"  ◆ {ev.Title}");
            _ui.Line($"    {ev.Text}");
            for (int i = 0; i < ev.Choices.Length; i++) _ui.Line($"    {i + 1}) {ev.Choices[i].Describe()}");
            choice = _ui.AskInt("    선택> ", 1, ev.Choices.Length, 1) - 1;
        }
        var o = s.ResolveEvent(choice);
        if (!_quiet) _ui.Line($"  ◇ {o.Summary()}  「{o.Applied.ResultText}」");
    }

    private void PrintNewEvaluations()
    {
        var s = _s;
        while (_evalsPrinted < s.Evaluations.Count)
        {
            var e = s.Evaluations[_evalsPrinted++];
            if (_quiet) continue;
            PrintEvaluation(_ui, e, s.Config);
        }
    }

    public static void PrintEvaluation(Ui ui, EvaluationOutcome e, TrainingConfig cfg)
    {
        string round = e.Round == 2 ? "최종" : $"{e.Round + 1}차";
        if (e.Absent) { ui.Line($"  ⚑ {round} 평가전 — 부상으로 결장 (보상 없음)"); return; }
        string perf = e.Performance >= cfg.MvpPerf ? "MVP!" : e.Performance >= cfg.GoodPerf ? "좋은 활약" : e.Performance >= cfg.PoorPerf ? "평범" : "부진";
        string reward = e.CoreGain > 0 ? $"핵심3 +{e.CoreGain}, 힌트 +{e.Hint}" : (e.Won ? $"힌트 +{e.Hint}" : "멘탈 +1");
        if (e.ConditionDelta != 0) reward += $", 컨디션 {e.ConditionDelta:+0;-0}";
        if (e.Mvp) reward += ", 다음 턴 특훈 확정";
        ui.Line($"  ⚑ {round} 평가전 vs {e.OpponentName} (강도 {e.OpponentStrength}) — {(e.Won ? "승" : "패")} {e.ScoreLine} · 활약도 {e.Performance:0} ({perf}) · 보상: {reward}, 피로 +{cfg.FatigueMatch:0}");
        foreach (var h in e.Highlights) ui.Line($"      · {h}");
    }

    public void PrintGraduation(GraduationResult r) => PrintGraduation(_ui, _s, r);

    public static void PrintGraduation(Ui ui, TrainingSession s, GraduationResult r)
    {
        var inst = r.Instance; var cfg = s.Config;
        ui.Header($"졸업 — {inst.Name} ({inst.Position.ToCode()} · {inst.Rarity})");
        for (int i = 0; i < 10; i++)
        {
            var k = Stats.AllKinds[i];
            bool core = cfg.Core3[(int)inst.Position].Contains(k);
            string max = inst.FinalStats[i] >= inst.Potential[i] ? " MAX" : "";
            ui.Line($"  {(core ? "*" : " ")}{Ui.Pad(TrainingText.StatName(k), 10)} {inst.InitialStats[i],3} → {inst.FinalStats[i],3} ({inst.FinalStats[i] - inst.InitialStats[i]:+0;-0}) {Ui.Bar(inst.FinalStats[i], inst.Potential[i])} /{inst.Potential[i]}{max}");
        }
        ui.Line($"  등급 【{inst.Grade}】 OVR {r.OvrInitial:0.0} → {inst.Ovr:0.0}  완성도 {inst.Completion * 100:0}% (전체 {inst.AllReach * 100:0}%)  힌트 {r.Hints} → {(r.UnlockedSkills.Count > 0 ? string.Join(", ", r.UnlockedSkills) : "스킬 미해금")}");
        ui.Line($"  \"{r.Comment}\"");
        ui.Line($"  캠프 기록: {r.Camp.Line()} · 정책 {s.PolicyName}");
        var missing = new List<string>();
        for (int i = 0; i < 10; i++)
            if (cfg.Core3[(int)inst.Position].Contains(Stats.AllKinds[i]) && inst.Potential[i] - inst.FinalStats[i] >= 2)
                missing.Add($"{TrainingText.StatName(Stats.AllKinds[i])} 잔여 {inst.Potential[i] - inst.FinalStats[i]}");
        if (missing.Count > 0) ui.Line("  미달: " + string.Join(", ", missing));
    }
}
