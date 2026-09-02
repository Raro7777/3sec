using System.Collections.Generic;
using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Engine
{
    /// <summary>경기 한 판의 공유 상태(설정, 난수, 로그, 양 팀, 진행 위치)와 실효 능력치 계산.</summary>
    public sealed class MatchContext
    {
        public readonly SimConfig Config;
        public readonly DeterministicRandom Rng;
        public readonly MatchLog Log;
        public readonly TeamMatchState Home;
        public readonly TeamMatchState Away;
        public readonly Dictionary<string, PlayerBoxScore> BoxScores;

        public int SetIndex;
        public int RallyIndex;
        public int PointsToWin;

        public MatchContext(SimConfig config, DeterministicRandom rng, MatchLog log, TeamMatchState home, TeamMatchState away,
            Dictionary<string, PlayerBoxScore> boxScores)
        {
            Config = config;
            Rng = rng;
            Log = log;
            Home = home;
            Away = away;
            BoxScores = boxScores;
        }

        public int HomeScore => Home.Score;
        public int AwayScore => Away.Score;

        public TeamMatchState Opponent(TeamMatchState t) => ReferenceEquals(t, Home) ? Away : Home;

        public TeamMatchState Team(TeamSide side) => side == TeamSide.Home ? Home : Away;

        /// <summary>클러치: 양 팀 모두 (목표점 - ScoreFromEnd) 이상 & 점수 차 ≤ MaxDiff.</summary>
        public bool IsClutch()
        {
            int threshold = PointsToWin - Config.Clutch.ScoreFromEnd;
            if (Home.Score < threshold || Away.Score < threshold) return false;
            int diff = Home.Score - Away.Score;
            if (diff < 0) diff = -diff;
            return diff <= Config.Clutch.MaxDiff;
        }

        /// <summary>실효 배수 = 팀 컨디션 × 개인 컨디션 × 피로 × 클러치(멘탈). [Min, Max] 클램프.</summary>
        public double EffectiveMultiplier(Player p, TeamMatchState team, bool clutch)
        {
            double m = team.State.TeamCondition * team.State.ConditionOf(p.Id);

            // 피로: 세트 진행도 × (1 - stamina/100)
            var f = Config.Fatigue;
            double progress = (SetIndex - 1) + SimMath.Clamp((Home.Score + Away.Score) / f.PointsPerSetForProgress, 0.0, 1.0);
            double loss = f.LossPerSet * progress * (1.0 - p.Stats.Stamina / 100.0);
            if (loss > f.MaxLoss) loss = f.MaxLoss;
            if (loss < 0) loss = 0;
            m *= 1.0 - loss;

            if (clutch)
            {
                var c = Config.Clutch;
                m *= 1.0 + c.MentalScale * (p.Stats.Mental - c.MentalPivot) / 50.0;
            }
            return SimMath.Clamp(m, Config.Rating.EffectiveMultiplierMin, Config.Rating.EffectiveMultiplierMax);
        }

        public double Eff(double raw, Player p, TeamMatchState team, bool clutch) => raw * EffectiveMultiplier(p, team, clutch);

        public PlayerBoxScore Box(Player p)
        {
            if (!BoxScores.TryGetValue(p.Id, out var b))
            {
                b = new PlayerBoxScore { PlayerId = p.Id, Name = p.Name, PositionCode = p.Position.ToCode() };
                BoxScores[p.Id] = b;
            }
            return b;
        }

        public double SkillLogit(Skills.SkillTrigger trigger, Player actor, Player opponent, bool clutch)
        {
            var sp = Config.SkillProvider;
            if (sp == null) return 0.0;
            return sp.AdjustLogit(trigger, actor, opponent, SetIndex, Home.Score, Away.Score, clutch);
        }

        public MatchEvent Emit(EventType type, TeamMatchState team, Player actor, int position,
            Quality quality = Quality.None, Outcome outcome = Outcome.None, AttackType attackType = AttackType.None,
            double probability = 0.0, int value = 0, bool clutch = false)
        {
            var e = Log.Add(type, SetIndex, RallyIndex, team.Side, Home.Score, Away.Score);
            if (e == null) return null;
            e.PlayerId = actor?.Id;
            e.CourtPosition = position;
            e.Quality = quality;
            e.Outcome = outcome;
            e.AttackType = attackType;
            e.Probability = probability;
            e.Value = value;
            e.Clutch = clutch;
            return e;
        }
    }
}
