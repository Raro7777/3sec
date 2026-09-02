/**
 * Full-screen celebration overlay (title win, cup win): confetti on a canvas plus a card.
 * Pure DOM/canvas, no dependencies; respects prefers-reduced-motion.
 */
export interface CelebrationSpec {
  kind: "league" | "cup" | "clinch";
  title: string;
  subtitle: string;
  lines: string[];
  color: string;
  /** button label; resolves when dismissed */
  button?: string;
}

export function celebrate(spec: CelebrationSpec): Promise<void> {
  return new Promise((resolve) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(5,8,11,.86);backdrop-filter:blur(4px)";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    root.appendChild(canvas);
    const card = document.createElement("div");
    card.style.cssText = `position:relative;max-width:min(92vw,440px);width:100%;background:#121a21;border:1px solid ${spec.color};border-radius:16px;padding:22px 20px 18px;text-align:center;box-shadow:0 0 60px ${spec.color}55;transform:scale(.92);opacity:0;transition:transform .5s cubic-bezier(.2,.9,.3,1.2),opacity .4s`;
    const trophy = spec.kind === "cup" ? "🏆" : spec.kind === "clinch" ? "🎉" : "👑";
    card.innerHTML = `<div style="font-size:56px;line-height:1;margin-bottom:6px">${trophy}</div>
      <div style="font-family:'Barlow Condensed','IBM Plex Sans KR',sans-serif;font-size:34px;font-weight:700;color:${spec.color};letter-spacing:.02em">${spec.title}</div>
      <div style="font-size:15px;color:#e7edf2;margin:4px 0 12px">${spec.subtitle}</div>
      <div style="font-size:13px;color:#93a4b3;line-height:1.7;text-align:left;display:inline-block">${spec.lines.map((l) => `<div>${l}</div>`).join("")}</div>
      <div style="margin-top:16px"><button style="background:${spec.color};color:#1a1400;border:0;border-radius:8px;padding:9px 18px;font-weight:700;font-size:15px;cursor:pointer">${spec.button ?? "계속"}</button></div>`;
    root.appendChild(card);
    document.body.appendChild(root);
    requestAnimationFrame(() => { card.style.transform = "scale(1)"; card.style.opacity = "1"; });

    // confetti
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener("resize", resize);
    const palette = [spec.color, "#ffd166", "#e7edf2", "#5fd38a", "#4cc9f0", "#ff8fab"];
    const N = reduce ? 0 : spec.kind === "clinch" ? 90 : 160;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6,
      vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 120, w: 6 + Math.random() * 6, h: 8 + Math.random() * 10,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 6, c: palette[Math.floor(Math.random() * palette.length)]!,
    }));
    let last = performance.now();
    let alive = true;
    const tick = (t: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > innerHeight + 30) { p.y = -20; p.x = Math.random() * innerWidth; p.vy = 80 + Math.random() * 120; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = 0.9;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      requestAnimationFrame(tick);
    };
    if (N) requestAnimationFrame(tick);

    const done = () => {
      alive = false;
      window.removeEventListener("resize", resize);
      root.style.transition = "opacity .3s"; root.style.opacity = "0";
      setTimeout(() => { root.remove(); resolve(); }, 300);
    };
    card.querySelector("button")!.addEventListener("click", done);
  });
}
