/**
 * Visitor details for a destination (building, room or landmark): what it is,
 * how to call it, when it is open and which doctors practise there. Wards use
 * visiting hours instead. The hours themselves are in hours.ts.
 */
import { tidyHours, validHours, type Hours } from "./hours.ts";
import { parseDoctors, type Doctor } from "./doctors.ts";

export * from "./hours.ts";

export type PlaceInfo = {
  description?: string;
  phone?: string;
  hours?: Hours[];
  /** The hours are visiting hours (e.g. a ward), not opening hours. */
  visiting?: boolean;
  /** Other names people search for: services, local terms. */
  keywords?: string[];
  /** Doctors who practise here, with their schedules. */
  doctors?: Doctor[];
};

/** Validates stored details; returns undefined when there are none. */
export function parseInfo(value: unknown): PlaceInfo | undefined {
  if (value === undefined) return undefined;
  const d = value as PlaceInfo;
  const text = (s: unknown, max: number) => s === undefined || (typeof s === "string" && s.length <= max);
  if (
    !d ||
    typeof d !== "object" ||
    !text(d.description, 500) ||
    !text(d.phone, 40) ||
    (d.visiting !== undefined && typeof d.visiting !== "boolean") ||
    (d.keywords !== undefined &&
      (!Array.isArray(d.keywords) ||
        d.keywords.length > 40 ||
        d.keywords.some((k) => typeof k !== "string" || k.length > 80))) ||
    (d.hours !== undefined && !validHours(d.hours))
  )
    throw Error("Invalid place details");
  const info: PlaceInfo = {};
  if (d.description?.trim()) info.description = d.description.trim();
  if (d.phone?.trim()) info.phone = d.phone.trim();
  if (d.hours?.length) info.hours = tidyHours(d.hours);
  if (d.visiting) info.visiting = true;
  const keywords = [...new Set((d.keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  if (keywords.length) info.keywords = keywords;
  const doctors = parseDoctors(d.doctors);
  if (doctors) info.doctors = doctors;
  return Object.keys(info).length ? info : undefined;
}
