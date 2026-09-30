/**
 * How a hospital is stored in the database: the site (title, canvas and
 * walking paths), one row per building or outdoor piece, and the hospital
 * information in its own tables — details per place, doctors and the
 * questions & answers. `splitLayout` turns an editor layout into those rows
 * and `joinLayout` puts them back together.
 */
import type { Piece } from "./layout.ts";
import type { FaqEntry, TopicId } from "./faq.ts";
import type { Doctor } from "./doctors.ts";
import type { PlaceInfo } from "./place-info.ts";
import type { WalkingNetwork } from "../wayfinding/navigation.ts";

export type Site = { title: string; width: number; height: number; network: WalkingNetwork };
export type BuildingRow = { pieceId: number; order: number; piece: Piece };
/** `place` is "b:<piece>", "r:<piece>:<room>" or "n:<waypoint>". */
export type PlaceRow = { place: string; info: Omit<PlaceInfo, "doctors"> };
export type DoctorRow = Doctor & { place: string; order: number };
export type FaqRow = { order: number; topic: TopicId; question: string; answer: string };
export type Records = {
  site: Site;
  buildings: BuildingRow[];
  places: PlaceRow[];
  doctors: DoctorRow[];
  faq: FaqRow[];
};

/** A plain copy without undefined fields, which the database can't store. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Splits a parsed layout into database rows. */
export function splitLayout(layout: {
  title: string;
  grid: { width: number; height: number };
  pieces: Piece[];
  network: WalkingNetwork;
  faq: FaqEntry[];
}): Records {
  const places: PlaceRow[] = [],
    doctors: DoctorRow[] = [];
  function take(place: string, info: PlaceInfo | undefined) {
    if (!info) return;
    const { doctors: list, ...rest } = info;
    if (Object.keys(rest).length) places.push({ place, info: plain(rest) });
    list?.forEach((d, order) => doctors.push(plain({ ...d, place, order })));
  }
  const buildings = layout.pieces.map((p, order) => {
    const { info, ...piece } = p;
    take(`b:${p.id}`, info);
    return {
      pieceId: p.id,
      order,
      piece: plain({
        ...piece,
        ...(piece.roomAssets && {
          roomAssets: piece.roomAssets.map(({ info, ...room }) => {
            take(`r:${p.id}:${room.id}`, info);
            return room;
          }),
        }),
      }) as Piece,
    };
  });
  const network = {
    nodes: layout.network.nodes.map(({ info, ...node }) => {
      take(`n:${node.id}`, info);
      return node;
    }),
    edges: layout.network.edges,
  };
  return {
    site: plain({ title: layout.title, width: layout.grid.width, height: layout.grid.height, network }),
    buildings,
    places,
    doctors,
    faq: layout.faq.map((e, order) => ({ order, topic: e.topic ?? "lainnya", question: e.question, answer: e.answer })),
  };
}

/** Puts database rows back together as a layout, in the form autosave stores (read with `parseLayout`). */
export function joinLayout(r: Records) {
  const info = new Map<string, PlaceInfo>();
  for (const p of r.places) info.set(p.place, { ...p.info });
  for (const d of [...r.doctors].sort((a, b) => a.order - b.order)) {
    const { place, order: _, ...doctor } = d;
    const at = info.get(place) ?? {};
    info.set(place, { ...at, doctors: [...(at.doctors ?? []), doctor] });
  }
  const pieces = [...r.buildings]
    .sort((a, b) => a.order - b.order)
    .map(({ piece }) => ({
      ...piece,
      ...(piece.roomAssets && {
        roomAssets: piece.roomAssets.map((room) => ({ ...room, info: info.get(`r:${piece.id}:${room.id}`) })),
      }),
      info: info.get(`b:${piece.id}`),
    }));
  const network = {
    nodes: r.site.network.nodes.map((n) => ({ ...n, info: info.get(`n:${n.id}`) })),
    edges: r.site.network.edges,
  };
  return plain({
    title: r.site.title,
    pieces,
    network,
    grid: { width: r.site.width, height: r.site.height, tileMeters: 2 },
    faq: [...r.faq].sort((a, b) => a.order - b.order).map(({ topic, question, answer }) => ({ question, answer, topic })),
  });
}

/** JSON with sorted keys, to tell whether a stored row changed. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
