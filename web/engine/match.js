// 랠리 판정 체인 + 세트/경기 진행. Engine/MatchContext.cs · RallyEngine.cs · SetEngine.cs · MatchEngine.cs 포팅.
// 성능: 랠리마다 새 객체를 만들지 않도록 스크래치 버퍼를 재사용하고, 이벤트는 log.enabled 일 때만 생성한다.

import {
  POS, STAT, SIDE, EV, Q, OUT, ATK, REASON, FORMATION,
  TeamMatchState, isFrontRow, chemistryOf, conditionOf,
} from './domain.js';
import { ratingServe, ratingReceive, ratingSet, ratingAttack, ratingBlock, ratingDig } from './ratings.js';
import { contest, sigmoid, logit, lerp, clamp } from './mathx.js';
import { DEFAULT_SIM_CONFIG } from './config.js';
import { createSkillRuntime } from './skills.js';
import { Rng } from './rng.js';

// ---------------------------------------------------------------- 로그
class MatchLog {
  constructor(enabled) { this.enabled = enabled; this.events = []; this.seq = 0; }
  add(type, set, rally, side, homeScore, awayScore) {
    this.seq++;
    if (!this.enabled) return null;
    const e = {
      seq: this.seq, set, rally, type, side,
      playerId: null, courtPosition: 0,
      quality: Q.None, outcome: OUT.None, attackType: ATK.None,
      secondary: null, homeScore, awayScore, value: 0, reason: REASON.None,
      probability: 0, clutch: false,
    };
    this.events.push(e);
    return e;
  }
}

function newBox(p) {
  return {
    playerId: p.id, name: p.name, positionCode: ['S', 'OH', 'OP', 'MB', 'L'][p.pos],
    serves: 0, aces: 0, serveErrors: 0,
    receptions: 0, receptionPerfect: 0, receptionGood: 0, receptionPoor: 0, receptionErrors: 0,
    sets: 0, assists: 0,
    attacks: 0, kills: 0, attackErrors: 0, blocked: 0,
    blockKills: 0, blockAssists: 0, blockTouches: 0,
    digAttempts: 0, digs: 0,
  };
}

// ---------------------------------------------------------------- 경기 컨텍스트 + 랠리 엔진
class MatchSim {
  constructor(config, rng, log, home, away, boxScores, skills) {
    this.cfg = config;
    // 고유 스킬 런타임. null 이면 모든 스킬 훅을 건너뛴다 → 기존 판정과 비트 단위로 동일.
    this.sk = skills || null;
    this.rng = rng;
    this.log = log;
    this.home = home;
    this.away = away;
    this.box = boxScores;
    this.setIndex = 0;
    this.rallyIndex = 0;
    this.pointsToWin = 25;
    this.sens = config.statSensitivity > 0 ? config.statSensitivity : 1e-9;

    // 스크래치 버퍼(할당 억제) — RallyEngine.cs:29
    this._w = new Float64Array(16);
    this._cand = new Array(16);
    this._candType = new Int32Array(16);
    this._candN = 0;
    this._blockers = [null, null, null];
    this._blockerPos = [0, 0, 0];
    this._blockN = 0;
    this._quickThreatMb = null;
    // 랠리 결과(재사용)
    this._res = { winner: 0, reason: 0, clutch: false, attacks: 0 };
    // 시퀀스 결과(재사용) — kind: 0 PointAttacking, 1 PointDefending, 2 Continue, 3 CoverContinue
    this._seq = { kind: 0, reason: 0, nextQuality: 0, nextFirstContact: null };
  }

  /** 전역 민감도가 적용된 실효 k. RallyEngine.cs:56 */
  K(k) { return k / this.sens; }

  /** 역할 게인: 기준 레이팅 중심으로 편차를 gain 배. RallyEngine.cs:59 Stretch */
  static stretch(rating, gain, ref_) { return ref_ + gain * (rating - ref_); }

  /** MatchContext.cs:44 IsClutch */
  isClutch() {
    const c = this.cfg.clutch;
    const threshold = this.pointsToWin - c.scoreFromEnd;
    if (this.home.score < threshold || this.away.score < threshold) return false;
    let diff = this.home.score - this.away.score;
    if (diff < 0) diff = -diff;
    return diff <= c.maxDiff;
  }

  /**
   * 실효 배수 = 팀 컨디션 × 개인 컨디션 × 피로 × 클러치(멘탈). MatchContext.cs:57
   * noFatigue = true 면 피로 감소를 면제한다(스킬 '모루 위에서'). docs/skills.md 4.7
   */
  effMult(p, team, clutch, noFatigue) {
    const st = team.state;
    let m = st.teamCondition * conditionOf(st, p.id);
    const f = this.cfg.fatigue;
    if (noFatigue !== true) {
      const progress = (this.setIndex - 1) + clamp((this.home.score + this.away.score) / f.pointsPerSetForProgress, 0.0, 1.0);
      let loss = f.lossPerSet * progress * (1.0 - p.stats[STAT.stamina] / 100.0);
      if (loss > f.maxLoss) loss = f.maxLoss;
      else if (loss < 0) loss = 0;
      m *= 1.0 - loss;
    }
    if (clutch) {
      const c = this.cfg.clutch;
      m *= 1.0 + c.mentalScale * (p.stats[STAT.mental] - c.mentalPivot) / 50.0;
    }
    const r = this.cfg.rating;
    return m < r.effectiveMultiplierMin ? r.effectiveMultiplierMin : (m > r.effectiveMultiplierMax ? r.effectiveMultiplierMax : m);
  }

  eff(raw, p, team, clutch, noFatigue) { return raw * this.effMult(p, team, clutch, noFatigue); }

  boxOf(p) {
    let b = this.box.get(p.id);
    if (b === undefined) { b = newBox(p); this.box.set(p.id, b); }
    return b;
  }

  team(side) { return side === SIDE.HOME ? this.home : this.away; }
  opponent(t) { return t === this.home ? this.away : this.home; }

  emit(type, team, actor, position, quality, outcome, attackType, probability, value, clutch) {
    const e = this.log.add(type, this.setIndex, this.rallyIndex, team.side, this.home.score, this.away.score);
    if (e === null) return null;
    e.playerId = actor ? actor.id : null;
    e.courtPosition = position | 0;
    e.quality = quality | 0;
    e.outcome = outcome | 0;
    e.attackType = attackType | 0;
    e.probability = probability || 0;
    e.value = value | 0;
    e.clutch = !!clutch;
    return e;
  }

