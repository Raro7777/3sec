using System.Collections.Generic;

namespace VolleySim.Result
{
    /// <summary>선수별 박스스코어.</summary>
    public sealed class PlayerBoxScore
    {
        public string PlayerId;
        public string Name;
        public string PositionCode;

        public int Serves;
        public int Aces;
        public int ServeErrors;

        public int Receptions;
        public int ReceptionPerfect;
        public int ReceptionGood;
        public int ReceptionPoor;
        public int ReceptionErrors;

        public int Sets;
        public int Assists;

        public int Attacks;
        public int Kills;
        public int AttackErrors;
        /// <summary>블로킹에 막힌 횟수</summary>
        public int Blocked;

        public int BlockKills;
        public int BlockAssists;
        public int BlockTouches;

        public int DigAttempts;
        public int Digs;

        public int Points => Kills + BlockKills + Aces;
        public double KillRate => Attacks > 0 ? Kills / (double)Attacks : 0.0;
        public double ReceptionEfficiency => Receptions > 0 ? (ReceptionPerfect + ReceptionGood * 0.5 - ReceptionErrors) / Receptions : 0.0;
    }

    /// <summary>팀 단위 경기 통계(밸런스 지표 산출용).</summary>
    public sealed class TeamMatchStats
    {
        public int Points;
        public int ServeRallies;
        public int ServeRalliesWon;   // 브레이크 포인트
        public int ReceiveRallies;
        public int ReceiveRalliesWon; // 사이드아웃

        public int Serves;
        public int Aces;
        public int ServeErrors;

        public int Receptions;
        public int ReceptionPerfect;
        public int ReceptionGood;
        public int ReceptionPoor;
        public int ReceptionErrors;

        public int Attacks;
        public int Kills;
        public int AttackErrors;
        public int Blocked;
        public int FirstBallAttacks;
        public int FirstBallKills;
        public int TransitionAttacks;

        public int BlockKills;
        public int BlockTouches;
        public int BlockOuts;

        public int DigAttempts;
        public int Digs;
        public int FreeBalls;
        public int Dumps;

        public int ClutchRallies;
        public int ClutchRalliesWon;

        public int LiberoSwaps;
        public int Substitutions;

        /// <summary>공격 유형별 시도/성공. 인덱스 = (int)VolleySim.Log.AttackType.</summary>
        public int[] AttacksByType = new int[8];
        public int[] KillsByType = new int[8];

        public double SideOutRate => ReceiveRallies > 0 ? ReceiveRalliesWon / (double)ReceiveRallies : 0.0;
        public double KillRate => Attacks > 0 ? Kills / (double)Attacks : 0.0;
        public double AceRate => Serves > 0 ? Aces / (double)Serves : 0.0;
        public double ServeErrorRate => Serves > 0 ? ServeErrors / (double)Serves : 0.0;

        public void Add(TeamMatchStats o)
        {
            Points += o.Points;
            ServeRallies += o.ServeRallies; ServeRalliesWon += o.ServeRalliesWon;
            ReceiveRallies += o.ReceiveRallies; ReceiveRalliesWon += o.ReceiveRalliesWon;
            Serves += o.Serves; Aces += o.Aces; ServeErrors += o.ServeErrors;
            Receptions += o.Receptions; ReceptionPerfect += o.ReceptionPerfect; ReceptionGood += o.ReceptionGood;
            ReceptionPoor += o.ReceptionPoor; ReceptionErrors += o.ReceptionErrors;
            Attacks += o.Attacks; Kills += o.Kills; AttackErrors += o.AttackErrors; Blocked += o.Blocked;
            FirstBallAttacks += o.FirstBallAttacks; FirstBallKills += o.FirstBallKills; TransitionAttacks += o.TransitionAttacks;
            BlockKills += o.BlockKills; BlockTouches += o.BlockTouches; BlockOuts += o.BlockOuts;
            DigAttempts += o.DigAttempts; Digs += o.Digs; FreeBalls += o.FreeBalls; Dumps += o.Dumps;
            ClutchRallies += o.ClutchRallies; ClutchRalliesWon += o.ClutchRalliesWon;
            LiberoSwaps += o.LiberoSwaps; Substitutions += o.Substitutions;
            for (int i = 0; i < AttacksByType.Length && i < o.AttacksByType.Length; i++)
            {
                AttacksByType[i] += o.AttacksByType[i];
                KillsByType[i] += o.KillsByType[i];
            }
        }
    }

    public sealed class SetScore
    {
        public int SetIndex;
        public int Home;
        public int Away;
        public int Rallies;
        public override string ToString() => $"{Home}-{Away}";
    }
}
