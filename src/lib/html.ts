export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Tone = "accent" | "neutral" | "success" | "warning";
type BarTone = "amber" | "sage" | "slate";

function toneStyles(tone: Tone): { background: string; border: string; value: string } {
  switch (tone) {
    case "success":
      return { background: "#f1f9f4", border: "#cce8d6", value: "#166534" };
    case "warning":
      return { background: "#fff7ed", border: "#fed7aa", value: "#c2410c" };
    case "neutral":
      return { background: "#f5f5f4", border: "#e7e5e4", value: "#1c1917" };
    default:
      return { background: "#1c1917", border: "#312e2b", value: "#fef3c7" };
  }
}

function barToneColor(tone: BarTone): string {
  if (tone === "sage") return "#5f8f72";
  if (tone === "slate") return "#475569";
  return "#d97706";
}

export function renderMetricCards(metrics: Array<{ label: string; value: string; tone?: Tone }>): string {
  return metrics.map((metric) => {
    const palette = toneStyles(metric.tone ?? "neutral");
    return `
      <td style="padding:0 8px 12px 0;width:33.333%;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${palette.border};border-radius:18px;background:${palette.background};">
          <tr>
            <td style="padding:16px 18px;font-family:Georgia,'Times New Roman',serif;">
              <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#78716c;">${escapeHtml(metric.label)}</div>
              <div style="font-size:28px;line-height:1.2;margin-top:10px;color:${palette.value};font-weight:bold;">${escapeHtml(metric.value)}</div>
            </td>
          </tr>
        </table>
      </td>
    `;
  }).join("");
}

export function renderBarChart(title: string, bars: Array<{ label: string; value: number; tone?: BarTone }>): string {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const rows = bars.map((bar) => {
    const width = Math.max(12, Math.round((bar.value / max) * 100));
    return `
      <tr>
        <td style="padding:0 0 10px;font-family:Arial,sans-serif;font-size:13px;color:#44403c;width:160px;">${escapeHtml(bar.label)}</td>
        <td style="padding:0 0 10px;">
          <div style="background:#f5f5f4;border-radius:999px;overflow:hidden;height:10px;">
            <div style="width:${width}%;height:10px;background:${barToneColor(bar.tone ?? "amber")};border-radius:999px;"></div>
          </div>
        </td>
        <td style="padding:0 0 10px 10px;font-family:Arial,sans-serif;font-size:12px;color:#57534e;text-align:right;width:56px;">${bar.value}</td>
      </tr>
    `;
  }).join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7dcc9;border-radius:18px;background:#fffcf5;margin-top:16px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.3;color:#1c1917;margin-bottom:14px;">${escapeHtml(title)}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
        </td>
      </tr>
    </table>
  `;
}

export function renderButtons(ctas: Array<{ label: string; url: string }>): string {
  if (ctas.length === 0) return "";
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:18px;">
      <tr>
        ${ctas.map((cta) => `
          <td style="padding:0 12px 12px 0;">
            <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 18px;border-radius:999px;background:#1c1917;color:#fef3c7;font-family:Arial,sans-serif;font-size:13px;text-decoration:none;font-weight:bold;">${escapeHtml(cta.label)}</a>
          </td>
        `).join("")}
      </tr>
    </table>
  `;
}

export function renderSections(sections: Array<{ heading: string; body: string }>): string {
  return sections.map((section) => `
    <tr>
      <td style="padding:0 0 18px;font-family:Georgia,'Times New Roman',serif;color:#1c1917;">
        <div style="font-size:20px;line-height:1.3;margin-bottom:8px;">${escapeHtml(section.heading)}</div>
        <div style="font-size:15px;line-height:1.75;color:#44403c;">${escapeHtml(section.body)}</div>
      </td>
    </tr>
  `).join("");
}

export function renderEmailShell(input: {
  eyebrow: string;
  title: string;
  summary: string;
  metrics?: string;
  chart?: string;
  sections?: string;
  ctas?: string;
}): string {
  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:0;background:#f4efe4;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(circle at top,#fff9ec 0%,#f4efe4 55%,#efe7d8 100%);padding:34px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#fff;border:1px solid #e7dcc9;border-radius:28px;overflow:hidden;box-shadow:0 24px 80px rgba(28,25,23,0.08);">
                <tr>
                  <td style="padding:30px 30px 24px;background:linear-gradient(135deg,#1c1917 0%,#3f3a36 100%);color:#fff8eb;font-family:Georgia,'Times New Roman',serif;">
                    <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#fdba74;">${escapeHtml(input.eyebrow)}</div>
                    <div style="font-size:34px;line-height:1.16;margin-top:12px;">${escapeHtml(input.title)}</div>
                    <div style="font-size:16px;line-height:1.7;color:#fed7aa;margin-top:12px;">${escapeHtml(input.summary)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 30px 28px;">
                    ${input.metrics ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${input.metrics}</tr></table>` : ""}
                    ${input.chart ?? ""}
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;">
                      ${input.sections ?? ""}
                    </table>
                    ${input.ctas ?? ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();
}
