/**
 * Getting a leaflet image ready to upload, in the browser: a phone photo of a
 * brochure is made smaller (at most `MAX_SIDE` pixels on its long side), so
 * visitors on budget phones load it quickly, and its size is measured so the
 * chat keeps its space while it loads. GIFs, and images small enough already,
 * go as they are.
 */
export const MAX_SIDE = 2000;
const SMALL_ENOUGH = 1.5 * 1024 * 1024;

export type ReadyImage = { body: Blob; name: string; width: number; height: number };

/** The name a file is kept under: lowercase letters, digits and dashes, with the right extension. */
export function safeName(name: string, type: string): string {
  const base =
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "leaflet";
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type] ?? "jpg";
  return `${base}.${ext}`;
}

/** A leaflet's title from its file name, e.g. "alur_bpjs-2026.jpg" → "Alur bpjs 2026". */
export function titleFrom(name: string): string {
  const words = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export async function readyImage(file: File): Promise<ReadyImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (file.type === "image/gif" || (scale === 1 && file.size <= SMALL_ENOUGH)) {
    bitmap.close();
    return { body: file, name: safeName(file.name, file.type), width, height };
  }
  const w = Math.round(width * scale),
    h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  // A transparent PNG goes on white, as it would be printed.
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.86));
  // WebP where the browser can write it, else JPEG.
  let body = await encode("image/webp");
  if (!body || body.type !== "image/webp") body = await encode("image/jpeg");
  if (!body) throw Error("This image couldn't be prepared.");
  return { body, name: safeName(file.name, body.type), width: w, height: h };
}
