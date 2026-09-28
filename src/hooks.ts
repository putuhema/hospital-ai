import { initConvex, encodeConvexLoad, decodeConvexLoad } from "convex-svelte/sveltekit";
import { PUBLIC_CONVEX_URL } from "$env/static/public";

initConvex(PUBLIC_CONVEX_URL);

// Lets `convexLoad` results rendered on the server become live subscriptions in the browser.
export const transport = {
  ConvexLoadResult: { encode: encodeConvexLoad, decode: decodeConvexLoad },
};
