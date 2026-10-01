/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Keeps the visitor app working on a weak or missing hospital connection:
 * the app's code, 3D models, icons and fonts are kept on the phone, and each
 * map page is kept as it was last opened, with the hospital's data in it. Pages
 * come from the network first, so a connected visitor always sees the latest;
 * the chat and the database are never kept.
 */
import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `p-map-${version}`;
/** Fonts from Google, kept across versions. */
const FONTS = "p-map-fonts";
// Blender sources sit beside the models but the app never loads them.
const ASSETS = new Set([...build, ...files.filter((f) => !/\.blend\d*$/.test(f))]);
/** The visitor map pages: the hospital at / and at its public address /m/<slug>. */
const MAP_PAGE = /^\/(m\/[^/]+)?$/;
/** How long a page may take on a weak connection before the kept copy is shown. */
const PATIENCE = 6000;

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...ASSETS])));
});

sw.addEventListener("activate", (event) => {
  // Drop the files of earlier versions; kept pages go too, as they load that version's code.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== FONTS).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim())
      .then(keepOpenPages),
  );
});

/** The map pages already open (a first visit, before this worker ran), kept for next time. */
async function keepOpenPages() {
  const cache = await caches.open(CACHE);
  for (const client of await sw.clients.matchAll({ type: "window" })) {
    const path = new URL(client.url).pathname;
    if (!MAP_PAGE.test(path)) continue;
    const response = await fetch(path).catch(() => null);
    if (response?.ok) await cache.put(path, response);
  }
}

/** A map page from the network, kept for next time; the kept copy when the network fails or is too slow. */
async function mapPage(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE),
    key = new URL(request.url).pathname;
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  const kept = await cache.match(key);
  if (!kept) return network;
  const slow = new Promise<Response>((resolve) => setTimeout(() => resolve(kept), PATIENCE));
  return Promise.race([network.catch(() => kept), slow]);
}

/** Fonts change rarely: the kept copy first. */
async function font(request: Request): Promise<Response> {
  const cache = await caches.open(FONTS);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(font(request));
    return;
  }
  if (url.origin !== sw.location.origin) return;
  if (request.mode === "navigate" && MAP_PAGE.test(url.pathname)) {
    event.respondWith(mapPage(request));
    return;
  }
  if (!ASSETS.has(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const kept = await cache.match(url.pathname);
      if (kept) return kept;
      const response = await fetch(request);
      if (response.ok) cache.put(url.pathname, response.clone());
      return response;
    }),
  );
});
