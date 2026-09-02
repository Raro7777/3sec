using VolleySim.Domain;
using VolleySim.Training;
using VolleySim.Training.Evaluation;
using VolleySim.Training.Policies;

namespace VolleySim.Play.Tests;

/// <summary>data/ 로딩과 Game 생성 헬퍼. 평가전은 스텁(빠름·결정적)으로 두고, 결정성 테스트에서만 실제 시뮬을 쓴다.</summary>
public static class PlayFixtures
{
    private static readonly Lazy<(List<Player> players, List<Team> teams)> Data = new(() => Game.LoadData(FindDataDir()));

    public static string FindDataDir()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var d = new DirectoryInfo(start);
            for (int i = 0; i < 10 && d != null; i++, d = d.Parent)
            {
                var cand = Path.Combine(d.FullName, "data", "players.json");
                if (File.Exists(cand)) return Path.Combine(d.FullName, "data");
            }
        }
        throw new FileNotFoundException("data/players.json 을 찾을 수 없습니다");
    }

    public static string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volleysim-play-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static Game NewGame(int seed, string savePath, IEvaluationMatchProvider? eval = null, string? clubName = null, double opponentGrowth = 0)
    {
        var (players, teams) = Data.Value;
        var st = GameState.NewGame(seed, clubName, unlimited: false);
        return new Game(st, players, teams, TrainingConfig.CreateDefault(), eval ?? new StubEvaluationProvider(), savePath) { OpponentGrowth = opponentGrowth };
    }

    public static Game FromState(GameState st, string savePath, IEvaluationMatchProvider? eval = null)
    {
        var (players, teams) = Data.Value;
        return new Game(st, players, teams, TrainingConfig.CreateDefault(), eval ?? new StubEvaluationProvider(), savePath);
    }

    /// <summary>스카우트 1회 후 그 카드를 정책으로 완주시켜 졸업 처리(대표가 있으면 decision 대로).</summary>
    public static PlayerInstance ScoutAndTrain(Game g, TrainingPolicy policy, int decision = 0)
    {
        var (card0, _, _) = g.Scout();
        var card = g.TrainingCard(card0.Id);
        var sups = g.RecommendSupporters(card);
        var session = g.NewSession(card, g.BuildSupport(card, sups));
        var result = TrainingRunner.Run(session, policy);
        g.Graduate(result, decision);
        return result.Instance;
    }
}
