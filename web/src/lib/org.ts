// Org branding, themes, and per-org session persistence.

export interface OrgFeatures {
  buddies: boolean;
  clubs: boolean;
  games: boolean;
  tournaments: boolean;
  leagues: boolean;
  quickPlay: boolean;
}

export interface OrgTheme {
  primary?: string;
  accent?: string;
  bg?: string;
  preset?: string;
}

export interface OrgSettings {
  defaultTournamentMode?: "none" | "active" | "specific";
  defaultTournamentId?: string | null;
}

export interface OrgBranding {
  slug: string;
  name: string;
  logoUrl: string | null;
  theme: OrgTheme;
  features: OrgFeatures;
  settings?: OrgSettings;
}

// Reads a picked image file as a data URL, for logos / banners / payment proofs.
export function fileToDataUrl(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`Image is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`));
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file (JPG or PNG)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export const THEME_PRESETS: { id: string; label: string; primary: string; accent: string; bg?: string }[] = [
  { id: "pickle", label: "Pickle",  primary: "#e0447e", accent: "#6d5ce6", bg: "#f4f6fb" },
  { id: "ocean",  label: "Ocean",   primary: "#0284c7", accent: "#4f46e5", bg: "#f0f7fc" },
  { id: "forest", label: "Forest",  primary: "#16a34a", accent: "#0d9488", bg: "#f1f8f3" },
  { id: "sunset", label: "Sunset",  primary: "#ea580c", accent: "#dc2626", bg: "#fdf5f0" },
  { id: "slate",  label: "Slate",   primary: "#475569", accent: "#334155", bg: "#f4f6f8" },
];

export function parseSlug(): string | null {
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg || null;
}

function hexToRgb(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function lighten(hex: string, amt: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.min(255, Math.round(v + (255 - v) * amt));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function darken(hex: string, amt: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.round(v * (1 - amt)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Relative luminance 0..1 — used to keep org backgrounds readable on the
// light UI (dark text is fixed, so very dark backgrounds get blended white).
function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// Applies an org's identity to the document: title + CSS custom properties.
// The primary color takes the --pink slot and the accent takes --purple (the
// two ends of the brand gradient); optional bg drives the page background.
export function applyBranding(org: OrgBranding) {
  document.title = org.name;
  const st = document.documentElement.style;
  const primary = org.theme.primary;
  const accent = org.theme.accent;
  if (primary) {
    st.setProperty("--pink", primary);
    const rgb = hexToRgb(primary);
    if (rgb) st.setProperty("--pink-rgb", rgb);
  }
  if (accent) {
    st.setProperty("--purple", accent);
    // Accent-derived text color must stay readable on the light UI.
    st.setProperty("--purple-soft", darken(accent, 0.2));
    const rgb = hexToRgb(accent);
    if (rgb) st.setProperty("--purple-rgb", rgb);
  }
  if (primary && accent) {
    st.setProperty("--grad", `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`);
  }
  if (org.theme.bg) {
    // Text is dark on the light UI, so a dark org background is blended
    // toward white until it stays readable.
    let bg = org.theme.bg;
    while (luminance(bg) < 0.82) bg = lighten(bg, 0.35);
    st.setProperty("--bg", bg);
    st.setProperty("--bg2", "#ffffff");
  }
}

// ── Per-org session persistence ──────────────────────────────────────────────

export interface StoredSession {
  token: string;
  user: any;
}

const sessionKey = (slug: string) => `gp_session_${slug}`;

export function loadSession(slug: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(slug: string, session: StoredSession) {
  try {
    localStorage.setItem(sessionKey(slug), JSON.stringify(session));
  } catch {}
}

export function clearSession(slug: string) {
  try {
    localStorage.removeItem(sessionKey(slug));
  } catch {}
}