  // ---------------------------------------------------------------- 랠리
  /** RallyEngine.cs:61 PlayRally */
  playRally(serving, receiving) {
    const cfg = this.cfg, rng = this.rng, sk = this.sk;
    const clutch = this.isClutch();
    if (sk !== null) sk.beginRally();
    const res = this._res;
    res.clutch = clutch;
    res.attacks = 0;

    serving.stats.serveRallies++;
    receiving.stats.receiveRallies++;
    if (clutch) { serving.stats.clutchRallies++; receiving.stats.clutchRallies++; }

    if (this.log.enabled) this.emit(EV.RallyStart, serving, serving.playerAt(1), 1, Q.None, OUT.None, ATK.None, 0, serving.rotationIndex, clutch);

    // ---------------- 1. 서브 ----------------
    const server = serving.playerAt(1);
    const aggression = clamp(serving.tactics.serveAggression, 0.0, 1.0);
    const serveRating = this.eff(ratingServe(server, cfg.rating), server, serving, clutch);
    const sp = cfg.serve;
    const errBase = lerp(sp.errorBaseSafe, sp.errorBaseAggressive, aggression);
    const homeLogit = serving.side === SIDE.HOME ? cfg.match.homeCourtLogit : 0.0;
    const skServeErr = sk !== null ? sk.serveErrorLogit(serving, server, aggression) : 0.0;
    const pServeErr = contest(errBase, -(serveRating - sp.errorRefRating), this.K(sp.errorK), -homeLogit + skServeErr);

    const serverBox = this.boxOf(server);
    serverBox.serves++;
    serving.stats.serves++;

    if (rng.chance(pServeErr)) {
      serverBox.serveErrors++;
      serving.stats.serveErrors++;
      if (this.log.enabled) this.emit(EV.Serve, serving, server, 1, Q.Error, OUT.Error, ATK.None, pServeErr, 0, clutch);
      res.winner = receiving.side;
      res.reason = REASON.ServeError;
      return res;
    }

    // ---------------- 2. 리시브 ----------------
    const receiverPos = this.chooseReceiver(receiving, aggression);
    const receiver = receiving.playerAt(receiverPos);
    let recvRating = this.eff(ratingReceive(receiver, cfg.rating), receiver, receiving, clutch);
    if (receiver.isLibero) recvRating = MatchSim.stretch(recvRating, cfg.receive.liberoRoleGain, cfg.receive.liberoRoleRefRating);
    const formationLogit = this.formationLogit(receiving, receiver);
    const skRecv = sk !== null ? sk.receiveXLogit(receiving, receiver, serving) : 0.0;
    const x = (recvRating - serveRating) / this.K(sp.receiveK) - sp.aggressionLogit * (aggression - 0.5) + formationLogit + skRecv;
    const skAce = sk !== null ? sk.aceLogit(serving, server) : 0.0;
    const pAce = sigmoid(logit(sp.aceBase) - x + homeLogit + skAce);

    if (this.log.enabled) this.emit(EV.Serve, serving, server, 1, Q.None, OUT.InPlay, ATK.None, pAce, (aggression * 100) | 0, clutch);

    const recvBox = this.boxOf(receiver);
    recvBox.receptions++;
    receiving.stats.receptions++;

    if (rng.chance(pAce)) {
      serverBox.aces++;
      serving.stats.aces++;
      recvBox.receptionErrors++;
      receiving.stats.receptionErrors++;
      if (this.log.enabled) this.emit(EV.Reception, receiving, receiver, receiverPos, Q.Error, OUT.Ace, ATK.None, pAce, 0, clutch);
      res.winner = serving.side;
      res.reason = REASON.Ace;
      return res;
    }

    const passQuality = this.rollQuality(x, cfg.receive.perfectBase, cfg.receive.goodBase);
    if (passQuality === Q.Perfect) { recvBox.receptionPerfect++; receiving.stats.receptionPerfect++; }
    else if (passQuality === Q.Good) { recvBox.receptionGood++; receiving.stats.receptionGood++; }
    else { recvBox.receptionPoor++; receiving.stats.receptionPoor++; }
    if (this.log.enabled) this.emit(EV.Reception, receiving, receiver, receiverPos, passQuality, OUT.InPlay, ATK.None, pAce, 0, clutch);
    if (sk !== null) sk.noteReceive(receiving, receiver, passQuality, aggression);

    // ---------------- 3. 공격 시퀀스(트랜지션 반복) ----------------
    let attacking = receiving, defending = serving;
    let ballQuality = passQuality;
    let firstContact = receiver;
    const maxAttacks = cfg.match.maxAttacksPerRally;

    for (let n = 0; n < maxAttacks; n++) {
      const seq = this.runAttackSequence(attacking, defending, ballQuality, firstContact, n, clutch);
      res.attacks = n + 1;
      if (seq.kind === 0) { res.winner = attacking.side; res.reason = seq.reason; return res; }
      if (seq.kind === 1) { res.winner = defending.side; res.reason = seq.reason; return res; }
      if (seq.kind === 3) { // CoverContinue: 공수 그대로
        ballQuality = seq.nextQuality;
        firstContact = seq.nextFirstContact;
      } else {                // Continue: 공수 교대
        const t = attacking; attacking = defending; defending = t;
        ballQuality = seq.nextQuality;
        firstContact = seq.nextFirstContact;
      }
    }
    // 안전장치. RallyEngine.cs:168
    res.winner = defending.side;
    res.reason = REASON.RallyCap;
    return res;
  }

