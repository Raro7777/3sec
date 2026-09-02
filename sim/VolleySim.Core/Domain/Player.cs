using System;

namespace VolleySim.Domain
{
    /// <summary>개인 특기 스킬. 프로토타입에서는 데이터로만 보존하고 판정에는 미반영(훅만 존재).</summary>
    public sealed class SkillData
    {
        public string Name = "";
        public string Description = "";
    }

    public sealed class Appearance
    {
        public string HairStyle = "";
        public string HairColor = "";
        public string EyeColor = "";
        public string BodyType = "";
    }

    /// <summary>
    /// 선수 카드. data/players.json 스키마와 1:1 대응.
    /// </summary>
    public sealed class Player
    {
        public string Id = "";
        public string Name = "";
        public string TeamId = "";
        public Position Position;
        public Rarity Rarity = Rarity.N;
        public int JerseyNumber;
        public int HeightCm = 175;
        public int Age = 20;
        public Stats Stats = new Stats();
        public Stats Potential = new Stats();
        public SkillData Skill = new SkillData();
        public Appearance Appearance = new Appearance();
        public string[] Personality = Array.Empty<string>();
        public string Bio = "";

        public bool IsLibero => Position == Position.L;

        public override string ToString() => $"{Id} {Name} ({Position.ToCode()} #{JerseyNumber})";

        public Player Clone()
        {
            return new Player
            {
                Id = Id,
                Name = Name,
                TeamId = TeamId,
                Position = Position,
                Rarity = Rarity,
                JerseyNumber = JerseyNumber,
                HeightCm = HeightCm,
                Age = Age,
                Stats = Stats.Clone(),
                Potential = Potential.Clone(),
                Skill = new SkillData { Name = Skill.Name, Description = Skill.Description },
                Appearance = new Appearance
                {
                    HairStyle = Appearance.HairStyle, HairColor = Appearance.HairColor,
                    EyeColor = Appearance.EyeColor, BodyType = Appearance.BodyType,
                },
                Personality = (string[])Personality.Clone(),
                Bio = Bio,
            };
        }
    }
}
