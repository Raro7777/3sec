using System;
using System.Collections.Generic;
using System.Text;
using VolleySim.Domain;

namespace VolleySim.Training
{
    /// <summary>이벤트 선택 결과 효과. 스탯은 잠재력 클램프를 거쳐 적용된다.</summary>
    public sealed class EventEffect
    {
        public double[] StatGains = new double[10];
        public double Fatigue;
        public int Condition;
        public int Hint;
        public string ResultText = "";

        public EventEffect Stat(StatKind k, double v) { StatGains[(int)k] += v; return this; }
        public EventEffect WithFatigue(double f) { Fatigue += f; return this; }
        public EventEffect WithCondition(int c) { Condition += c; return this; }
        public EventEffect WithHint(int h) { Hint += h; return this; }
        public EventEffect WithText(string t) { ResultText = t ?? ""; return this; }

        public string Badge()
        {
            var parts = new List<string>();
            for (int i = 0; i < 10; i++)
            {
                if (Math.Abs(StatGains[i]) > 1e-9) parts.Add($"{TrainingText.StatName(Stats.AllKinds[i])} {StatGains[i]:+0.#;-0.#}");
            }
            if (Math.Abs(Fatigue) > 1e-9) parts.Add($"피로 {Fatigue:+0;-0}");
            if (Condition != 0) parts.Add($"컨디션 {Condition:+0;-0}");
            if (Hint != 0) parts.Add($"힌트 {Hint:+0;-0}");
            return parts.Count == 0 ? "효과 없음" : string.Join(", ", parts);
        }
    }

    public sealed class EventChoice
    {
        public string Label = "";
        /// <summary>1.0 이면 분기 없음. 미만이면 성공/실패 분기(6.2절).</summary>
        public double SuccessRate = 1.0;
        public EventEffect OnSuccess = new EventEffect();
        public EventEffect OnFail;

        public bool IsBranch => SuccessRate < 1.0;

        public string Describe()
        {
            if (!IsBranch) return $"{Label} → {OnSuccess.Badge()}";
            return $"{Label} (성공 {SuccessRate * 100:0}%) → 성공: {OnSuccess.Badge()} / 실패: {(OnFail ?? new EventEffect()).Badge()}";
        }
    }

    /// <summary>이벤트 1건: 본문 + 선택지 2개. <see cref="OracleChoice"/> 는 시뮬 스크립트의 평균 효과와 같은 선택지(자동 진행·정합 테스트용).</summary>
    public sealed class TrainingEvent
    {
        public EventKind Kind;
        public string Id = "";
        public string Title = "";
        public string Text = "";
        public EventChoice[] Choices = new EventChoice[2];
        public int OracleChoice = 0;
        public string SupporterName;
    }

    public sealed class EventOutcome
    {
        public TrainingEvent Event;
        public int ChoiceIndex;
        public bool Success = true;
        public EventEffect Applied;
        public Dictionary<StatKind, double> ActualGains = new Dictionary<StatKind, double>();
        public string Summary()
        {
            var sb = new StringBuilder();
            sb.Append(Event.Title).Append(" [").Append(Event.Choices[ChoiceIndex].Label).Append(']');
            if (Event.Choices[ChoiceIndex].IsBranch) sb.Append(Success ? " 성공" : " 실패");
            sb.Append(" → ").Append(Applied.Badge());
            return sb.ToString();
        }
    }

