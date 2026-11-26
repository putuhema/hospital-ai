import type { RequestHandler } from "./$types";
import page from "$lib/showcase/showcase.html?raw";

// The sales pitch: every feature with a short animated demo, and what the
// assistant's model costs to run (Indonesian). A self-contained page built
// from the stageshow example `airma-pitch` (React from a CDN, everything
// else inline), served as is rather than through the app's layout.

export const trailingSlash = "ignore";
export const prerender = true;

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="AIRMA: peta kampus 3D dan asisten pengunjung untuk rumah sakit. Demo tiap fitur dan perhitungan biaya model AI.">
<link rel="icon" href="/favicon.ico">
<style>
:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
</head>
<body>
${page}
</body>
</html>`;

export const GET: RequestHandler = () =>
  new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
