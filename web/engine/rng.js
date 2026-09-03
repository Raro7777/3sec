// 시드 기반 결정적 난수. C# 의 xoshiro256**(DeterministicRandom.cs) 를 그대로 재현하는 대신
// JS 에서 빠르고 안전한 xorshift128 + SplitMix32 시드 확장을 직접 구현한다.
// 요구사항: Math.random() 금지, 같은 시드 + 같은 입력 = 항상 같은 결과.
// 인터페이스(nextDouble / nextInt / chance / weightedIndex / fork)는 DeterministicRandom.cs 와 1:1.

import { ln } from './mathx.js';

/** SplitMix32: 시드 1개 → 32비트 난수 스트림(상태 확장용). */
function splitmix32(state) {
  state = (state + 0x9e3779b9) | 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return [(z ^ (z >>> 15)) >>> 0, state];
}

export class Rng {
  /** @param {number} seed 정수 시드 */
  constructor(seed) {
    let s = seed | 0;
    let v;
    [v, s] = splitmix32(s); this.s0 = v;
    [v, s] = splitmix32(s); this.s1 = v;
    [v, s] = splitmix32(s); this.s2 = v;
    [v, s] = splitmix32(s); this.s3 = v;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
    this.draws = 0;
    // 워밍업(시드 상관 제거)
    for (let i = 0; i < 8; i++) this.nextUint32();
    this.draws = 0;
  }

  /** xorshift128. [0, 2^32) 부호 없는 정수. */
  nextUint32() {
    this.draws++;
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    t ^= t << 11; t >>>= 0;
    t ^= t >>> 8;
    this.s0 = ((t ^ s ^ (s >>> 19)) >>> 0);
    return this.s0;
  }

  /** [0, 1) — 32비트 정밀도(시뮬 판정에 충분). DeterministicRandom.cs:59 NextDouble */
  nextDouble() {
    return this.nextUint32() * 2.3283064365386963e-10; // 1 / 2^32
  }

  /** [0, maxExclusive) 정수. DeterministicRandom.cs:66 NextInt */
  nextInt(maxExclusive) {
    if (maxExclusive <= 0) return 0;
    return (this.nextUint32() % maxExclusive) | 0;
  }

  /** 확률 p 로 true. DeterministicRandom.cs:73 Chance (p<=0 / p>=1 에서도 난수 1개 소비) */
  chance(p) {
    const r = this.nextUint32() * 2.3283064365386963e-10;
    if (p <= 0.0) return false;
    if (p >= 1.0) return true;
    return r < p;
  }

  /** 가중치 배열에서 인덱스 1개. 총합 0 이면 마지막 유효 인덱스. DeterministicRandom.cs:81 WeightedIndex */
  weightedIndex(weights, count) {
    let total = 0;
    for (let i = 0; i < count; i++) if (weights[i] > 0) total += weights[i];
    if (total <= 0) {
      this.nextUint32();
      return count > 0 ? count - 1 : -1;
    }
    const r = this.nextDouble() * total;
    let acc = 0, last = -1;
    for (let i = 0; i < count; i++) {
      if (weights[i] <= 0) continue;
      last = i;
      acc += weights[i];
      if (r < acc) return i;
    }
    return last;
  }

  /** [lo, hi) 균등 실수. */
  uniform(lo, hi) { return lo + (hi - lo) * this.nextDouble(); }

  /**
   * 표준정규. TrainingRandom.cs:33 은 Box-Muller(Math.Log·Math.Cos)를 쓰지만
   * Math.cos 는 JS 엔진마다 마지막 비트가 달라질 수 있어 Marsaglia 극좌표법으로 바꿨다.
   * (sqrt 는 JS 명세상 정확 반올림, ln 은 mathx.js 의 결정적 구현 → 브라우저 무관 결정성)
   * 분포는 동일한 N(mean, sd).
   */
  gauss(mean, sd) {
    let u, v, s;
    do {
      u = this.nextDouble() * 2.0 - 1.0;
      v = this.nextDouble() * 2.0 - 1.0;
      s = u * u + v * v;
    } while (s >= 1.0 || s === 0.0);
    const f = Math.sqrt(-2.0 * ln(s) / s);
    return mean + sd * (u * f);
  }

  /** 하위 시드(항상 양수). TrainingRandom.cs:24 NextSeed */
  nextSeed() { return (this.nextUint32() & 0x7fffffff) | 0; }

  /** 새 하위 스트림. DeterministicRandom.cs:100 Fork */
  fork() { return new Rng(this.nextUint32() | 0); }
}

/**
 * (seed, a, b) → 결정적 파생 시드. MonteCarlo.cs:110 MixSeed 와 동일한 상수·순서.
 * 시나리오 간 공통 난수(분산 감소)를 위해 파리티 하네스에서도 그대로 쓴다.
 */
export function mixSeed(seed, a, b) {
  let h = Math.imul(seed, 2654435761) >>> 0;
  h = (h ^ ((Math.imul(a, 2246822519) + 0x9e3779b9) >>> 0)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ Math.imul(b, 3266489917)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0x7fffffff) | 0;
}

/** GameState.NextSeed(GameState.cs:47) 와 같은 규칙의 저장 가능한 시드 카운터. */
export function derivedSeed(seed, index) {
  let h = Math.imul(seed, 2654435761) >>> 0;
  h = (h ^ ((Math.imul(index, 2246822519) + 0x9e3779b9) >>> 0)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h & 0x7fffffff) | 0;
}
