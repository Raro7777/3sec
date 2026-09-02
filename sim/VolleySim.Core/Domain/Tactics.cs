namespace VolleySim.Domain
{
    /// <summary>리시브 포메이션. 단순 가중치(누가 리시브를 더 많이 받는가 + 소폭의 품질 보정)로 표현.</summary>
    public enum ReceiveFormation
    {
        /// <summary>표준 3인 리시브(리베로 + OH 2명 중심).</summary>
        Standard = 0,
        /// <summary>리베로가 넓은 범위를 커버. 리베로 리시브 비중 대폭 상승.</summary>
        LiberoCentered = 1,
        /// <summary>균등 분담. OH 비중 상승, 리베로 비중 하락.</summary>
        Spread = 2,
    }

    /// <summary>팀 단위 전술 파라미터.</summary>
    public sealed class Tactics
    {
        /// <summary>공격 배분 가중치 — MB 속공.</summary>
        public double QuickWeight = 1.2;
        /// <summary>공격 배분 가중치 — OH 오픈(하이볼).</summary>
        public double OpenWeight = 1.0;
        /// <summary>공격 배분 가중치 — OP 공격(후위 파이프/라이트).</summary>
        public double BackRowWeight = 0.7;
        /// <summary>공격 배분 가중치 — 시간차.</summary>
        public double DelayedWeight = 0.5;

        /// <summary>서브 공격성 0(안정 서브)~1(강서브). 에이스율·범실률 동시 상승.</summary>
        public double ServeAggression = 0.5;

        public ReceiveFormation Formation = ReceiveFormation.Standard;

        public static Tactics Default() => new Tactics();

        public Tactics Clone()
        {
            return new Tactics
            {
                QuickWeight = QuickWeight,
                OpenWeight = OpenWeight,
                BackRowWeight = BackRowWeight,
                DelayedWeight = DelayedWeight,
                ServeAggression = ServeAggression,
                Formation = Formation,
            };
        }

        public override string ToString()
        {
            return $"Q{QuickWeight:0.##}/O{OpenWeight:0.##}/B{BackRowWeight:0.##}/D{DelayedWeight:0.##} srv{ServeAggression:0.##} {Formation}";
        }
    }
}
