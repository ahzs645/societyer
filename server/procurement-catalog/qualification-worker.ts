import { parentPort, workerData } from "node:worker_threads";
import { fingerprintCatalog } from "./qualification";
try { parentPort!.postMessage({ result: fingerprintCatalog(workerData.directory, workerData.asOf) }); }
catch { parentPort!.postMessage({ error: "Catalog qualification failed its integrity checks." }); }
