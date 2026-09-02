using System.Collections.Generic;
using VolleySim.Domain;
using VolleySim.Result;

namespace VolleySim.Training.Evaluation
{
    /// <summary>평가전 요청(7.2절 TrainingMatchRequest 에 해당).</summary>
    public sealed class EvaluationRequest
    {
        /// <summary>0 = 1차(T4), 1 = 2차(T8), 2 = 최종(T12)</summary>
        public int Round;
        public int Turn;
        public int OpponentStrength;
        public Player Card;
        public Position Position;
        /// <summary>현재 스탯(소수)</summary>
        public double[] CurrentStats;
        public double CoreAverage;
        public Condition Condition;
        public TrainingConfig Config;
        /// <summary>시드 파생용(세션 시드). 제공자는 rng 를 써도 되고 이 값을 섞어도 된다.</summary>
        public int SessionSeed;
        public string TraineeTeamName = "캠프 팀";
    }

    /// <summary>평가전 결과(7.2절 TrainingMatchResult). 보상 필드는 세션이 채운다.</summary>
    public sealed class EvaluationOutcome
    {
        public int Round;
        public int Turn;
        public int OpponentStrength;
        public string OpponentName = "";
        public bool Absent;
        public bool Won;
        /// <summary>활약도 0~100</summary>
        public double Performance;
        public string ScoreLine = "";
        public List<string> Highlights = new List<string>();
        public PlayerBoxScore Box;
        public MatchResult Match;

        // ---- 세션이 채우는 보상 ----
        public int CoreGain;
        public int Hint;
        public int ConditionDelta;
        public bool Mvp;

        public string ResultLabel => Absent ? "결장" : (Won ? "승" : "패");
    }

    public interface IEvaluationMatchProvider
    {
        EvaluationOutcome Play(EvaluationRequest request, TrainingRandom rng);
    }
}
