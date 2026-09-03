// 10종 스탯 + 신장 → 판정용 복합 레이팅(0~100). Engine/Ratings.cs 포팅.
import { STAT } from './domain.js';
import { clamp } from './mathx.js';

export function ratingServe(p, w) {
  return w.serveFromServe * p.stats[STAT.serve] + w.serveFromPower * p.stats[STAT.power];
}

export function ratingReceive(p, w) {
  return w.receiveFromReceive * p.stats[STAT.receive] + w.receiveFromSpeed * p.stats[STAT.speed];
}

export function ratingSet(p, w) {
  return w.setFromSet * p.stats[STAT.set] + w.setFromSpeed * p.stats[STAT.speed];
}

export function ratingAttack(p, w) {
  const h = clamp((p.heightCm - w.heightPivotCm) * w.attackHeightPerCm, -w.attackHeightCap, w.attackHeightCap);
  return w.attackFromSpike * p.stats[STAT.spike] + w.attackFromPower * p.stats[STAT.power]
       + w.attackFromSpeed * p.stats[STAT.speed] + h;
}

export function ratingBlock(p, w) {
  const h = clamp((p.heightCm - w.heightPivotCm) * w.blockHeightPerCm, -w.blockHeightCap, w.blockHeightCap);
  return w.blockFromBlock * p.stats[STAT.block] + w.blockFromSpeed * p.stats[STAT.speed] + h;
}

export function ratingDig(p, w) {
  return w.digFromDig * p.stats[STAT.dig] + w.digFromSpeed * p.stats[STAT.speed];
}
