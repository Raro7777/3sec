// Determinism + speed check for src/sim: builds the worker bundle, computes the in-thread reference in node (tsx),
// then loads a tiny page in headless Chromium (Playwright) that runs the same jobs through SimPool, and compares.
// Run: node scripts/check-worker.mjs   (needs Playwright with Chromium; override its location with PLAYWRIGHT_PATH)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWorker, loadEsbuild, viewerDir } from "./build-worker.mjs";

const harness = resolve(viewerDir, "scripts/check-worker-harness.ts");
const tsx = resolve(viewerDir, "node_modules/.bin/tsx");

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c.startsWith("/") ? pathToFileURL(c).href : c);
    } catch { /* next */ }
  }
  throw new Error("playwright not found; set PLAYWRIGHT_PATH");
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (d) => `${d.id}: ${d.score[0]}-${d.score[1]}  events=${d.events} shots=${d.shots.join("/")} xg=${d.xg.join("/")} dist=${d.distance} fat=${d.fatigue}`;

await buildWorker();

console.log("[check] in-thread reference (node/tsx)...");
const refOut = execFileSync(tsx, [harness], { cwd: viewerDir, encoding: "utf8", maxBuffer: 1 << 26 });
const ref = JSON.parse(refOut.trim().split("\n").pop());

const dir = mkdtempSync(join(tmpdir(), "3sec-check-worker-"));
try {
  const esbuild = await loadEsbuild();
  await esbuild.build({ entryPoints: [harness], bundle: true, format: "iife", platform: "browser", target: "es2020", outfile: join(dir, "page.js"), logLevel: "silent" });
  const html = join(dir, "index.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>check-worker</title><script src="./page.js"></script>`);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("[page]", m.text()); });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(pathToFileURL(html).href);
    console.log("[check] running SimPool in Chromium...");
    const res = await page.evaluate(() => window.runCheck());

    let ok = true;
    const compare = (label, refs, got, strict) => {
      let allEq = true;
      for (let i = 0; i < refs.length; i++) {
        const a = refs[i], b = got[i];
        const eq = same(a, b);
        if (!eq) allEq = false;
        console.log(`  ${eq ? "OK  " : "DIFF"} ${label} ${fmt(b)}${eq ? "" : `\n       ref ${fmt(a)}`}`);
        if (!eq && strict) for (const k of Object.keys(a)) if (!same(a[k], b[k])) console.log(`       field ${k}: ref=${JSON.stringify(a[k]).slice(0, 160)} got=${JSON.stringify(b[k]).slice(0, 160)}`);
      }
      if (!allEq && strict) ok = false;
      return allEq;
    };
    console.log(`[check] page ${res.protocol}, mode=${res.mode}, workers=${res.workerCount}, hardwareConcurrency=${res.hardwareConcurrency}`);
    console.log(`[check] 1) workers vs in-thread runToEnd() in the same browser (must be identical):`);
    compare("workers  ", res.threadDigests, res.workerDigests, true);
    console.log(`[check] 2) browser in-thread vs node/tsx reference (informational: V8 versions differ in Math.pow/Math.cos, so a bit-exact match is not expected across runtimes):`);
    const crossOk = compare("node-ref ", ref.digests, res.threadDigests, false);
    if (!crossOk) console.log(`[check]    node V8 ${process.versions.v8} vs Chromium ${browser.version()}: results differ across runtimes, as expected.`);
    if (res.mode !== "workers") { ok = false; console.log("[check] FAIL: pool did not run in worker mode"); }
    if (!same(res.progress, ref.digests.map((_, i) => i + 1))) { ok = false; console.log("[check] FAIL: progress callbacks", res.progress); }
    console.log(`[check] ${ref.digests.length} matches: workers cold ${res.workerMs} ms, workers warm ${res.workerWarmMs} ms, browser in-thread ${res.threadMs} ms, node in-thread ${ref.ms} ms`);
    console.log(`[check] speed-up vs in-thread: cold x${(res.threadMs / res.workerMs).toFixed(2)}, warm x${(res.threadMs / res.workerWarmMs).toFixed(2)}`);
    console.log(ok ? "[check] PASS: worker results identical to in-thread runToEnd()" : "[check] FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
