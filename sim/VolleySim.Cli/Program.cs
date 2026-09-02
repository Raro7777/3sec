using System.Globalization;
using System.Text;
using VolleySim;
using VolleySim.Cli;
using VolleySim.Commentary;
using VolleySim.Config;
using VolleySim.Data;
using VolleySim.Domain;
using VolleySim.Log;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
Console.OutputEncoding = Encoding.UTF8;

// ---------------- 인자 파싱 ----------------
int matches = 1000;
int seed = 42;
string? playersPath = null;
string? teamsPath = null;
string? outPath = null;
bool commentary = false;
bool quick = false;
double overall = RandomPlayerGenerator.DefaultOverall;
int commentaryRallies = 12;

for (int i = 0; i < args.Length; i++)
{
    string a = args[i];
    string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{a} 값이 필요합니다");
    switch (a)
    {
        case "--matches": matches = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--seed": seed = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--players": playersPath = Next(); break;
        case "--teams": teamsPath = Next(); break;
        case "--out": outPath = Next(); break;
        case "--overall": overall = double.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--commentary": commentary = true; break;
        case "--commentary-rallies": commentaryRallies = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--quick": quick = true; break;
        case "-h":
        case "--help":
            Console.WriteLine("사용법: dotnet run --project sim/VolleySim.Cli -- [--matches N] [--seed S] [--players data/players.json --teams data/teams.json] [--out report.md] [--commentary] [--quick] [--overall 67]");
            return 0;
        default:
            Console.Error.WriteLine($"알 수 없는 인자: {a}");
            return 2;
    }
}

var config = SimConfig.CreateDefault();

// ---------------- 팀 소스 ----------------
// 파일이 있으면 파일의 앞 두 팀을 홈/원정으로 사용, 없으면 시드 기반 랜덤 동급 팀(경기마다 새 로스터).
TeamState? fileHome = null, fileAway = null;
string source;
if (playersPath != null && File.Exists(playersPath))
{
    var players = JsonDataLoader.LoadPlayers(playersPath);
    List<Team> teams;
    if (teamsPath != null && File.Exists(teamsPath)) teams = JsonDataLoader.LoadTeams(teamsPath);
    else
    {
        teams = players.Select(p => p.TeamId).Distinct().Select(id => new Team { Id = id, Name = id }).ToList();
    }
    var usable = new List<TeamState>();
    foreach (var t in teams)
    {
        try { usable.Add(JsonDataLoader.BuildTeamState(t, players)); }
        catch (Exception ex) { Console.Error.WriteLine($"팀 {t.Id} 라인업 구성 실패: {ex.Message}"); }
    }
    if (usable.Count < 2) { Console.Error.WriteLine("사용 가능한 팀이 2개 미만입니다. 랜덤 생성기로 대체합니다."); }
    else { fileHome = usable[0]; fileAway = usable[1]; }
    source = fileHome != null ? $"파일 ({playersPath}, {fileHome.Team.Name} vs {fileAway!.Team.Name})" : "랜덤 생성기(파일 로드 실패)";
}
else
{
    source = $"시드 기반 랜덤 동급 팀 (overall={overall:0.#}, 경기마다 새 로스터)";
}

TeamState BaseHome(int i) => fileHome ?? RandomPlayerGenerator.GenerateTeamState(MonteCarlo.MixSeed(seed, i, 1), "HOME", "홈", overall);
TeamState BaseAway(int i) => fileAway ?? RandomPlayerGenerator.GenerateTeamState(MonteCarlo.MixSeed(seed, i, 2), "AWAY", "원정", overall);

MatchSetup Setup(int i, Func<TeamState, TeamState>? homeMod = null, Tactics? ht = null, Tactics? at = null)
{
    var h = BaseHome(i);
    if (homeMod != null) h = homeMod(h);
    return new MatchSetup { Home = h, Away = BaseAway(i), HomeTactics = ht ?? Tactics.Default(), AwayTactics = at ?? Tactics.Default() };
}

// ---------------- 시나리오 실행 ----------------
var report = new StringBuilder();
void Line(string s = "") { Console.WriteLine(s); report.AppendLine(s); }

Line($"# 몬테카를로 밸런스 리포트 (자동 생성)");
Line();
Line($"- 실행: `--matches {matches} --seed {seed}`{(quick ? " --quick" : "")}");
Line($"- 팀 소스: {source}");
Line($"- 생성 시각: {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC");
Line();

