using VolleySim.Domain;

namespace VolleySim.Skills
{
    /// <summary>스킬 훅이 호출되는 판정 지점.</summary>
    public enum SkillTrigger
    {
        ServeError,
        ServeAce,
        Receive,
        Set,
        AttackError,
        AttackKill,
        BlockKill,
        Dig,
    }

    /// <summary>
    /// 개인 특기 스킬 효과 훅. 프로토타입에서는 구현체가 없고(null) 판정에 반영되지 않는다.
    /// 추후 "타임서브 성공 시 다음 랠리 리시브 확률 +" 같은 트리거형 효과를 이 인터페이스로 붙인다.
    /// 반환값은 해당 판정 로짓에 가산된다(양수 = 행위자에게 유리).
    /// </summary>
    public interface ISkillEffectProvider
    {
        double AdjustLogit(SkillTrigger trigger, Player actor, Player opponent, int setIndex, int homeScore, int awayScore, bool clutch);
    }
}
