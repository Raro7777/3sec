using System.Text.Json;
using System.Text.Json.Serialization;
using VolleySim.Data;
using VolleySim.Domain;
using VolleySim.Training;

namespace VolleySim.Play;

/// <summary>구단 운영 상태(저장 단위). 카드 보유 · 졸업 인스턴스 · 연습생 · 라인업 · 재화 · 전적.</summary>
public sealed class GameState
{
    public int Version = 1;
    public string ClubId = "u01";
    public string ClubName = "새록 스프라우츠";
    public string ClubCity = "새록시";
    public int Seed;
    /// <summary>시드 파생 카운터(저장/복원 가능한 난수 상태)</summary>
    public int SeedIndex;
    public int Tickets = 5;
    public int Fragments;
    public int Wins;
    public int Losses;
    public int TrainingCount;
    public int InstanceCounter;
    public bool UnlimitedTickets;
    public bool FirstRunRewardGiven;
    /// <summary>보유 카드: cardId → 한계돌파 횟수(중복 스카우트)</summary>
    public Dictionary<string, int> OwnedCards = new();
    public List<PlayerInstance> Instances = new();
    public List<Player> Fillers = new();
    public string[]? LineupStarters;
    public string? LineupLibero;
    public List<string> History = new();
    public Dictionary<string, int> WinsByClub = new();
    public Dictionary<string, int> LossesByClub = new();

    public const int InitialTickets = 5;
    public const int FragmentsPerTicket = 3;
    public const double ScoutR = 0.80, ScoutSR = 0.17, ScoutSSR = 0.03;
    public const int LimitBreakPotential = 3;
    public const double FillerOverall = 44.0;

    /// <summary>다음 시드(결정적·저장 가능).</summary>
    public int NextSeed()
    {
        unchecked
        {
            uint h = (uint)Seed * 2654435761u;
            h ^= (uint)(++SeedIndex) * 2246822519u + 0x9E3779B9u;
            h ^= h >> 15;
            h *= 3266489917u;
            h ^= h >> 13;
            return (int)(h & 0x7FFFFFFF);
        }
    }

    public IEnumerable<PlayerInstance> Representatives => Instances.Where(i => i.IsRepresentative);
    public PlayerInstance? Representative(string cardId) => Instances.FirstOrDefault(i => i.IsRepresentative && i.CardId == cardId);

    public static GameState NewGame(int seed, string? clubName, bool unlimited)
    {
        var g = new GameState { Seed = seed, UnlimitedTickets = unlimited };
        if (!string.IsNullOrWhiteSpace(clubName)) g.ClubName = clubName.Trim();
        g.CreateFillers();
        return g;
    }

    /// <summary>약한 제네릭 연습생 7명(S1 OH2 MB2 OP1 L1, N 카드 수준)으로 처음부터 경기가 가능하게 한다.</summary>
    public void CreateFillers()
    {
        Fillers.Clear();
        var rng = new VolleySim.Engine.DeterministicRandom(NextSeed());
        Position[] plan = { Position.S, Position.OH, Position.OH, Position.MB, Position.MB, Position.OP, Position.L };
        for (int i = 0; i < plan.Length; i++)
        {
            var p = RandomPlayerGenerator.GeneratePlayer(rng, $"{ClubId}-t{i + 1:00}", ClubId, plan[i], 90 + i, FillerOverall, 3.0);
            p.Rarity = Rarity.N;
            p.Name = "연습생 " + p.Name;
            p.Skill = new SkillData { Name = "", Description = "" };
            Fillers.Add(p);
        }
    }

    // ---------------- 저장/불러오기 ----------------
    private static readonly JsonSerializerOptions JsonOpt = new()
    {
        IncludeFields = true,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public void Save(string path)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOpt));
    }

    public static GameState Load(string path)
    {
        var g = JsonSerializer.Deserialize<GameState>(File.ReadAllText(path), JsonOpt) ?? throw new InvalidDataException("세이브 파일을 읽을 수 없습니다");
        if (g.Fillers.Count == 0) g.CreateFillers();
        return g;
    }
}
