using System;
using System.Collections.Generic;
using VolleySim.Config;
using VolleySim.Domain;
using VolleySim.Log;
using VolleySim.Result;

namespace VolleySim.Engine
{
    /// <summary>
    /// 경기 중 한 팀의 가변 상태: 로테이션, 코트 위 6인, 리베로 교체, 교체 횟수, 점수, 통계.
    /// 코트 포지션 번호는 1=후위 오른쪽(서버), 2=전위 오른쪽, 3=전위 중앙, 4=전위 왼쪽, 5=후위 왼쪽, 6=후위 중앙.
    /// </summary>
    public sealed class TeamMatchState
    {
        public readonly TeamSide Side;
        public readonly TeamState State;
        public readonly Tactics Tactics;

        /// <summary>시작 슬롯 기준 선발 6인. Starters[i] 는 로테이션 0 에서 포지션 (i+1).</summary>
        public readonly Player[] Starters = new Player[6];
        public Player Libero;
        public int RotationIndex;
        /// <summary>현재 코트 위 선수. OnCourt[p-1] 은 포지션 p.</summary>
        public readonly Player[] OnCourt = new Player[6];
        /// <summary>리베로가 현재 대신 들어가 있는 선발 선수(없으면 null).</summary>
        public Player LiberoReplacing;
        public int SubstitutionsUsed;

        public int Score;
        public int SetsWon;
        public readonly TeamMatchStats Stats = new TeamMatchStats();

        /// <summary>현재 코트 위 세터(포지션 S 우선, 없으면 세트 스탯 최고).</summary>
        public Player Setter { get; private set; }

        public string TeamId => State.Team.Id;

        public TeamMatchState(TeamSide side, TeamState state, Tactics tactics)
        {
            Side = side;
            State = state ?? throw new ArgumentNullException(nameof(state));
            Tactics = tactics ?? Tactics.Default();
            state.Validate();
            for (int i = 0; i < 6; i++) Starters[i] = state.GetPlayer(state.Lineup.StartingIds[i]);
            Libero = string.IsNullOrEmpty(state.Lineup.LiberoId) ? null : state.GetPlayer(state.Lineup.LiberoId);
            ResetForSet();
        }

        public static bool IsFrontRow(int position) => position >= 2 && position <= 4;

        public void ResetForSet()
        {
            RotationIndex = 0;
            Score = 0;
            SubstitutionsUsed = 0;
            LiberoReplacing = null;
            RebuildCourt();
        }

        /// <summary>시계방향 로테이션(2→1→6→5→4→3→2). 서브권을 새로 얻은 팀이 서브 전에 호출.</summary>
        public void Rotate()
        {
            RotationIndex = (RotationIndex + 1) % 6;
            RebuildCourt();
        }

        /// <summary>리베로 교체를 무시한 기준 선수(로테이션 순서상 그 포지션의 선발).</summary>
        public Player BasePlayerAt(int position)
        {
            return Starters[(position - 1 + RotationIndex) % 6];
        }

        public Player PlayerAt(int position) => OnCourt[position - 1];

        /// <summary>코트 위 포지션(1~6). 코트에 없으면 0.</summary>
        public int PositionOf(Player p)
        {
            for (int i = 0; i < 6; i++) if (ReferenceEquals(OnCourt[i], p)) return i + 1;
            return 0;
        }

        public bool IsOnCourt(Player p) => PositionOf(p) > 0;

        private void RebuildCourt()
        {
            for (int p = 1; p <= 6; p++)
            {
                var bp = BasePlayerAt(p);
                OnCourt[p - 1] = (LiberoReplacing != null && ReferenceEquals(bp, LiberoReplacing) && Libero != null) ? Libero : bp;
            }
            Setter = FindSetter();
        }

