using System;

namespace VolleySim.Engine
{
    /// <summary>
    /// 결정적 수학 함수 모음.
    /// Math.Exp / Math.Log 은 플랫폼 C 런타임 구현에 따라 마지막 비트가 달라질 수 있으므로
    /// IEEE-754 기본 연산(+ - * /, Floor, 비트 조작)만으로 구현한 자체 Exp/Ln 을 사용한다.
    /// 정밀도는 약 1e-14 상대 오차로 시뮬레이션 용도로 충분하다.
    /// </summary>
    public static class SimMath
    {
        private const double Log2E = 1.4426950408889634;
        private const double Ln2Hi = 6.93147180369123816490e-01;
        private const double Ln2Lo = 1.90821492927058770002e-10;

        /// <summary>결정적 e^x. x는 [-700, 700] 으로 클램프.</summary>
        public static double Exp(double x)
        {
            if (double.IsNaN(x)) return x;
            if (x > 700.0) x = 700.0;
            if (x < -700.0) x = -700.0;

            double kf = Math.Floor(x * Log2E + 0.5);
            int k = (int)kf;
            double r = (x - kf * Ln2Hi) - kf * Ln2Lo; // |r| <= ln2/2 ≈ 0.3466

            // 테일러 급수 14차 (|r|<=0.3466 에서 잔차 < 1e-16)
            double term = 1.0;
            double sum = 1.0;
            for (int i = 1; i <= 14; i++)
            {
                term = term * r / i;
                sum += term;
            }
            return sum * Pow2(k);
        }

        /// <summary>2^k (k in [-1022, 1023]) 를 비트 조작으로 정확히 생성.</summary>
        public static double Pow2(int k)
        {
            if (k > 1023) return double.PositiveInfinity;
            if (k < -1022) return 0.0;
            long bits = ((long)(k + 1023)) << 52;
            return BitConverter.Int64BitsToDouble(bits);
        }

        /// <summary>결정적 자연로그. x ≤ 0 이면 -∞ 대신 매우 작은 값(-745)을 반환.</summary>
        public static double Ln(double x)
        {
            if (double.IsNaN(x)) return x;
            if (x <= 0.0) return -745.0;
            if (double.IsPositiveInfinity(x)) return 709.0;

            long bits = BitConverter.DoubleToInt64Bits(x);
            int exp = (int)((bits >> 52) & 0x7FF);
            if (exp == 0)
            {
                // 비정규수: 2^54 를 곱해 정규화
                x *= 18014398509481984.0; // 2^54
                bits = BitConverter.DoubleToInt64Bits(x);
                exp = (int)((bits >> 52) & 0x7FF) - 54;
            }
            int e = exp - 1023;
            long mantBits = (bits & 0x000FFFFFFFFFFFFFL) | 0x3FF0000000000000L;
            double m = BitConverter.Int64BitsToDouble(mantBits); // [1, 2)
            if (m > 1.4142135623730951)
            {
                m *= 0.5;
                e += 1;
            }
            // ln(m) = 2 * atanh(z), z = (m-1)/(m+1), |z| <= 0.1716
            double z = (m - 1.0) / (m + 1.0);
            double z2 = z * z;
            double termZ = z;
            double sum = 0.0;
            for (int i = 1; i <= 25; i += 2)
            {
                sum += termZ / i;
                termZ *= z2;
            }
            double lnM = 2.0 * sum;
            return e * Ln2Hi + (e * Ln2Lo + lnM);
        }

        /// <summary>시그모이드 1/(1+e^-x).</summary>
        public static double Sigmoid(double x)
        {
            if (x >= 0)
            {
                double ez = Exp(-x);
                return 1.0 / (1.0 + ez);
            }
            else
            {
                double ez = Exp(x);
                return ez / (1.0 + ez);
            }
        }

        /// <summary>로짓 ln(p/(1-p)). p는 [1e-9, 1-1e-9]로 클램프.</summary>
        public static double Logit(double p)
        {
            if (p < 1e-9) p = 1e-9;
            if (p > 1.0 - 1e-9) p = 1.0 - 1e-9;
            return Ln(p / (1.0 - p));
        }

        /// <summary>
        /// 스탯 대결 확률. 두 값이 같을 때(diff=0) 정확히 baseProb 가 되며,
        /// diff 가 k 만큼 커질 때마다 로짓이 1 증가한다.
        /// P = sigmoid( logit(baseProb) + diff / k + extraLogit )
        /// </summary>
        public static double Contest(double baseProb, double diff, double k, double extraLogit = 0.0)
        {
            if (k <= 0) k = 1e-9;
            return Sigmoid(Logit(baseProb) + diff / k + extraLogit);
        }

        public static double Lerp(double a, double b, double t) => a + (b - a) * t;

        public static double Clamp(double v, double min, double max) => v < min ? min : (v > max ? max : v);

        public static int Clamp(int v, int min, int max) => v < min ? min : (v > max ? max : v);
    }
}
