import { PREVIEWS } from "@/modules/email/templates/fixtures";
import { devOnly, escapeHtml } from "./preview";

/**
 * Index of the email previews. Development only — see `preview.ts`.
 */
export async function GET() {
  const blocked = devOnly();
  if (blocked) return blocked;

  const items = Object.entries(PREVIEWS)
    .map(
      ([name, preview]) =>
        `<li><a href="/api/dev/email/${name}">${escapeHtml(preview.title)}</a>` +
        ` <a href="/api/dev/email/${name}?format=text">(text)</a>` +
        ` <code>${escapeHtml(name)}</code></li>`,
    )
    .join("");

  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Email previews</title>` +
      `<body style="font:15px system-ui;padding:2rem;line-height:1.9">` +
      `<h1 style="font-size:1.25rem">Email previews</h1><ul>${items}</ul></body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
