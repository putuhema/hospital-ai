import { getContext, setContext } from "svelte";
import type { Live } from "./model/live.ts";

const KEY = Symbol("live");

/** Give the components below the hospital's live figures from SIMRS, as they arrive. */
export const provideLive = (live: () => Live | null | undefined) => setContext(KEY, live);
/** The live figures of the map this component is in; none outside one (the editor's previews). */
export const useLive = (): (() => Live | null | undefined) => getContext<(() => Live | null | undefined) | undefined>(KEY) ?? (() => null);
