import type { Handle } from "@sveltejs/kit";

// Visitors read Indonesian first (the map switches to English on the device if they chose it); the editor is in English.
export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%lang%", event.url.pathname.startsWith("/editor") ? "en" : "id"),
  });
