// 경기 시뮬 상수 전부. SimConfig.cs 의 값을 그대로 옮긴 것(값 변경 금지).
// 확률 상수는 "동급 대결(diff=0)" 기준 확률, k 는 로짓 1 을 움직이는 스탯 차이.

/** SimConfig.cs:34 CreateDefault */
export function createSimConfig() {
  return {
    // SimConfig.cs:38 MatchRules
    match: {
      setsToWin: 3,
      pointsToWinSet: 25,
      pointsToWinFinalSet: 15,
      minPointMargin: 2,
      maxSubstitutionsPerSet: 6,
      maxAttacksPerRally: 14,
      maxRalliesPerSet: 400,
      homeServesFirst: true,
      homeCourtLogit: 0.0,
    },
    // SimConfig.cs:56 RatingWeights
    rating: {
      serveFromServe: 0.75, serveFromPower: 0.25,
      receiveFromReceive: 0.80, receiveFromSpeed: 0.20,
      setFromSet: 0.85, setFromSpeed: 0.15,
      attackFromSpike: 0.65, attackFromPower: 0.25, attackFromSpeed: 0.10,
      attackHeightPerCm: 0.15, attackHeightCap: 4.0,
      blockFromBlock: 0.80, blockFromSpeed: 0.20,
      blockHeightPerCm: 0.6, blockHeightCap: 8.0,
      digFromDig: 0.75, digFromSpeed: 0.25,
      heightPivotCm: 176.0,
      effectiveMultiplierMin: 0.6, effectiveMultiplierMax: 1.4,
    },
    // SimConfig.cs:88 ServeParams
    serve: {
      errorBaseSafe: 0.05, errorBaseAggressive: 0.15,
      errorRefRating: 65.0, errorK: 70.0,
      aggressionLogit: 0.75,
      aceBase: 0.085, receiveK: 60.0,
      targetingBias: 0.6, targetingRefRating: 68.0,
    },
    // SimConfig.cs:106 ReceiveParams
    receive: {
      perfectBase: 0.34, goodBase: 0.60,
      weightLibero: 1.6,
      weightOhBack: 1.0, weightOhFrontLeft: 0.8, weightOhFrontRight: 0.5,
      weightOpBack: 0.45, weightOpFront: 0.2,
      weightMbBack: 0.35, weightMbFront: 0.0,
      weightSetterBack: 0.12, weightSetterFront: 0.03,
      freeBallPerfectProb: 0.80,
      // [v0.2 포지션 가치 보정] SimConfig.cs:132
      liberoRoleGain: 2.0, liberoRoleRefRating: 80.0,
    },
    // SimConfig.cs:137 SetParams
    set: {
      perfectFromPerfectPass: 0.70,
      perfectFromGoodPass: 0.35,
      goodFromGoodPass: 0.70,
      goodFromPoorPass: 0.45,
      refRating: 70.0, k: 40.0,
      nonSetterPenaltyLogit: -0.7,
      setterDumpProb: 0.03,
      freeBallFromPoorPass: 0.18,
    },
    // SimConfig.cs:154 AttackParams
    attack: {
      errorBase: 0.075, errorRefRating: 70.0, errorK: 120.0,
      killBase: 0.41, killK: 120.0,
      digTeamBlend: 0.20,
      blockShareInKill: 0.35,
      firstBallKillLogit: 0.35,
      quickKillLogit: 0.30, quickErrorMult: 1.0,
      openKillLogit: 0.0, openErrorMult: 1.0,
      backRowKillLogit: -0.10, backRowErrorMult: 1.2,
      delayedKillLogit: 0.25, delayedErrorMult: 1.1,
      dumpKillLogit: 0.10, dumpErrorMult: 0.8,
      perfectSetKillLogit: 0.45, perfectSetErrorMult: 0.9,
      poorSetKillLogit: -0.70, poorSetErrorMult: 1.5,
      quickAvailGoodPass: 0.8,
      delayedAvailGoodPass: 0.4,
      backRowAvailPoorPass: 0.4,
      openOpRelativeWeight: 0.8,
      transitionKillLogitPerAttack: 0.05,
      predictabilityLogit: 0.4, predictabilityFreeShare: 0.45,
      // [v0.2 디코이] SimConfig.cs:210
      mbDecoyK: 100.0, mbDecoyMaxLogit: 0.35,
      mbDecoyBlockShare: 1.0, mbDecoyKillShare: 0.5,
      mbDecoyFullQuickShare: 0.15,
    },
    // SimConfig.cs:219 BlockParams
    block: {
      killBase: 0.115, k: 120.0,
      extraBlockerBonus: 8.0,
      touchBase: 0.22, touchOutRatio: 0.30, touchBackRatio: 0.30,
      touchSlowDigLogit: 0.6,
      coverBase: 0.75, coverGoodQualityProb: 0.35,
      quickBlockLogit: -0.15, backRowBlockLogit: -0.35, delayedBlockLogit: -0.10,
      dumpBlockLogit: -0.4, poorSetBlockLogit: 0.40, perfectSetBlockLogit: -0.30,
      joinOpen: 0.80, joinBackRow: 0.60, joinQuick: 0.25, joinDelayed: 0.30,
      joinDump: 0.15, joinThirdPoorSet: 0.35,
      joinSpeedRef: 65.0, joinK: 60.0,
      // [v0.2 MB 가중] SimConfig.cs:260
      mbStrengthWeight: 1.8,
    },
    // SimConfig.cs:263 DigParams
    dig: {
      perfectBase: 0.22, goodBase: 0.55, k: 120.0,
      weightLibero: 2.4, weightOh: 1.0, weightOp: 0.8, weightMb: 0.6, weightSetter: 0.5,
      // [v0.2 리베로 스트레치] SimConfig.cs:281
      liberoRoleGain: 2.0, liberoRoleRefRating: 80.0,
    },
    // SimConfig.cs:285 FatigueParams
    fatigue: { lossPerSet: 0.03, pointsPerSetForProgress: 46.0, maxLoss: 0.30 },
    // SimConfig.cs:294 ClutchParams
    clutch: { scoreFromEnd: 5, maxDiff: 2, mentalScale: 0.15, mentalPivot: 60.0 },
    // 흐름 모델(docs/match-sim.md 흐름 절) — 기본은 꺼짐: parity·기본 sim 은 기존 판정과 비트 단위로 같다. 게임 층(game.js·season.js)이 켠다.
    //   연속 득점을 당하는 쪽은 범실 로짓이 오르고(멘탈이 덜어 준다), 내는 쪽은 킬 로짓이 조금 오른다.
    //   AI 감독은 상대 N연속에 작전타임(세트당 2회)을 불러 연속을 끊고, 세트를 뒤진 팀은 다음 세트 서브를 더 세게 넣는다.
    flow: {
      enabled: false,
      streakStart: 3, pressurePerPoint: 0.06, pressureMax: 0.20, mentalRelief: 0.5,
      confidenceShare: 0.5,
      timeoutsPerSet: 2, timeoutAtStreak: 3,
      adjustTrailing: 0.10, adjustLeading: -0.05,
    },
    // SimConfig.cs:304 ChemistryParams
    chemistry: { logitScale: 0.50 },
    // SimConfig.cs:310 FormationParams
    formation: {
      liberoCenteredLiberoMult: 1.7, liberoCenteredOhMult: 0.8,
      liberoCenteredLiberoLogit: 0.05, liberoCenteredOtherLogit: -0.05,
      spreadLiberoMult: 0.7, spreadOhMult: 1.2,
      spreadLiberoLogit: 0.0, spreadOtherLogit: 0.0,
    },
    // 선수 고유 스킬(docs/skills.md). C# 에는 아직 없는 JS 선행 구현 — 이식 명세는 skills.md 8절.
    // enabled=false 또는 활성 스킬 0명이면 판정에 아무 영향이 없다(로짓 가산 0).
    skill: {
      enabled: true,
      levelScale: [0.0, 1.0, 1.5, 2.0], // 인덱스 = 스킬 레벨(0 = 미해금)
      channelCap: 1.50,                 // 채널 1개에 실릴 수 있는 팀 합계 로짓 상한(±)
      globalScale: 1.0,                 // 스킬 전체 세기 노브(StatSensitivity 와 같은 역할)
      // 스킬 중첩 감쇠: 코트 위 스킬 보유자 n 명이면 개별 효과 × 1/(1 + falloff×(n−1)).
      // n=1 이면 1.0 → 스킬 1개 단독 캘리브레이션은 그대로. docs/skills.md 6.3
      stackFalloff: 0.06,
    },
    // SimConfig.cs:29 전역 스탯 민감도
    statSensitivity: 1.0,
  };
}

/** 기본 설정 1개를 공유(경기마다 새로 만들지 않아 할당을 줄인다). 수정 금지. */
export const DEFAULT_SIM_CONFIG = createSimConfig();
