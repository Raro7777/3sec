using System;
using System.Collections.Generic;
using VolleySim.Engine;

namespace VolleySim.Training
{
    /// <summary>육성용 난수. Core 의 xoshiro256** 결정적 난수를 감싸 균등/정규/선택을 제공한다. 같은 시드 = 같은 수열.</summary>
    public sealed class TrainingRandom
    {
        private readonly DeterministicRandom _rng;

        public TrainingRandom(long seed) { _rng = new DeterministicRandom(seed); }

        public long DrawCount => _rng.DrawCount;

        /// <summary>[0,1)</summary>
        public double NextDouble() => _rng.NextDouble();

        public double Uniform(double lo, double hi) => lo + (hi - lo) * _rng.NextDouble();

        public int NextInt(int maxExclusive) => _rng.NextInt(maxExclusive);

        /// <summary>새 시드(하위 시뮬레이터에 넘길 용도). 항상 양수.</summary>
        public int NextSeed() => (int)(_rng.NextULong() & 0x7FFFFFFF);

        public bool Chance(double p) => _rng.NextDouble() < p;

        public T Choice<T>(IReadOnlyList<T> items) => items[_rng.NextInt(items.Count)];

        /// <summary>표준정규 (Box-Muller).</summary>
        public double Gauss(double mean, double sd)
        {
            double u1 = 1.0 - _rng.NextDouble(); // (0,1]
            double u2 = _rng.NextDouble();
            double z = Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
            return mean + sd * z;
        }
    }
}
