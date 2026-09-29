import { getContext, setContext } from "svelte";
import { DEFAULT_LANG, isLang, type Lang } from "./lang.ts";
import { format, type Key } from "./messages.ts";
import { typeInline, typeName } from "./places.ts";

const STORAGE_KEY = "p-map-lang";

/**
 * The visitor's language. The map provides one (Indonesian unless the
 * visitor chose English on this device); components shared with the editor
 * find none and speak English.
 */
export class Locale {
  lang = $state<Lang>(DEFAULT_LANG);

  constructor(lang: Lang = DEFAULT_LANG) {
    this.lang = lang;
  }

  /** A message in the current language. */
  t = (key: Key, values?: Record<string, string | number>) => format(this.lang, key, values);
  /** What a kind of place is called, e.g. "Apotek". */
  type = (detail: string) => typeName(detail, this.lang);
  /** The same inside a sentence: "toilets", "apotek", "IGD". */
  typeInline = (detail: string) => typeInline(detail, this.lang);
  /** A shortcut's label: "Toilets", or "Nearest toilets" / "Toilet terdekat" once there's a start. */
  shortcut = (detail: string, nearest: boolean) => {
    const label = nearest ? this.t("nearest", { type: this.typeInline(detail) }) : this.type(detail);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  /** The language this device chose before, if any. */
  restore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isLang(saved)) this.lang = saved;
    } catch {
      // Private browsing: stay with the default.
    }
    document.documentElement.lang = this.lang;
  }

  set(lang: Lang) {
    this.lang = lang;
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not remembered, but still switched.
    }
  }
}

const KEY = Symbol("locale");
const english = new Locale("en");

/** Give the components below this one a language. */
export const provideLocale = (locale: Locale) => setContext(KEY, locale);
/** The language of the map this component is in; English outside one (the editor). */
export const useLocale = (): Locale => getContext<Locale | undefined>(KEY) ?? english;
