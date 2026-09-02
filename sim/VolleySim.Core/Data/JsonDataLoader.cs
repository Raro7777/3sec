using System;
using System.Collections.Generic;
using System.IO;
using VolleySim.Domain;

namespace VolleySim.Data
{
    /// <summary>
    /// data/players.json, data/teams.json 로더. 스키마는 docs/match-sim.md 및 상위 기획 지시와 동일.
    /// 알 수 없는 키는 무시하고, 누락된 키는 기본값으로 채운다.
    /// </summary>
    public static class JsonDataLoader
    {
        public static List<Player> ParsePlayers(string json)
        {
            var arr = MiniJson.AsArray(MiniJson.Parse(json));
            if (arr == null) throw new FormatException("players.json must be a JSON array");
            var list = new List<Player>(arr.Count);
            foreach (var item in arr)
            {
                var o = MiniJson.AsObject(item);
                if (o == null) continue;
                list.Add(ParsePlayer(o));
            }
            return list;
        }

        public static List<Team> ParseTeams(string json)
        {
            var arr = MiniJson.AsArray(MiniJson.Parse(json));
            if (arr == null) throw new FormatException("teams.json must be a JSON array");
            var list = new List<Team>(arr.Count);
            foreach (var item in arr)
            {
                var o = MiniJson.AsObject(item);
                if (o == null) continue;
                var colors = MiniJson.GetObject(o, "colors");
                list.Add(new Team
                {
                    Id = MiniJson.GetString(o, "id"),
                    Name = MiniJson.GetString(o, "name"),
                    City = MiniJson.GetString(o, "city"),
                    Colors = new TeamColors
                    {
                        Primary = MiniJson.GetString(colors, "primary", "#000000"),
                        Secondary = MiniJson.GetString(colors, "secondary", "#FFFFFF"),
                    },
                    EmblemConcept = MiniJson.GetString(o, "emblemConcept"),
                    Identity = MiniJson.GetString(o, "identity"),
                    HomeArena = MiniJson.GetString(o, "homeArena"),
                });
            }
            return list;
        }

        public static List<Player> LoadPlayers(string path) => ParsePlayers(File.ReadAllText(path));
        public static List<Team> LoadTeams(string path) => ParseTeams(File.ReadAllText(path));

        private static Player ParsePlayer(Dictionary<string, object> o)
        {
            var p = new Player
            {
                Id = MiniJson.GetString(o, "id"),
                Name = MiniJson.GetString(o, "name"),
                TeamId = MiniJson.GetString(o, "teamId"),
                JerseyNumber = MiniJson.GetInt(o, "jerseyNumber"),
                HeightCm = MiniJson.GetInt(o, "heightCm", 175),
                Age = MiniJson.GetInt(o, "age", 20),
                Bio = MiniJson.GetString(o, "bio"),
            };
            if (!PositionExtensions.TryParsePosition(MiniJson.GetString(o, "position"), out p.Position))
                throw new FormatException($"Player {p.Id}: unknown position '{MiniJson.GetString(o, "position")}'");
            PositionExtensions.TryParseRarity(MiniJson.GetString(o, "rarity", "N"), out p.Rarity);
            p.Stats = ParseStats(MiniJson.GetObject(o, "stats"));
            p.Potential = ParseStats(MiniJson.GetObject(o, "potential"));

            var skill = MiniJson.GetObject(o, "skill");
            p.Skill = new SkillData { Name = MiniJson.GetString(skill, "name"), Description = MiniJson.GetString(skill, "description") };

            var ap = MiniJson.GetObject(o, "appearance");
            p.Appearance = new Appearance
            {
                HairStyle = MiniJson.GetString(ap, "hairStyle"),
                HairColor = MiniJson.GetString(ap, "hairColor"),
                EyeColor = MiniJson.GetString(ap, "eyeColor"),
                BodyType = MiniJson.GetString(ap, "bodyType"),
            };

            var pers = MiniJson.GetArray(o, "personality");
            if (pers != null)
            {
                var list = new List<string>(pers.Count);
                foreach (var x in pers) if (x is string s) list.Add(s);
                p.Personality = list.ToArray();
            }
            return p;
        }

        private static Stats ParseStats(Dictionary<string, object> o)
        {
            var s = new Stats();
            if (o == null) return s;
            s.Serve = Stats.Clamp(MiniJson.GetInt(o, "serve"));
            s.Receive = Stats.Clamp(MiniJson.GetInt(o, "receive"));
            s.Set = Stats.Clamp(MiniJson.GetInt(o, "set"));
            s.Spike = Stats.Clamp(MiniJson.GetInt(o, "spike"));
            s.Block = Stats.Clamp(MiniJson.GetInt(o, "block"));
            s.Dig = Stats.Clamp(MiniJson.GetInt(o, "dig"));
            s.Speed = Stats.Clamp(MiniJson.GetInt(o, "speed"));
            s.Power = Stats.Clamp(MiniJson.GetInt(o, "power"));
            s.Stamina = Stats.Clamp(MiniJson.GetInt(o, "stamina"));
            s.Mental = Stats.Clamp(MiniJson.GetInt(o, "mental"));
            return s;
        }

        /// <summary>구단 + 소속 선수로 팀 상태를 구성(라인업 자동).</summary>
        public static TeamState BuildTeamState(Team team, IEnumerable<Player> allPlayers)
        {
            var roster = new List<Player>();
            foreach (var p in allPlayers) if (p.TeamId == team.Id) roster.Add(p);
            var state = new TeamState { Team = team, Roster = roster };
            state.Lineup = LineupBuilder.Auto(roster);
            return state;
        }
    }
}