  /** 세트 → 공격 옵션 → 블로킹 → 킬/디그. RallyEngine.cs:176 RunAttackSequence */
  runAttackSequence(attacking, defending, pass, firstContact, attackIndex, clutch) {
    const cfg = this.cfg, rng = this.rng, seq = this._seq, sk = this.sk;
    const ap = cfg.attack, bp = cfg.block, setp = cfg.set;
    const homeLogit = attacking.side === SIDE.HOME ? cfg.match.homeCourtLogit : 0.0;
    const logging = this.log.enabled;

    // --- 프리볼(Poor 패스) ---
    if (pass === Q.Poor && rng.chance(setp.freeBallFromPoorPass)) {
      const sender = firstContact || attacking.setter;
      attacking.stats.freeBalls++;
      if (logging) this.emit(EV.FreeBall, attacking, sender, attacking.positionOf(sender), Q.None, OUT.InPlay, ATK.FreeBall, setp.freeBallFromPoorPass, 0, clutch);
      const fbPos = this.chooseFreeBallReceiver(defending);
      const fbReceiver = defending.playerAt(fbPos);
      const fq = rng.chance(cfg.receive.freeBallPerfectProb) ? Q.Perfect : Q.Good;
      const rb = this.boxOf(fbReceiver);
      rb.digAttempts++; rb.digs++;
      defending.stats.digAttempts++; defending.stats.digs++;
      if (logging) this.emit(EV.Dig, defending, fbReceiver, fbPos, fq, OUT.InPlay, ATK.FreeBall, cfg.receive.freeBallPerfectProb, 0, clutch);
      seq.kind = 2; seq.nextQuality = fq; seq.nextFirstContact = fbReceiver;
      return seq;
    }

    // --- 세터 결정 ---
    let setter = attacking.setter;
    const nonSetter = (setter === null || setter === firstContact);
    if (nonSetter) setter = this.chooseAlternativeSetter(attacking, firstContact);
    const setterPos = attacking.positionOf(setter);
    const setterFront = isFrontRow(setterPos);

    // --- 공격 옵션 선택 ---
    let type, attacker, predictLogit = 0.0;
    if (!nonSetter && setterFront && pass === Q.Perfect && rng.chance(setp.setterDumpProb)) {
      type = ATK.Dump;
      attacker = setter;
    } else {
      const idx = this.chooseAttackOption(attacking, setter, pass);
      attacker = this._cand[idx];
      type = this._candType[idx];
      predictLogit = this.predictabilityPenalty(attacking.tactics, type);
    }
    const attackPos = attacking.positionOf(attacker);

    // --- 속공 위협(디코이). RallyEngine.cs:218 ---
    let decoyLogit = 0.0;
    if (this._quickThreatMb !== null && type !== ATK.Quick && type !== ATK.Dump && ap.mbDecoyK > 0) {
      const mb = this._quickThreatMb;
      const mbAtk = this.eff(ratingAttack(mb, cfg.rating), mb, attacking, clutch);
      decoyLogit = clamp((mbAtk - ap.errorRefRating) / this.K(ap.mbDecoyK), -ap.mbDecoyMaxLogit, ap.mbDecoyMaxLogit);
      decoyLogit *= quickShareFactor(attacking.tactics, ap.mbDecoyFullQuickShare);
    }

    // --- 세트 품질 ---
    const setRating = this.eff(ratingSet(setter, cfg.rating), setter, attacking, clutch);
    const chem = chemistryOf(attacking.state, setter.id, attacker.id);
    const chemLogit = cfg.chemistry.logitScale * (chem - 50.0) / 50.0;
    const skSet = sk !== null ? sk.setLogit(attacking, setter, attacker, type, pass, nonSetter, attackIndex) : 0.0;
    const setX = (setRating - setp.refRating) / this.K(setp.k) + chemLogit + (nonSetter ? setp.nonSetterPenaltyLogit : 0.0) + skSet;
    let setQuality = this.rollSetQuality(pass, setX);
    if (type === ATK.Dump) setQuality = Q.Perfect;

    const setterBox = this.boxOf(setter);
    if (type !== ATK.Dump) setterBox.sets++;
    if (logging) this.emit(EV.Set, attacking, setter, setterPos, setQuality, OUT.InPlay, type, sigmoid(setX), attackPos, clutch);

    // --- 블로커 결정 ---
    this.chooseBlockers(defending, type, attackPos, setQuality, clutch);
    if (sk !== null) sk.noteBlockers(this._blockN, this._blockers);

    // --- 공격 레이팅·범실 ---
    const atk = this.eff(ratingAttack(attacker, cfg.rating), attacker, attacking, clutch);
    let typeKillLogit, typeErrMult, typeBlockLogit;
    switch (type) {
      case ATK.Quick: typeKillLogit = ap.quickKillLogit; typeErrMult = ap.quickErrorMult; typeBlockLogit = bp.quickBlockLogit; break;
      case ATK.BackRow: typeKillLogit = ap.backRowKillLogit; typeErrMult = ap.backRowErrorMult; typeBlockLogit = bp.backRowBlockLogit; break;
      case ATK.Delayed: typeKillLogit = ap.delayedKillLogit; typeErrMult = ap.delayedErrorMult; typeBlockLogit = bp.delayedBlockLogit; break;
      case ATK.Dump: typeKillLogit = ap.dumpKillLogit; typeErrMult = ap.dumpErrorMult; typeBlockLogit = bp.dumpBlockLogit; break;
      default: typeKillLogit = ap.openKillLogit; typeErrMult = ap.openErrorMult; typeBlockLogit = 0.0; break;
    }
    let setKillLogit = 0, setErrMult = 1, setBlockLogit = 0;
    if (setQuality === Q.Perfect) { setKillLogit = ap.perfectSetKillLogit; setErrMult = ap.perfectSetErrorMult; setBlockLogit = bp.perfectSetBlockLogit; }
    else if (setQuality === Q.Poor) { setKillLogit = ap.poorSetKillLogit; setErrMult = ap.poorSetErrorMult; setBlockLogit = bp.poorSetBlockLogit; }

    const atkBox = this.boxOf(attacker);
    atkBox.attacks++;
    attacking.stats.attacks++;
    attacking.stats.attacksByType[type]++;
    if (attackIndex === 0) attacking.stats.firstBallAttacks++; else attacking.stats.transitionAttacks++;
    if (type === ATK.Dump) attacking.stats.dumps++;

    const skAtkErr = sk !== null ? sk.attackErrorLogit(attacking, attacker) : 0.0;
    const pErr = contest(clamp(ap.errorBase * typeErrMult * setErrMult, 0.0, 0.95), -(atk - ap.errorRefRating), this.K(ap.errorK), -homeLogit + skAtkErr);
    if (rng.chance(pErr)) {
      atkBox.attackErrors++;
      attacking.stats.attackErrors++;
      if (logging) this.emit(EV.Attack, attacking, attacker, attackPos, setQuality, OUT.Error, type, pErr, this._blockN, clutch);
      seq.kind = 1; seq.reason = REASON.AttackError;
      return seq;
    }

    // --- 블로킹 ---
    let digBonus = 0.0;
    if (this._blockN > 0) {
      const blockStrength = this.weightedBlockRating(defending, clutch) + bp.extraBlockerBonus * (this._blockN - 2);
      const primary = this._blockers[0];
      const skBlock = sk !== null ? sk.blockLogit(defending, attacking, attacker) : 0.0;
      const blockExtra = typeBlockLogit + setBlockLogit - homeLogit + predictLogit - decoyLogit * ap.mbDecoyBlockShare + skBlock;
      const pBlock = contest(bp.killBase, blockStrength - atk, this.K(bp.k), blockExtra);
      if (rng.chance(pBlock)) {
        atkBox.blocked++;
        attacking.stats.blocked++;
        this.creditBlock(defending, primary);
        if (logging) {
          this.emit(EV.Attack, attacking, attacker, attackPos, setQuality, OUT.BlockKill, type, pBlock, this._blockN, clutch);
          this.emitBlockEvent(defending, OUT.BlockKill, pBlock, clutch);
        }
        seq.kind = 1; seq.reason = REASON.BlockKill;
        return seq;
      }
      const pTouch = contest(bp.touchBase, blockStrength - atk, this.K(bp.k), blockExtra);
      if (rng.chance(pTouch)) {
        this.boxOf(primary).blockTouches++;
        defending.stats.blockTouches++;
        const r = rng.nextDouble();
        if (r < bp.touchOutRatio) {
          // 블록 아웃: 공격팀 득점(킬로 집계)
          atkBox.kills++;
          attacking.stats.kills++;
          attacking.stats.killsByType[type]++;
          attacking.stats.blockOuts++;
          if (attackIndex === 0) attacking.stats.firstBallKills++;
          if (type !== ATK.Dump) setterBox.assists++;
          if (logging) {
            this.emitBlockEvent(defending, OUT.BlockTouch, pTouch, clutch);
            this.emit(EV.Attack, attacking, attacker, attackPos, setQuality, OUT.BlockOut, type, pTouch, this._blockN, clutch);
          }
          seq.kind = 0; seq.reason = REASON.BlockOut;
          return seq;
        }
        if (r < bp.touchOutRatio + bp.touchBackRatio) {
          // 공격팀 코트로 되돌아옴 → 커버
          if (logging) {
            this.emitBlockEvent(defending, OUT.BlockTouch, pTouch, clutch);
            this.emit(EV.Attack, attacking, attacker, attackPos, setQuality, OUT.BlockTouch, type, pTouch, this._blockN, clutch);
          }
          const coverPos = this.chooseCoverer(attacking, attacker);
          const coverer = attacking.playerAt(coverPos);
          let coverDig = this.eff(ratingDig(coverer, cfg.rating), coverer, attacking, clutch);
          if (coverer.isLibero) coverDig = MatchSim.stretch(coverDig, cfg.dig.liberoRoleGain, cfg.dig.liberoRoleRefRating);
          const pCover = contest(bp.coverBase, coverDig - ap.errorRefRating, this.K(cfg.dig.k), 0);
          const cb = this.boxOf(coverer);
          cb.digAttempts++;
          attacking.stats.digAttempts++;
          if (rng.chance(pCover)) {
            cb.digs++;
            attacking.stats.digs++;
            const cq = rng.chance(bp.coverGoodQualityProb) ? Q.Good : Q.Poor;
            if (logging) this.emit(EV.Cover, attacking, coverer, coverPos, cq, OUT.Covered, type, pCover, 0, clutch);
            seq.kind = 3; seq.nextQuality = cq; seq.nextFirstContact = coverer;
            return seq;
          }
          // 커버 실패 = 블로킹 득점
          atkBox.blocked++;
          attacking.stats.blocked++;
          this.creditBlock(defending, primary);
          if (logging) this.emit(EV.Cover, attacking, coverer, coverPos, Q.Error, OUT.Error, type, pCover, 0, clutch);
          seq.kind = 1; seq.reason = REASON.BlockKill;
          return seq;
        }
        // 느려진 공: 수비팀 디그 유리
        digBonus = bp.touchSlowDigLogit;
        if (logging) this.emitBlockEvent(defending, OUT.BlockTouch, pTouch, clutch);
      }
    }

    // --- 킬 vs 디그 ---
    const diggerPos = this.chooseDigger(defending);
    const digger = defending.playerAt(diggerPos);
    let digRating = this.eff(ratingDig(digger, cfg.rating), digger, defending, clutch);
    if (digger.isLibero) digRating = MatchSim.stretch(digRating, cfg.dig.liberoRoleGain, cfg.dig.liberoRoleRefRating);
    const teamDig = this.averageNonBlockerDig(defending, clutch);
    const digBlend = (1.0 - ap.digTeamBlend) * digRating + ap.digTeamBlend * teamDig;
    const defense = this._blockN > 0
      ? (1.0 - ap.blockShareInKill) * digBlend + ap.blockShareInKill * this.weightedBlockRating(defending, clutch)
      : digBlend;
    const skDig = sk !== null ? sk.digLogit(defending, digger) : 0.0;
    const skKill = sk !== null ? sk.attackKillLogit(attacking, attacker) : 0.0;
    const killExtra = typeKillLogit + setKillLogit - digBonus + homeLogit - predictLogit
      + decoyLogit * ap.mbDecoyKillShare
      + (attackIndex === 0 ? ap.firstBallKillLogit : ap.transitionKillLogitPerAttack * attackIndex)
      + skKill - skDig;
    const pKill = contest(ap.killBase, atk - defense, this.K(ap.killK), killExtra);

    const digBox = this.boxOf(digger);
    digBox.digAttempts++;
    defending.stats.digAttempts++;

    if (rng.chance(pKill)) {
      atkBox.kills++;
      attacking.stats.kills++;
      attacking.stats.killsByType[type]++;
      if (attackIndex === 0) attacking.stats.firstBallKills++;
      if (type !== ATK.Dump) setterBox.assists++;
      if (logging) {
        this.emit(EV.Attack, attacking, attacker, attackPos, setQuality, OUT.Kill, type, pKill, this._blockN, clutch);
        this.emit(EV.Dig, defending, digger, diggerPos, Q.Error, OUT.Error, type, pKill, 0, clutch);
      }
      seq.kind = 0; seq.reason = REASON.Kill;
      return seq;
    }

    digBox.digs++;
    defending.stats.digs++;
    const dx = (digRating - atk) / this.K(cfg.dig.k) + digBonus + skDig;
    const dq = this.rollQuality(dx, cfg.dig.perfectBase, cfg.dig.goodBase);
    if (logging) {
      this.emit(EV.Attack, attacking, attacker, attackPos, setQuality, OUT.Dug, type, pKill, this._blockN, clutch);
      this.emit(EV.Dig, defending, digger, diggerPos, dq, OUT.InPlay, type, 1.0 - pKill, 0, clutch);
    }
    seq.kind = 2; seq.nextQuality = dq; seq.nextFirstContact = digger;
    return seq;
  }

