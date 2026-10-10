/* IbACE service worker — caches the app shell so the app runs with no network.
   Bump CACHE_VERSION whenever any app file changes, so devices pick up the update. */
const CACHE_VERSION = "v3.5.2";
const CACHE_NAME = "ibace-" + CACHE_VERSION;

const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "license.js",
  "ops.js",
  "lockbox.js",
  "sync.js",
  "tools.js",
  "me.js",
  "admin.js",
  "settings.js",
  "home.js",
  "report.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/logo-report.jpg"
];

const OFFLINE_HTML = '<!doctype html><html lang="en"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>IbACE</title>' +
  '<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5">' +
  "<h1>IbACE is not saved on this device yet</h1>" +
  "<p>Open IbACE once with an internet connection. After that it works with no connection.</p>" +
  "<p>Your padlock data is not affected.</p></body></html>";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ibace-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: the cached app shell always wins; the network is only a fallback.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === "navigate") {
        const shell = (await cache.match("index.html")) || (await cache.match("./"));
        return shell || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
