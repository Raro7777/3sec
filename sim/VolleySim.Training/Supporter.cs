using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using VolleySim.Domain;

namespace VolleySim.Training
{
    /// <summary>서포터 1명의 입력(9.3절): 확정 스탯·포지션·원소속 구단. 로스터의 대표 인스턴스에서 만든다.</summary>
    public sealed class SupporterInfo
    {
        public string Id = "";
        public string Name = "";
        public Position Position;
        /// <summary>원소속 구단(카드 club, world.md). 동문/라이벌 판정에 사용.</summary>
        public string ClubId = "";
        /// <summary>확정 스탯 10종(StatKind 순서)</summary>
        public int[] Stats = new int[10];

        public static SupporterInfo FromPlayer(Player p)
        {
            var s = new SupporterInfo { Id = p.Id, Name = p.Name, Position = p.Position, ClubId = p.TeamId };
            for (int i = 0; i < 10; i++) s.Stats[i] = p.Stats[VolleySim.Domain.Stats.AllKinds[i]];
            return s;
        }

        public int Stat(StatKind k) => Stats[(int)k];
    }

    /// <summary>
    /// 트레이니 카드 + 서포터 목록 → 수식에 꽂히는 보정치(9.3절). 스크립트 Support 클래스와 1:1.
    /// </summary>
    public sealed class SupportProfile
    {
        public readonly TrainingConfig Config;
        public readonly List<SupporterInfo> Supporters = new List<SupporterInfo>();
        /// <summary>훈련 종류별 보정 합(상한 적용 후). 인덱스 = 훈련 5종</summary>
        public readonly double[] TrainBonus = new double[5];
        /// <summary>라이벌 핫존 가산(핫존 훈련에만)</summary>
        public double HotExtra;
        /// <summary>부상 확률 배수(≤1, 하한 0.80)</summary>
        public double InjuryMult = 1.0;
        /// <summary>컨디션 하락 확률 배수(≤1, 하한 0.65)</summary>
        public double CondDownMult = 1.0;
        /// <summary>특훈 등장 확률 가산</summary>
        public double SpecialBonus;
        /// <summary>서포터별 시그니처 훈련(5개 훈련 주 스탯 중 최고). 선배 이벤트에 사용.</summary>
        public readonly List<TrainingAction> SignatureTrainings = new List<TrainingAction>();
        /// <summary>서포터별 인연 태그(동문/라이벌/포지션 일치)</summary>
        public readonly List<string> Tags = new List<string>();

        public int Count => Supporters.Count;

        public static SupportProfile Empty(TrainingConfig cfg) => new SupportProfile(cfg);

        private SupportProfile(TrainingConfig cfg) { Config = cfg; }

        /// <param name="capOverride">null 이면 Config.SupportCap. 추천 점수 계산 시 상한 해제용.</param>
        public static SupportProfile Build(Position traineePos, string traineeClub, IEnumerable<SupporterInfo> supporters, TrainingConfig cfg, double? capOverride = null)
        {
            var prof = new SupportProfile(cfg);
            double cap = capOverride ?? cfg.SupportCap;
            double inj = 0, cond = 0, sp = 0;
            foreach (var s in supporters)
            {
                if (s == null) continue;
                prof.Supporters.Add(s);
                var tags = new List<string>();
                for (int t = 0; t < 5; t++)
                {
                    int main = s.Stats[(int)cfg.TrainingStats[t][0]];
                    prof.TrainBonus[t] += Math.Min(cfg.SupportTrainCapEach, Math.Max(0.0, main - cfg.SupportStatBase) / cfg.SupportStatDiv);
                }
                if (s.Position == traineePos)
                {
                    for (int t = 0; t < 5; t++) prof.TrainBonus[t] += cfg.SupportPosMatch;
                    tags.Add("포지션 일치");
                }
                if (!string.IsNullOrEmpty(s.ClubId) && s.ClubId == traineeClub)
                {
                    for (int t = 0; t < 5; t++) prof.TrainBonus[t] += cfg.SupportSameClub;
                    tags.Add("동문");
                }
                if (cfg.IsRival(s.ClubId, traineeClub))
                {
                    prof.HotExtra += cfg.SupportRivalHot;
                    tags.Add("라이벌");
                }
                inj += Math.Min(cfg.SupportInjCapEach, Math.Max(0.0, s.Stat(StatKind.Stamina) - cfg.SupportStatBase) / cfg.SupportInjDiv);
                cond += Math.Min(cfg.SupportCondCapEach, Math.Max(0.0, s.Stat(StatKind.Mental) - cfg.SupportStatBase) / cfg.SupportCondDiv);
                double ovr = OvrOf(s, cfg);
                if (ovr >= cfg.GradeCut[0]) sp += cfg.SupportSpecialS;
                else if (ovr >= cfg.GradeCut[1]) sp += cfg.SupportSpecialA;
                // 시그니처 훈련: 주 스탯 최고(동률이면 앞 순서)
                int bestT = 0; int bestV = int.MinValue;
                for (int t = 0; t < 5; t++)
                {
                    int v = s.Stats[(int)cfg.TrainingStats[t][0]];
                    if (v > bestV) { bestV = v; bestT = t; }
                }
                prof.SignatureTrainings.Add((TrainingAction)bestT);
                prof.Tags.Add(string.Join("·", tags));
            }
            for (int t = 0; t < 5; t++) prof.TrainBonus[t] = Math.Min(cap, prof.TrainBonus[t]);
            prof.InjuryMult = Math.Max(cfg.SupportInjFloor, 1.0 - inj);
            prof.CondDownMult = Math.Max(cfg.SupportCondFloor, 1.0 - cond);
            prof.SpecialBonus = Math.Min(cfg.SupportSpecialCap, sp);
            return prof;
        }

