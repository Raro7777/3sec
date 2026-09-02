using System.Collections.Generic;
using System.Text;
using VolleySim.Domain;
using VolleySim.Log;

namespace VolleySim.Result
{
    /// <summary>경기 결과: 세트 스코어 + 박스스코어 + 팀 통계 + 이벤트 로그.</summary>
    public sealed class MatchResult
    {
        public int Seed;
        public string HomeTeamId;
        public string AwayTeamId;
        public int HomeSets;
        public int AwaySets;
        public TeamSide Winner;
        public List<SetScore> Sets = new List<SetScore>();
        public TeamMatchStats HomeStats = new TeamMatchStats();
        public TeamMatchStats AwayStats = new TeamMatchStats();
        public Dictionary<string, PlayerBoxScore> BoxScores = new Dictionary<string, PlayerBoxScore>();
        public MatchLog Log;
        /// <summary>결정성 검증용: 경기 동안 뽑은 난수 수.</summary>
        public long RandomDraws;

        public int TotalRallies
        {
            get { int n = 0; foreach (var s in Sets) n += s.Rallies; return n; }
        }

        public int TotalHomePoints
        {
            get { int n = 0; foreach (var s in Sets) n += s.Home; return n; }
        }

        public int TotalAwayPoints
        {
            get { int n = 0; foreach (var s in Sets) n += s.Away; return n; }
        }

        public string SetScoreLine()
        {
            var sb = new StringBuilder();
            for (int i = 0; i < Sets.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                sb.Append(Sets[i].Home).Append('-').Append(Sets[i].Away);
            }
            return sb.ToString();
        }

        /// <summary>결정성 비교용 서명(세트 점수 + 팀 통계 + 난수 소비량).</summary>
        public string Signature()
        {
            var sb = new StringBuilder();
            sb.Append(HomeSets).Append(':').Append(AwaySets).Append('|').Append(SetScoreLine()).Append('|');
            sb.Append(RandomDraws).Append('|');
            AppendStats(sb, HomeStats);
            sb.Append('|');
            AppendStats(sb, AwayStats);
            return sb.ToString();
        }

        private static void AppendStats(StringBuilder sb, TeamMatchStats s)
        {
            sb.Append(s.Points).Append(',').Append(s.Aces).Append(',').Append(s.ServeErrors).Append(',')
              .Append(s.Kills).Append(',').Append(s.AttackErrors).Append(',').Append(s.BlockKills).Append(',')
              .Append(s.Digs).Append(',').Append(s.ReceiveRalliesWon).Append(',').Append(s.Attacks);
        }
    }
}
