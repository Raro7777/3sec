namespace VolleySim.Engine
{
    /// <summary>
    /// 시드 주입형 결정적 난수 생성기 (xoshiro256** + SplitMix64 시드 확장).
    /// 정수 연산만 사용하므로 플랫폼/런타임에 무관하게 동일 시드 → 동일 수열을 보장한다.
    /// System.Random은 런타임 버전에 따라 알고리즘이 달라질 수 있어 사용하지 않는다.
    /// </summary>
    public sealed class DeterministicRandom
    {
        private ulong _s0, _s1, _s2, _s3;
        private long _drawCount;

        public DeterministicRandom(long seed)
        {
            ulong x = unchecked((ulong)seed);
            _s0 = SplitMix64(ref x);
            _s1 = SplitMix64(ref x);
            _s2 = SplitMix64(ref x);
            _s3 = SplitMix64(ref x);
            if ((_s0 | _s1 | _s2 | _s3) == 0) _s0 = 0x9E3779B97F4A7C15UL;
        }

        /// <summary>지금까지 뽑은 난수 횟수(디버그/재현 검증용).</summary>
        public long DrawCount => _drawCount;

        private static ulong SplitMix64(ref ulong x)
        {
            unchecked
            {
                x += 0x9E3779B97F4A7C15UL;
                ulong z = x;
                z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
                z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
                return z ^ (z >> 31);
            }
        }

        private static ulong RotL(ulong v, int k) => (v << k) | (v >> (64 - k));

        public ulong NextULong()
        {
            unchecked
            {
                _drawCount++;
                ulong result = RotL(_s1 * 5UL, 7) * 9UL;
                ulong t = _s1 << 17;
                _s2 ^= _s0;
                _s3 ^= _s1;
                _s1 ^= _s2;
                _s0 ^= _s3;
                _s2 ^= t;
                _s3 = RotL(_s3, 45);
                return result;
            }
        }

        /// <summary>[0, 1) 구간의 53비트 정밀도 double.</summary>
        public double NextDouble()
        {
            return (NextULong() >> 11) * (1.0 / 9007199254740992.0);
        }

        /// <summary>[0, maxExclusive) 정수. maxExclusive ≤ 0 이면 0.</summary>
        public int NextInt(int maxExclusive)
        {
            if (maxExclusive <= 0) return 0;
            return (int)(NextULong() % (ulong)maxExclusive);
        }

        /// <summary>확률 p로 true.</summary>
        public bool Chance(double p)
        {
            if (p <= 0.0) { NextULong(); return false; }
            if (p >= 1.0) { NextULong(); return true; }
            return NextDouble() < p;
        }

        /// <summary>가중치 배열에서 인덱스 하나를 뽑는다. 총합이 0이면 마지막 유효 인덱스(없으면 -1).</summary>
        public int WeightedIndex(double[] weights, int count)
        {
            double total = 0;
            for (int i = 0; i < count; i++) if (weights[i] > 0) total += weights[i];
            if (total <= 0)
            {
                NextULong();
                return count > 0 ? count - 1 : -1;
            }
            double r = NextDouble() * total;
            double acc = 0;
            int last = -1;
            for (int i = 0; i < count; i++)
            {
                if (weights[i] <= 0) continue;
                last = i;
                acc += weights[i];
                if (r < acc) return i;
            }
            return last;
        }

        /// <summary>새 하위 스트림(예: 세트별/선수 생성용). 현재 상태에서 파생되므로 결정적.</summary>
        public DeterministicRandom Fork()
        {
            return new DeterministicRandom(unchecked((long)NextULong()));
        }
    }
}
