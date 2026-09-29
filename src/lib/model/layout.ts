import { parseNetwork } from "../wayfinding/navigation.ts";
import { doorFits, fitsRoom, isArea, isBuilding, roomTypes, type RoomAsset } from "./interiors.ts";
import { parseInfo, type PlaceInfo } from "./place-info.ts";
export type Piece = {
  id: number;
  name: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  rotation: number;
  entrances?: {
    side: "north" | "south" | "east" | "west";
    offset: number;
    width: number;
  }[];
  roomAssets?: RoomAsset[];
  rooms?: string[];
  /** Roof (buildings) or canopy (corridors) colour. Model default when unset. */
  roofColor?: string;
  /** Storeys shown on the exterior. Navigation uses the ground floor. */
  floors?: number;
  /** Buildings only: "L" cuts away one quarter, turning with `rotation`. */
  shape?: "L";
  /** Buildings, car parks and gateways: description, phone and hours shown to visitors. */
  info?: PlaceInfo;
};
export type Asset = {
  name: string;
  kind: string;
  w: number;
  h: number;
  color: string;
  label: string;
  group: "Buildings" | "Corridors" | "Outdoor" | "Templates";
  roofColor?: string;
  floors?: number;
  shape?: "L";
  roomAssets?: RoomAsset[];
  description?: string;
  /** Library thumbnail, when it isn't the kind's own render. */
  image?: string;
};
let templateRoom = 0;
const room = (
  type: RoomAsset["type"],
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  door: RoomAsset["door"] = "south",
): RoomAsset => ({ id: ++templateRoom, type, name, x, y, w, h, door });
export const assets: Asset[] = [
  {
    name: "Pitched roof building",
    group: "Buildings",
    kind: "pitched",
    w: 5,
    h: 4,
    color: "#d3ddd0",
    label: "Building",
  },
  {
    name: "Flat roof building",
    group: "Buildings",
    kind: "flat",
    w: 5,
    h: 4,
    color: "#d3ddd0",
    label: "Building",
  },
  {
    name: "L-shaped building",
    group: "Buildings",
    kind: "pitched",
    shape: "L",
    w: 6,
    h: 6,
    color: "#d3ddd0",
    label: "Building",
    image: "/models/l-shape.png",
  },
  {
    name: "Straight corridor",
    group: "Corridors",
    kind: "straight",
    w: 4,
    h: 1,
    color: "#d9d4c9",
    label: "4 × 1 tiles",
  },
  {
    name: "Corner corridor",
    group: "Corridors",
    kind: "corner",
    w: 2,
    h: 2,
    color: "#d9d4c9",
    label: "2 × 2 tiles",
  },
  {
    name: "T-junction",
    group: "Corridors",
    kind: "junction",
    w: 3,
    h: 2,
    color: "#d9d4c9",
    label: "3 × 2 tiles",
  },
  {
    name: "Cross junction",
    group: "Corridors",
    kind: "cross",
    w: 3,
    h: 3,
    color: "#d9d4c9",
    label: "3 × 3 tiles",
  },
  {
    name: "Garden path",
    group: "Outdoor",
    kind: "path",
    w: 4,
    h: 1,
    color: "#cfc6b4",
    label: "4 × 1 tiles",
    description: "Open-air paved walkway, no roof",
    image: "/models/path.png",
  },
  {
    name: "Car park",
    group: "Outdoor",
    kind: "parking",
    w: 6,
    h: 4,
    color: "#7c8286",
    label: "6 × 4 tiles",
    description: "Open-air parking area with marked bays, no building",
    image: "/models/parking.svg",
  },
  {
    name: "Small car park",
    group: "Outdoor",
    kind: "parking",
    w: 3,
    h: 3,
    color: "#7c8286",
    label: "3 × 3 tiles",
    description: "A few bays, e.g. drop-off or disabled parking",
    image: "/models/parking.svg",
  },
  {
    name: "Motorcycle parking",
    group: "Outdoor",
    kind: "motorcycle",
    w: 4,
    h: 3,
    color: "#80868a",
    label: "4 × 3 tiles",
    description: "Narrow 1 × 2 m bays for motorcycles and scooters",
    image: "/models/motorcycle.svg",
  },
  {
    name: "Campus entrance",
    group: "Outdoor",
    kind: "gate",
    w: 5,
    h: 1,
    color: "#b9b2a3",
    label: "5 × 1 tiles",
    description: "Gateway over the drive with the hospital's name on it",
    image: "/models/gate.svg",
  },
  {
    name: "Parking gate",
    group: "Outdoor",
    kind: "barrier",
    w: 3,
    h: 1,
    color: "#6f7579",
    label: "3 × 1 tiles",
    description: "Ticket booth and barrier arm across a car park lane",
    image: "/models/barrier.svg",
  },
  {
    name: "Outpatient clinic",
    group: "Templates",
    kind: "flat",
    w: 6,
    h: 5,
    color: "#e4e8df",
    roofColor: "#8fa39a",
    label: "6 × 5 tiles",
    description: "Reception, waiting, 3 exam rooms, toilets",
    roomAssets: [
      room("reception", "Reception", 2, 4, 2, 1, "north"),
      room("waiting", "Waiting area", 4, 3, 2, 2, "west"),
      room("exam", "Exam room 1", 0, 0, 2, 2),
      room("exam", "Exam room 2", 2, 0, 2, 2),
      room("exam", "Exam room 3", 4, 0, 2, 2),
      room("toilet", "Toilets", 0, 4, 1, 1, "east"),
    ],
  },
  {
    name: "L-shaped day clinic",
    group: "Templates",
    kind: "flat",
    shape: "L",
    w: 8,
    h: 6,
    color: "#e4e8df",
    roofColor: "#8fa39a",
    label: "8 × 6 tiles",
    description: "L-shaped: reception, waiting, 3 exam rooms",
    image: "/models/l-shape.png",
    roomAssets: [
      room("exam", "Exam room 1", 0, 0, 2, 2),
      room("exam", "Exam room 2", 2, 0, 2, 2),
      room("toilet", "Toilets", 0, 3, 1, 1, "east"),
      room("reception", "Reception", 0, 5, 2, 1, "north"),
      room("waiting", "Waiting area", 4, 4, 2, 2, "north"),
      room("exam", "Exam room 3", 6, 4, 2, 2, "north"),
    ],
  },
  {
    name: "Inpatient ward",
    group: "Templates",
    kind: "pitched",
    w: 8,
    h: 5,
    color: "#dfe6dc",
    label: "8 × 5 tiles",
    description: "6 patient rooms and a nurse station",
    roomAssets: [
      room("patient", "Room 1", 0, 0, 2, 2),
      room("patient", "Room 2", 2, 0, 2, 2),
      room("patient", "Room 3", 4, 0, 2, 2),
      room("patient", "Room 4", 6, 0, 2, 2),
      room("patient", "Room 5", 0, 3, 2, 2, "north"),
      room("nurse", "Nurse station", 3, 3, 2, 1, "north"),
      room("patient", "Room 6", 6, 3, 2, 2, "north"),
    ],
  },
  {
    name: "Emergency department",
    group: "Templates",
    kind: "flat",
    w: 7,
    h: 5,
    color: "#efe3dc",
    roofColor: "#b0564a",
    label: "7 × 5 tiles",
    description: "Triage, treatment bays, theatre, pharmacy",
    roomAssets: [
      room("reception", "Triage desk", 0, 4, 2, 1, "north"),
      room("exam", "Treatment bay 1", 0, 0, 2, 2),
      room("exam", "Treatment bay 2", 2, 0, 2, 2),
      room("surgery", "Resuscitation", 4, 0, 3, 2),
      room("pharmacy", "Pharmacy", 5, 4, 2, 1, "north"),
      room("stairs", "Stairs & lift", 6, 2, 1, 2, "west"),
    ],
  },
];
/** A new piece from a library asset, keeping only the fields a piece stores. */
export function pieceFrom(
  a: Asset,
  extra: Partial<Piece> & { id: number; x: number; y: number },
): Piece {
  return {
    name: a.name,
    kind: a.kind,
    w: a.w,
    h: a.h,
    color: a.color,
    rotation: 0,
    rooms: [],
    ...(a.roofColor && { roofColor: a.roofColor }),
    ...(a.floors && { floors: a.floors }),
    ...(a.shape && { shape: a.shape }),
    ...(a.roomAssets && {
      roomAssets: a.roomAssets.map((r, i) => ({ ...r, id: extra.id + i + 1 })),
    }),
    ...extra,
  };
}
const byName = (name: string) => assets.find((a) => a.name === name)!;
const pitched = byName("Pitched roof building"),
  flat = byName("Flat roof building"),
  straight = byName("Straight corridor");
