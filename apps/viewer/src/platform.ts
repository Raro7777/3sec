/**
 * The things an Android build owes the player that a browser tab does not.
 *
 * - The hardware/gesture **back** button. Without a handler Capacitor closes the app on the first press,
 *   so a player who taps back to shut a sheet loses the session instead. Back now unwinds what is actually
 *   open — a sheet, the tactics drawer, a sub-screen — and only offers to leave from the home screen, on a
 *   second press.
 * - The **screen** staying on. A match is nine minutes of watching with no touches, which is exactly how
 *   long Android waits before dimming. The wake lock is held only while a match is on the screen.
 * - **Saving when the app goes away.** Android kills backgrounded apps without warning; the save is cheap,
 *   so it happens on the way out rather than being trusted to the next deliberate action.
 *
 * Every one of these degrades to nothing in a plain browser, which is where the game is also played.
 */

type BackStep = () => boolean;

let backSteps: BackStep[] = [];
let exitArmed = 0;
/** How long the "press again" offer stands. */
export const EXIT_WINDOW_MS = 2000;
let wakeLock: { release: () => Promise<void> } | null = null;
let wakeWanted = false;

/**
 * Register what back should try, most specific first. Each step closes one thing and returns true, or
 * returns false to let the next one try. When every step declines, back is an exit.
 */
export function onBack(steps: BackStep[]): void {
  backSteps = steps;
}

/** Ask the OS to keep the screen on (a match is running). Silently does nothing where unsupported. */
export async function keepAwake(on: boolean): Promise<void> {
  wakeWanted = on;
  const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
  if (!nav.wakeLock) return;
  try {
    if (on && !wakeLock) wakeLock = await nav.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* denied, or the tab is hidden: not worth telling anyone about */ }
}

/**
 * Resolve one back press: close the innermost thing that is open, or — when nothing is — offer to leave and
 * then leave. Exported so the decision can be driven in a test without the Android bridge, which only
 * exists inside the packaged app.
 */
export function handleBack(now = Date.now()): "handled" | "arm" | "exit" {
  for (const step of backSteps) if (step()) { exitArmed = 0; return "handled"; }
  // nothing left to close: leaving takes two presses, so a stray gesture never ends the session
  if (exitArmed && now - exitArmed < EXIT_WINDOW_MS) { exitArmed = 0; return "exit"; }
  exitArmed = now;
  return "arm";
}

/**
 * Wire it all up. `save` is called when the app goes to the background, `toast` shows the "press again to
 * leave" line, and `exit` closes the app (Android only).
 */
export function installPlatform(opts: { save: () => void; toast: (msg: string) => void }): void {
  // the screen: a lock is dropped when the app is hidden and has to be taken again on return
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      opts.save();
      wakeLock = null; // the OS has already released it
    } else if (wakeWanted) {
      void keepAwake(true);
    }
  });
  window.addEventListener("pagehide", () => opts.save());

  void (async () => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const { App } = await import("@capacitor/app");
    App.addListener("appStateChange", ({ isActive }) => { if (!isActive) opts.save(); });
    App.addListener("backButton", () => {
      const what = handleBack();
      if (what === "arm") opts.toast("한 번 더 누르면 게임을 나갑니다");
      else if (what === "exit") void App.exitApp();
    });
  })();
}
