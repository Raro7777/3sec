using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Engine
{
    /// <summary>세트 하나의 진행: 점수, 2점차 종료, 사이드아웃 시 로테이션·서브권 이동, 리베로 규칙 적용.</summary>
    public sealed class SetEngine
    {
        private readonly MatchContext _ctx;
        private readonly RallyEngine _rally;

        public SetEngine(MatchContext ctx, RallyEngine rally)
        {
            _ctx = ctx;
            _rally = rally;
        }

        /// <param name="firstServer">이 세트에서 먼저 서브하는 팀</param>
        public SetScore PlaySet(int setIndex, TeamMatchState firstServer)
        {
            var cfg = _ctx.Config;
            var home = _ctx.Home;
            var away = _ctx.Away;
            bool isFinal = setIndex == cfg.Match.SetsToWin * 2 - 1;
            _ctx.SetIndex = setIndex;
            _ctx.PointsToWin = isFinal ? cfg.Match.PointsToWinFinalSet : cfg.Match.PointsToWinSet;
            _ctx.RallyIndex = 0;

            home.ResetForSet();
            away.ResetForSet();

            var serving = firstServer;
            var receiving = _ctx.Opponent(firstServer);

            _ctx.Emit(EventType.SetStart, serving, null, 0, value: _ctx.PointsToWin);
            serving.ApplyLiberoRule(true, _ctx.Log, setIndex, 0, home.Score, away.Score);
            receiving.ApplyLiberoRule(false, _ctx.Log, setIndex, 0, home.Score, away.Score);

            int rallies = 0;
            while (!IsSetOver(home.Score, away.Score, _ctx.PointsToWin, cfg.Match.MinPointMargin) && rallies < cfg.Match.MaxRalliesPerSet)
            {
                rallies++;
                _ctx.RallyIndex = rallies;

                var r = _rally.PlayRally(serving, receiving);
                var winner = _ctx.Team(r.Winner);
                winner.Score++;
                winner.Stats.Points++;
                if (ReferenceEquals(winner, serving)) serving.Stats.ServeRalliesWon++;
                else receiving.Stats.ReceiveRalliesWon++;
                if (r.Clutch) winner.Stats.ClutchRalliesWon++;

                var pe = _ctx.Emit(EventType.Point, winner, null, 0, Quality.None, Outcome.None, AttackType.None, 0.0, (int)r.Reason, r.Clutch);
                if (pe != null) pe.Reason = r.Reason;

                if (!ReferenceEquals(winner, serving))
                {
                    // 사이드아웃: 리시브 팀이 득점 → 로테이션 후 서브권 획득
                    receiving.Rotate();
                    _ctx.Emit(EventType.Rotation, receiving, receiving.PlayerAt(1), 1, value: receiving.RotationIndex);
                    var t = serving; serving = receiving; receiving = t;
                }

                if (!IsSetOver(home.Score, away.Score, _ctx.PointsToWin, cfg.Match.MinPointMargin))
                {
                    serving.ApplyLiberoRule(true, _ctx.Log, setIndex, rallies, home.Score, away.Score);
                    receiving.ApplyLiberoRule(false, _ctx.Log, setIndex, rallies, home.Score, away.Score);
                }
            }

            var score = new SetScore { SetIndex = setIndex, Home = home.Score, Away = away.Score, Rallies = rallies };
            var setWinner = home.Score > away.Score ? home : away;
            setWinner.SetsWon++;
            _ctx.Emit(EventType.SetEnd, setWinner, null, 0, value: setIndex);
            return score;
        }

        public static bool IsSetOver(int a, int b, int pointsToWin, int margin)
        {
            int hi = a > b ? a : b;
            int diff = a > b ? a - b : b - a;
            return hi >= pointsToWin && diff >= margin;
        }
    }
}
