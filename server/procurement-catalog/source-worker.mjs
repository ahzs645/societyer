// Development/test entry point. Production workers are bundled plain ESM.
import { workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
await tsImport(new URL(`./${workerData.entry}.ts`, import.meta.url).href, import.meta.url);
