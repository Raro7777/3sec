using System;
using System.Collections.Generic;
using VolleySim.Domain;
using VolleySim.Engine;

namespace VolleySim.Data
{
    /// <summary>
    /// 시드 기반 랜덤 선수/팀 생성기. data/players.json 이 없을 때 테스트·CLI 의 기본 입력.
    /// 포지션별 스탯 프로파일(평균)에 정규 근사 잡음을 더한다. 기준 overall=67 은 "프로 주전급"(50~85 범위).
    /// </summary>
    public static class RandomPlayerGenerator
    {
        public const double DefaultOverall = 67.0;
        public const double DefaultSpread = 6.0;

        // 순서: serve, receive, set, spike, block, dig, speed, power, stamina, mental
        private static readonly int[] ProfileS = { 62, 58, 82, 50, 58, 66, 70, 52, 68, 72 };
        private static readonly int[] ProfileOH = { 68, 72, 52, 74, 62, 66, 70, 68, 70, 64 };
        private static readonly int[] ProfileOP = { 70, 52, 48, 78, 64, 55, 64, 76, 66, 64 };
        private static readonly int[] ProfileMB = { 58, 45, 45, 70, 78, 50, 62, 70, 64, 62 };
        private static readonly int[] ProfileL = { 40, 82, 60, 30, 30, 82, 78, 45, 72, 66 };

        private static readonly int[] HeightMean = { 174, 177, 180, 184, 166 }; // S, OH, OP, MB, L

        private static readonly string[] Surnames =
        {
            "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍",
        };

        private static readonly string[] GivenSyllables =
        {
            "서", "연", "지", "민", "수", "하", "은", "유", "예", "아", "채", "윤", "다", "현", "소", "진", "나", "희", "영", "주", "빈", "린", "슬", "혜", "정", "미", "율", "가", "온", "별",
        };

        private static readonly string[] HairStyles = { "포니테일", "숏컷", "단발", "긴 생머리", "트윈테일", "땋은 머리", "웨이브 단발" };
        private static readonly string[] HairColors = { "흑발", "다크브라운", "밤색", "애쉬브라운", "적갈색", "은발" };
        private static readonly string[] EyeColors = { "갈색", "다크브라운", "회색", "청록", "호박색" };
        private static readonly string[] BodyTypes = { "슬림", "탄탄한", "장신", "다부진", "민첩한" };
        private static readonly string[] Personalities = { "승부욕", "차분함", "낙천적", "완벽주의", "리더십", "수줍음", "장난기", "성실함", "냉정함", "열정적" };

        private static readonly string[] SkillNamesS = { "실크 토스", "판을 읽는 눈", "속공 지휘" };
        private static readonly string[] SkillNamesOH = { "천장 공격", "클러치 스파이크", "철벽 리시브" };
        private static readonly string[] SkillNamesOP = { "대포알 백어택", "파워 서브", "라이트 폭격" };
        private static readonly string[] SkillNamesMB = { "철벽 블로킹", "번개 속공", "이동 공격" };
        private static readonly string[] SkillNamesL = { "코트의 수호자", "다이빙 디그", "안정 리시브" };

        private static int[] Profile(Position pos)
        {
            switch (pos)
            {
                case Position.S: return ProfileS;
                case Position.OH: return ProfileOH;
                case Position.OP: return ProfileOP;
                case Position.MB: return ProfileMB;
                default: return ProfileL;
            }
        }

        /// <summary>정규 근사(균등 3개 합). 평균 0, 표준편차 1.</summary>
        private static double Gauss(DeterministicRandom rng)
        {
            return (rng.NextDouble() + rng.NextDouble() + rng.NextDouble() - 1.5) * 2.0;
        }

        public static string RandomName(DeterministicRandom rng)
        {
            string s = Surnames[rng.NextInt(Surnames.Length)];
            string a = GivenSyllables[rng.NextInt(GivenSyllables.Length)];
            string b = GivenSyllables[rng.NextInt(GivenSyllables.Length)];
            return s + a + b;
        }

