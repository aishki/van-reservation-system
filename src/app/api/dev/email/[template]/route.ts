import { PREVIEWS, type Preview } from "@/modules/email/templates/fixtures";
import { devOnly, escapeHtml } from "../preview";

/**
 * Renders one email template with its sample payload, so a template can be
 * looked at without sending mail or standing up the write path.
 *
 * It goes through `render()` — the same call the real send uses — so what the
 * browser shows is the HTML SES would carry, not an approximation. `?format=text`
 * returns the plain-text alternative, which is the half that usually rots
 * unnoticed.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ template: string }> },
) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const { template } = await params;
  const preview = PREVIEWS[template];
  if (preview === undefined) {
    return new Response(null, { status: 404 });
  }

  const { html, text, subject } = await preview.render();
  const wantsText = new URL(req.url).searchParams.get("format") === "text";

  if (wantsText) {
    const cc = preview.cc.length > 0 ? `Cc: ${preview.cc.join(", ")}\n` : "";
    return new Response(
      `To: ${preview.to}\n${cc}Subject: ${subject}\n\n${text}`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // The rendered email goes in an iframe so its own styles cannot inherit from
  // (or leak into) the header strip above it — the email must look exactly as a
  // client would show it, standalone.
  return new Response(headerStrip(template, preview, subject) + frame(html), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * To / Cc / Subject above the preview. Who receives which notification is
 * invisible in the templates themselves — they render a body and nothing more —
 * so the addressing is stated here, where someone looking at the design asks.
 */
function headerStrip(
  template: string,
  preview: Preview,
  subject: string,
): string {
  const row = (label: string, value: string) =>
    value === ""
      ? ""
      : `<tr><th style="text-align:left;padding:2px 12px 2px 0;color:#949494;font-weight:500;vertical-align:top">${label}</th>` +
        `<td style="padding:2px 0">${escapeHtml(value)}</td></tr>`;

  return (
    `<div style="font:14px/1.6 system-ui;padding:18px 22px;background:#faf9fc;border-bottom:1px solid #eee">` +
    `<div style="margin-bottom:10px"><a href="/api/dev/email" style="color:#5009b5">&larr; all previews</a>` +
    ` &nbsp;·&nbsp; <a href="/api/dev/email/${encodeURIComponent(template)}?format=text" style="color:#5009b5">view plain text</a></div>` +
    `<table style="border-collapse:collapse">` +
    row("To", preview.to) +
    row("Cc", preview.cc.join(", ")) +
    row("Subject", subject) +
    `</table></div>`
  );
}

function frame(html: string): string {
  return (
    `<iframe title="Email preview" srcdoc="${escapeHtml(html)}" ` +
    `style="border:0;width:100%;height:calc(100vh - 130px);display:block"></iframe>`
  );
}
