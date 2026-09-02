using System.Globalization;
using System.Text;
using VolleySim.Play;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
try { Console.OutputEncoding = Encoding.UTF8; } catch { }

// ---------------- 인자 ----------------
bool auto = false, oracleTable = false, calibrate = false, fullCommentary = false, useStub = false;
int runs = 8, seed = 1, matchesPerClub = 1, n = 2000;
double opponentGrowth = 0.0;
string policyName = "optimal";
string? scriptPath = null, dataDir = null, savePath = null, clubName = null, loadPath = null;

try
{
for (int i = 0; i < args.Length; i++)
{
    string a = args[i];
    string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{a} 값이 필요합니다");
    switch (a)
    {
        case "--auto": auto = true; break;
        case "--runs": runs = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--seed": seed = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--policy": policyName = Next(); break;
        case "--matches": matchesPerClub = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--script": scriptPath = Next(); break;
        case "--data": dataDir = Next(); break;
        case "--save": savePath = Next(); break;
        case "--load": loadPath = Next(); break;
        case "--club": clubName = Next(); break;
        case "--commentary": fullCommentary = true; break;
        case "--stub-eval": useStub = true; break;
        case "--oracle-table": oracleTable = true; break;
        case "--calibrate-eval": calibrate = true; break;
        case "--n": n = int.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "--opponent-growth": opponentGrowth = double.Parse(Next(), CultureInfo.InvariantCulture); break;
        case "-h": case "--help":
            Console.WriteLine("사용법: dotnet run --project sim/VolleySim.Play -- [옵션]");
            Console.WriteLine("  (없음)                 대화형 코어 루프 (stdin)");
            Console.WriteLine("  --script 파일          입력 줄을 순서대로 공급 (비대화)");
            Console.WriteLine("  --auto --runs N --seed S [--policy safe|optimal|push|random] [--matches M]   정책으로 N회 자동 육성 후 6구단과 각 M경기");
            Console.WriteLine("  --seed S --club 이름 --save saves/x.json --load saves/x.json --data data/ --commentary --stub-eval");
            Console.WriteLine("  --opponent-growth 0.6      6구단 선수를 초기치 + 60%×(잠재력−초기치)로 성장시킨 상대로 가정 (관찰용)");
            Console.WriteLine("  --oracle-table [--n 2000]   문서 12절 정책표 재현(파이썬 오라클 대조)");
            Console.WriteLine("  --calibrate-eval [--n 200]  실제 시뮬 평가전 활약도 캘리브레이션 표");
            return 0;
        default: Console.Error.WriteLine("알 수 없는 인자: " + a + " (--help 로 사용법을 봅니다)"); return 2;
    }
}
}
catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentException)
{
    // 숫자 자리에 문자열이 오는 등 인자 오류는 스택트레이스 대신 한 줄로 알린다.
    Console.Error.WriteLine("인자 오류: " + ex.Message + " (--help 로 사용법을 봅니다)");
    return 2;
}

var stdout = Console.Out;
IInput input = scriptPath != null ? new ScriptInput(File.ReadAllLines(scriptPath), stdout) : new ConsoleInput(stdout);
var ui = new Ui(stdout, input);

if (oracleTable) { AutoMode.OracleTable(ui, n); return 0; }
if (calibrate) { AutoMode.CalibrateEval(ui, n == 2000 ? 200 : n); return 0; }

// ---------------- 데이터 ----------------
dataDir ??= FindDataDir();
if (dataDir == null) { Console.Error.WriteLine("data/players.json 을 찾을 수 없습니다. --data 로 지정하세요."); return 2; }
var (players, teams) = Game.LoadData(dataDir);
var cfg = TrainingConfig.CreateDefault();
IEvaluationMatchProvider eval = useStub ? new StubEvaluationProvider() : new SimEvaluationProvider();

GameState state;
if (loadPath != null && File.Exists(loadPath)) { state = GameState.Load(loadPath); savePath ??= loadPath; }
else
{
    if (loadPath != null) Console.Error.WriteLine($"세이브 파일이 없어 새 게임을 시작합니다: {loadPath}");
    state = GameState.NewGame(seed, clubName, unlimited: auto);
}
savePath ??= Path.Combine(Path.GetDirectoryName(dataDir) ?? ".", "saves", auto ? $"auto-{seed}.json" : $"club-{seed}.json");
var game = new Game(state, players, teams, cfg, eval, savePath) { OpponentGrowth = opponentGrowth };

if (auto)
{
    TrainingPolicy policy;
    try { policy = TrainingPolicy.ByName(policyName); }
    catch (ArgumentException ex)
    {
        Console.Error.WriteLine(ex.Message + " — 사용 가능: " + string.Join(" / ", TrainingPolicy.Names));
        return 2;
    }
    AutoMode.RunAuto(ui, game, runs, policy, matchesPerClub, markdown: true);
    return 0;
}

try
{
    new Screens(ui, game, fullCommentary).MainLoop();
}
catch (InputExhaustedException)
{
    ui.Line("입력이 끝나 종료합니다.");
}
ui.Line("안녕히 가세요.");
return 0;

static string? FindDataDir()
{
    foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
    {
        var d = new DirectoryInfo(start);
        for (int i = 0; i < 8 && d != null; i++, d = d.Parent)
        {
            var cand = Path.Combine(d.FullName, "data", "players.json");
            if (File.Exists(cand)) return Path.Combine(d.FullName, "data");
        }
    }
    return null;
}