int scen = quick ? Math.Max(200, matches / 4) : matches;

// 1. 베이스라인 (이벤트 수집 켜서 랠리 길이 히스토그램 확보)
var baseline = MonteCarlo.Run("baseline", matches, seed, i => Setup(i), config, collectEvents: true);
Line("## 1. 베이스라인 지표 (동급 팀)");
Line();
Line("| 지표 | 값 | 목표 범위 | 판정 |");
Line("|---|---|---|---|");
Check("홈 승률", baseline.HomeWinRate, 0.45, 0.55, true);
Check("사이드아웃 성공률", baseline.SideOut, 0.60, 0.65, true);
Check("공격 성공(kill)률", baseline.KillRate, 0.40, 0.45, true);
Check("서브 에이스율", baseline.AceRate, 0.05, 0.08, true);
Check("서브 범실률", baseline.ServeErrorRate, 0.08, 0.12, true);
Check("유효 블로킹 비율(블로킹 득점/공격 시도)", baseline.BlockedRate, 0.08, 0.12, true);
Check("세트당 평균 총 득점", baseline.PointsPerSet, 44, 48, false);
Line();
Line("보조 지표:");
Line();
Line("| 지표 | 값 |");
Line("|---|---|");
Line($"| 공격 범실률 | {P(baseline.AttackErrorRate)} |");
Line($"| 블록 터치(유효 블로킹 접촉) 비율 | {P(baseline.BlockTouchRate)} |");
Line($"| 세트당 블로킹 득점 | {baseline.BlocksPerSet:0.00} |");
Line($"| 세트당 서브 에이스 | {baseline.AcesPerSet:0.00} |");
Line($"| 리시브 A/B/C/실패 | {P(baseline.ReceptionPerfectRate)} / {P(baseline.ReceptionGoodRate)} / {P(baseline.ReceptionPoorRate)} / {P(baseline.ReceptionErrorRate)} |");
Line($"| 첫 공격(퍼스트볼) 성공률 | {P(baseline.FirstBallSideOut)} |");
Line($"| 랠리당 평균 공격 시도 | {baseline.AttacksPerRally:0.00} |");
Line($"| 세트당 프리볼 | {baseline.FreeBallsPerSet:0.00} |");
Line($"| 듀스 세트 비율 | {P(baseline.DeuceSetRate)} |");
Line($"| 경기당 평균 세트 수 | {baseline.SetsPerMatch:0.00} |");
Line($"| 경기당 클러치 랠리 수(홈 기준) | {baseline.ClutchRalliesPerMatch:0.0} |");
Line($"| 홈 클러치 랠리 승률 | {P(baseline.HomeClutchWinRate)} |");
Line($"| 실행 시간 | {baseline.ElapsedMs / 1000:0.0}s ({matches}경기, 이벤트 수집 포함) |");
Line();

Line("랠리 길이 분포(공격 시도 횟수 기준, 0 = 서브로 종료):");
Line();
Line("| 0 | 1 | 2 | 3 | 4 | 5+ |");
Line("|---|---|---|---|---|---|");
{
    double tot = baseline.RallyAttackHist.Sum();
    Line("| " + string.Join(" | ", baseline.RallyAttackHist.Select(v => P(tot > 0 ? v / tot : 0))) + " |");
}
Line();

Line("## 2. 세트 스코어 분포");
Line();
Line("| 3-0 | 3-1 | 3-2 | 0-3 | 1-3 | 2-3 |");
Line("|---|---|---|---|---|---|");
Line("| " + string.Join(" | ", baseline.SetScoreDist.Select(v => P(v / (double)baseline.Matches))) + " |");
Line();
{
    double w30 = (baseline.SetScoreDist[0] + baseline.SetScoreDist[3]) / (double)baseline.Matches;
    double w31 = (baseline.SetScoreDist[1] + baseline.SetScoreDist[4]) / (double)baseline.Matches;
    double w32 = (baseline.SetScoreDist[2] + baseline.SetScoreDist[5]) / (double)baseline.Matches;
    Line($"합산(승패 무관): 3-0 {P(w30)}, 3-1 {P(w31)}, 3-2 {P(w32)}");
}
Line();

