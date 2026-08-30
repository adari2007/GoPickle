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
  { id: "pickle", label: "Pickle",  primary: "#ff4d8d", accent: "#7c6bff" },
  { id: "ocean",  label: "Ocean",   primary: "#0ea5e9", accent: "#6366f1", bg: "#04121f" },
  { id: "forest", label: "Forest",  primary: "#22c55e", accent: "#14b8a6", bg: "#06140b" },
  { id: "sunset", label: "Sunset",  primary: "#f97316", accent: "#ef4444", bg: "#170a06" },
  { id: "slate",  label: "Slate",   primary: "#94a3b8", accent: "#64748b", bg: "#0b0f16" },
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
    st.setProperty("--purple-soft", lighten(accent, 0.35));
    const rgb = hexToRgb(accent);
    if (rgb) st.setProperty("--purple-rgb", rgb);
  }
  if (primary && accent) {
    st.setProperty("--grad", `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`);
  }
  if (org.theme.bg) {
    st.setProperty("--bg", org.theme.bg);
    st.setProperty("--bg2", lighten(org.theme.bg, 0.05));
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
