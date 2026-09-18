/**
 * What a tester's report needs that the tester cannot be asked to type: the build, the device, the
 * screen, how big the save is, and the last few runtime errors. The error log is a small ring in
 * localStorage, filled by the global hooks installed before the game boots, so a crash on the way in
 * still leaves a trace for the next launch's report.
 */
import { isNativeApp } from "./share";

const ERR_KEY = "3sec.errors";
const ERR_MAX = 8;

export interface LoggedError { at: string; msg: string; where?: string }

const readErrors = (): LoggedError[] => {
  try { return JSON.parse(localStorage.getItem(ERR_KEY) ?? "[]") as LoggedError[]; } catch { return []; }
};

function logError(msg: string, where?: string): void {
  try {
    const list = readErrors();
    list.push({ at: new Date().toISOString(), msg: msg.slice(0, 300), where: where?.slice(0, 200) });
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-ERR_MAX)));
  } catch { /* storage unavailable: nothing to do */ }
}

/** Hook uncaught errors and rejected promises. Call once, before anything else runs. */
export function installErrorLog(): void {
  window.addEventListener("error", (e) => {
    const src = e.filename ? `${e.filename.split("/").pop()}:${e.lineno}:${e.colno}` : undefined;
    logError(e.message || String(e.error ?? "error"), src);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined;
    const msg = typeof r === "string" ? r : r?.message ?? String(r);
    const where = typeof r === "object" && r?.stack ? r.stack.split("\n")[1]?.trim() : undefined;
    logError(`(promise) ${msg}`, where);
  });
}

export const recentErrors = (): LoggedError[] => readErrors();
export function clearErrors(): void { try { localStorage.removeItem(ERR_KEY); } catch { /* ignore */ } }

export interface ReportContext {
  message: string;
  appVersion: string;
  saveLabel: string;
  difficulty: string;
  saveBytes: number;
}

/** The report as plain text: the tester's words first, then everything the tester should not have to know. */
export async function buildReport(ctx: ReportContext): Promise<string> {
  let build = `v${ctx.appVersion} (웹)`;
  if (isNativeApp()) {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      build = `v${info.version} (${info.build})`;
    } catch { build = `v${ctx.appVersion} (앱)`; }
  }
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string; mobile?: boolean } };
  let storage = "";
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage !== undefined && est.quota) storage = `${Math.round(est.usage / 1024)} KB / ${Math.round(est.quota / 1024 / 1024)} MB`;
  } catch { /* not available */ }
  let localUsed = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; localUsed += k.length + (localStorage.getItem(k)?.length ?? 0); } } catch { /* ignore */ }
  const errs = recentErrors();
  const lines = [
    "가난한자의 FM 의견",
    "",
    ctx.message.trim() || "(내용 없음)",
    "",
    "---- 진단 정보 (자동) ----",
    `빌드: ${build}`,
    `기기: ${nav.userAgentData?.platform ?? nav.platform} · ${nav.userAgent}`,
    `화면: ${screen.width}×${screen.height} @${window.devicePixelRatio} · 뷰포트 ${window.innerWidth}×${window.innerHeight} · ${screen.orientation?.type ?? ""}`,
    `언어: ${navigator.language} · 코어 ${navigator.hardwareConcurrency ?? "?"} · 메모리 ${nav.deviceMemory ?? "?"} GB`,
    `게임: ${ctx.saveLabel} · 난이도 ${ctx.difficulty} · 저장 ${Math.round(ctx.saveBytes / 1024)} KB · 로컬 ${Math.round(localUsed / 1024)} KB${storage ? ` · 저장소 ${storage}` : ""}`,
    `시각: ${new Date().toISOString()}`,
  ];
  if (errs.length) {
    lines.push("", `최근 오류 ${errs.length}건:`);
    for (const e of errs) lines.push(`- ${e.at.slice(0, 19)} ${e.msg}${e.where ? ` @ ${e.where}` : ""}`);
  }
  return lines.join("\n");
}

export const FEEDBACK_MAIL = "sunhong2k@gmail.com";

/** Hand the report to the share sheet (native or web), or to a mail app; false when neither took it. */
export async function sendReport(text: string): Promise<boolean> {
  const subject = "가난한자의 FM 의견";
  if (isNativeApp()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: subject, text, dialogTitle: subject });
      return true;
    } catch { /* fall through to mail */ }
  }
  const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
  if (nav.share) {
    try { await nav.share({ title: subject, text }); return true; } catch { /* cancelled or unsupported */ }
  }
  return openMail(text);
}

export function openMail(text: string): boolean {
  try {
    const url = `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent("가난한자의 FM 의견")}&body=${encodeURIComponent(text)}`;
    window.location.href = url;
    return true;
  } catch { return false; }
}