        public static Player GeneratePlayer(DeterministicRandom rng, string id, string teamId, Position pos, int jersey,
            double overall = DefaultOverall, double spread = DefaultSpread)
        {
            var prof = Profile(pos);
            double delta = overall - DefaultOverall;
            var stats = new Stats();
            for (int i = 0; i < Stats.AllKinds.Length; i++)
            {
                double v = prof[i] + delta + Gauss(rng) * spread;
                stats[Stats.AllKinds[i]] = SimMath.Clamp((int)Math.Round(v), 20, 99);
            }
            var potential = new Stats();
            for (int i = 0; i < Stats.AllKinds.Length; i++)
            {
                potential[Stats.AllKinds[i]] = Stats.Clamp(stats[Stats.AllKinds[i]] + 3 + rng.NextInt(13));
            }
            int height = (int)Math.Round(HeightMean[(int)pos] + Gauss(rng) * 4.0);
            var avg = stats.Average;
            Rarity rarity = avg >= 74 ? Rarity.SSR : (avg >= 68 ? Rarity.SR : (avg >= 60 ? Rarity.R : Rarity.N));

            string[] skillNames;
            switch (pos)
            {
                case Position.S: skillNames = SkillNamesS; break;
                case Position.OH: skillNames = SkillNamesOH; break;
                case Position.OP: skillNames = SkillNamesOP; break;
                case Position.MB: skillNames = SkillNamesMB; break;
                default: skillNames = SkillNamesL; break;
            }

            var personality = new string[3];
            for (int i = 0; i < 3; i++) personality[i] = Personalities[rng.NextInt(Personalities.Length)];

            return new Player
            {
                Id = id,
                Name = RandomName(rng),
                TeamId = teamId,
                Position = pos,
                Rarity = rarity,
                JerseyNumber = jersey,
                HeightCm = height,
                Age = 19 + rng.NextInt(12),
                Stats = stats,
                Potential = potential,
                Skill = new SkillData { Name = skillNames[rng.NextInt(skillNames.Length)], Description = "(프로토타입: 판정 미반영)" },
                Appearance = new Appearance
                {
                    HairStyle = HairStyles[rng.NextInt(HairStyles.Length)],
                    HairColor = HairColors[rng.NextInt(HairColors.Length)],
                    EyeColor = EyeColors[rng.NextInt(EyeColors.Length)],
                    BodyType = BodyTypes[rng.NextInt(BodyTypes.Length)],
                },
                Personality = personality,
                Bio = "",
            };
        }

        /// <summary>
        /// 12인 로스터(S2 OH4 OP2 MB3 L1)를 생성하고 표준 5-1 라인업(포지션별 최적)을 구성한 팀 상태를 만든다.
        /// </summary>
        public static TeamState GenerateTeamState(int seed, string teamId, string teamName,
            double overall = DefaultOverall, double spread = DefaultSpread)
        {
            var rng = new DeterministicRandom(seed);
            var team = new Team
            {
                Id = teamId,
                Name = teamName,
                City = "가상시",
                Colors = new TeamColors { Primary = "#3355AA", Secondary = "#FFFFFF" },
                EmblemConcept = "",
                Identity = "",
                HomeArena = teamName + " 체육관",
            };
            var roster = new List<Player>();
            Position[] plan =
            {
                Position.S, Position.OH, Position.OH, Position.OP, Position.MB, Position.MB, Position.L,
                Position.S, Position.OH, Position.OH, Position.OP, Position.MB,
            };
            for (int i = 0; i < plan.Length; i++)
            {
                roster.Add(GeneratePlayer(rng, $"{teamId}-p{i + 1:00}", teamId, plan[i], i + 1, overall, spread));
            }
            var state = new TeamState { Team = team, Roster = roster };
            state.Lineup = LineupBuilder.Auto(roster);
            state.Chemistry = new ChemistryTable();
            return state;
        }
    }
}
