// Local macOS runs use the patched system Chrome with its sandbox on.
// SOCIETYER_CHROMIUM_PATH still wins, and other platforms keep their browser.
export function chromiumLaunchOptions() {
  const mac = process.platform === "darwin";
  const executablePath = process.env.SOCIETYER_CHROMIUM_PATH;
  if (executablePath) return { executablePath, chromiumSandbox: mac };
  return mac ? { channel: "chrome", chromiumSandbox: true } : undefined;
}
