import { ConvexHttpClient } from "convex/browser";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { api } from "../../convex/_generated/api";

/**
 * The web app manifest, so visitors can add the map to their home screen.
 * `?start=` is the page it was installed from, / or the public address
 * /m/<slug>; the installed app opens there, under the hospital's name.
 */
export async function GET({ url }) {
  const start = url.searchParams.get("start") ?? "/";
  const slug = start.match(/^\/m\/([a-z0-9]+)$/)?.[1];
  const hospital = await new ConvexHttpClient(PUBLIC_CONVEX_URL)
    .query(api.hospital.version, slug ? { slug } : {})
    .catch(() => null);
  const name = hospital?.title ?? "P-Map";
  const manifest = {
    id: slug ? `/m/${slug}` : "/",
    name,
    short_name: name.length > 12 ? name.replace(/^(RSUD|RSU|RS)\s+/i, "") : name,
    description: "Peta, arah dan jadwal dokter rumah sakit.",
    lang: "id",
    start_url: slug ? `/m/${slug}` : "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f3ea",
    theme_color: "#f6f3ea",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" },
  });
}
