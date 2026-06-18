const CACHE_NAME = "verkup-offline-v5";
const APP_SHELL = [
  "./",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./favicon-16.png",
  "./favicon-32.png",
  "./verkup-app-icon-192.png",
  "./verkup-app-icon-512.png",
  "./verkup-logo.png",
  "./vendor/pdfjs/pdf.mjs",
  "./vendor/pdfjs/pdf.worker.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request, url.pathname.includes("/data/") ? { cache: "no-store" } : undefined)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("./");
        throw new Error("Offline cache miss");
      }),
  );
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || "Новая сборка Verkup";
  const options = {
    body: payload.body || "Вам назначили изделие на сборку.",
    icon: "./verkup-app-icon-192.png",
    badge: "./favicon-32.png",
    tag: payload.tag || "verkup-production-assignment",
    requireInteraction: true,
    data: {
      url: payload.url || "./?mode=production",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./?mode=production",
    self.registration.scope || self.location.href,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client && client.url.startsWith(self.location.origin)) {
            if ("navigate" in client) return client.navigate(targetUrl).then(() => client.focus());
            return client.focus();
          }
        }

        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);

  try {
    const response = await fetch("./", { cache: "reload" });
    if (!response.ok) return;

    const html = await response.clone().text();
    await cache.put("./", response);

    const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], self.location.href))
      .filter((url) => url.origin === self.location.origin && url.pathname.includes("/assets/"))
      .map((url) => url.href);

    await cache.addAll(assetUrls);
  } catch {
    // The app still has the basic shell cache even when asset discovery fails.
  }
}

function readPushPayload(event) {
  if (!event.data) return {};

  try {
    return event.data.json();
  } catch {
    return {
      body: event.data.text(),
    };
  }
}