  // ---------------------------------------------------------------- 품질 판정
  /** RallyEngine.cs:397 RollQuality */
  rollQuality(x, perfectBase, goodBase) {
    if (this.rng.chance(sigmoid(logit(perfectBase) + x))) return Q.Perfect;
    if (this.rng.chance(sigmoid(logit(goodBase) + x))) return Q.Good;
    return Q.Poor;
  }

  /** RallyEngine.cs:406 RollSetQuality */
  rollSetQuality(pass, x) {
    const s = this.cfg.set;
    if (pass === Q.Perfect) return this.rng.chance(sigmoid(logit(s.perfectFromPerfectPass) + x)) ? Q.Perfect : Q.Good;
    if (pass === Q.Good) {
      if (this.rng.chance(sigmoid(logit(s.perfectFromGoodPass) + x))) return Q.Perfect;
      return this.rng.chance(sigmoid(logit(s.goodFromGoodPass) + x)) ? Q.Good : Q.Poor;
    }
    return this.rng.chance(sigmoid(logit(s.goodFromPoorPass) + x)) ? Q.Good : Q.Poor;
  }

  // ---------------------------------------------------------------- 선수 선택
  /** RallyEngine.cs:437 FormationLogit */
  formationLogit(team, receiver) {
    const f = this.cfg.formation;
    switch (team.tactics.formation) {
      case FORMATION.LiberoCentered: return receiver.isLibero ? f.liberoCenteredLiberoLogit : f.liberoCenteredOtherLogit;
      case FORMATION.Spread: return receiver.isLibero ? f.spreadLiberoLogit : f.spreadOtherLogit;
      default: return 0.0;
    }
  }

