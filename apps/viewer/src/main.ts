import { Game } from "./game";

new Game();

// Offline app shell (real hosting only – file:// and the single-file artifact have no service worker scope).
if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !location.hostname.endsWith("claude.ai")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
