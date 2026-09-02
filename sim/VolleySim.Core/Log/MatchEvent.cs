using System.Collections.Generic;
using VolleySim.Domain;

namespace VolleySim.Log
{
    public enum EventType
    {
        MatchStart = 0,
        SetStart,
        RallyStart,
        Serve,
        Reception,
        Set,
        Attack,
        Block,
        Dig,
        /// <summary>블록 터치 후 공격팀 코트로 되돌아온 공을 살림</summary>
        Cover,
        /// <summary>공격 대신 프리볼로 넘김</summary>
        FreeBall,
        Point,
        Rotation,
        LiberoIn,
        LiberoOut,
        Substitution,
        SetEnd,
        MatchEnd,
    }

    /// <summary>리시브/세트/디그 품질. A=Perfect, B=Good, C=Poor.</summary>
    public enum Quality
    {
        None = 0,
        Perfect = 1,
        Good = 2,
        Poor = 3,
        Error = 4,
    }

    /// <summary>터치 결과.</summary>
    public enum Outcome
    {
        None = 0,
        /// <summary>인플레이(랠리 지속)</summary>
        InPlay,
        Ace,
        Kill,
        Error,
        BlockKill,
        /// <summary>블록 터치(유효 블로킹) 후 랠리 지속</summary>
        BlockTouch,
        /// <summary>블록에 맞고 아웃 → 공격팀 득점</summary>
        BlockOut,
        Dug,
        Covered,
    }

    public enum AttackType
    {
        None = 0,
        /// <summary>MB 속공</summary>
        Quick,
        /// <summary>OH/OP 오픈(하이볼)</summary>
        Open,
        /// <summary>후위 공격(파이프/백어택)</summary>
        BackRow,
        /// <summary>시간차</summary>
        Delayed,
        /// <summary>세터 덤프</summary>
        Dump,
        FreeBall,
    }

    /// <summary>득점 사유.</summary>
    public enum PointReason
    {
        None = 0,
        Ace,
        ServeError,
        Kill,
        AttackError,
        BlockKill,
        BlockOut,
        RallyCap,
    }

    /// <summary>
    /// 랠리의 모든 터치·상태 변화를 담는 구조화 이벤트. 렌더러(텍스트 중계, 2D 연출)는 이것만 소비한다.
    /// </summary>
    public sealed class MatchEvent
    {
        public int Seq;
        /// <summary>세트 번호(1부터)</summary>
        public int Set;
        /// <summary>세트 내 랠리 번호(1부터)</summary>
        public int Rally;
        public EventType Type;
        /// <summary>행위 주체 팀</summary>
        public TeamSide Side;
        /// <summary>행위 주체 선수 id(팀 이벤트면 null)</summary>
        public string PlayerId;
        /// <summary>행위 시점의 코트 포지션(1~6, 해당 없으면 0)</summary>
        public int CourtPosition;
        public Quality Quality;
        public Outcome Outcome;
        public AttackType AttackType;
        /// <summary>보조 선수 id 목록(블로커들, 리베로 교체 대상, 교체 선수 등)</summary>
        public List<string> SecondaryPlayerIds;
        /// <summary>이벤트 직후 점수</summary>
        public int HomeScore;
        public int AwayScore;
        /// <summary>범용 정수(블로커 수, 로테이션 인덱스, 득점 사유 등)</summary>
        public int Value;
        /// <summary>득점 이벤트의 사유</summary>
        public PointReason Reason;
        /// <summary>판정에 사용된 주 확률(디버그·밸런스 분석용)</summary>
        public double Probability;
        /// <summary>클러치 상황 여부</summary>
        public bool Clutch;

        public override string ToString()
        {
            return $"#{Seq} S{Set} R{Rally} {Type} {Side} {PlayerId ?? "-"}@{CourtPosition} {Quality}/{Outcome}/{AttackType} [{HomeScore}:{AwayScore}] v={Value} p={Probability:0.000}";
        }
    }
}
