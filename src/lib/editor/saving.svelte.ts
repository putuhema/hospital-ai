import { untrack } from "svelte";
import { useConvexClient, useQuery } from "convex-svelte";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { STORAGE_KEY } from "../model/layout.ts";

export type SaveStatus = "loading" | "saved" | "saving" | "failed";

/**
 * Keeps an editor page and the database in step. The database is the source
 * of truth: the page loads the hospital from it, saves each change shortly
 * after it is made (visitors see it straight away) and takes in changes saved
 * from another tab or device. Create it while the page component initialises.
 */
export class HospitalStore {
  status = $state<SaveStatus>("loading");
  /** Why the last save failed, while it is retried. */
  problem = $state("");
  /** The hospital's public address, /m/<slug>; null until the first save. */
  slug = $state<string | null>(null);

  #client = useConvexClient();
  #query = useQuery(api.hospital.get, {});
  /** The layout as last loaded or saved. */
  #synced = "";
  #revision = -1;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saving = false;
  /** The stored hospital could not be read: never overwrite it. */
  #blocked = false;

  constructor(
    private snapshot: () => string,
    private load: (layout: string) => void,
    /** A change saved elsewhere was loaded. */
    private onremote?: () => void,
  ) {
    $effect(() => {
      const { data, isLoading, error } = this.#query;
      if (isLoading) return;
      // Convex keeps trying to reach the database; nothing is saved before the hospital has loaded.
      untrack(() => (error ? (this.problem = "Could not reach the database.") : this.#received(data ?? null)));
    });
    $effect(() => {
      const layout = snapshot();
      untrack(() => this.#changed(layout));
    });
    const leave = (e: BeforeUnloadEvent) => {
      if (!this.pending) return;
      this.save();
      e.preventDefault();
    };
    $effect(() => {
      window.addEventListener("beforeunload", leave);
      return () => {
        window.removeEventListener("beforeunload", leave);
        if (this.pending) this.save();
      };
    });
  }

  /** Changes not in the database yet. */
  get pending() {
    return this.status !== "loading" && !this.#blocked && (this.#saving || this.snapshot() !== this.#synced);
  }

  #received(data: { slug: string; revision: number; layout: string } | null) {
    if (this.status === "loading") {
      if (data) this.#take(data);
      else {
        // Nothing in the database yet: start from what this browser saved before, if anything.
        try {
          const local = localStorage.getItem(STORAGE_KEY);
          if (local) this.load(local);
        } catch {}
        this.status = "saving";
        this.save();
      }
      return;
    }
    // Saved from another tab or device, while this page has nothing waiting to be saved.
    if (data && data.revision !== this.#revision && !this.pending) {
      this.#take(data);
      this.onremote?.();
    }
  }

  #take(data: { slug: string; revision: number; layout: string }) {
    this.slug = data.slug;
    this.#revision = data.revision;
    try {
      this.load(data.layout);
      this.#synced = this.snapshot();
      this.status = "saved";
    } catch {
      this.#blocked = true;
      this.#fail("The saved hospital could not be read.");
    }
  }

  #changed(layout: string) {
    if (this.status === "loading" || this.#blocked) return;
    clearTimeout(this.#timer);
    if (layout === this.#synced && !this.#saving) {
      this.status = "saved";
      return;
    }
    this.status = "saving";
    // A copy on this device too, in case the connection drops before it is saved.
    try {
      localStorage.setItem(STORAGE_KEY, layout);
    } catch {}
    this.#timer = setTimeout(() => this.save(), 600);
  }

  /** Save now rather than after the short wait. */
  async save() {
    clearTimeout(this.#timer);
    if (this.#blocked || this.#saving) return;
    const layout = this.snapshot();
    this.#saving = true;
    try {
      const saved = await this.#client.mutation(api.hospital.save, { layout, slug: this.slug ?? undefined });
      this.#synced = layout;
      this.#revision = saved.revision;
      this.slug = saved.slug;
      this.problem = "";
    } catch (e) {
      this.#saving = false;
      this.#fail(e instanceof ConvexError ? String(e.data) : "Could not reach the database.");
      return;
    }
    this.#saving = false;
    // More changes came in while saving.
    if (this.snapshot() !== this.#synced) this.#changed(this.snapshot());
    else this.status = "saved";
  }

  #fail(problem: string) {
    this.problem = problem;
    this.status = "failed";
    clearTimeout(this.#timer);
    if (!this.#blocked) this.#timer = setTimeout(() => this.save(), 5000);
  }
}
