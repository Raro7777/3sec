using System;

namespace VolleySim.Domain
{
    /// <summary>
    /// 10종 능력치(0~100 정수). 프로 주전급 성장 완료 선수의 실전 범위는 대략 50~85.
    /// 시뮬레이션은 <see cref="Player.Stats"/>만 사용하며 potential은 무시한다.
    /// </summary>
    public sealed class Stats
    {
        public int Serve;
        public int Receive;
        public int Set;
        public int Spike;
        public int Block;
        public int Dig;
        public int Speed;
        public int Power;
        public int Stamina;
        public int Mental;

        public const int Min = 0;
        public const int Max = 100;

        public static readonly StatKind[] AllKinds =
        {
            StatKind.Serve, StatKind.Receive, StatKind.Set, StatKind.Spike, StatKind.Block,
            StatKind.Dig, StatKind.Speed, StatKind.Power, StatKind.Stamina, StatKind.Mental,
        };

        public Stats() { }

        public Stats(int serve, int receive, int set, int spike, int block, int dig, int speed, int power, int stamina, int mental)
        {
            Serve = serve; Receive = receive; Set = set; Spike = spike; Block = block;
            Dig = dig; Speed = speed; Power = power; Stamina = stamina; Mental = mental;
        }

        public int this[StatKind kind]
        {
            get
            {
                switch (kind)
                {
                    case StatKind.Serve: return Serve;
                    case StatKind.Receive: return Receive;
                    case StatKind.Set: return Set;
                    case StatKind.Spike: return Spike;
                    case StatKind.Block: return Block;
                    case StatKind.Dig: return Dig;
                    case StatKind.Speed: return Speed;
                    case StatKind.Power: return Power;
                    case StatKind.Stamina: return Stamina;
                    case StatKind.Mental: return Mental;
                    default: throw new ArgumentOutOfRangeException(nameof(kind));
                }
            }
            set
            {
                switch (kind)
                {
                    case StatKind.Serve: Serve = value; break;
                    case StatKind.Receive: Receive = value; break;
                    case StatKind.Set: Set = value; break;
                    case StatKind.Spike: Spike = value; break;
                    case StatKind.Block: Block = value; break;
                    case StatKind.Dig: Dig = value; break;
                    case StatKind.Speed: Speed = value; break;
                    case StatKind.Power: Power = value; break;
                    case StatKind.Stamina: Stamina = value; break;
                    case StatKind.Mental: Mental = value; break;
                    default: throw new ArgumentOutOfRangeException(nameof(kind));
                }
            }
        }

        public double Average
        {
            get
            {
                int sum = 0;
                for (int i = 0; i < AllKinds.Length; i++) sum += this[AllKinds[i]];
                return sum / (double)AllKinds.Length;
            }
        }

        public Stats Clone()
        {
            return new Stats(Serve, Receive, Set, Spike, Block, Dig, Speed, Power, Stamina, Mental);
        }

        /// <summary>모든 스탯에 delta를 더한 새 인스턴스(0~100으로 클램프).</summary>
        public Stats WithAllAdded(int delta)
        {
            var s = Clone();
            for (int i = 0; i < AllKinds.Length; i++)
            {
                s[AllKinds[i]] = Clamp(s[AllKinds[i]] + delta);
            }
            return s;
        }

        public Stats WithAdded(StatKind kind, int delta)
        {
            var s = Clone();
            s[kind] = Clamp(s[kind] + delta);
            return s;
        }

        public static int Clamp(int v) => v < Min ? Min : (v > Max ? Max : v);

        public override string ToString()
        {
            return $"SV{Serve} RC{Receive} ST{Set} SP{Spike} BL{Block} DG{Dig} SPD{Speed} PW{Power} STA{Stamina} MT{Mental}";
        }
    }
}
