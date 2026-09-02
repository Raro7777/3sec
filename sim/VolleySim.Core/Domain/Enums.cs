namespace VolleySim.Domain
{
    /// <summary>선수 포지션. 코트 6인 + 리베로.</summary>
    public enum Position
    {
        /// <summary>세터</summary>
        S = 0,
        /// <summary>아웃사이드 히터(윙스파이커, 레프트)</summary>
        OH = 1,
        /// <summary>아포짓 스파이커(라이트)</summary>
        OP = 2,
        /// <summary>미들블로커(센터)</summary>
        MB = 3,
        /// <summary>리베로</summary>
        L = 4,
    }

    public enum Rarity
    {
        N = 0,
        R = 1,
        SR = 2,
        SSR = 3,
    }

    /// <summary>10종 스탯 키. players.json의 stats/potential 키와 1:1 대응.</summary>
    public enum StatKind
    {
        Serve = 0,
        Receive = 1,
        Set = 2,
        Spike = 3,
        Block = 4,
        Dig = 5,
        Speed = 6,
        Power = 7,
        Stamina = 8,
        Mental = 9,
    }

    /// <summary>홈/원정 구분.</summary>
    public enum TeamSide
    {
        Home = 0,
        Away = 1,
    }

    public static class PositionExtensions
    {
        public static string ToCode(this Position p)
        {
            switch (p)
            {
                case Position.S: return "S";
                case Position.OH: return "OH";
                case Position.OP: return "OP";
                case Position.MB: return "MB";
                case Position.L: return "L";
                default: return "?";
            }
        }

        public static bool TryParsePosition(string s, out Position p)
        {
            switch (s)
            {
                case "S": p = Position.S; return true;
                case "OH": p = Position.OH; return true;
                case "OP": p = Position.OP; return true;
                case "MB": p = Position.MB; return true;
                case "L": p = Position.L; return true;
                default: p = Position.S; return false;
            }
        }

        public static bool TryParseRarity(string s, out Rarity r)
        {
            switch (s)
            {
                case "N": r = Rarity.N; return true;
                case "R": r = Rarity.R; return true;
                case "SR": r = Rarity.SR; return true;
                case "SSR": r = Rarity.SSR; return true;
                default: r = Rarity.N; return false;
            }
        }

        public static TeamSide Opposite(this TeamSide s) => s == TeamSide.Home ? TeamSide.Away : TeamSide.Home;
    }
}
