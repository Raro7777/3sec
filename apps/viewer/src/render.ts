import { PITCH } from "@3sec/engine";

export interface View {
  w: number;
  h: number;
  scale: number; // px per meter
  ox: number; // px of x=0
  oy: number; // px of y=0
}

export function drawPitch(ctx: CanvasRenderingContext2D, v: View): void {
  const { scale, ox, oy } = v;
  const hl = PITCH.halfLength;
  const hw = PITCH.halfWidth;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;

  // Grass with mowing stripes
  ctx.fillStyle = "#2f7d3a";
  ctx.fillRect(0, 0, v.w, v.h);
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? "#2f7d3a" : "#33873f";
    const x0 = -hl + (i * PITCH.length) / stripes;
    ctx.fillRect(X(x0), Y(-hw), (PITCH.length / stripes) * scale + 1, PITCH.width * scale);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(1, 0.12 * scale);
  ctx.lineJoin = "round";

  // Outline & halfway line
  ctx.strokeRect(X(-hl), Y(-hw), PITCH.length * scale, PITCH.width * scale);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-hw));
  ctx.lineTo(X(0), Y(hw));
  ctx.stroke();

  // Centre circle & spot
  ctx.beginPath();
  ctx.arc(X(0), Y(0), PITCH.centerCircleRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Y(0), 0.2 * scale, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();

  for (const side of [-1, 1] as const) {
    const gx = hl * side;
    // Penalty area
    const pa = PITCH.penaltyAreaDepth * side;
    ctx.strokeRect(
      Math.min(X(gx), X(gx - pa)),
      Y(-PITCH.penaltyAreaHalfWidth),
      PITCH.penaltyAreaDepth * scale,
      PITCH.penaltyAreaHalfWidth * 2 * scale,
    );
    // Goal area
    const ga = PITCH.goalAreaDepth * side;
    ctx.strokeRect(
      Math.min(X(gx), X(gx - ga)),
      Y(-PITCH.goalAreaHalfWidth),
      PITCH.goalAreaDepth * scale,
      PITCH.goalAreaHalfWidth * 2 * scale,
    );
    // Penalty spot
    const ps = (hl - PITCH.penaltySpotDist) * side;
    ctx.beginPath();
    ctx.arc(X(ps), Y(0), 0.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    // Penalty arc (outside the box only)
    ctx.beginPath();
    const r = PITCH.centerCircleRadius * scale;
    const dx = (PITCH.penaltyAreaDepth - PITCH.penaltySpotDist) * scale;
    const ang = Math.acos(dx / r);
    if (side === 1) ctx.arc(X(ps), Y(0), r, Math.PI - ang, Math.PI + ang);
    else ctx.arc(X(ps), Y(0), r, -ang, ang);
    ctx.stroke();
    // Goal
    const gd = PITCH.goalDepth * side;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(Math.min(X(gx), X(gx + gd)), Y(-PITCH.goalHalfWidth), PITCH.goalDepth * scale, PITCH.goalWidth * scale);
    ctx.strokeRect(Math.min(X(gx), X(gx + gd)), Y(-PITCH.goalHalfWidth), PITCH.goalDepth * scale, PITCH.goalWidth * scale);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    // Corner arcs
    for (const sy of [-1, 1] as const) {
      ctx.beginPath();
      const cx = X(gx);
      const cy = Y(hw * sy);
      const start = side === 1 ? (sy === 1 ? Math.PI : Math.PI / 2) : sy === 1 ? -Math.PI / 2 : 0;
      ctx.arc(cx, cy, PITCH.cornerArcRadius * scale, start, start + Math.PI / 2);
      ctx.stroke();
    }
  }
}