    /// <summary>
    /// 이벤트 텍스트 최소 세트(6.5절·9.4절 예시 활용). 구조는 나중에 JSON 풀로 뺄 수 있게 "생성 규칙 → TrainingEvent" 로 분리해 두었다.
    /// 효과 수치는 스크립트의 랜덤 이벤트 근사와 동일하며, 두 번째 선택지는 사람 플레이용 대안이다.
    /// </summary>
    public static class EventCatalog
    {
        public static TrainingEvent Story(int index, Position pos, TrainingConfig cfg)
        {
            var core = cfg.Core3[(int)pos];
            var ev = new TrainingEvent { Kind = EventKind.Story, Id = $"story{index + 1}" };
            switch (index)
            {
                case 0:
                    ev.Title = "스토리 #1 · 입소 첫 주";
                    ev.Text = "숙소 불이 꺼진 뒤에도 잠들지 못한다. \"제가 정말 여기 있어도 되는 걸까요.\"";
                    ev.Choices[0] = new EventChoice { Label = "네가 뽑힌 이유를 말해 준다", OnSuccess = new EventEffect().Stat(StatKind.Mental, 2).WithHint(1).WithText("\"…알겠습니다. 내일부터 제대로 할게요.\" 눈빛이 달라졌다.") };
                    ev.Choices[1] = new EventChoice { Label = "일단 푹 자라고 한다", OnSuccess = new EventEffect().WithCondition(1).WithText("다음 날 아침, 조금은 개운한 얼굴.") };
                    break;
                case 1:
                    ev.Title = "스토리 #2 · 벽";
                    ev.Text = $"같은 실수가 사흘째 반복된다. 공을 주우며 중얼거린다. \"왜 안 되지…\"";
                    ev.Choices[0] = new EventChoice { Label = "기본으로 돌아가자", OnSuccess = new EventEffect().Stat(core[1], 2).Stat(core[0], 1).WithHint(1).WithText("가장 쉬운 공 100개. 소리가 조금씩 달라진다.") };
                    ev.Choices[1] = new EventChoice { Label = "하루 쉬고 다시 보자", OnSuccess = new EventEffect().Stat(StatKind.Mental, 2).WithText("\"…네.\" 다음 날, 표정이 조금 풀렸다.") };
                    break;
                default:
                    ev.Title = "스토리 #3 · 각오";
                    ev.Text = "최종 평가전을 앞두고 라커룸에 혼자 앉아 있다. \"감독님, 저… 이길 수 있을까요.\"";
                    ev.Choices[0] = new EventChoice { Label = "네 무기를 믿어라", OnSuccess = new EventEffect().Stat(core[0], 2).Stat(StatKind.Mental, 1).WithHint(1).WithText("고개를 끄덕인다. \"제 무기, 알고 있어요.\"") };
                    ev.Choices[1] = new EventChoice { Label = "져도 괜찮다", OnSuccess = new EventEffect().Stat(core[1], 1).WithCondition(1).WithText("\"…그래도 이기고 싶어요.\" 웃는다.") };
                    break;
            }
            return ev;
        }

        public static TrainingEvent Senior(string supporterName, string tag, TrainingAction signature, TrainingConfig cfg)
        {
            var stat = cfg.TrainingStats[(int)signature][0];
            string statName = TrainingText.StatName(stat);
            var ev = new TrainingEvent { Kind = EventKind.Senior, Id = "senior", SupporterName = supporterName };
            bool rival = tag != null && tag.Contains("라이벌");
            bool alumni = tag != null && tag.Contains("동문");
            if (rival)
            {
                ev.Title = $"선배 이벤트 · {supporterName}의 도발";
                ev.Text = $"{supporterName} 선배가 팔짱을 끼고 본다. \"그 정도 {statName}로 이기겠어? 더 해 봐.\"";
            }
            else if (alumni)
            {
                ev.Title = $"선배 이벤트 · 동문 {supporterName}";
                ev.Text = $"같은 구단 출신 {supporterName} 선배가 캠프에 들렀다. \"네 {statName}, 예전 내 폼이랑 똑같네. 하나만 고치자.\"";
            }
            else
            {
                ev.Title = $"선배 이벤트 · {supporterName}";
                ev.Text = $"{supporterName} 선배가 {statName} 폼을 봐주겠다고 한다.";
            }
            ev.Choices[0] = new EventChoice { Label = "배운다", OnSuccess = new EventEffect().Stat(stat, cfg.SeniorEventGain).WithHint(1).WithText("손목 각도 하나. 공 소리가 달라졌다.") };
            ev.Choices[1] = new EventChoice { Label = "지금 방식대로", OnSuccess = new EventEffect().Stat(stat, 1).Stat(StatKind.Mental, 1).WithText("\"…나중에 후회한다?\" 웃으며 공을 던져 준다.") };
            return ev;
        }

