import { Worker } from "node:worker_threads";
import type { ActivationRequest, ActivationReceipt } from "./releases";
import type { fingerprintCatalog } from "./qualification";

const spawnWorker = (name: string, data: Record<string, unknown>, heap: number) => new Worker(new URL(import.meta.url.endsWith(".ts") ? "./source-worker.mjs" : `./${name}.mjs`, import.meta.url), { execArgv: [], workerData: { ...data, entry: name }, resourceLimits: { maxOldGenerationSizeMb: heap } });
export function prepareInWorker(root: string, request: ActivationRequest): Promise<{ directory: string; receipt: ActivationReceipt }> {
  return taskWorker("activation-worker", { root, request });
}
export function qualifyInWorker(directory: string, asOf: number): Promise<ReturnType<typeof fingerprintCatalog>> {
  return taskWorker("qualification-worker", { directory, asOf });
}
function taskWorker<T>(name: string, data: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = spawnWorker(name, data, 1536);
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Publication preparation timed out; the prior catalog remains available.")); }, 10 * 60_000);
    const finish = () => { clearTimeout(timer); void worker.terminate(); };
    worker.once("message", message => { finish(); message.error ? reject(new Error(message.error)) : resolve(message.result); });
    worker.once("error", error => { finish(); reject(error); });
    worker.once("exit", code => { if (code !== 0) { clearTimeout(timer); reject(new Error("Publication worker stopped.")); } });
  });
}
export class AnalysisWorker {
  private worker: Worker;
  private pending = new Map<number, { resolve: (value: { resultJson: string; asOf: number }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  readonly ready: Promise<void>;
  constructor(directory: string) {
    this.worker = spawnWorker("analysis-worker", { directory }, 768);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("Analysis worker startup timed out.")); this.close(); }, 60_000);
      this.worker.on("message", message => {
        if (message.ready) { clearTimeout(timer); resolve(); return; }
        if (message.startupError) { clearTimeout(timer); reject(new Error(message.startupError)); this.close(); return; }
        const entry = this.pending.get(message.id); if (!entry) return;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        message.error ? entry.reject(new Error(message.error)) : entry.resolve({ resultJson: message.resultJson, asOf: message.asOf });
      });
      this.worker.on("error", error => { clearTimeout(timer); reject(error); this.failPending(error instanceof Error ? error : new Error("Analysis worker failed.")); });
      this.worker.on("exit", () => { clearTimeout(timer); reject(new Error("Analysis worker stopped.")); this.failPending(new Error("Analysis worker stopped.")); });
    });
  }
  private failPending(error: Error) { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); }
  async request(request: unknown, asOf: number) {
    await this.ready;
    if (this.pending.size >= 8) throw new Error("Analysis queue is busy; retry shortly.");
    return new Promise<{ resultJson: string; asOf: number }>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Analysis timed out; narrow the filters.")); }, 30_000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, request, asOf });
    });
  }
  close() { this.failPending(new Error("Analytical catalog was closed.")); void this.worker.terminate(); }
}