        public static double OvrOf(SupporterInfo s, TrainingConfig cfg)
        {
            var st = new double[10];
            for (int i = 0; i < 10; i++) st[i] = s.Stats[i];
            return cfg.Ovr(st, s.Position);
        }

        /// <summary>초보용 자동 추천(9.6절): 핵심 3스탯 훈련 보정 합 + 라이벌 핫존 가산 × 0.5 + 부상 방지율 × 0.5 순으로 k명(자기 자신 제외는 호출자 책임).</summary>
        public static List<SupporterInfo> Recommend(Position traineePos, string traineeClub, IEnumerable<SupporterInfo> roster, TrainingConfig cfg, int k = 3)
        {
            var core = cfg.Core3[(int)traineePos];
            var coreTrainings = new List<int>();
            for (int t = 0; t < 5; t++) if (Array.IndexOf(core, cfg.TrainingStats[t][0]) >= 0) coreTrainings.Add(t);
            double Score(SupporterInfo s)
            {
                var one = Build(traineePos, traineeClub, new[] { s }, cfg, capOverride: 9.0);
                double sum = 0;
                foreach (var t in coreTrainings) sum += one.TrainBonus[t];
                return sum + one.HotExtra * 0.5 + (1.0 - one.InjuryMult) * 0.5;
            }
            return roster.Where(s => s != null).OrderByDescending(Score).Take(k).ToList();
        }

        public double RecommendScore(SupporterInfo s, Position traineePos, string traineeClub)
        {
            var cfg = Config;
            var core = cfg.Core3[(int)traineePos];
            var one = Build(traineePos, traineeClub, new[] { s }, cfg, capOverride: 9.0);
            double sum = 0;
            for (int t = 0; t < 5; t++) if (Array.IndexOf(core, cfg.TrainingStats[t][0]) >= 0) sum += one.TrainBonus[t];
            return sum + one.HotExtra * 0.5 + (1.0 - one.InjuryMult) * 0.5;
        }

        public string Summary()
        {
            var sb = new StringBuilder("훈련보정 ");
            for (int t = 0; t < 5; t++)
            {
                if (t > 0) sb.Append(' ');
                sb.Append(TrainingText.ActionName((TrainingAction)t)).Append('+').Append((TrainBonus[t] * 100).ToString("0.0")).Append('%');
            }
            sb.Append(" | 핫존 +").Append((HotExtra * 100).ToString("0")).Append("%p 부상×").Append(InjuryMult.ToString("0.00"))
              .Append(" 컨디션하락×").Append(CondDownMult.ToString("0.00")).Append(" 특훈+").Append((SpecialBonus * 100).ToString("0")).Append("%p");
            return sb.ToString();
        }
    }
}