        private Player FindSetter()
        {
            Player best = null;
            for (int i = 0; i < 6; i++)
            {
                var p = OnCourt[i];
                if (p.Position == Position.S) return p;
            }
            for (int i = 0; i < 6; i++)
            {
                var p = OnCourt[i];
                if (p.IsLibero) continue;
                if (best == null || p.Stats.Set > best.Stats.Set) best = p;
            }
            return best ?? OnCourt[0];
        }

        /// <summary>
        /// 리베로 자동 교체 규칙(랠리 사이에만 호출):
        /// 후위(6→5→1 순)에 있는 MB 를 리베로가 대신한다. 단 1번 포지션 선수가 서브를 넣어야 하면(서브권 보유) 교체하지 않는다.
        /// 교체 대상 MB 가 전위로 올라가면 리베로가 나가고 MB 가 복귀한다.
        /// </summary>
        public void ApplyLiberoRule(bool serving, MatchLog log, int set, int rally, int homeScore, int awayScore)
        {
            if (Libero == null)
            {
                LiberoReplacing = null;
                return;
            }

            Player target = null;
            int targetPos = 0;
            int[] order = { 6, 5, 1 };
            for (int i = 0; i < order.Length; i++)
            {
                int pos = order[i];
                if (pos == 1 && serving) continue; // 서버는 리베로로 대체 불가(리베로 서브 금지)
                var bp = BasePlayerAt(pos);
                if (bp.Position == Position.MB)
                {
                    target = bp;
                    targetPos = pos;
                    break;
                }
            }

            if (ReferenceEquals(target, LiberoReplacing))
            {
                RebuildCourt();
                return;
            }

            if (LiberoReplacing != null)
            {
                var e = log.Add(EventType.LiberoOut, set, rally, Side, homeScore, awayScore);
                if (e != null)
                {
                    e.PlayerId = Libero.Id;
                    e.CourtPosition = PositionOf(Libero);
                    e.SecondaryPlayerIds = new List<string> { LiberoReplacing.Id };
                }
            }
            LiberoReplacing = target;
            RebuildCourt();
            if (target != null)
            {
                Stats.LiberoSwaps++;
                var e = log.Add(EventType.LiberoIn, set, rally, Side, homeScore, awayScore);
                if (e != null)
                {
                    e.PlayerId = Libero.Id;
                    e.CourtPosition = targetPos;
                    e.SecondaryPlayerIds = new List<string> { target.Id };
                }
            }
        }

        /// <summary>
        /// 일반 선수교체(세트당 한도 적용). 리베로는 이 경로로 교체할 수 없다.
        /// 프로토타입에서는 AI 가 호출하지 않지만 데이터 구조와 규칙은 준비되어 있다.
        /// </summary>
        public bool TrySubstitute(string outId, string inId, SimConfig cfg, MatchLog log, int set, int rally, int homeScore, int awayScore)
        {
            if (SubstitutionsUsed >= cfg.Match.MaxSubstitutionsPerSet) return false;
            var pin = State.GetPlayer(inId);
            var pout = State.GetPlayer(outId);
            if (pin == null || pout == null) return false;
            if (pin.IsLibero || pout.IsLibero) return false;
            if (IsStarterOrOnCourt(pin)) return false;
            int slot = -1;
            for (int i = 0; i < 6; i++) if (ReferenceEquals(Starters[i], pout)) slot = i;
            if (slot < 0) return false;

            Starters[slot] = pin;
            if (ReferenceEquals(LiberoReplacing, pout)) LiberoReplacing = null;
            SubstitutionsUsed++;
            Stats.Substitutions++;
            RebuildCourt();
            var e = log.Add(EventType.Substitution, set, rally, Side, homeScore, awayScore);
            if (e != null)
            {
                e.PlayerId = pin.Id;
                e.CourtPosition = PositionOf(pin);
                e.SecondaryPlayerIds = new List<string> { pout.Id };
                e.Value = SubstitutionsUsed;
            }
            return true;
        }

        private bool IsStarterOrOnCourt(Player p)
        {
            for (int i = 0; i < 6; i++) if (ReferenceEquals(Starters[i], p)) return true;
            return false;
        }
    }
}
