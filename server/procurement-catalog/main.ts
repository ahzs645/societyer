import { readFileSync } from "node:fs";
import { createCatalogService, type ServiceConfig } from "./server";

const file = process.env.CATALOG_CONFIG_FILE;
if (!file) throw new Error("CATALOG_CONFIG_FILE must name the private service configuration.");
const config = JSON.parse(readFileSync(file, "utf8")) as ServiceConfig;
const server = await createCatalogService(config);
server.adminServer.listen(Number(process.env.CATALOG_ADMIN_PORT ?? 8789), "127.0.0.1");
server.listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? "127.0.0.1", () => console.log("procurement_catalog_listening"));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.adminServer.close(); server.close(() => process.exit(0)); });