Line("## 3. 공격 유형·포지션 분포 (베이스라인)");
Line();
Line("| 공격 유형 | 시도 비중 | 성공률 |");
Line("|---|---|---|");
foreach (var t in new[] { AttackType.Quick, AttackType.Open, AttackType.BackRow, AttackType.Delayed, AttackType.Dump })
    Line($"| {TypeName(t)} | {P(baseline.AttackTypeShare(t))} | {P(baseline.AttackTypeKillRate(t))} |");
Line();
Line("| 포지션 | 공격 시도 비중 | 성공률 | 득점 구성(킬/블로킹/에이스) |");
Line("|---|---|---|---|");
foreach (var pos in new[] { "OH", "OP", "MB", "S", "L" })
{
    if (!baseline.KillsByPosition.TryGetValue(pos, out var kp)) continue;
    baseline.PointsByPosition.TryGetValue(pos, out var pp);
    double share = baseline.Both.Attacks > 0 ? kp[0] / (double)baseline.Both.Attacks : 0;
    double kr = kp[0] > 0 ? kp[1] / (double)kp[0] : 0;
    Line($"| {pos} | {P(share)} | {P(kr)} | {pp?[0] ?? 0} / {pp?[1] ?? 0} / {pp?[2] ?? 0} |");
}
Line();

// 4. 스탯 민감도
Line("## 4. 스탯 민감도 (홈 팀 전원 전 스탯 보정, 원정 동급)");
Line();
Line("| 보정 | 홈 승률 | ±SE | 홈 세트 득실 | 홈 사이드아웃 | 홈 kill% |");
Line("|---|---|---|---|---|---|");
foreach (int d in new[] { -10, 0, 5, 10, 20 })
{
    var agg = d == 0 ? baseline : MonteCarlo.Run($"all{d:+0;-0}", scen, seed, i => Setup(i, h => TeamMods.AddAllStats(h, d)), config);
    Line($"| 전 스탯 {d:+0;-0} | {P(agg.HomeWinRate)} | {P(agg.HomeWinRateStdErr)} | {SetDiff(agg)} | {P(agg.Home.SideOutRate)} | {P(agg.Home.KillRate)} |");
}
Line();

// 5. 포지션별 민감도
Line("## 5. 포지션별 민감도 (해당 포지션 선수만 전 스탯 +15)");
Line();
Line("| 대상 | 인원 | 홈 승률 | 승률 변화 | 1인당 변화 |");
Line("|---|---|---|---|---|");
void PosRow(string label, int count, Func<TeamState, TeamState> mod)
{
    var agg = MonteCarlo.Run(label, scen, seed, i => Setup(i, mod), config);
    double delta = agg.HomeWinRate - baseline.HomeWinRate;
    Line($"| {label} | {count} | {P(agg.HomeWinRate)} | {P(delta, true)} | {P(delta / count, true)} |");
}
PosRow("S만 +15", 1, h => TeamMods.WithStarterSlot(h, 0, 15));
PosRow("OH 2명 +15", 2, h => TeamMods.WithStarterSlot(TeamMods.WithStarterSlot(h, 1, 15), 4, 15));
PosRow("OH 1명만 +15", 1, h => TeamMods.WithStarterSlot(h, 1, 15));
PosRow("OP만 +15", 1, h => TeamMods.WithStarterSlot(h, 3, 15));
PosRow("MB 2명 +15", 2, h => TeamMods.WithStarterSlot(TeamMods.WithStarterSlot(h, 2, 15), 5, 15));
PosRow("MB 1명만 +15", 1, h => TeamMods.WithStarterSlot(h, 2, 15));
PosRow("L만 +15", 1, h => TeamMods.WithPosition(h, Position.L, 15));
Line();

// 6. 개별 스탯 민감도 (전원 특정 스탯 +15)
Line("## 6. 개별 스탯 민감도 (홈 팀 전원 해당 스탯만 +15)");
Line();
Line("| 스탯 | 홈 승률 | 승률 변화 |");
Line("|---|---|---|");
foreach (var k in Stats.AllKinds)
{
    var agg = MonteCarlo.Run($"stat-{k}", scen, seed, i => Setup(i, h => TeamMods.AddStat(h, k, 15)), config);
    Line($"| {k} +15 | {P(agg.HomeWinRate)} | {P(agg.HomeWinRate - baseline.HomeWinRate, true)} |");
}
Line();

