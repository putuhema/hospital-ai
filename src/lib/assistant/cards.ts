/**
 * Cards in the chat for places and routes the assistant shows, e.g.
 * "Laboratory · Open now · until 16:00 · Show on map". A card is a link in
 * the map's own format (`?to=…`, `?from=…&to=…`), so following it selects the
 * place or route just as a shared link or QR code would.
 */
import { hoursStatus, type HoursStatus } from "../model/place-info.ts";
import type { Place } from "../wayfinding/routing.ts";
import type { MapSelection } from "./tools.ts";
import type { Lang } from "../i18n/lang.ts";
import { format } from "../i18n/messages.ts";
import { typeName } from "../i18n/places.ts";

export type MapCard = {
  /** The destination, for its name and icon. */
  place: Place;
  /** What it is and where, e.g. "Pharmacy · Pharmacy & lab" or "From Main reception · 4 min walk". */
  detail: string;
  /** Open now or closed, from the visitor's clock; null without hours. */
  status: HoursStatus | null;
  href: string;
  action: string;
};

/**
 * The card for a selection, read from the current layout so its name and
 * open-now stay current; null when the place is no longer on the map.
 */
export function mapCard(selection: MapSelection, list: Place[], now: Date, lang: Lang = "en"): MapCard | null {
  const place = list.find((p) => p.id === selection.to);
  if (!place) return null;
  const status = place.info ? hoursStatus(place.info, now, lang) : null;
  if (selection.kind === "place")
    return {
      place,
      detail: [typeName(place.detail, lang), place.building].filter(Boolean).join(" · "),
      status,
      href: `?to=${place.id}`,
      action: format(lang, "showOnMap"),
    };
  const from = list.find((p) => p.id === selection.from);
  if (!from) return null;
  return {
    place,
    detail: format(lang, "fromWalk", { name: from.name, n: selection.minutes }),
    status,
    href: `?from=${from.id}&to=${place.id}`,
    action: format(lang, "showRoute"),
  };
}

