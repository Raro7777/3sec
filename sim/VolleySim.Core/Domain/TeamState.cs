using System;
using System.Collections.Generic;

namespace VolleySim.Domain
{
    /// <summary>세터-공격수 호흡도(0~100). 키는 세터 id + 공격수 id. 기본값 50.</summary>
    public sealed class ChemistryTable
    {
        public const int Default = 50;
        private readonly Dictionary<string, int> _values = new Dictionary<string, int>(StringComparer.Ordinal);

        private static string Key(string setterId, string attackerId) => setterId + "|" + attackerId;

        public int Get(string setterId, string attackerId)
        {
            if (setterId == null || attackerId == null) return Default;
            return _values.TryGetValue(Key(setterId, attackerId), out var v) ? v : Default;
        }

        public void Set(string setterId, string attackerId, int value)
        {
            _values[Key(setterId, attackerId)] = value < 0 ? 0 : (value > 100 ? 100 : value);
        }

        /// <summary>세터와 팀 전원의 호흡도를 일괄 설정.</summary>
        public void SetAll(string setterId, IEnumerable<Player> attackers, int value)
        {
            foreach (var a in attackers) Set(setterId, a.Id, value);
        }

        public int Count => _values.Count;
    }

    /// <summary>
    /// 경기 투입 직전의 팀 상태: 구단 + 로스터 + 라인업 + 컨디션 + 호흡도.
    /// 시뮬레이터는 이 객체를 수정하지 않는다.
    /// </summary>
    public sealed class TeamState
    {
        public Team Team = new Team();
        public List<Player> Roster = new List<Player>();
        public Lineup Lineup = new Lineup();

        /// <summary>팀 컨디션 배수(1.0 = 보통). 모든 선수의 실효 능력치에 곱해진다.</summary>
        public double TeamCondition = 1.0;
        /// <summary>개인 컨디션 배수(1.0 = 보통). 없으면 1.0.</summary>
        public Dictionary<string, double> PlayerCondition = new Dictionary<string, double>(StringComparer.Ordinal);
        public ChemistryTable Chemistry = new ChemistryTable();

        private Dictionary<string, Player> _index;

        public Player GetPlayer(string id)
        {
            if (id == null) return null;
            if (_index == null || _index.Count != Roster.Count)
            {
                _index = new Dictionary<string, Player>(StringComparer.Ordinal);
                foreach (var p in Roster) _index[p.Id] = p;
            }
            return _index.TryGetValue(id, out var pl) ? pl : null;
        }

        public double ConditionOf(string playerId)
        {
            return PlayerCondition.TryGetValue(playerId, out var c) ? c : 1.0;
        }

        /// <summary>라인업 유효성 검사. 문제가 있으면 예외.</summary>
        public void Validate()
        {
            if (Lineup == null) throw new InvalidOperationException("Lineup is null");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < 6; i++)
            {
                var id = Lineup.StartingIds[i];
                if (string.IsNullOrEmpty(id)) throw new InvalidOperationException($"Lineup slot {i + 1} is empty ({Team.Id})");
                if (!seen.Add(id)) throw new InvalidOperationException($"Duplicate starter {id} ({Team.Id})");
                var p = GetPlayer(id);
                if (p == null) throw new InvalidOperationException($"Starter {id} not on roster ({Team.Id})");
                if (p.IsLibero) throw new InvalidOperationException($"Libero {id} cannot be a starter on court ({Team.Id})");
            }
            if (!string.IsNullOrEmpty(Lineup.LiberoId))
            {
                var l = GetPlayer(Lineup.LiberoId);
                if (l == null) throw new InvalidOperationException($"Libero {Lineup.LiberoId} not on roster ({Team.Id})");
                if (!l.IsLibero) throw new InvalidOperationException($"Player {Lineup.LiberoId} is not a libero ({Team.Id})");
                if (seen.Contains(l.Id)) throw new InvalidOperationException($"Libero {l.Id} also listed as starter ({Team.Id})");
            }
            foreach (var b in Lineup.BenchIds)
            {
                if (GetPlayer(b) == null) throw new InvalidOperationException($"Bench player {b} not on roster ({Team.Id})");
            }
        }
    }
}