// 7. 전술 극단값
Line("## 7. 전술 극단값 비교");
Line();
Line("| 홈 전술 | 원정 전술 | 홈 승률 | 홈 kill% | 홈 에이스율 | 홈 서브범실 | 홈 사이드아웃 | 속공/오픈/후위/시간차 비중(홈) |");
Line("|---|---|---|---|---|---|---|---|");
var quickOnly = new Tactics { QuickWeight = 1, OpenWeight = 0, BackRowWeight = 0, DelayedWeight = 0 };
var openOnly = new Tactics { QuickWeight = 0, OpenWeight = 1, BackRowWeight = 0, DelayedWeight = 0 };
var backOnly = new Tactics { QuickWeight = 0, OpenWeight = 0, BackRowWeight = 1, DelayedWeight = 0 };
var delayedHeavy = new Tactics { QuickWeight = 0.5, OpenWeight = 0.5, BackRowWeight = 0.3, DelayedWeight = 2.0 };
var aggressive = new Tactics { ServeAggression = 1.0 };
var safe = new Tactics { ServeAggression = 0.0 };
var liberoC = new Tactics { Formation = ReceiveFormation.LiberoCentered };
var spread = new Tactics { Formation = ReceiveFormation.Spread };
void TacRow(string hn, string an, Tactics ht, Tactics at)
{
    var agg = MonteCarlo.Run($"tac-{hn}-vs-{an}", scen, seed, i => Setup(i, null, ht, at), config);
    var h = agg.Home;
    string mix = $"{P(h.AttacksByType[(int)AttackType.Quick] / (double)Math.Max(1, h.Attacks))}/{P(h.AttacksByType[(int)AttackType.Open] / (double)Math.Max(1, h.Attacks))}/{P(h.AttacksByType[(int)AttackType.BackRow] / (double)Math.Max(1, h.Attacks))}/{P(h.AttacksByType[(int)AttackType.Delayed] / (double)Math.Max(1, h.Attacks))}";
    Line($"| {hn} | {an} | {P(agg.HomeWinRate)} | {P(h.KillRate)} | {P(h.AceRate)} | {P(h.ServeErrorRate)} | {P(h.SideOutRate)} | {mix} |");
}
TacRow("기본", "기본", Tactics.Default(), Tactics.Default());
TacRow("속공 100%", "기본", quickOnly, Tactics.Default());
TacRow("오픈 100%", "기본", openOnly, Tactics.Default());
TacRow("후위 100%", "기본", backOnly, Tactics.Default());
TacRow("시간차 중심", "기본", delayedHeavy, Tactics.Default());
TacRow("속공 100%", "오픈 100%", quickOnly, openOnly);
TacRow("강서브(1.0)", "기본", aggressive, Tactics.Default());
TacRow("안정서브(0.0)", "기본", safe, Tactics.Default());
TacRow("강서브(1.0)", "안정서브(0.0)", aggressive, safe);
TacRow("리베로 중심 포메이션", "표준", liberoC, Tactics.Default());
TacRow("분산 포메이션", "표준", spread, Tactics.Default());
Line();

// 8. 변수: 클러치·컨디션·호흡도·피로
Line("## 8. 변수 효과 (클러치 mental / 컨디션 / 호흡도 / 피로)");
Line();
Line("| 시나리오 | 홈 승률 | 승률 변화 | 홈 클러치 랠리 승률 | 클러치 랠리/경기 | 5세트 홈 kill% |");
Line("|---|---|---|---|---|---|");
void VarRow(string label, Func<TeamState, TeamState> mod)
{
    var agg = MonteCarlo.Run(label, scen, seed, i => Setup(i, mod), config);
    Line($"| {label} | {P(agg.HomeWinRate)} | {P(agg.HomeWinRate - baseline.HomeWinRate, true)} | {P(agg.HomeClutchWinRate)} | {agg.ClutchRalliesPerMatch:0.0} | - |");
}
Line($"| 베이스라인 | {P(baseline.HomeWinRate)} | - | {P(baseline.HomeClutchWinRate)} | {baseline.ClutchRalliesPerMatch:0.0} | - |");
VarRow("mental +30 (홈 전원)", h => TeamMods.AddStat(h, StatKind.Mental, 30));
VarRow("mental -30 (홈 전원)", h => TeamMods.AddStat(h, StatKind.Mental, -30));
VarRow("stamina +30 (홈 전원)", h => TeamMods.AddStat(h, StatKind.Stamina, 30));
VarRow("stamina -30 (홈 전원)", h => TeamMods.AddStat(h, StatKind.Stamina, -30));
VarRow("팀 컨디션 1.05", h => TeamMods.WithTeamCondition(h, 1.05));
VarRow("팀 컨디션 0.95", h => TeamMods.WithTeamCondition(h, 0.95));
VarRow("세터-공격수 호흡도 100", h => TeamMods.WithChemistry(h, 100));
VarRow("세터-공격수 호흡도 0", h => TeamMods.WithChemistry(h, 0));
Line();

