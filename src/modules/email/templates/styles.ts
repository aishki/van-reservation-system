/**
 * Inline styles shared by every email template.
 *
 * Inline because email clients strip <style> blocks and know nothing of
 * cascade; shared because the templates are meant to look like one product and
 * there are four of them in the plan (see `../NOTIFICATIONS.md`). Copying the
 * object per template is how the confirmation and the rejection end up with
 * different greys a year from now.
 *
 * Values are literal hex, not the app's CSS custom properties: `var()` does not
 * resolve in Outlook, and a token that silently falls back to black is worse
 * than a hardcoded colour that someone has to update in one place.
 */
export const styles = {
  body: {
    backgroundColor: "#f5f5f5",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
    color: "#231e33",
    margin: "0",
    padding: "24px 0",
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    maxWidth: "520px",
    margin: "0 auto",
    padding: "40px",
  },
  heading: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#2b1b49",
    margin: "0 0 8px",
  },
  lead: { fontSize: "15px", lineHeight: "22px", color: "#666666", margin: "0" },
  label: {
    fontSize: "12px",
    color: "#949494",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    margin: "0 0 2px",
  },
  value: {
    fontSize: "15px",
    fontWeight: 500,
    color: "#231e33",
    margin: "0 0 16px",
  },
  hr: { borderColor: "#eeeeee", margin: "24px 0" },
  footer: { fontSize: "13px", lineHeight: "20px", color: "#949494" },
  link: { color: "#5009b5" },
} as const;
