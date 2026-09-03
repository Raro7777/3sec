// 결정적 수학 함수 (SimMath.cs 포팅).
// Math.exp / Math.log 은 JS 엔진마다 마지막 비트가 달라질 수 있으므로
// IEEE-754 기본 연산만으로 구현한 자체 Exp/Ln 을 쓴다 → 브라우저가 달라도 같은 시드 = 같은 결과.
// SimMath.cs:1-126

const LOG2E = 1.4426950408889634;
const LN2_HI = 6.93147180369123816490e-01;   // SimMath.cs:12 Ln2Hi
const LN2_LO = 1.90821492927058770002e-10;   // SimMath.cs:13 Ln2Lo

// 비트 조작용 공용 버퍼(할당 없음)
const _buf = new ArrayBuffer(8);
const _f64 = new Float64Array(_buf);
const _u32 = new Uint32Array(_buf);
// 리틀엔디언이면 상위 32비트가 인덱스 1
_f64[0] = 1.0;
const HI = _u32[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

/** 2^k 를 지수 비트로 정확히 생성. SimMath.cs:40 Pow2 */
export function pow2(k) {
  if (k > 1023) return Infinity;
  if (k < -1022) return 0.0;
  _u32[LO] = 0;
  _u32[HI] = (k + 1023) << 20;
  return _f64[0];
}

/** 결정적 e^x. x 는 [-700, 700] 클램프. SimMath.cs:19 Exp */
export function exp(x) {
  if (Number.isNaN(x)) return x;
  if (x > 700.0) x = 700.0;
  else if (x < -700.0) x = -700.0;

  const kf = Math.floor(x * LOG2E + 0.5);
  const r = (x - kf * LN2_HI) - kf * LN2_LO; // |r| <= ln2/2
  // 테일러 14차
  let term = 1.0, sum = 1.0;
  for (let i = 1; i <= 14; i++) {
    term = term * r / i;
    sum += term;
  }
  return sum * pow2(kf);
}

/** 결정적 자연로그. x <= 0 이면 -745. SimMath.cs:52 Ln */
export function ln(x) {
  if (Number.isNaN(x)) return x;
  if (x <= 0.0) return -745.0;
  if (x === Infinity) return 709.0;

  _f64[0] = x;
  let expBits = (_u32[HI] >>> 20) & 0x7ff;
  if (expBits === 0) {
    // 비정규수: 2^54 로 정규화
    x *= 18014398509481984.0;
    _f64[0] = x;
    expBits = ((_u32[HI] >>> 20) & 0x7ff) - 54;
  }
  let e = expBits - 1023;
  // 가수부만 남기고 지수를 1023(=[1,2))으로 교체
  _u32[HI] = (_u32[HI] & 0x000fffff) | 0x3ff00000;
  let m = _f64[0];
  if (m > 1.4142135623730951) { m *= 0.5; e += 1; }
  // ln(m) = 2*atanh(z)
  const z = (m - 1.0) / (m + 1.0);
  const z2 = z * z;
  let termZ = z, sum = 0.0;
  for (let i = 1; i <= 25; i += 2) {
    sum += termZ / i;
    termZ *= z2;
  }
  const lnM = 2.0 * sum;
  return e * LN2_HI + (e * LN2_LO + lnM);
}

/** 시그모이드. SimMath.cs:93 */
export function sigmoid(x) {
  if (x >= 0) {
    const ez = exp(-x);
    return 1.0 / (1.0 + ez);
  }
  const ez = exp(x);
  return ez / (1.0 + ez);
}

/** 로짓 ln(p/(1-p)). p 는 [1e-9, 1-1e-9] 클램프. SimMath.cs:108 */
export function logit(p) {
  if (p < 1e-9) p = 1e-9;
  else if (p > 1.0 - 1e-9) p = 1.0 - 1e-9;
  return ln(p / (1.0 - p));
}

/**
 * 스탯 대결 확률. diff=0 이면 정확히 baseProb, diff 가 k 만큼 커질 때마다 로짓 +1.
 * SimMath.cs:118 Contest
 */
export function contest(baseProb, diff, k, extraLogit = 0.0) {
  if (k <= 0) k = 1e-9;
  return sigmoid(logit(baseProb) + diff / k + extraLogit);
}

export function lerp(a, b, t) { return a + (b - a) * t; }

export function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

/** C# Math.Round(x, MidpointRounding.ToEven) 과 동일한 은행가 반올림. */
export function roundHalfEven(v) {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return (f % 2 === 0) ? f : f + 1;
}
