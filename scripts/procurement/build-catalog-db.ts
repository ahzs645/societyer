import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { buildCatalog, openCatalog, sqliteSelfTest, verifyCatalog } from "../../server/procurement-catalog/database";

const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" }, verify: { type: "boolean" }, rebuild: { type: "boolean" } } });
if (!values.output || (!values.verify && !values.input)) throw new Error("Use --input <verified export> --output <origin.sqlite>, or --verify --output <catalog.sqlite>.");
sqliteSelfTest();
if (values.rebuild && existsSync(values.output)) throw new Error("Rebuild must target a new file; the existing origin is preserved.");
if (values.verify) {
  const db = openCatalog(values.output);
  try { const meta = verifyCatalog(db); console.log(JSON.stringify({ verified: true, societyId: meta.societyId, publicationId: meta.publicationId, generation: meta.generation, inventoryHash: meta.inventoryHash })); }
  finally { db.close(); }
} else console.log(JSON.stringify(await buildCatalog(values.input!, values.output)));
