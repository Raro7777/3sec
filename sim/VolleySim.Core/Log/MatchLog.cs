using System.Collections.Generic;
using VolleySim.Domain;

namespace VolleySim.Log
{
    /// <summary>
    /// 경기 이벤트 로그. <see cref="Enabled"/> 가 false 면 이벤트를 저장하지 않는다(몬테카를로 고속 실행용).
    /// 저장 여부는 난수 소비에 영향을 주지 않으므로 결정성에 무관하다.
    /// </summary>
    public sealed class MatchLog
    {
        public bool Enabled = true;
        public readonly List<MatchEvent> Events = new List<MatchEvent>();
        private int _seq;

        public int Count => Events.Count;

        public MatchEvent Add(EventType type, int set, int rally, TeamSide side, int homeScore, int awayScore)
        {
            _seq++;
            if (!Enabled) return null;
            var e = new MatchEvent
            {
                Seq = _seq,
                Set = set,
                Rally = rally,
                Type = type,
                Side = side,
                HomeScore = homeScore,
                AwayScore = awayScore,
            };
            Events.Add(e);
            return e;
        }
    }
}
