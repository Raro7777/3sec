using System;
using System.Collections.Generic;
using VolleySim.Domain;

namespace VolleySim.Data
{
    /// <summary>로스터에서 표준 5-1 라인업을 자동 구성.</summary>
    public static class LineupBuilder
    {
        /// <summary>
        /// S 1, OH 2, OP 1, MB 2, L 1(있으면) 을 각 포지션 핵심 스탯 기준으로 고른다.
        /// 포지션이 부족하면 남은 선수 중 종합 스탯이 높은 순으로 채운다(리베로 제외).
        /// </summary>
        public static Lineup Auto(IReadOnlyList<Player> roster)
        {
            if (roster == null || roster.Count < 6) throw new ArgumentException("Roster needs at least 6 non-libero players", nameof(roster));
            var used = new HashSet<string>(StringComparer.Ordinal);

            Player setter = Pick(roster, used, Position.S, p => p.Stats.Set * 2.0 + p.Stats.Speed);
            Player oh1 = Pick(roster, used, Position.OH, p => p.Stats.Spike + p.Stats.Receive);
            Player oh2 = Pick(roster, used, Position.OH, p => p.Stats.Spike + p.Stats.Receive);
            Player op = Pick(roster, used, Position.OP, p => p.Stats.Spike + p.Stats.Power);
            Player mb1 = Pick(roster, used, Position.MB, p => p.Stats.Block * 2.0 + p.Stats.Spike);
            Player mb2 = Pick(roster, used, Position.MB, p => p.Stats.Block * 2.0 + p.Stats.Spike);
            Player libero = Pick(roster, used, Position.L, p => p.Stats.Receive + p.Stats.Dig, required: false);

            // 부족한 자리 채우기
            var slots = new[] { setter, oh1, mb1, op, oh2, mb2 };
            for (int i = 0; i < slots.Length; i++)
            {
                if (slots[i] != null) continue;
                Player best = null;
                double bestV = double.NegativeInfinity;
                foreach (var p in roster)
                {
                    if (p.IsLibero || used.Contains(p.Id)) continue;
                    double v = p.Stats.Average;
                    if (v > bestV) { bestV = v; best = p; }
                }
                if (best == null) throw new InvalidOperationException("Not enough non-libero players for a lineup");
                used.Add(best.Id);
                slots[i] = best;
            }

            var lineup = Lineup.Standard51(slots[0].Id, slots[1].Id, slots[2].Id, slots[3].Id, slots[4].Id, slots[5].Id, libero?.Id);
            foreach (var p in roster)
            {
                if (!used.Contains(p.Id)) lineup.BenchIds.Add(p.Id);
            }
            return lineup;
        }

        private static Player Pick(IReadOnlyList<Player> roster, HashSet<string> used, Position pos, Func<Player, double> score, bool required = true)
        {
            Player best = null;
            double bestV = double.NegativeInfinity;
            foreach (var p in roster)
            {
                if (p.Position != pos || used.Contains(p.Id)) continue;
                double v = score(p);
                if (v > bestV) { bestV = v; best = p; }
            }
            if (best != null) used.Add(best.Id);
            return best;
        }
    }
}