  /** RallyEngine.cs:451 ChooseReceiver — 포지션×전후위 가중 + 서버의 약점 공략. */
  chooseReceiver(team, aggression) {
    const r = this.cfg.receive, f = this.cfg.formation, sv = this.cfg.serve, w = this._w;
    let liberoMult = 1.0, ohMult = 1.0;
    if (team.tactics.formation === FORMATION.LiberoCentered) { liberoMult = f.liberoCenteredLiberoMult; ohMult = f.liberoCenteredOhMult; }
    else if (team.tactics.formation === FORMATION.Spread) { liberoMult = f.spreadLiberoMult; ohMult = f.spreadOhMult; }

    for (let pos = 1; pos <= 6; pos++) {
      const p = team.playerAt(pos);
      const front = isFrontRow(pos);
      let v;
      if (p.isLibero) v = r.weightLibero * liberoMult;
      else {
        switch (p.pos) {
          case POS.OH: v = front ? (pos === 4 ? r.weightOhFrontLeft : r.weightOhFrontRight) : r.weightOhBack; v *= ohMult; break;
          case POS.OP: v = front ? r.weightOpFront : r.weightOpBack; break;
          case POS.MB: v = front ? r.weightMbFront : r.weightMbBack; break;
          case POS.S: v = front ? r.weightSetterFront : r.weightSetterBack; break;
          default: v = front ? r.weightOpFront : r.weightOpBack; break;
        }
      }
      if (v > 0) {
        const recv = ratingReceive(p, this.cfg.rating);
        const t = 1.0 + sv.targetingBias * aggression * (sv.targetingRefRating - recv) / 50.0;
        v *= clamp(t, 0.3, 2.5);
      }
      w[pos - 1] = v;
    }
    let idx = this.rng.weightedIndex(w, 6);
    if (idx < 0) idx = 5;
    return idx + 1;
  }

  /** RallyEngine.cs:492 ChooseFreeBallReceiver */
  chooseFreeBallReceiver(team) {
    const d = this.cfg.dig, w = this._w;
    for (let pos = 1; pos <= 6; pos++) {
      let v = digWeight(team.playerAt(pos), d);
      if (isFrontRow(pos)) v *= 0.3;
      w[pos - 1] = v;
    }
    let idx = this.rng.weightedIndex(w, 6);
    if (idx < 0) idx = 5;
    return idx + 1;
  }

  /** RallyEngine.cs:519 ChooseDigger — 블로커 제외, 전위 비블로커는 ×0.5 */
  chooseDigger(defending) {
    const d = this.cfg.dig, w = this._w, bl = this._blockers, bn = this._blockN;
    for (let pos = 1; pos <= 6; pos++) {
      const p = defending.playerAt(pos);
      let v = 0.0;
      let isBlocker = false;
      for (let i = 0; i < bn; i++) if (bl[i] === p) { isBlocker = true; break; }
      if (!isBlocker) {
        v = digWeight(p, d);
        if (v > 0 && isFrontRow(pos)) v *= 0.5;
      }
      w[pos - 1] = v;
    }
    let idx = this.rng.weightedIndex(w, 6);
    if (idx < 0) idx = 5;
    return idx + 1;
  }

