/**
 * Publishing: the editor pushes its layout to Convex and visitors open it at
 * /m/<slug>. The device that first publishes keeps the slug and a secret key,
 * which it needs to update the public map later.
 */
export type Publication = { slug: string; key: string };

const KEY = "p-map-publication";

export function readPublication(): Publication | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return typeof p?.slug === "string" && typeof p?.key === "string" ? p : null;
  } catch {
    return null;
  }
}

export const savePublication = (p: Publication) => localStorage.setItem(KEY, JSON.stringify(p));
export const forgetPublication = () => localStorage.removeItem(KEY);

/** A new secret for updating a published map (not stored on the server, only its hash). */
export const newPublishKey = () => crypto.randomUUID() + crypto.randomUUID();

/** The public address of a published map. */
export const publicUrl = (slug: string, origin = location.origin) => `${origin}/m/${slug}`;
