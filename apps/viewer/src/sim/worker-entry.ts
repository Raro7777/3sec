/**
 * Web Worker entry: simulates one match per request and posts back a plain-data MatchResult.
 * Bundled by scripts/build-worker.mjs into worker.bundle.ts (a string), which SimPool turns into a Blob URL worker.
 */
import { simulateInThread, type WorkerRequest, type WorkerResponse } from "./protocol";

// The viewer's tsconfig uses the DOM lib, not "webworker", so reach the worker global untyped.
const scope = globalThis as unknown as { postMessage(message: WorkerResponse): void; addEventListener(type: "message", fn: (e: MessageEvent<WorkerRequest>) => void): void };

scope.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.kind !== "run") return;
  const { job } = msg;
  try {
    scope.postMessage({ kind: "done", id: job.id, result: simulateInThread(job) });
  } catch (err) {
    scope.postMessage({ kind: "error", id: job.id, message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) });
  }
});

scope.postMessage({ kind: "ready" });
