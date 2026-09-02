using VolleySim.Config;
using VolleySim.Domain;

namespace VolleySim.Engine
{
    /// <summary>10종 스탯 + 신장을 판정용 복합 레이팅(0~100 스케일)으로 합성.</summary>
    public static class Ratings
    {
        public static double Serve(Player p, SimConfig.RatingWeights w)
        {
            return w.ServeFromServe * p.Stats.Serve + w.ServeFromPower * p.Stats.Power;
        }

        public static double Receive(Player p, SimConfig.RatingWeights w)
        {
            return w.ReceiveFromReceive * p.Stats.Receive + w.ReceiveFromSpeed * p.Stats.Speed;
        }

        public static double Set(Player p, SimConfig.RatingWeights w)
        {
            return w.SetFromSet * p.Stats.Set + w.SetFromSpeed * p.Stats.Speed;
        }

        public static double Attack(Player p, SimConfig.RatingWeights w)
        {
            double h = SimMath.Clamp((p.HeightCm - w.HeightPivotCm) * w.AttackHeightPerCm, -w.AttackHeightCap, w.AttackHeightCap);
            return w.AttackFromSpike * p.Stats.Spike + w.AttackFromPower * p.Stats.Power + w.AttackFromSpeed * p.Stats.Speed + h;
        }

        public static double Block(Player p, SimConfig.RatingWeights w)
        {
            double h = SimMath.Clamp((p.HeightCm - w.HeightPivotCm) * w.BlockHeightPerCm, -w.BlockHeightCap, w.BlockHeightCap);
            return w.BlockFromBlock * p.Stats.Block + w.BlockFromSpeed * p.Stats.Speed + h;
        }

        public static double Dig(Player p, SimConfig.RatingWeights w)
        {
            return w.DigFromDig * p.Stats.Dig + w.DigFromSpeed * p.Stats.Speed;
        }
    }
}
