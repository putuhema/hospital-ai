/**
 * Leaflets, brochures and posters the hospital uploads as images (a BPJS
 * flow, a price list, a doctors' schedule poster). The image lives in Vercel
 * Blob; its title and the text written from it are what the assistant
 * searches (`search_leaflets`), and it shows the image in the chat
 * (`show_leaflet`). Kept in their own table (convex/leaflets.ts), apart from
 * the map, so uploading one never touches the editor's layout.
 */
import type { TopicId } from "./faq.ts";

export type Leaflet = {
  id: string;
  /** The image, public on Vercel Blob. */
  url: string;
  /** e.g. "Alur pendaftaran pasien BPJS". */
  title: string;
  /** What the leaflet says, written out (by hand or read from the image), for the assistant to answer from. */
  text: string;
  topic: TopicId;
  /** The image's size in pixels, so the chat keeps its space before it loads. */
  width?: number;
  height?: number;
};

/** What the chat shows for a leaflet; also how it is replayed from a kept answer. */
export type LeafletImage = Pick<Leaflet, "id" | "url" | "title" | "width" | "height">;

export const MAX_LEAFLETS = 60;
export const MAX_LEAFLET_TITLE = 120;
export const MAX_LEAFLET_TEXT = 4000;
/** Largest image accepted, in bytes; the editor makes big photos smaller before uploading. */
export const MAX_LEAFLET_BYTES = 8 * 1024 * 1024;
export const LEAFLET_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Whether a URL is an image this app uploaded to Vercel Blob (public store, under leaflets/). */
export function isLeafletUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com") && u.pathname.startsWith("/leaflets/");
  } catch {
    return false;
  }
}

/** The leaflet as the chat shows it. */
export const leafletImage = (l: Leaflet): LeafletImage => ({
  id: l.id,
  url: l.url,
  title: l.title,
  ...(l.width && l.height && { width: l.width, height: l.height }),
});
