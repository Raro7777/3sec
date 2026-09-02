using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Engine;
using VolleySim.Result;

namespace VolleySim
{
    /// <summary>
    /// 공개 API. 같은 입력 + 같은 시드 = 같은 결과(서버/클라이언트 동일 재현).
    /// </summary>
    public static class MatchSimulator
    {
        /// <param name="home">홈 팀 상태(수정되지 않음)</param>
        /// <param name="away">원정 팀 상태(수정되지 않음)</param>
        /// <param name="homeTactics">홈 전술(null 이면 기본)</param>
        /// <param name="awayTactics">원정 전술(null 이면 기본)</param>
        /// <param name="seed">난수 시드</param>
        /// <param name="config">시뮬레이션 상수(null 이면 기본)</param>
        /// <param name="collectEvents">false 면 이벤트 로그를 저장하지 않음(대량 시뮬레이션용). 결과 수치는 동일.</param>
        public static MatchResult Simulate(TeamState home, TeamState away, Tactics homeTactics, Tactics awayTactics, int seed,
            SimConfig config = null, bool collectEvents = true)
        {
            return new MatchEngine().Run(home, away, homeTactics ?? Tactics.Default(), awayTactics ?? Tactics.Default(), seed, config, collectEvents);
        }
    }
}
