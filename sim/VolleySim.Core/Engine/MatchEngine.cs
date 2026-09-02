using System.Collections.Generic;
using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Engine
{
    /// <summary>경기 전체(5세트 3선승) 진행.</summary>
    public sealed class MatchEngine
    {
        public MatchResult Run(TeamState home, TeamState away, Tactics homeTactics, Tactics awayTactics, int seed, SimConfig config, bool collectEvents)
        {
            config = config ?? SimConfig.CreateDefault();
            var rng = new DeterministicRandom(seed);
            var log = new MatchLog { Enabled = collectEvents };
            var homeState = new TeamMatchState(TeamSide.Home, home, homeTactics);
            var awayState = new TeamMatchState(TeamSide.Away, away, awayTactics);
            var box = new Dictionary<string, PlayerBoxScore>();
            var ctx = new MatchContext(config, rng, log, homeState, awayState, box);
            var rally = new RallyEngine(ctx);
            var setEngine = new SetEngine(ctx, rally);

            var result = new MatchResult
            {
                Seed = seed,
                HomeTeamId = home.Team.Id,
                AwayTeamId = away.Team.Id,
                Log = log,
                BoxScores = box,
            };

            ctx.Emit(EventType.MatchStart, homeState, null, 0);

            // 1세트 첫 서브: 설정에 따라 홈 고정 또는 동전 던지기. 이후 세트는 교대, 최종 세트는 다시 동전 던지기.
            TeamMatchState firstServerSet1 = config.Match.HomeServesFirst
                ? homeState
                : (rng.Chance(0.5) ? homeState : awayState);
            int maxSets = config.Match.SetsToWin * 2 - 1;
            TeamMatchState firstServer = firstServerSet1;

            for (int set = 1; set <= maxSets; set++)
            {
                if (set == maxSets) firstServer = rng.Chance(0.5) ? homeState : awayState;
                else if (set > 1) firstServer = ctx.Opponent(firstServer);

                var score = setEngine.PlaySet(set, firstServer);
                result.Sets.Add(score);
                if (homeState.SetsWon >= config.Match.SetsToWin || awayState.SetsWon >= config.Match.SetsToWin) break;
            }

            result.HomeSets = homeState.SetsWon;
            result.AwaySets = awayState.SetsWon;
            result.Winner = homeState.SetsWon > awayState.SetsWon ? TeamSide.Home : TeamSide.Away;
            result.HomeStats = homeState.Stats;
            result.AwayStats = awayState.Stats;
            result.RandomDraws = rng.DrawCount;

            ctx.Emit(EventType.MatchEnd, ctx.Team(result.Winner), null, 0, value: result.HomeSets * 10 + result.AwaySets);
            return result;
        }
    }
}