export const starterPieces: Piece[] = [
  pieceFrom(pitched, {
    id: 1,
    name: "West patient ward",
    x: 4,
    y: 4,
    floors: 2,
    roomAssets: [
      room("patient", "Room 1", 0, 0, 2, 2),
      room("patient", "Room 2", 2, 0, 2, 2),
      room("nurse", "Nurse station", 0, 3, 2, 1, "north"),
      room("toilet", "Toilets", 2, 3, 1, 1, "north"),
    ],
  }),
  pieceFrom(pitched, {
    id: 2,
    name: "East patient ward",
    x: 15,
    y: 4,
    floors: 2,
    roomAssets: [
      room("patient", "Room 3", 1, 0, 2, 2),
      room("patient", "Room 4", 3, 0, 2, 2),
      room("stairs", "Stairs & lift", 3, 3, 2, 1, "north"),
    ],
  }),
  pieceFrom(straight, { id: 3, name: "West connection", x: 9, y: 6, w: 6 }),
  pieceFrom(straight, {
    id: 4,
    name: "Central corridor",
    x: 11,
    y: 7,
    w: 2,
    h: 7,
  }),
  pieceFrom(flat, {
    id: 5,
    name: "Outpatient clinic",
    x: 5,
    y: 10,
    w: 4,
    h: 3,
    roofColor: "#8fa39a",
    roomAssets: [
      room("exam", "Exam room 1", 0, 0, 2, 2),
      room("exam", "Exam room 2", 2, 0, 2, 1),
    ],
  }),
  pieceFrom(straight, { id: 6, x: 9, y: 11, w: 2 }),
  pieceFrom(pitched, {
    id: 7,
    name: "Pharmacy & lab",
    x: 15,
    y: 10,
    w: 3,
    h: 3,
    color: "#e6ddd0",
    roomAssets: [
      room("pharmacy", "Pharmacy", 1, 0, 2, 1),
      room("lab", "Laboratory", 1, 2, 2, 1, "north"),
    ],
  }),
  pieceFrom(straight, { id: 8, x: 13, y: 11, w: 2 }),
  pieceFrom(flat, {
    id: 9,
    name: "Main reception",
    x: 10,
    y: 14,
    w: 4,
    h: 2,
    entrances: [{ side: "south", offset: 2, width: 0.8 }],
    roomAssets: [
      room("reception", "Reception desk", 0, 1, 1, 1, "north"),
      room("waiting", "Waiting area", 3, 0, 1, 2, "west"),
    ],
  }),
];
export const STORAGE_KEY = "hospital-layout";
export function parseLayout(text: string) {
  const d = JSON.parse(text);
  const width = d.grid?.width ?? 24,
    height = d.grid?.height ?? 20;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 8 ||
    height < 8 ||
    width > 100 ||
    height > 100
  )
    throw Error("Canvas must be 8–100 tiles");
  if (Array.isArray(d.pieces))
    d.pieces = d.pieces.map((p: Piece) => ({
      ...p,
      kind: ["ward", "emergency", "consult"].includes(p.kind)
        ? "pitched"
        : p.kind === "reception"
          ? "flat"
          : p.kind,
      rooms: p.rooms ?? [],
    }));
  if (
    !Array.isArray(d.pieces) ||
    !d.pieces.every(
      (p: Piece) =>
        assets.some((a) => a.kind === p.kind) &&
        typeof p.name === "string" &&
        Array.isArray(p.rooms) &&
        p.rooms.length <= 100 &&
        p.rooms.every(
          (r) =>
            typeof r === "string" && r.trim().length > 0 && r.length <= 100,
        ) &&
        ["x", "y", "w", "h", "id", "rotation"].every((k) =>
          Number.isInteger((p as unknown as Record<string, number>)[k]),
        ) &&
        p.w > 0 &&
        p.h > 0 &&
        p.x >= 0 &&
        p.y >= 0 &&
        p.x + p.w <= width &&
        p.y + p.h <= height &&
        [0, 90, 180, 270].includes(p.rotation) &&
        /^#[0-9a-f]{6}$/i.test(p.color) &&
        (p.roofColor === undefined || /^#[0-9a-f]{6}$/i.test(p.roofColor)) &&
        (p.floors === undefined ||
          (Number.isInteger(p.floors) && p.floors >= 1 && p.floors <= 4)) &&
        (p.shape === undefined || (p.shape === "L" && isBuilding(p))),
    )
  )
    throw Error("Invalid layout");
  for (const p of d.pieces as Piece[]) {
    if (
      p.entrances !== undefined &&
      (!Array.isArray(p.entrances) ||
        p.entrances.some(
          (e) =>
            !e ||
            !["north", "south", "east", "west"].includes(e.side) ||
            !Number.isFinite(e.offset) ||
            !Number.isFinite(e.width) ||
            e.width < 0.3 ||
            e.width > 2 ||
            !doorFits(p, e),
        ))
    )
      throw Error("Invalid entrance");
    if (
      p.roomAssets !== undefined &&
      (!Array.isArray(p.roomAssets) ||
        p.roomAssets.length > 100 ||
        p.roomAssets.some(
          (r) =>
            !r ||
            !roomTypes.some((t) => t.type === r.type) ||
            (r.door !== undefined &&
              !["north", "south", "east", "west"].includes(r.door)) ||
            (r.color !== undefined && !/^#[0-9a-f]{6}$/i.test(r.color)) ||
            typeof r.name !== "string" ||
            !r.name.trim() ||
            r.name.length > 100 ||
            !["x", "y", "w", "h", "id"].every((k) =>
              Number.isInteger((r as unknown as Record<string, number>)[k]),
            ) ||
            r.w < 1 ||
            r.h < 1 ||
            !fitsRoom(p, r, p.roomAssets),
        ))
    )
      throw Error("Invalid interior rooms");
    p.info = isBuilding(p) || isArea(p) ? parseInfo(p.info) : undefined;
    for (const r of p.roomAssets ?? []) r.info = parseInfo(r.info);
  }
  const network = parseNetwork(d.network, width, height);
  return {
    network,
    title: typeof d.title === "string" ? d.title : "Hospital map",
    pieces: d.pieces as Piece[],
    grid: { width, height, tileMeters: 2 },
  };
}
