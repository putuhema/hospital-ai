import type { Piece } from "../model/layout.ts";
import { corridorDoors, doorFits, fitsRoom, overlaps, rotateSide, type Door, type Side } from "../model/interiors.ts";
import type { WalkingNetwork } from "../wayfinding/navigation.ts";

/**
 * Editing rules for the layout editor. Each check returns a message to show
 * the user when the change isn't allowed, or null when it is.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Canvas = { width: number; height: number };

export const MIN_CANVAS = 8,
  MAX_CANVAS = 100;

export const insideCanvas = (r: Rect, c: Canvas) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= c.width && r.y + r.h <= c.height;

/** True when a piece's actual footprint (L shapes included) overlaps another piece. */
export const occupied = (pieces: Piece[], p: Piece) => pieces.some((o) => o.id !== p.id && overlaps(p, o));

export function checkMove(pieces: Piece[], p: Piece, x: number, y: number, canvas: Canvas) {
  if (!insideCanvas({ ...p, x, y }, canvas)) return "Keep the building inside the canvas";
  if (occupied(pieces, { ...p, x, y })) return "This space is occupied";
  return null;
}

export function checkPlacement(pieces: Piece[], piece: Piece, canvas: Canvas) {
  if (!insideCanvas(piece, canvas)) return "Keep the asset inside the grid";
  if (occupied(pieces, piece)) return "This space is occupied. Choose an empty grid area.";
  return null;
}

export function checkCanvasSize(pieces: Piece[], network: WalkingNetwork, w: number, h: number) {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < MIN_CANVAS ||
    h < MIN_CANVAS ||
    w > MAX_CANVAS ||
    h > MAX_CANVAS
  )
    return `Use whole numbers between ${MIN_CANVAS} and ${MAX_CANVAS} tiles`;
  if (pieces.some((p) => p.x + p.w > w || p.y + p.h > h))
    return "Move buildings inside the new bounds before shrinking";
  if (network.nodes.some((p) => p.x > w || p.y > h))
    return "Remove paths outside the new bounds before shrinking";
  return null;
}

/** Changing a building's width, depth or shape must keep its doors and rooms on it. */
export function checkReshape(pieces: Piece[], next: Piece) {
  if ((next.entrances ?? []).some((e) => !doorFits(next, e)))
    return "Move or remove entrances outside the new wall bounds first";
  if ((next.roomAssets ?? []).some((r) => !fitsRoom(next, r)))
    return "Remove rooms outside the new building bounds first";
  if (occupied(pieces, next)) return "This space is occupied";
  return null;
}

/**
 * Turn a piece 90° clockwise about its centre (nudged back onto the canvas),
 * carrying its entrances and rooms with it.
 */
export function rotated(p: Piece, canvas: Canvas): Piece {
  return {
    ...p,
    x: Math.max(0, Math.min(canvas.width - p.h, p.x + Math.floor((p.w - p.h) / 2))),
    y: Math.max(0, Math.min(canvas.height - p.w, p.y + Math.floor((p.h - p.w) / 2))),
    w: p.h,
    h: p.w,
    rotation: (p.rotation + 90) % 360,
    entrances: p.entrances?.map((e) => ({
      ...e,
      side: rotateSide(e.side),
      offset: e.side === "east" || e.side === "west" ? p.h - e.offset : e.offset,
    })),
    roomAssets: p.roomAssets?.map((r) => ({
      ...r,
      x: p.h - r.y - r.h,
      y: r.x,
      w: r.h,
      h: r.w,
      door: rotateSide(r.door ?? "south"),
    })),
  };
}

export function checkRotation(pieces: Piece[], turned: Piece, canvas: Canvas) {
  return turned.w > canvas.width || turned.h > canvas.height || occupied(pieces, turned)
    ? "Not enough space to rotate here"
    : null;
}

/**
 * A piece placed from the draft being set up before placing: its own id,
 * the clicked tile, and fresh ids for the rooms it brings along.
 */
export function placedFrom(draft: Piece, id: number, tile: { x: number; y: number }): Piece {
  return {
    ...structuredClone(draft),
    id,
    ...tile,
    ...(draft.roomAssets && { roomAssets: draft.roomAssets.map((r, i) => ({ ...r, id: id + i + 1 })) }),
  };
}

/** A copy one tile down and to the right, kept on the canvas. */
export function duplicated(p: Piece, id: number, canvas: Canvas): Piece {
  return {
    ...p,
    id,
    x: Math.min(canvas.width - p.w, p.x + 1),
    y: Math.min(canvas.height - p.h, p.y + 1),
    name: p.name + " copy",
  };
}

/** A new manual entrance, or a message when it doesn't fit or clashes with a door. */
export function newEntrance(
  p: Piece,
  pieces: Piece[],
  side: Side,
  offset: number,
): { entry: Door } | { error: string } {
  const entry = { side, offset, width: 0.8 };
  if (!Number.isFinite(offset) || !doorFits(p, entry)) return { error: "Entrance must fit on the wall" };
  if (
    [...(p.entrances ?? []), ...corridorDoors(p, pieces)].some(
      (d) => d.side === side && Math.abs(d.offset - offset) < 0.8,
    )
  )
    return { error: "There is already a door here" };
  return { entry };
}
