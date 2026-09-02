using System;
using System.Collections.Generic;
using VolleySim.Domain;

namespace VolleySim.Training
{
    /// <summary>캠프 기록(8.5절 1줄 + 부록 B campRecord).</summary>
    public sealed class CampRecord
    {
        public int Wins;
        public int Losses;
        public int Absent;
        public int Mvp;
        public int Injuries;
        public int SevereInjuries;
        public int HotTrains;
        public int Rests;
        public int Trains;
        public int BestConditionTurns;
        public int TurnsLost;
        public List<string> SupporterNames = new List<string>();
        public string PolicyName = "";

        public string Line() => $"평가전 {Wins}승 {Losses}패{(Absent > 0 ? $" {Absent}결장" : "")} · MVP {Mvp}회 · 부상 {Injuries}회 · 핫존 훈련 {HotTrains}회 · 절호조 {BestConditionTurns}턴";
    }

    /// <summary>
    /// 졸업 인스턴스(8.1절·부록 B PlayerInstance). 카드 1장에서 여러 인스턴스가 나올 수 있고 대표 인스턴스 1개만 로스터/서포터에 쓰인다.
    /// </summary>
    public sealed class PlayerInstance
    {
        public string InstanceId = "";
        public string CardId = "";
        public string Name = "";
        public Position Position;
        public Rarity Rarity;
        /// <summary>원소속 구단(카드 club)</summary>
        public string ClubId = "";
        public int JerseyNumber;
        public int HeightCm;
        public int Age;
        public string SkillName = "";
        /// <summary>확정 스탯 10종(StatKind 순서)</summary>
        public int[] FinalStats = new int[10];
        public int[] InitialStats = new int[10];
        public int[] Potential = new int[10];
        public double Ovr;
        public Grade Grade;
        /// <summary>완성도 = 핵심 3스탯 도달률(0~1)</summary>
        public double Completion;
        public double AllReach;
        public int Hints;
        /// <summary>고유 스킬 해금 레벨 0~3</summary>
        public int SkillLevel;
        public CampRecord Camp = new CampRecord();
        public int RunIndex;
        public bool IsRepresentative = true;

        public Stats ToStats()
        {
            var s = new Stats();
            for (int i = 0; i < 10; i++) s[Stats.AllKinds[i]] = Stats.Clamp(FinalStats[i]);
            return s;
        }

        /// <summary>경기 시뮬용 Player. Id 는 인스턴스 id, TeamId 는 호출자가 지정(내 구단).</summary>
        public Player ToPlayer(string teamId)
        {
            return new Player
            {
                Id = InstanceId,
                Name = Name,
                TeamId = teamId,
                Position = Position,
                Rarity = Rarity,
                JerseyNumber = JerseyNumber,
                HeightCm = HeightCm,
                Age = Age,
                Stats = ToStats(),
                Potential = ToStats(),
                Skill = new SkillData { Name = SkillName, Description = "" },
            };
        }

        public SupporterInfo ToSupporter()
        {
            var s = new SupporterInfo { Id = InstanceId, Name = Name, Position = Position, ClubId = ClubId };
            Array.Copy(FinalStats, s.Stats, 10);
            return s;
        }

        public override string ToString() => $"{Name} {Position.ToCode()} {Rarity} OVR {Ovr:0.0} {Grade}";
    }
}
