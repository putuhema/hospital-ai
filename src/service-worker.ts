/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Keeps the app's code and 3D models on the visitor's phone, so the map opens
 * straight away on the next visit and on a weak hospital connection. Pages,
 * the hospital's data and the chat always come from the network.
 */
import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `p-map-${version}`;
const ASSETS = new Set([...build, ...files]);

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...ASSETS])));
});

sw.addEventListener("activate", (event) => {
  // Drop the files of earlier versions.
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== sw.location.origin || !ASSETS.has(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const kept = await cache.match(url.pathname);
      if (kept) return kept;
      const response = await fetch(event.request);
      if (response.ok) cache.put(url.pathname, response.clone());
      return response;
    }),
  );
});
