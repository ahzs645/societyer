import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";

process.env.AUTH_MODE = "none";
process.env.AUTH_DB_PATH ??= path.join(tmpdir(), "societyer-api-contract-auth.sqlite");

const { mountApiGateway } = await import("../server/api-gateway");

const app = express();
mountApiGateway(app);

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to bind API contract test server.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const specResponse = await fetch(`${baseUrl}/api/openapi.json`);
  if (!specResponse.ok) {
    throw new Error(`OpenAPI endpoint returned ${specResponse.status}.`);
  }
  const spec = await specResponse.json();
  const operations = Object.entries(spec.paths ?? {}).flatMap(([routePath, methods]) =>
    Object.entries(methods as Record<string, any>).map(([method, operation]) => ({
      routePath,
      method,
      operation,
    })),
  );

  const invalid = operations.filter(({ operation }) => {
    return (
      !operation.operationId ||
      !Array.isArray(operation.tags) ||
      !operation.responses ||
      !operation.security ||
      !operation["x-required-scope"]
    );
  });
  if (invalid.length) {
    throw new Error(
      `OpenAPI operations missing contract metadata: ${invalid
        .slice(0, 10)
        .map(({ method, routePath }) => `${method.toUpperCase()} ${routePath}`)
        .join(", ")}`,
    );
  }

  const docsResponse = await fetch(`${baseUrl}/api/docs/`);
  if (!docsResponse.ok) {
    throw new Error(`Swagger docs endpoint returned ${docsResponse.status}.`);
  }

  console.log(
    `API contract ok: ${Object.keys(spec.paths ?? {}).length} paths, ${operations.length} operations.`,
  );
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error: NodeJS.ErrnoException | undefined) => {
      if (!error || error.code === "ERR_SERVER_NOT_RUNNING") resolve();
      else reject(error);
    });
  });
  rmSync(process.env.AUTH_DB_PATH!, { force: true });
}
