import type { Piece } from "../model/layout.ts";
import type { FaqEntry } from "../model/faq.ts";
import { footprint, isCorridor, isOpenAir } from "../model/interiors.ts";
import type { WalkingNetwork } from "../wayfinding/navigation.ts";

export type Project = {
  title: string;
  pieces: Piece[];
  network: WalkingNetwork;
  width: number;
  height: number;
  /** Hospital information: questions the map can't answer. */
  faq?: FaqEntry[];
};

const grid = (p: Project) => ({ width: p.width, height: p.height, tileMeters: 2 });

/** What autosave stores (read back with `parseLayout`). */
export const layoutSnapshot = (p: Project) =>
  JSON.stringify({ title: p.title, pieces: p.pieces, network: p.network, grid: grid(p), faq: p.faq ?? [] });

/** The downloadable layout file. */
export const layoutJson = (p: Project) =>
  JSON.stringify(
    { version: 1, title: p.title, grid: grid(p), pieces: p.pieces, network: p.network, faq: p.faq ?? [] },
    null,
    2,
  );

/**
 * A Blender-friendly OBJ blockout: each piece's outline extruded to 1 m
 * (corridors), 0.1 m (paths, car parks and gateways) or 3 m (buildings). One unit is one metre.
 */
export function layoutObj(pieces: Piece[]) {
  let body = "# Hospital layout — 1 unit = 1 meter\n",
    v = 1;
  for (const p of pieces) {
    const height = isOpenAir(p) ? 0.1 : isCorridor(p) ? 1 : 3,
      poly = footprint(p).map(({ x, y }) => [x * 2, y * 2]),
      n = poly.length;
    body += `o ${p.name.replaceAll(" ", "_")}\n`;
    for (const elevation of [0, height]) for (const [a, b] of poly) body += `v ${a} ${b} ${elevation}\n`;
    // Floor (wound downwards), roof, then one quad per wall.
    body += "f " + poly.map((_, i) => v + n - 1 - i).join(" ") + "\n";
    body += "f " + poly.map((_, i) => v + n + i).join(" ") + "\n";
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      body += `f ${v + i} ${v + j} ${v + n + j} ${v + n + i}\n`;
    }
    v += n * 2;
  }
  return body;
}

/** A file name from the project title, e.g. "Greenfield Hospital" → "greenfield-hospital.json". */
export const fileName = (title: string, ext: string) => title.toLowerCase().replaceAll(" ", "-") + "." + ext;

export function downloadFile(body: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
