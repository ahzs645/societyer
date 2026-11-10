import { parentPort, workerData } from "node:worker_threads";
import { prepareRelease } from "./releases";
try { parentPort!.postMessage({ result: prepareRelease(workerData.root, workerData.request) }); }
catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : "Catalog preparation failed." }); }