        public static TrainingEvent RandomStatBranch(StatKind stat, TrainingConfig cfg)
        {
            string n = TrainingText.StatName(stat);
            var ev = new TrainingEvent { Kind = EventKind.Random, Id = "rand-branch-" + stat, Title = $"{n} 응용 훈련" };
            ev.Text = $"코치가 {n} 응용 훈련을 제안한다. 지금 폼을 바꾸면 흔들릴 수도 있다.";
            ev.Choices[0] = new EventChoice
            {
                Label = "도전한다",
                SuccessRate = cfg.EventBranchSuccessP,
                OnSuccess = new EventEffect().Stat(stat, cfg.EventBranchGain).WithText("30분 만에 소리가 달라졌다."),
                OnFail = new EventEffect().WithCondition(-1).WithText("폼이 흔들린다. \"…원래대로 돌아갈게요.\""),
            };
            ev.Choices[1] = new EventChoice { Label = "기본기대로", OnSuccess = new EventEffect().Stat(stat, 1).WithText("\"제 방식이 있어요.\" 고집도 재능이다.") };
            return ev;
        }

        public static TrainingEvent RandomStat(StatKind stat, int v)
        {
            string n = TrainingText.StatName(stat);
            var ev = new TrainingEvent { Kind = EventKind.Random, Id = "rand-stat-" + stat, Title = $"{n}, 감이 왔다" };
            ev.Text = $"훈련 중 {n}에서 \"됐다\" 싶은 순간이 왔다. 오늘은 이걸 붙잡을까.";
            ev.Choices[0] = new EventChoice { Label = "집중한다", OnSuccess = new EventEffect().Stat(stat, v).WithText("공 100개를 더 때리고 나서야 체육관을 나왔다.") };
            ev.Choices[1] = new EventChoice { Label = "평소대로", OnSuccess = new EventEffect().Stat(StatKind.Mental, 1).WithText("\"내일도 될 거예요.\" 차분하다.") };
            return ev;
        }

        public static TrainingEvent RandomFatigue(int d)
        {
            var ev = new TrainingEvent { Kind = EventKind.Random, Id = "rand-fatigue" + d };
            if (d <= -15)
            {
                ev.Title = "구단 온천 휴가";
                ev.Text = "구단에서 하루 온천 휴가를 보내 줬다. 본인은 훈련장에 남고 싶어 한다.";
                ev.Choices[0] = new EventChoice { Label = "다녀오게 한다", OnSuccess = new EventEffect().WithFatigue(d).WithText("돌아온 얼굴이 하루 사이에 가벼워졌다.") };
                ev.Choices[1] = new EventChoice { Label = "남는 걸 허락한다", OnSuccess = new EventEffect().Stat(StatKind.Mental, 1).WithText("텅 빈 체육관에서 혼자 서브를 넣는다.") };
            }
            else if (d < 0)
            {
                ev.Title = "빗속의 러닝";
                ev.Text = "새벽부터 폭우. 예정된 외부 러닝을 강행할지 결정해야 한다.";
                ev.Choices[0] = new EventChoice { Label = "실내 스트레칭", OnSuccess = new EventEffect().WithFatigue(d).WithText("매트 위에서 조용한 오전. 몸이 가볍다.") };
                ev.Choices[1] = new EventChoice { Label = "강행한다", OnSuccess = new EventEffect().Stat(StatKind.Stamina, 1).WithFatigue(5).WithText("흠뻑 젖은 채 웃는다. \"이 정도는 괜찮아요.\"") };
            }
            else
            {
                ev.Title = "야간 자율 훈련";
                ev.Text = "훈련이 끝났는데 체육관 불이 켜져 있다. 혼자 공을 때리고 있다.";
                ev.Choices[0] = new EventChoice { Label = "같이 남는다", OnSuccess = new EventEffect().WithFatigue(d).WithText("'감독님, 토스 좀요!' 밤 10시까지 이어진 연습.") };
                ev.Choices[1] = new EventChoice { Label = "그만 쉬게 한다", OnSuccess = new EventEffect().WithFatigue(-10).Stat(StatKind.Mental, 1).WithText("'…네.' 아쉬운 얼굴로 공을 정리한다.") };
            }
            return ev;
        }

