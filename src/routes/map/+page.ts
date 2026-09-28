import { redirect } from "@sveltejs/kit";

// The map used to live at /map; keep old links and printed QR codes working.
export function load({ url }) {
  redirect(308, "/" + url.search);
}
