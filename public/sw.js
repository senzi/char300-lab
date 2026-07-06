const APP_VERSION = "0.2.2";
const APP_CACHE = `zhuzi-app-${APP_VERSION}`;
const RUNTIME_CACHE = `zhuzi-runtime-${APP_VERSION}`;
const FONT_CACHE = `zhuzi-fonts-${APP_VERSION}`;
const FONT_CSS_URL = "https://fontsapi.zeoseven.com/292/main/result.css";
const APP_SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(APP_SHELL);
      await cacheBuildAssets(cache).catch(() => undefined);
      await cacheFontAssets().catch(() => undefined);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_CACHE, RUNTIME_CACHE, FONT_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((name) => (keep.has(name) ? undefined : caches.delete(name))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, APP_CACHE, "/index.html"));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || APP_SHELL.includes(url.pathname))) {
    event.respondWith(cacheFirst(request, APP_CACHE));
    return;
  }

  if (url.href === FONT_CSS_URL || isFontRequest(url)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

async function cacheBuildAssets(cache) {
  const response = await fetch("/index.html", { cache: "no-store" });
  if (!response.ok) {
    return;
  }

  const html = await response.text();
  const assetUrls = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
    .map((match) => match[1])
    .filter((url) => url.startsWith("/assets/"));

  await Promise.all(assetUrls.map((url) => cache.add(url).catch(() => undefined)));
}

async function cacheFontAssets() {
  const cache = await caches.open(FONT_CACHE);
  const response = await fetch(FONT_CSS_URL, { mode: "cors" });
  if (!response.ok) {
    return;
  }

  await cache.put(FONT_CSS_URL, response);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (fallbackUrl) {
        await cache.put(fallbackUrl, response.clone());
      }
    }
    return response;
  } catch {
    return (await cache.match(request)) ?? (fallbackUrl ? await cache.match(fallbackUrl) : undefined) ?? Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached ?? (await refresh) ?? Response.error();
}

function isFontRequest(url) {
  return /\.(?:woff2?|ttf|otf)$/i.test(url.pathname);
}