        public static TrainingEvent RandomCondition(int d)
        {
            var ev = new TrainingEvent { Kind = EventKind.Random, Id = "rand-cond" + d };
            if (d > 0)
            {
                ev.Title = "첫 팬레터";
                ev.Text = "구단 앞으로 첫 팬레터가 왔다. 답장을 어떻게 할까.";
                ev.Choices[0] = new EventChoice { Label = "구단이 대신", OnSuccess = new EventEffect().WithCondition(d).WithText("'…다음엔 제가 쓸게요.' 살짝 붉어진 얼굴.") };
                ev.Choices[1] = new EventChoice { Label = "직접 쓰게 한다", OnSuccess = new EventEffect().Stat(StatKind.Mental, 2).WithFatigue(5).WithText("세 번을 고쳐 쓰고 나서야 봉투를 닫았다.") };
            }
            else
            {
                ev.Title = "감기 기운";
                ev.Text = "아침부터 목이 잠겼다. 본인은 괜찮다는데.";
                ev.Choices[0] = new EventChoice { Label = "약 먹고 버틴다", OnSuccess = new EventEffect().WithCondition(d).WithText("훈련은 했지만 하루 종일 멍한 얼굴.") };
                ev.Choices[1] = new EventChoice { Label = "병원에 보낸다", OnSuccess = new EventEffect().WithFatigue(5).WithText("주사 한 대. 저녁엔 목소리가 돌아왔다.") };
            }
            return ev;
        }

        private static readonly string[][] Flavor =
        {
            new[] { "서브 100개. 라인 안에 꽂힌다.", "토스 없이 혼자 서브 반복.", "배짱 서브 연습. 실패해도 웃는다." },
            new[] { "낮은 자세로 공을 받아낸다.", "긴 랠리 수비 훈련. 무릎이 검게 됐다.", "코트 바닥과 친해지는 하루." },
            new[] { "판단력 훈련. 눈이 빨라졌다.", "잔발 스텝 반복.", "세터 코치와 1:1 토스." },
            new[] { "점프, 점프, 또 점프.", "오픈 강타 100개.", "타점이 조금 올라갔다." },
            new[] { "손끝 반응 훈련.", "네트 앞 사이드스텝 반복.", "블로킹 타이밍이 몸에 붙는다." },
            new[] { "휴식. 아이스팩과 낮잠.", "휴식. 숙소에서 만화책.", "휴식. 산책과 이른 취침." },
            new[] { "특훈! 코치가 열의를 알아봤다.", "특훈. 오늘은 쓰러질 때까지.", "특훈. 프로 선배의 메뉴 그대로." },
            new[] { "치료. 트레이너실에서 하루.", "치료. 얼음찜질과 재활.", "치료. 붕대를 감은 채 관전." },
        };

        public static string FlavorOf(TrainingAction a, int turn)
        {
            int idx = (int)a;
            if (idx < 0 || idx >= Flavor.Length) return "";
            var pool = Flavor[idx];
            return pool[(turn * 7 + idx * 3) % pool.Length];
        }
    }
}
