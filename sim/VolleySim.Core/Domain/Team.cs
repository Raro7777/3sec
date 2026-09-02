namespace VolleySim.Domain
{
    public sealed class TeamColors
    {
        public string Primary = "#000000";
        public string Secondary = "#FFFFFF";
    }

    /// <summary>구단 정보. data/teams.json 스키마와 1:1 대응.</summary>
    public sealed class Team
    {
        public string Id = "";
        public string Name = "";
        public string City = "";
        public TeamColors Colors = new TeamColors();
        public string EmblemConcept = "";
        public string Identity = "";
        public string HomeArena = "";

        public override string ToString() => $"{Id} {Name}";
    }
}
