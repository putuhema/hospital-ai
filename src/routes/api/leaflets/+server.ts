import { json, type RequestHandler } from "@sveltejs/kit";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { env } from "$env/dynamic/private";
import { signedIn } from "$lib/server/editor";
import { isLeafletUrl, LEAFLET_TYPES, MAX_LEAFLET_BYTES } from "$lib/model/leaflets";

/**
 * Leaflet images on Vercel Blob (lib/model/leaflets.ts). The editor uploads
 * straight to Blob (`upload` from @vercel/blob/client), so a big image never
 * passes through this function: POST only hands out a short-lived upload token
 * to a signed-in admin. DELETE removes an image the editor has just forgotten
 * (convex/leaflets.ts `remove`). Needs `BLOB_READ_WRITE_TOKEN`.
 */

const notSetUp = () => json({ error: "Leaflet uploads are not set up: BLOB_READ_WRITE_TOKEN is missing." }, { status: 503 });

export const POST: RequestHandler = async (event) => {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return notSetUp();
  const body = (await event.request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return json({ error: "Invalid request." }, { status: 400 });
  // Asking for a token needs an admin; Blob's own "upload completed" call is checked by handleUpload.
  if (body.type === "blob.generate-client-token" && !(await signedIn(event))?.editor)
    return json({ error: "Only admins can upload leaflets." }, { status: 403 });
  try {
    const result = await handleUpload({
      token,
      request: event.request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("leaflets/")) throw Error("Leaflets go under leaflets/");
        return { allowedContentTypes: LEAFLET_TYPES, maximumSizeInBytes: MAX_LEAFLET_BYTES, addRandomSuffix: true };
      },
    });
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async (event) => {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return notSetUp();
  if (!(await signedIn(event))?.editor) return json({ error: "Only admins can remove leaflets." }, { status: 403 });
  const { url } = ((await event.request.json().catch(() => null)) ?? {}) as { url?: unknown };
  if (typeof url !== "string" || !isLeafletUrl(url)) return json({ error: "Not a leaflet image." }, { status: 400 });
  await del(url, { token });
  return new Response(null, { status: 204 });
};
