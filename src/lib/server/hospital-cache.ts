/**
 * The hospital for the assistant, kept in memory between questions: the map
 * is parsed and the walking grid built once per saved version, and only a
 * small version check goes to the database for each question. Kept per
 * language, as rooms named by the editor read in the visitor's (`localizeRooms`).
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { parseLayout } from "../model/layout.ts";
import { assistantContext, type AssistantContext } from "../assistant/tools.ts";
import type { FaqEntry } from "../model/faq.ts";
import type { Lang } from "../i18n/lang.ts";
import { localizeRooms } from "../i18n/places.ts";

export type CachedHospital = {
  slug: string;
  revision: number;
  title: string;
  faq: FaqEntry[];
  /** The tools' view of the map, without the time (each question has its own). */
  map: Omit<AssistantContext, "now">;
};

const hospitals = new Map<string, CachedHospital>();

export async function hospitalFor(convex: ConvexHttpClient, lang: Lang, slug?: string): Promise<CachedHospital | null> {
  const version = await convex.query(api.hospital.version, slug ? { slug } : {});
  if (!version) return null;
  const key = `${version.slug}:${lang}`;
  const kept = hospitals.get(key);
  if (kept?.revision === version.revision) return kept;
  const saved = await convex.query(api.hospital.get, { slug: version.slug });
  if (!saved) return null;
  const layout = parseLayout(saved.layout);
  const { now: _, ...map } = assistantContext({ ...layout, pieces: localizeRooms(layout.pieces, lang) }, new Date());
  const hospital = { slug: saved.slug, revision: saved.revision, title: layout.title, faq: layout.faq, map };
  hospitals.set(key, hospital);
  return hospital;
}
