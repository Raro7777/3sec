using System;
using System.Collections.Generic;
using System.Linq;
using VolleySim.Training.Policies;

namespace VolleySim.Training
{
    /// <summary>정책으로 세션을 끝까지 자동 진행. 몬테카를로 집계 포함.</summary>
    public static class TrainingRunner
    {
        public static GraduationResult Run(TrainingSession s, TrainingPolicy policy)
        {
            s.PolicyName = policy.Name;
            int guard = 0;
            while (s.Phase != SessionPhase.Graduated)
            {
                if (++guard > 1000) throw new InvalidOperationException("세션이 끝나지 않습니다");
                if (s.Phase == SessionPhase.AwaitAction) s.Apply(policy.Choose(s));
                else if (s.Phase == SessionPhase.AwaitEventChoice) s.ResolveEvent(policy.ChooseEvent(s, s.PendingEvent));
            }
            return s.Result;
        }

        /// <summary>n회 반복 집계. factory(i) 가 i번째 세션을 만든다(시드는 호출자가 섞는다).</summary>
        public static RunSummary Batch(Func<int, TrainingSession> factory, TrainingPolicy policy, int n)
        {
            var list = new List<(GraduationResult r, TrainingSession s)>(n);
            for (int i = 0; i < n; i++)
            {
                var s = factory(i);
                list.Add((Run(s, policy), s));
            }
            return RunSummary.From(list.Select(x => (x.r, x.s)).ToList());
        }
    }

    /// <summary>스크립트 _job 과 같은 집계 항목.</summary>
    public sealed class RunSummary
    {
        public int N;
        public double OvrMean, OvrSd, P10, P90;
        public double S, A, B, C, D;
        public double CoreReach, AllReach;
        public double InjuryRate, SevereRate, TurnsLost;
        public double Hints, Rests, HotTrains, Trains, CondAvg;
        public double OvrInjured = double.NaN, OvrNoInjury = double.NaN, OvrLight = double.NaN, OvrSevere = double.NaN;
        public double SeniorEvents;
        public double WinRate, MvpRate;

        public static RunSummary From(List<(GraduationResult r, TrainingSession s)> runs)
        {
            var o = runs.Select(x => x.r.OvrRaw).ToList();
            int n = o.Count;
            var so = o.OrderBy(v => v).ToList();
            var sum = new RunSummary { N = n, OvrMean = o.Average() };
            sum.OvrSd = Math.Sqrt(o.Select(v => (v - sum.OvrMean) * (v - sum.OvrMean)).Average());
            sum.P10 = so[n / 10]; sum.P90 = so[n * 9 / 10];
            var cfg = runs[0].s.Config;
            sum.S = o.Count(v => cfg.GradeOf(v) == Grade.S) / (double)n;
            sum.A = o.Count(v => cfg.GradeOf(v) == Grade.A) / (double)n;
            sum.B = o.Count(v => cfg.GradeOf(v) == Grade.B) / (double)n;
            sum.C = o.Count(v => cfg.GradeOf(v) == Grade.C) / (double)n;
            sum.D = o.Count(v => cfg.GradeOf(v) == Grade.D) / (double)n;
            sum.CoreReach = runs.Average(x => x.r.CoreReach); sum.AllReach = runs.Average(x => x.r.AllReach);
            var inj = runs.Where(x => x.s.Trainee.Injuries > 0).ToList();
            var noinj = runs.Where(x => x.s.Trainee.Injuries == 0).ToList();
            var sev = inj.Where(x => x.s.Trainee.SevereInjuries > 0).ToList();
            var light = inj.Where(x => x.s.Trainee.SevereInjuries == 0).ToList();
            sum.InjuryRate = inj.Count / (double)n; sum.SevereRate = sev.Count / (double)n;
            sum.TurnsLost = runs.Average(x => x.s.Trainee.TurnsLost);
            sum.Hints = runs.Average(x => x.r.Hints); sum.Rests = runs.Average(x => x.s.Trainee.Rests);
            sum.HotTrains = runs.Average(x => x.s.Trainee.HotTrains); sum.Trains = runs.Average(x => x.s.Trainee.Trains);
            sum.CondAvg = runs.Average(x => x.s.Trainee.ConditionAcc / Math.Max(1, x.s.Trainee.Trains));
            if (inj.Count > 0) sum.OvrInjured = inj.Average(x => x.r.OvrRaw);
            if (noinj.Count > 0) sum.OvrNoInjury = noinj.Average(x => x.r.OvrRaw);
            if (light.Count > 0) sum.OvrLight = light.Average(x => x.r.OvrRaw);
            if (sev.Count > 0) sum.OvrSevere = sev.Average(x => x.r.OvrRaw);
            sum.SeniorEvents = runs.Average(x => x.s.Trainee.SeniorEvents);
            int played = runs.Sum(x => x.r.Evaluations.Count(e => !e.Absent));
            sum.WinRate = played > 0 ? runs.Sum(x => x.r.Evaluations.Count(e => !e.Absent && e.Won)) / (double)played : 0;
            sum.MvpRate = played > 0 ? runs.Sum(x => x.r.Evaluations.Count(e => e.Mvp)) / (double)played : 0;
            return sum;
        }

        public string Line(string label, double baseOvr)
        {
            string F(double v) => double.IsNaN(v) ? "—" : v.ToString("0.0");
            return $"| {label} | {OvrMean:0.0} ({OvrMean - baseOvr:+0.0;-0.0}) | {OvrSd:0.0} | {P10:0.0} / {P90:0.0} | S {S * 100:0} / A {A * 100:0} / B {B * 100:0} | {CoreReach * 100:0}% / {AllReach * 100:0}% | {InjuryRate * 100:0}% ({SevereRate * 100:0}%) | {F(OvrNoInjury)} / {F(OvrLight)} / {F(OvrSevere)} | {Rests:0.0} / {HotTrains:0.0} / {Trains:0.0} | {Hints:0.0} |";
        }
    }
}
