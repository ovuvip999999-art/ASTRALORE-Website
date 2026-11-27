const CACHE_NAME = "astra-ai-shell-v13";
const APP_FILES = [
  "/astra.html",
  "/astra-page.css",
  "/astra-config.js",
  "/astra-memory.js",
  "/astra-page.js",
  "/astra-document-editor.js",
  "/astra-pwa.js",
  "/astra-manifest.webmanifest",
  "/astra-icon.svg",
  "/astra-icon-maskable.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("astra-ai-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // This worker may be registered at the origin root, but it only handles
  // ASTRA's own page and static app files. Other ASTRALORE pages pass through.
  const isAstraPage = url.pathname === "/astra.html";
  const isAstraAsset = APP_FILES.includes(url.pathname);
  if (!isAstraPage && !isAstraAsset) return;

  // Prefer the latest hosted files; use the app cache only as a fallback.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (isAstraPage && request.mode === "navigate") {
          return (await caches.match("/astra.html")) || Response.error();
        }
        return Response.error();
      })
  );
});