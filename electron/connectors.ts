export async function checkConnector(endpoint: string) {
  try {
    const response = await fetch(new URL("/healthz", endpoint).toString());
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      provider: body?.browser?.provider ?? body?.provider,
      message: response.ok ? undefined : `Connector returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Connector is unavailable.",
    };
  }
}
