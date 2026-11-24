/* Our Addis service worker: the app opens instantly and fully offline (even when the home PC is off).
   - App files: served from cache, refreshed in the background (stale-while-revalidate).
   - Map tiles & fonts: cached as you browse, so areas you've looked at work offline.
   - /api/: never cached; the app's own sync layer handles being offline. */
const VERSION = "our-addis-v3";
const SHELL = [
  "./", "app.js", "store.js", "fasting.js", "ideas.js", "manifest.webmanifest",
  "vendor/leaflet.js", "vendor/leaflet.css", "vendor/images/marker-icon.png", "vendor/images/marker-shadow.png",
  "vendor/images/layers.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png",
];
const TILES = "our-addis-tiles-osm", FONTS = "our-addis-fonts", MAX_TILES = 2500;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => (k.startsWith("our-addis-v") && k !== VERSION) || k === "our-addis-tiles").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.includes("/api/") || url.pathname.includes("/_/")) return; // live data & dashboard: network only
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const key = req.mode === "navigate" ? "./" : req;
      const hit = await cache.match(key, { ignoreSearch: req.mode === "navigate" });
      const fresh = fetch(req).then((r) => { if (r.ok && !r.redirected) cache.put(key, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(fresh); return hit; }
      return (await fresh) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    })());
    return;
  }

  if (/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === "opaque") { cache.put(req, r.clone()); e.waitUntil(trim(TILES, MAX_TILES)); } return r; }
      catch { return new Response("", { status: 504 }); }
    })());
    return;
  }

  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((r) => { if (r.ok || r.type === "opaque") cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await fresh) || new Response("", { status: 504 });
    })());
  }
});