  /** RallyEngine.cs:533 ChooseCoverer */
  chooseCoverer(attacking, attacker) {
    const d = this.cfg.dig, w = this._w;
    for (let pos = 1; pos <= 6; pos++) {
      const p = attacking.playerAt(pos);
      w[pos - 1] = (p === attacker) ? 0.0 : digWeight(p, d);
    }
    let idx = this.rng.weightedIndex(w, 6);
    if (idx < 0) idx = 5;
    return idx + 1;
  }

  /** RallyEngine.cs:546 ChooseAlternativeSetter — 리베로는 −10 페널티. */
  chooseAlternativeSetter(team, exclude) {
    let best = null, bestV = -Infinity;
    for (let pos = 1; pos <= 6; pos++) {
      const p = team.playerAt(pos);
      if (p === exclude) continue;
      let v = ratingSet(p, this.cfg.rating);
      if (p.isLibero) v -= 10;
      if (v > bestV) { bestV = v; best = p; }
    }
    return best || team.playerAt(1);
  }

  /** 전술 가중치 × 패스 품질 가용성으로 공격 옵션을 고른다. RallyEngine.cs:562 ChooseAttackOption */
  chooseAttackOption(team, setter, pass) {
    const a = this.cfg.attack, t = team.tactics, w = this._w, sk = this.sk;
    // 스킬 '순풍' 처럼 공격 배분 자체를 바꾸는 효과. 배수 1.0 = 변화 없음(난수 소비는 그대로).
    const wm = sk !== null
      ? [1, sk.weightMult(team, setter, ATK.Quick, pass), sk.weightMult(team, setter, ATK.Open, pass),
         sk.weightMult(team, setter, ATK.BackRow, pass), sk.weightMult(team, setter, ATK.Delayed, pass)]
      : null;
    this._candN = 0;
    this._quickThreatMb = null;

    let frontMbExists = false;
    for (let pos = 2; pos <= 4; pos++) {
      const p = team.playerAt(pos);
      if (p.pos === POS.MB && p !== setter) { frontMbExists = true; break; }
    }

    const quickAvail = pass === Q.Perfect ? 1.0 : (pass === Q.Good ? a.quickAvailGoodPass : 0.0);
    const delayedAvail = pass === Q.Perfect ? 1.0 : (pass === Q.Good ? a.delayedAvailGoodPass : 0.0);
    const backAvail = pass === Q.Poor ? a.backRowAvailPoorPass : 1.0;

    let anyFrontWing = false;
    for (let pos = 2; pos <= 4; pos++) {
      const p = team.playerAt(pos);
      if (p === setter || p.isLibero) continue;
      if (p.pos === POS.MB) {
        const v = t.quickWeight * quickAvail * (wm !== null ? wm[ATK.Quick] : 1);
        if (v > 0) {
          this.addCand(p, ATK.Quick, v);
          if (this._quickThreatMb === null || ratingAttack(p, this.cfg.rating) > ratingAttack(this._quickThreatMb, this.cfg.rating)) this._quickThreatMb = p;
        }
      } else {
        anyFrontWing = true;
        const rel = p.pos === POS.OP ? a.openOpRelativeWeight : 1.0;
        const v = t.openWeight * rel * (wm !== null ? wm[ATK.Open] : 1);
        if (v > 0) this.addCand(p, ATK.Open, v);
        if (frontMbExists) {
          const wd = t.delayedWeight * delayedAvail * rel * (wm !== null ? wm[ATK.Delayed] : 1);
          if (wd > 0) this.addCand(p, ATK.Delayed, wd);
        }
      }
    }
    // 전위에 윙 공격수가 없으면 MB 하이볼(오픈)도 허용
    if (!anyFrontWing) {
      for (let pos = 2; pos <= 4; pos++) {
        const p = team.playerAt(pos);
        if (p === setter || p.isLibero) continue;
        const v = t.openWeight * 0.7;
        if (v > 0) this.addCand(p, ATK.Open, v);
      }
    }
    // 후위 공격: OP 우선, 없으면 OH
    let backOp = null, backOh = null;
    for (let pos = 1; pos <= 6; pos++) {
      if (isFrontRow(pos)) continue;
      const p = team.playerAt(pos);
      if (p === setter || p.isLibero) continue;
      if (p.pos === POS.OP && backOp === null) backOp = p;
      else if (p.pos === POS.OH && backOh === null) backOh = p;
    }
    const backAttacker = backOp || backOh;
    if (backAttacker !== null) {
      const v = t.backRowWeight * backAvail * (wm !== null ? wm[ATK.BackRow] : 1);
      if (v > 0) this.addCand(backAttacker, ATK.BackRow, v);
    }

    if (this._candN === 0) {
      for (let pos = 2; pos <= 4; pos++) {
        const p = team.playerAt(pos);
        if (p === setter || p.isLibero) continue;
        this.addCand(p, ATK.Open, 1.0);
      }
      if (this._candN === 0 && backAttacker !== null) this.addCand(backAttacker, ATK.BackRow, 1.0);
      if (this._candN === 0) {
        for (let pos = 1; pos <= 6; pos++) {
          const p = team.playerAt(pos);
          if (p.isLibero) continue;
          this.addCand(p, isFrontRow(pos) ? ATK.Open : ATK.BackRow, 1.0);
        }
      }
    }

    let idx = this.rng.weightedIndex(w, this._candN);
    if (idx < 0) idx = this._candN - 1;
    return idx;
  }

  addCand(p, type, w) {
    const n = this._candN;
    if (n >= 16) return;
    this._w[n] = w;
    this._cand[n] = p;
    this._candType[n] = type;
    this._candN = n + 1;
  }

  /** RallyEngine.cs:681 PredictabilityPenalty */
  predictabilityPenalty(t, type) {
    const a = this.cfg.attack;
    const q = t.quickWeight < 0 ? 0 : t.quickWeight;
    const o = t.openWeight < 0 ? 0 : t.openWeight;
    const b = t.backRowWeight < 0 ? 0 : t.backRowWeight;
    const d = t.delayedWeight < 0 ? 0 : t.delayedWeight;
    const sum = q + o + b + d;
    if (sum <= 0) return 0.0;
    let share;
    switch (type) {
      case ATK.Quick: share = q / sum; break;
      case ATK.Open: share = o / sum; break;
      case ATK.BackRow: share = b / sum; break;
      case ATK.Delayed: share = d / sum; break;
      default: return 0.0;
    }
    const over = share - a.predictabilityFreeShare;
    return over > 0 ? a.predictabilityLogit * over : 0.0;
  }

