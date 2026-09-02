using System.Reflection;
using VolleySim.Training.Policies;

namespace VolleySim.Play.Tests;

public class ScreensTests
{
    private static int Occurrences(string text, string needle)
    {
        int n = 0, i = 0;
        while ((i = text.IndexOf(needle, i, StringComparison.Ordinal)) >= 0) { n++; i += needle.Length; }
        return n;
    }

    private static (Screens screens, StringWriter output) Run(Game g, params string[] script)
    {
        var sw = new StringWriter();
        var ui = new Ui(sw, new ScriptInput(script, sw));
        var s = new Screens(ui, g, fullCommentary: false);
        s.MainLoop();
        return (s, sw);
    }

    /// <summary>불러오기 뒤 메인 메뉴의 상태 표시·구단명 변경·기록은 불러온 상태를 가리켜야 한다(이전에는 루프 밖에서 잡은 옛 상태를 계속 썼다).</summary>
    [Fact]
    public void AfterLoad_MainMenuUsesLoadedState()
    {
        var dir = PlayFixtures.TempDir();
        var a = Path.Combine(dir, "a.json");
        var ga = PlayFixtures.NewGame(5, a, clubName: "A구단");
        ga.Scout();
        ga.State.Save(a);

        var gb = PlayFixtures.NewGame(6, Path.Combine(dir, "b.json"), clubName: "B구단");
        // 7) 불러오기 → 1번 파일(a.json) → 8) 구단명 변경 → 6) 저장 → 0) 종료
        var (_, output) = Run(gb, "7", "1", "8", "새이름", "6", "0");
        var text = output.ToString();
        Assert.Contains("불러왔습니다: A구단", text);
        // 불러오기 이후 화면은 새 상태(A구단 → 새이름)만 가리킨다
        var afterLoad = text.Split("불러왔습니다")[1];
        Assert.Contains("새이름 감독실", afterLoad);
        Assert.DoesNotContain("B구단 감독실", afterLoad);
        Assert.Contains("보유 카드 1장", afterLoad);   // A구단의 스카우트 1회가 반영된 헤더

        var reloaded = GameState.Load(a);
        Assert.Equal("새이름", reloaded.ClubName);
        Assert.Single(reloaded.OwnedCards);
        Assert.Equal("B구단", gb.State.ClubName); // 옛 상태는 건드리지 않는다
    }

    [Fact]
    public void AfterLoad_OpponentGrowthIsPreserved()
    {
        var dir = PlayFixtures.TempDir();
        var a = Path.Combine(dir, "a.json");
        PlayFixtures.NewGame(5, a).State.Save(a);
        var g = PlayFixtures.NewGame(6, Path.Combine(dir, "b.json"), opponentGrowth: 0.35);
        var (screens, _) = Run(g, "7", "1", "0");
        var field = typeof(Screens).GetField("_g", BindingFlags.NonPublic | BindingFlags.Instance)!;
        var current = (Game)field.GetValue(screens)!;
        Assert.NotSame(g, current);
        Assert.Equal(0.35, current.OpponentGrowth);
    }

    /// <summary>--script 소진(EOF) 시 프롬프트 어디에서든 InputExhaustedException 으로 빠져나오고 상태는 깨지지 않는다.</summary>
    [Theory]
    [InlineData("1")]                 // 스카우트 직후 메인 프롬프트에서 EOF
    [InlineData("2", "1")]            // 카드 선택 후 진행 방식 프롬프트에서 EOF
    [InlineData("2", "1", "1")]       // 수동 육성 첫 턴 프롬프트에서 EOF
    [InlineData("4")]                 // 라인업 화면 프롬프트에서 EOF
    [InlineData("5")]                 // 경기 상대 선택 프롬프트에서 EOF
    public void ScriptExhaustion_ThrowsInputExhausted_AtAnyPrompt(params string[] script)
    {
        var g = PlayFixtures.NewGame(13, Path.Combine(PlayFixtures.TempDir(), "x.json"));
        Assert.Throws<InputExhaustedException>(() => Run(g, script));
        Assert.InRange(g.State.Tickets, 0, GameState.InitialTickets);
    }

    [Fact]
    public void InvalidInputs_FallBackToDefaults_WithoutCrashing()
    {
        var g = PlayFixtures.NewGame(14, Path.Combine(PlayFixtures.TempDir(), "y.json"));
        g.State.UnlimitedTickets = true;
        var (_, output) = Run(g,
            "zzz",            // 알 수 없는 메뉴
            "1",              // 스카우트
            "2", "99",        // 카드 번호 범위 밖 → 취소
            "2", "1", "9",    // 진행 방식 범위 밖 → 기본(수동)
            "abc", "0", "7",  // 턴 화면: 잘못된 입력 → 재질문, 0/7 도 범위 밖 → 재질문
            "a",              // 남은 턴 자동(안전)
            "4", "9 1", "1 x", "7 2", ".",  // 라인업: 범위 밖 슬롯, 비숫자, 리베로 슬롯에 비리베로
            "5", "0",         // 경기 취소
            "3", "p9", "x0", "0");
        var text = output.ToString();
        Assert.Contains("메뉴 번호를 입력하세요", text);
        Assert.Contains("1~6 또는 a/o/r", text);
        Assert.Contains("졸업 —", text);
        Assert.Equal(1, g.State.TrainingCount);
        Assert.Single(g.State.Instances);
    }

    [Fact]
    public void DemoScript_RunsToCompletion()
    {
        var dir = PlayFixtures.TempDir();
        var demo = Path.Combine(PlayFixtures.FindDataDir(), "..", "sim", "VolleySim.Play", "scripts", "demo.txt");
        Assert.True(File.Exists(demo), demo);
        var g = PlayFixtures.NewGame(7, Path.Combine(dir, "demo.json"), new VolleySim.Training.Evaluation.SimEvaluationProvider());
        var sw = new StringWriter();
        var ui = new Ui(sw, new ScriptInput(File.ReadAllLines(demo), sw));
        new Screens(ui, g, fullCommentary: false).MainLoop();
        var text = sw.ToString();
        // 데모 시나리오: 스카우트 3회 → 육성 2회(수동→자동, 스킵) → 로스터·라인업 확인 → 경기 1회 → 저장 → 종료
        Assert.Equal(3, Occurrences(text, "── 스카우트"));
        Assert.Equal(2, Occurrences(text, "══════ 졸업 —"));
        Assert.Contains("── 경기 — 상대 선택", text);
        Assert.Contains("저장했습니다:", text);
        Assert.Equal(2, g.State.TrainingCount);
        Assert.Equal(1, g.State.Wins + g.State.Losses);
        Assert.True(File.Exists(Path.Combine(dir, "demo.json")));
    }
}
