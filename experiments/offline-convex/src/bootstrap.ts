async function start() {
  if (import.meta.env.PROD) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  } else await navigator.serviceWorker.register("/service-worker.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  await import("./main");
}
void start().catch(error => {
  document.getElementById("error")!.textContent = error instanceof Error ? error.message : String(error);
});
export {};
