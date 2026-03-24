/** Předvolené barvy štítků poptávek (hex #RRGGBB). */
export const LEAD_TAG_COLOR_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: "#0ea5e9", label: "Modrá" },
  { hex: "#22c55e", label: "Zelená" },
  { hex: "#eab308", label: "Žlutá" },
  { hex: "#f97316", label: "Oranžová" },
  { hex: "#ef4444", label: "Červená" },
  { hex: "#a855f7", label: "Fialová" },
  { hex: "#64748b", label: "Šedá" },
  { hex: "#14b8a6", label: "Tyrkysová" },
  { hex: "#ec4899", label: "Růžová" },
  { hex: "#84cc16", label: "Limetka" },
];

const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

export function normalizeLeadTagColor(input: string | undefined | null): string {
  const t = String(input ?? "").trim();
  if (HEX_RE.test(t)) return t.toLowerCase();
  return "#64748b";
}

/** Relativní světlost 0–1 (sRGB). */
function channelToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0.5;
  const r = channelToLinear(parseInt(m[1], 16));
  const g = channelToLinear(parseInt(m[2], 16));
  const b = channelToLinear(parseInt(m[3], 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Barva textu s dostatečným kontrastem k pozadí. */
export function contrastTextForBg(hex: string): string {
  const bg = normalizeLeadTagColor(hex);
  return luminance(bg) > 0.55 ? "#0f172a" : "#fafafa";
}
