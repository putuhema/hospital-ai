import { convexLoad } from "convex-svelte/sveltekit";
import { api } from "../convex/_generated/api";

// The hospital saved in the database: the same one at /m/<slug>.
export const load = async () => ({
  map: await convexLoad(api.hospital.get, {}),
});
