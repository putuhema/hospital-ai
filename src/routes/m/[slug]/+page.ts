import { convexLoad } from "convex-svelte/sveltekit";
import { api } from "../../../convex/_generated/api";

export const load = async ({ params }) => ({
  map: await convexLoad(api.hospital.get, { slug: params.slug }),
});