  // ---------------------------------------------------------------- 블로킹
  /**
   * 수비팀 전위(2,3,4)에서만 블로커를 고른다 → 후위·리베로는 절대 블로킹하지 않는다.
   * RallyEngine.cs:735 ChooseBlockers
   */
  chooseBlockers(defending, type, attackPos, setQuality, clutch) {
    this._blockN = 0;
    const b = this.cfg.block;
    let primaryPos, secondaryPos, thirdPos, joinBase;
    const front = isFrontRow(attackPos);

    if (type === ATK.BackRow || !front) {
      primaryPos = 3;
      const b2 = ratingBlock(defending.playerAt(2), this.cfg.rating);
      const b4 = ratingBlock(defending.playerAt(4), this.cfg.rating);
      secondaryPos = b2 >= b4 ? 2 : 4;
      thirdPos = secondaryPos === 2 ? 4 : 2;
      joinBase = b.joinBackRow;
    } else if (type === ATK.Quick || (type === ATK.Open && attackPos === 3)) {
      primaryPos = 3;
      const b2 = ratingBlock(defending.playerAt(2), this.cfg.rating);
      const b4 = ratingBlock(defending.playerAt(4), this.cfg.rating);
      secondaryPos = b2 >= b4 ? 2 : 4;
      thirdPos = secondaryPos === 2 ? 4 : 2;
      joinBase = type === ATK.Quick ? b.joinQuick : b.joinOpen;
    } else {
      primaryPos = attackPos === 4 ? 2 : (attackPos === 2 ? 4 : 3); // Mirror
      secondaryPos = 3;
      thirdPos = primaryPos === 2 ? 4 : 2;
      switch (type) {
        case ATK.Delayed: joinBase = b.joinDelayed; break;
        case ATK.Dump: joinBase = b.joinDump; break;
        default: joinBase = b.joinOpen; break;
      }
    }

    this.addBlocker(defending, primaryPos);

    const sec = defending.playerAt(secondaryPos);
    const secSpeed = this.eff(sec.stats[STAT.speed], sec, defending, clutch);
    const pJoin = contest(joinBase, secSpeed - b.joinSpeedRef, this.K(b.joinK), 0);
    if (this.rng.chance(pJoin)) this.addBlocker(defending, secondaryPos);

    if (setQuality === Q.Poor && this._blockN === 2) {
      const third = defending.playerAt(thirdPos);
      const thirdSpeed = this.eff(third.stats[STAT.speed], third, defending, clutch);
      const pThird = contest(b.joinThirdPoorSet, thirdSpeed - b.joinSpeedRef, this.K(b.joinK), 0);
      if (this.rng.chance(pThird)) this.addBlocker(defending, thirdPos);
    }
  }

  addBlocker(defending, pos) {
    if (!isFrontRow(pos)) throw new Error(`후위 포지션 ${pos} 은 블로킹할 수 없습니다`); // 규칙 불변식
    const p = defending.playerAt(pos);
    if (p.isLibero) throw new Error('리베로는 블로킹할 수 없습니다');
    for (let i = 0; i < this._blockN; i++) if (this._blockers[i] === p) return;
    this._blockers[this._blockN] = p;
    this._blockerPos[this._blockN] = pos;
    this._blockN++;
  }

  /** 블로커 실효 블로킹 레이팅 가중 평균(MB 는 MbStrengthWeight). RallyEngine.cs:812 */
  weightedBlockRating(defending, clutch) {
    let sum = 0, wsum = 0;
    const mbw = this.cfg.block.mbStrengthWeight, sk = this.sk;
    for (let i = 0; i < this._blockN; i++) {
      const p = this._blockers[i];
      const w = p.pos === POS.MB ? mbw : 1.0;
      const noFatigue = sk !== null && sk.blockFatigueImmune(defending, p);
      sum += w * this.eff(ratingBlock(p, this.cfg.rating), p, defending, clutch, noFatigue);
      wsum += w;
    }
    return wsum > 0 ? sum / wsum : 0.0;
  }

  /** RallyEngine.cs:826 AverageNonBlockerDig */
  averageNonBlockerDig(defending, clutch) {
    let sum = 0, n = 0;
    const bl = this._blockers, bn = this._blockN;
    for (let pos = 1; pos <= 6; pos++) {
      const p = defending.playerAt(pos);
      let isBlocker = false;
      for (let i = 0; i < bn; i++) if (bl[i] === p) { isBlocker = true; break; }
      if (isBlocker) continue;
      sum += this.eff(ratingDig(p, this.cfg.rating), p, defending, clutch);
      n++;
    }
    return n > 0 ? sum / n : 50.0;
  }

  /** RallyEngine.cs:840 CreditBlock */
  creditBlock(defending, primary) {
    defending.stats.blockKills++;
    if (this.sk !== null) this.sk.noteBlockKill(defending, this._blockers, this._blockN);
    for (let i = 0; i < this._blockN; i++) {
      const box = this.boxOf(this._blockers[i]);
      if (this._blockers[i] === primary) box.blockKills++; else box.blockAssists++;
    }
  }

  /** RallyEngine.cs:850 EmitBlockEvent */
  emitBlockEvent(defending, outcome, prob, clutch) {
    if (this._blockN === 0) return;
    const e = this.emit(EV.Block, defending, this._blockers[0], this._blockerPos[0], Q.None, outcome, ATK.None, prob, this._blockN, clutch);
    if (e !== null && this._blockN > 1) {
      const s = [];
      for (let i = 1; i < this._blockN; i++) s.push(this._blockers[i].id);
      e.secondary = s;
    }
  }

