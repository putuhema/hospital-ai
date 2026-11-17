import { getContext, setContext } from "svelte";
import { dateOf } from "./model/doctors.ts";
import type { Ticket } from "./model/live.ts";

const KEY = Symbol("my-turn");
/** A ticket as the visitor sets it; the day is added. */
type NewTicket = Ticket extends infer T ? (T extends Ticket ? Omit<T, "day"> : never) : never;

/**
 * The visitor's own queue number ("Nomor saya") on this phone, for one
 * hospital and one day. Kept in the browser, unless the visitor asks to be
 * alerted: then the server keeps it for the day to watch the queue.
 */
export class MyTurn {
  ticket = $state<Ticket | null>(null);
  /** The server tells this phone when the number is near (turn-alerts.ts). */
  alerting = $state(false);
  #storage: string;
  /** Called when the followed number changes or stops, to stop the alerts for the old one. */
  onstop: (() => void) | null = null;

  constructor(slug: string) {
    this.#storage = `p-map-ticket:${slug}`;
  }

  /** The number this phone set today, if any. */
  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.#storage) ?? "null") as Ticket | null;
      this.ticket = saved && saved.day === dateOf(new Date()) && Number.isInteger(saved.number) ? saved : null;
      this.alerting = !!this.ticket && localStorage.getItem(`${this.#storage}:alert`) === "1";
    } catch {
      this.ticket = null;
    }
  }

  set(ticket: NewTicket) {
    this.setAlerting(false);
    this.ticket = { ...ticket, day: dateOf(new Date()) } as Ticket;
    this.#save();
  }

  clear() {
    this.setAlerting(false);
    this.ticket = null;
    this.#save();
  }

  /** Alerts on or off for the number followed now; off also stops them on the server. */
  setAlerting(on: boolean) {
    if (this.alerting && !on) this.onstop?.();
    this.alerting = on;
    try {
      if (on) localStorage.setItem(`${this.#storage}:alert`, "1");
      else localStorage.removeItem(`${this.#storage}:alert`);
    } catch {
      // Private browsing.
    }
  }

  #save() {
    try {
      if (this.ticket) localStorage.setItem(this.#storage, JSON.stringify(this.ticket));
      else localStorage.removeItem(this.#storage);
    } catch {
      // Private browsing: followed until the page closes.
    }
  }
}

/** Give the components below the visitor's queue number. */
export const provideMyTurn = (turn: MyTurn) => setContext(KEY, turn);
/** The visitor's queue number on the map; null outside one (the editor). */
export const useMyTurn = (): MyTurn | null => getContext<MyTurn | undefined>(KEY) ?? null;
