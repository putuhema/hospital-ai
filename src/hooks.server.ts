import type { Handle } from "@sveltejs/kit";

// Visitors read Indonesian first (the map switches to English on the device if they chose it); the editor and its sign-in are in English.
export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace("%lang%", /^\/(editor|login)(\/|$)/.test(event.url.pathname) ? "en" : "id"),
  });
