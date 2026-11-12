import { getContext, setContext } from "svelte";
import { dateOf } from "./model/doctors.ts";
import type { Ticket } from "./model/live.ts";

const KEY = Symbol("my-turn");
/** A ticket as the visitor sets it; the day is added. */
type NewTicket = Ticket extends infer T ? (T extends Ticket ? Omit<T, "day"> : never) : never;

/**
 * The visitor's own queue number ("Nomor saya") on this phone, for one
 * hospital and one day. Kept in the browser only: it never leaves the phone.
 */
export class MyTurn {
  ticket = $state<Ticket | null>(null);
  #storage: string;

  constructor(slug: string) {
    this.#storage = `p-map-ticket:${slug}`;
  }

  /** The number this phone set today, if any. */
  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.#storage) ?? "null") as Ticket | null;
      this.ticket = saved && saved.day === dateOf(new Date()) && Number.isInteger(saved.number) ? saved : null;
    } catch {
      this.ticket = null;
    }
  }

  set(ticket: NewTicket) {
    this.ticket = { ...ticket, day: dateOf(new Date()) } as Ticket;
    this.#save();
  }

  clear() {
    this.ticket = null;
    this.#save();
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
