import * as THREE from "three";

/**
 * The light over the campus at a time of day, as the visitor's clock tells it:
 * cool night, a rosy dawn, plain daylight, a warm late afternoon, a purple
 * dusk, then night again with the windows lit. Pure, so it can be tested.
 */
export type Daylight = {
  /** Sky and ground colours of the hemisphere light, and its strength. */
  sky: string;
  ground: string;
  hemi: number;
  /** The sun's (or at night the moon's) colour and strength. */
  sun: string;
  sunStrength: number;
  /** The lawn, and the colour the map clears to. */
  lawn: string;
  /** How lit the windows are, 0 (day) to 1 (night). */
  windows: number;
};

// Night stays easy to read: a soft blue evening, not darkness.
const NIGHT: Daylight = { sky: "#8a98c8", ground: "#56634a", hemi: 2.2, sun: "#c3cdff", sunStrength: 1.1, lawn: "#a3ae98", windows: 1 },
  DAWN: Daylight = { sky: "#f0d6c6", ground: "#8f9b7c", hemi: 1.7, sun: "#ffc49a", sunStrength: 1.9, lawn: "#c8d0b6", windows: 0.45 },
  DAY: Daylight = { sky: "#e3eef8", ground: "#a3b88c", hemi: 2.4, sun: "#fff0d8", sunStrength: 3.1, lawn: "#dbe4cc", windows: 0 },
  GOLDEN: Daylight = { sky: "#f6e2c8", ground: "#aaa880", hemi: 2.1, sun: "#ffc98a", sunStrength: 2.6, lawn: "#d7dbbf", windows: 0.15 },
  DUSK: Daylight = { sky: "#a99cc4", ground: "#69705a", hemi: 2.1, sun: "#ff9f7a", sunStrength: 1.5, lawn: "#b9b9a2", windows: 0.8 };

/** Hours (0–24) and the light at each; between them it blends. */
const KEYS: [number, Daylight][] = [
  [0, NIGHT],
  [5.3, NIGHT],
  [6.3, DAWN],
  [7.6, DAY],
  [15.6, DAY],
  [17.2, GOLDEN],
  [18.3, DUSK],
  [19.2, NIGHT],
  [24, NIGHT],
];

const a = new THREE.Color(),
  b = new THREE.Color();
const blend = (x: string, y: string, t: number) => `#${a.set(x).lerp(b.set(y), t).getHexString()}`;

/** The light at `hours` (e.g. 17.5 for half past five in the afternoon). */
export function daylightAt(hours: number): Daylight {
  const h = ((hours % 24) + 24) % 24;
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i][0] < h) i++;
  const [h0, from] = KEYS[i - 1],
    [h1, to] = KEYS[i],
    t = h1 > h0 ? Math.min(1, Math.max(0, (h - h0) / (h1 - h0))) : 0,
    mix = (x: number, y: number) => x + (y - x) * t;
  return {
    sky: blend(from.sky, to.sky, t),
    ground: blend(from.ground, to.ground, t),
    hemi: mix(from.hemi, to.hemi),
    sun: blend(from.sun, to.sun, t),
    sunStrength: mix(from.sunStrength, to.sunStrength),
    lawn: blend(from.lawn, to.lawn, t),
    windows: mix(from.windows, to.windows),
  };
}

/**
 * Where the light comes from, as a direction (x east, z south, y up): the sun
 * rising in the east and setting in the west, nearly overhead at noon (the
 * hospital is near the equator); at night the moon, high and to the north.
 */
export function sunFrom(hours: number) {
  const h = ((hours % 24) + 24) % 24;
  if (h < 6 || h > 18.5) return new THREE.Vector3(0.25, 1, -0.35).normalize();
  const arc = Math.min(1, Math.max(0, (h - 6) / 12.5)) * Math.PI,
    height = Math.max(0.18, Math.sin(arc));
  return new THREE.Vector3(Math.cos(arc), height * 1.6, 0.2).normalize();
}

/** Moments in the day, for "more people about during clinic hours": 1 by day, fewer at night. */
export function busyHours(hours: number) {
  const h = ((hours % 24) + 24) % 24;
  if (h >= 7 && h <= 16) return 1;
  if (h >= 6 && h < 7) return 0.6;
  if (h > 16 && h <= 19) return 0.7;
  return 0.35;
}
