using System;
using VolleySim.Domain;

namespace VolleySim.Training
{
    /// <summary>턴당 선택지. 0~4 는 훈련 5종(스크립트 TRAINING 순서), Rest 휴식, Special 특훈. Treat 는 강제 치료(선택 불가).</summary>
    public enum TrainingAction
    {
        Serve = 0,
        Receive = 1,
        Set = 2,
        Spike = 3,
        Block = 4,
        Rest = 5,
        Special = 6,
        Treat = 7,
    }

    /// <summary>컨디션 5단계. 정수값은 스크립트(0 최악 ~ 4 절호조)와 동일.</summary>
    public enum Condition
    {
        Worst = 0,
        Bad = 1,
        Normal = 2,
        Good = 3,
        Best = 4,
    }

    /// <summary>강도 곡선 구간(3.6절).</summary>
    public enum FatigueZone
    {
        Cold = 0,
        Normal = 1,
        Hot = 2,
        Overheat = 3,
    }

    public enum Aptitude
    {
        D = 0,
        C = 1,
        B = 2,
        A = 3,
        S = 4,
    }

    public enum Grade
    {
        D = 0,
        C = 1,
        B = 2,
        A = 3,
        S = 4,
    }

    /// <summary>특훈 종류(3.4절). 오라클(스크립트)은 포지션 특훈만 사용한다.</summary>
    public enum SpecialKind
    {
        Position = 0,
        Stamina = 1,
        MentalCamp = 2,
    }

    public enum InjuryKind
    {
        None = 0,
        Light = 1,
        Severe = 2,
    }

    public enum EventKind
    {
        Story = 0,
        Senior = 1,
        Random = 2,
        Bond = 3,
    }

    public static class TrainingText
    {
        public static string ActionName(TrainingAction a)
        {
            switch (a)
            {
                case TrainingAction.Serve: return "서브";
                case TrainingAction.Receive: return "리시브";
                case TrainingAction.Set: return "토스";
                case TrainingAction.Spike: return "스파이크";
                case TrainingAction.Block: return "블로킹";
                case TrainingAction.Rest: return "휴식";
                case TrainingAction.Special: return "특훈";
                case TrainingAction.Treat: return "치료";
                default: return a.ToString();
            }
        }

        public static string SpecialName(SpecialKind k)
        {
            switch (k)
            {
                case SpecialKind.Position: return "포지션 특훈";
                case SpecialKind.Stamina: return "체력 특훈";
                case SpecialKind.MentalCamp: return "멘탈 캠프";
                default: return k.ToString();
            }
        }

        public static string ConditionName(Condition c)
        {
            switch (c)
            {
                case Condition.Best: return "절호조";
                case Condition.Good: return "호조";
                case Condition.Normal: return "보통";
                case Condition.Bad: return "부진";
                case Condition.Worst: return "최악";
                default: return c.ToString();
            }
        }

        public static string ConditionArrow(Condition c)
        {
            switch (c)
            {
                case Condition.Best: return "↑↑";
                case Condition.Good: return "↑";
                case Condition.Normal: return "→";
                case Condition.Bad: return "↓";
                case Condition.Worst: return "↓↓";
                default: return "?";
            }
        }

        public static string ZoneName(FatigueZone z)
        {
            switch (z)
            {
                case FatigueZone.Cold: return "콜드";
                case FatigueZone.Normal: return "적정";
                case FatigueZone.Hot: return "핫존";
                case FatigueZone.Overheat: return "과열";
                default: return z.ToString();
            }
        }

        public static string StatName(StatKind s)
        {
            switch (s)
            {
                case StatKind.Serve: return "서브";
                case StatKind.Receive: return "리시브";
                case StatKind.Set: return "토스";
                case StatKind.Spike: return "스파이크";
                case StatKind.Block: return "블로킹";
                case StatKind.Dig: return "디그";
                case StatKind.Speed: return "스피드";
                case StatKind.Power: return "파워";
                case StatKind.Stamina: return "스태미나";
                case StatKind.Mental: return "멘탈";
                default: return s.ToString();
            }
        }

        public static string StatShort(StatKind s)
        {
            switch (s)
            {
                case StatKind.Serve: return "서브";
                case StatKind.Receive: return "리시";
                case StatKind.Set: return "토스";
                case StatKind.Spike: return "스파";
                case StatKind.Block: return "블로";
                case StatKind.Dig: return "디그";
                case StatKind.Speed: return "스피";
                case StatKind.Power: return "파워";
                case StatKind.Stamina: return "스태";
                case StatKind.Mental: return "멘탈";
                default: return s.ToString();
            }
        }

        public static string GradeName(Grade g) => g.ToString();

        public static string InjuryName(InjuryKind k)
        {
            switch (k)
            {
                case InjuryKind.Light: return "경상";
                case InjuryKind.Severe: return "중상";
                default: return "없음";
            }
        }

        public static string RarityName(Rarity r) => r.ToString();
    }
}