// 9. 팀 레벨 격차
Line("## 9. 팀 레벨 격차 (홈 overall 변화, 원정 67 고정)");
Line();
Line("| 홈 overall | 홈 승률 | 세트당 득점 | 홈 kill% |");
Line("|---|---|---|---|");
if (fileHome == null)
{
    foreach (double ov in new[] { 57.0, 62.0, 67.0, 72.0, 77.0 })
    {
        var agg = MonteCarlo.Run($"ov{ov}", scen, seed,
            i => new MatchSetup { Home = RandomPlayerGenerator.GenerateTeamState(MonteCarlo.MixSeed(seed, i, 1), "HOME", "홈", ov), Away = BaseAway(i) }, config);
        Line($"| {ov:0} | {P(agg.HomeWinRate)} | {agg.PointsPerSet:0.0} | {P(agg.Home.KillRate)} |");
    }
}
else Line("| (파일 팀 사용 시 생략) | | | |");
Line();

// 10. 샘플 중계
if (commentary)
{
    Line("## 10. 샘플 중계 (1세트 앞부분)");
    Line();
    var setup = Setup(0);
    var r = MatchSimulator.Simulate(setup.Home, setup.Away, setup.HomeTactics, setup.AwayTactics, MixSeedForSample(), config, collectEvents: true);
    Line("```");
    foreach (var l in KoreanCommentary.Render(r, setup.Home, setup.Away, commentaryRallies)) Line(l);
    Line("```");
    Line();
    Line($"최종: {r.SetScoreLine()} ({(r.Winner == TeamSide.Home ? "홈" : "원정")} 승, 난수 {r.RandomDraws}회, 이벤트 {r.Log.Count}개)");
    Line();
}

if (outPath != null)
{
    File.WriteAllText(outPath, report.ToString(), new UTF8Encoding(false));
    Console.WriteLine($"[리포트 저장: {outPath}]");
}
return 0;

// ---------------- 헬퍼 ----------------
int MixSeedForSample() => MonteCarlo.MixSeed(seed, 0, 7);

string P(double v, bool signed = false) => signed ? $"{v * 100:+0.0;-0.0;0.0}%p" : $"{v * 100:0.0}%";

string SetDiff(Aggregate a)
{
    int hs = a.SetScoreDist[0] * 3 + a.SetScoreDist[1] * 3 + a.SetScoreDist[2] * 3 + a.SetScoreDist[4] * 1 + a.SetScoreDist[5] * 2;
    int aw = a.SetScoreDist[3] * 3 + a.SetScoreDist[4] * 3 + a.SetScoreDist[5] * 3 + a.SetScoreDist[1] * 1 + a.SetScoreDist[2] * 2;
    return $"{hs / (double)Math.Max(1, a.Matches):0.00}-{aw / (double)Math.Max(1, a.Matches):0.00}";
}

void Check(string name, double v, double lo, double hi, bool pct)
{
    bool ok = v >= lo && v <= hi;
    string val = pct ? P(v) : v.ToString("0.0", CultureInfo.InvariantCulture);
    string range = pct ? $"{lo * 100:0}~{hi * 100:0}%" : $"{lo:0}~{hi:0}";
    string verdict = ok ? "달성" : (v < lo ? $"미달(-{(pct ? (lo - v) * 100 : lo - v):0.0})" : $"초과(+{(pct ? (v - hi) * 100 : v - hi):0.0})");
    Line($"| {name} | {val} | {range} | {verdict} |");
}

static string TypeName(AttackType t) => t switch
{
    AttackType.Quick => "속공(MB)",
    AttackType.Open => "오픈(OH/OP)",
    AttackType.BackRow => "후위(OP)",
    AttackType.Delayed => "시간차",
    AttackType.Dump => "세터 덤프",
    _ => t.ToString(),
};
