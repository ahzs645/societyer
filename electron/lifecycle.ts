import { app, dialog } from "electron";
import { makeDesktopLogger } from "./observability.js";

const logger = makeDesktopLogger("lifecycle");

export async function runStartupStage(label: string, action: () => Promise<void> | void) {
  try {
    await action();
  } catch (error) {
    handleFatalStartupError(label, error);
  }
}

export function handleFatalStartupError(label: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error && error.stack ? error.stack : undefined;
  console.error("Societyer Electron fatal startup error", { stage: label, message, detail });
  void logger.error("fatal startup error", { stage: label, error });
  dialog.showErrorBox(
    "Societyer failed to start",
    [`Stage: ${label}`, message, detail].filter(Boolean).join("\n\n"),
  );
  app.quit();
  throw error;
}