  // ---------------------------------------------------------------- 세트
  /** SetEngine.cs:20 PlaySet */
  playSet(setIndex, firstServer) {
    const cfg = this.cfg, home = this.home, away = this.away;
    const isFinal = setIndex === cfg.match.setsToWin * 2 - 1;
    this.setIndex = setIndex;
    this.pointsToWin = isFinal ? cfg.match.pointsToWinFinalSet : cfg.match.pointsToWinSet;
    this.rallyIndex = 0;

    home.resetForSet();
    away.resetForSet();
    if (this.sk !== null) this.sk.startSet(this.pointsToWin);

    let serving = firstServer;
    let receiving = this.opponent(firstServer);

    if (this.log.enabled) this.emit(EV.SetStart, serving, null, 0, Q.None, OUT.None, ATK.None, 0, this.pointsToWin, false);
    serving.applyLiberoRule(true, this.log, setIndex, 0, home.score, away.score);
    receiving.applyLiberoRule(false, this.log, setIndex, 0, home.score, away.score);

    let rallies = 0;
    const margin = cfg.match.minPointMargin, target = this.pointsToWin;
    while (!isSetOver(home.score, away.score, target, margin) && rallies < cfg.match.maxRalliesPerSet) {
      rallies++;
      this.rallyIndex = rallies;

      const r = this.playRally(serving, receiving);
      if (this.sk !== null) this.sk.endRally(r.winner);
      const winner = this.team(r.winner);
      winner.score++;
      winner.stats.points++;
      if (winner === serving) serving.stats.serveRalliesWon++;
      else receiving.stats.receiveRalliesWon++;
      if (r.clutch) winner.stats.clutchRalliesWon++;

      if (this.log.enabled) {
        const pe = this.emit(EV.Point, winner, null, 0, Q.None, OUT.None, ATK.None, 0, r.reason, r.clutch);
        if (pe) pe.reason = r.reason;
      }

      if (winner !== serving) {
        // 사이드아웃: 리시브 팀 득점 → 로테이션 후 서브권 획득
        receiving.rotate();
        if (this.log.enabled) this.emit(EV.Rotation, receiving, receiving.playerAt(1), 1, Q.None, OUT.None, ATK.None, 0, receiving.rotationIndex, false);
        const t = serving; serving = receiving; receiving = t;
      }

      if (!isSetOver(home.score, away.score, target, margin)) {
        serving.applyLiberoRule(true, this.log, setIndex, rallies, home.score, away.score);
        receiving.applyLiberoRule(false, this.log, setIndex, rallies, home.score, away.score);
      }
    }

    const score = { setIndex, home: home.score, away: away.score, rallies };
    const setWinner = home.score > away.score ? home : away;
    setWinner.setsWon++;
    if (this.log.enabled) this.emit(EV.SetEnd, setWinner, null, 0, Q.None, OUT.None, ATK.None, 0, setIndex, false);
    return score;
  }
}

function digWeight(p, d) {
  if (p.isLibero) return d.weightLibero;
  switch (p.pos) {
    case POS.OH: return d.weightOh;
    case POS.OP: return d.weightOp;
    case POS.MB: return d.weightMb;
    case POS.S: return d.weightSetter;
    default: return d.weightOp;
  }
}

/** RallyEngine.cs:704 QuickShareFactor */
function quickShareFactor(t, fullShare) {
  const q = t.quickWeight < 0 ? 0 : t.quickWeight;
  const o = t.openWeight < 0 ? 0 : t.openWeight;
  const b = t.backRowWeight < 0 ? 0 : t.backRowWeight;
  const d = t.delayedWeight < 0 ? 0 : t.delayedWeight;
  const sum = q + o + b + d;
  if (sum <= 0 || fullShare <= 0) return 1.0;
  const share = q / sum;
  return share >= fullShare ? 1.0 : share / fullShare;
}

/** SetEngine.cs:79 IsSetOver */
export function isSetOver(a, b, pointsToWin, margin) {
  const hi = a > b ? a : b;
  const diff = a > b ? a - b : b - a;
  return hi >= pointsToWin && diff >= margin;
}

// ---------------------------------------------------------------- 경기 전체
/**
 * 경기(5세트 3선승). MatchEngine.cs:12 Run
 * @param {object} home  makeTeamState 결과(수정되지 않음)
 * @param {object} away
 * @param {number} seed
 * @param {object} [config]
 * @param {boolean} [collectEvents]
 */
export function simulateMatch(home, away, seed, config, collectEvents = true) {
  const cfg = config || DEFAULT_SIM_CONFIG;
  const rng = new Rng(seed);
  const log = new MatchLog(collectEvents);
  const homeState = new TeamMatchState(SIDE.HOME, home);
  const awayState = new TeamMatchState(SIDE.AWAY, away);
  const box = new Map();
  const skills = createSkillRuntime(cfg, homeState, awayState);
  const sim = new MatchSim(cfg, rng, log, homeState, awayState, box, skills);

  const result = {
    seed, homeTeamId: home.team.id, awayTeamId: away.team.id,
    homeSets: 0, awaySets: 0, winner: SIDE.HOME,
    sets: [], homeStats: homeState.stats, awayStats: awayState.stats,
    boxScores: box, events: log.events, eventCount: 0,
  };

  if (log.enabled) sim.emit(EV.MatchStart, homeState, null, 0, Q.None, OUT.None, ATK.None, 0, 0, false);

  // 1세트 첫 서브. MatchEngine.cs:39
  let firstServer = cfg.match.homeServesFirst ? homeState : (rng.chance(0.5) ? homeState : awayState);
  const maxSets = cfg.match.setsToWin * 2 - 1;

  for (let set = 1; set <= maxSets; set++) {
    if (set === maxSets) firstServer = rng.chance(0.5) ? homeState : awayState;
    else if (set > 1) firstServer = sim.opponent(firstServer);

    result.sets.push(sim.playSet(set, firstServer));
    if (homeState.setsWon >= cfg.match.setsToWin || awayState.setsWon >= cfg.match.setsToWin) break;
  }

  result.homeSets = homeState.setsWon;
  result.awaySets = awayState.setsWon;
  result.winner = homeState.setsWon > awayState.setsWon ? SIDE.HOME : SIDE.AWAY;
  result.eventCount = log.seq;

  if (log.enabled) sim.emit(EV.MatchEnd, sim.team(result.winner), null, 0, Q.None, OUT.None, ATK.None, 0, result.homeSets * 10 + result.awaySets, false);
  return result;
}

export function setScoreLine(result) {
  return result.sets.map(s => `${s.home}-${s.away}`).join(', ');
}

export function totalPoints(result) {
  let h = 0, a = 0;
  for (const s of result.sets) { h += s.home; a += s.away; }
  return { home: h, away: a };
}
