/**
 * Languages of the visitor map and the assistant. Indonesian first: it is
 * what the map opens in; English is one tap away.
 */
export type Lang = "id" | "en";
export const LANGS: Lang[] = ["id", "en"];
export const DEFAULT_LANG: Lang = "id";
export const isLang = (v: unknown): v is Lang => v === "id" || v === "en";
