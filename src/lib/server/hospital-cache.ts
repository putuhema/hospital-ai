/**
 * The hospital for the assistant, kept in memory between questions: the map
 * is parsed and the walking grid built once per saved version, and only a
 * small version check goes to the database for each question.
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { parseLayout } from "../model/layout.ts";
import { assistantContext, type AssistantContext } from "../assistant/tools.ts";
import type { FaqEntry } from "../model/faq.ts";

export type CachedHospital = {
  slug: string;
  revision: number;
  title: string;
  faq: FaqEntry[];
  /** The tools' view of the map, without the time (each question has its own). */
  map: Omit<AssistantContext, "now">;
};

const hospitals = new Map<string, CachedHospital>();

export async function hospitalFor(convex: ConvexHttpClient, slug?: string): Promise<CachedHospital | null> {
  const version = await convex.query(api.hospital.version, slug ? { slug } : {});
  if (!version) return null;
  const kept = hospitals.get(version.slug);
  if (kept?.revision === version.revision) return kept;
  const saved = await convex.query(api.hospital.get, { slug: version.slug });
  if (!saved) return null;
  const layout = parseLayout(saved.layout);
  const { now: _, ...map } = assistantContext(layout, new Date());
  const hospital = { slug: saved.slug, revision: saved.revision, title: layout.title, faq: layout.faq, map };
  hospitals.set(saved.slug, hospital);
  return hospital;
}
