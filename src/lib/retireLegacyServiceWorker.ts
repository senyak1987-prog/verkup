/** Update only a previously installed worker; new visitors do not install one. */
export async function retireLegacyServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const appScope = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const legacyScript = new URL("sw.js", appScope);

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(async registration => {
      if (registration.scope !== appScope) return;
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      if (!worker) return;
      const script = new URL(worker.scriptURL);
      if (script.origin !== legacyScript.origin || script.pathname !== legacyScript.pathname) return;

      // The replacement claims existing clients without reloading their projects.
      try { await registration.update(); } catch { /* Retry on the next visit. */ }
    }));
  } catch {
    // Private browsing and offline visits may prevent access to registrations.
  }
}
