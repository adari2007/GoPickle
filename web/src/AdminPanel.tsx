import { useEffect, useState } from "react";
import { api, OrgUserInfo } from "./lib/api";
import { OrgBranding, THEME_PRESETS, applyBranding, fileToDataUrl } from "./lib/org";

// Org-admin settings: branding (name, logo, theme) and member roles.
// Feature toggles are deliberately absent — those are super-admin only.
export function AdminPanel({ org, currentUserId, tournaments, onOrgUpdated, onClose }: {
  org: OrgBranding;
  currentUserId: string;
  tournaments: { id: string; name: string; status: string }[];
  onOrgUpdated: (org: OrgBranding) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [logoUrl, setLogoUrl] = useState(org.logoUrl && !org.logoUrl.startsWith("data:") ? org.logoUrl : "");
  const [logoData, setLogoData] = useState<string | null>(org.logoUrl?.startsWith("data:") ? org.logoUrl : null);
  const [defaultMode, setDefaultMode] = useState(org.settings?.defaultTournamentMode ?? "none");
  const [defaultTid, setDefaultTid] = useState(org.settings?.defaultTournamentId ?? "");
  const [primary, setPrimary] = useState(org.theme.primary ?? "#ff4d8d");
  const [accent, setAccent] = useState(org.theme.accent ?? "#7c6bff");
  const [bg, setBg] = useState(org.theme.bg ?? "#06091a");
  const [members, setMembers] = useState<OrgUserInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getOrgMembers(org.slug).then(r => setMembers(r.members)).catch(e => setErr((e as Error).message));
  }, [org.slug]);

  async function onSave() {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const r = await api.updateOrg(org.slug, {
        name,
        logoUrl: logoUrl.trim() ? logoUrl.trim() : null,
        logoData,
        theme: { primary, accent, bg, preset: undefined },
        settings: {
          defaultTournamentMode: defaultMode as "none" | "active" | "specific",
          defaultTournamentId: defaultMode === "specific" ? (defaultTid || null) : null
        }
      });
      const updated: OrgBranding = { ...org, name: r.org.name, logoUrl: r.org.logoUrl, theme: r.org.theme, settings: r.org.settings };
      applyBranding(updated);
      onOrgUpdated(updated);
      setMsg("Saved.");
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  async function onLogoFile(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      setLogoData(await fileToDataUrl(file, 900_000));
    } catch (e) { setErr((e as Error).message); }
  }

  async function onToggleRole(m: OrgUserInfo) {
    setErr(null);
    const role = m.role === "ADMIN" ? "MEMBER" : "ADMIN";
    try {
      await api.setMemberRole(org.slug, m.id, role);
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role } : x));
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={onClose}>
      <div className="auth-card" style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h2 className="auth-title">Organization settings</h2>
        <p className="auth-subtitle">Branding for {org.name}</p>

        <div className="auth-form">
          <div className="field">
            <label>Organization Name</label>
            <input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Logo</label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              {(logoData || logoUrl) && <img src={logoData ?? logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain", background: "var(--surface)" }} />}
              <input type="file" accept="image/*" style={{ fontSize: "0.8rem", color: "var(--muted)" }}
                onChange={e => onLogoFile(e.target.files?.[0])} />
              {logoData && <button type="button" className="btn-ghost" onClick={() => setLogoData(null)}>Remove</button>}
            </div>
            <input placeholder="…or a logo URL: https://…/logo.png" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} style={{ marginTop: "0.4rem" }} />
          </div>
          <div className="field">
            <label>Default landing after sign-in</label>
            <select value={defaultMode} onChange={e => setDefaultMode(e.target.value as any)}>
              <option value="none">Home dashboard</option>
              <option value="active">Current active tournament</option>
              <option value="specific">A specific tournament…</option>
            </select>
            {defaultMode === "specific" && (
              <select value={defaultTid} onChange={e => setDefaultTid(e.target.value)} style={{ marginTop: "0.4rem" }}>
                <option value="">— choose a tournament —</option>
                {tournaments.map(t => <option key={t.id} value={t.id}>{t.name} ({t.status})</option>)}
              </select>
            )}
          </div>
          <div className="field">
            <label>Theme presets</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {THEME_PRESETS.map(p => (
                <button key={p.id} type="button"
                  onClick={() => { setPrimary(p.primary); setAccent(p.accent); setBg(p.bg ?? "#06091a"); }}
                  style={{ padding: "0.35rem 0.6rem", borderRadius: 8, cursor: "pointer", border: "1px solid var(--border)", background: `linear-gradient(135deg, ${p.primary}, ${p.accent})`, color: "#fff", fontWeight: 700, fontSize: "0.75rem" }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "1rem" }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Primary</label>
              <input type="color" value={primary} onChange={e => setPrimary(e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Accent</label>
              <input type="color" value={accent} onChange={e => setAccent(e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Background</label>
              <input type="color" value={bg} onChange={e => setBg(e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
          </div>
          {err && <p className="auth-error">{err}</p>}
          {msg && <p style={{ color: "var(--purple-soft)", fontSize: "0.85rem" }}>{msg}</p>}
          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save branding"}
          </button>
        </div>

        <hr className="profile-dropdown-divider" style={{ margin: "1.2rem 0" }} />
        <h3 style={{ marginBottom: "0.6rem" }}>Members</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {members.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.45rem 0.6rem", border: "1px solid var(--border)", borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{m.name}{m.id === currentUserId ? " (you)" : ""}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{m.email ?? m.phone ?? ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: m.role === "ADMIN" ? "var(--pink)" : "var(--muted)" }}>{m.role}</span>
                <button className="btn-ghost" onClick={() => onToggleRole(m)}>
                  {m.role === "ADMIN" ? "Make member" : "Make admin"}
                </button>
              </div>
            </div>
          ))}
          {members.length === 0 && <p className="muted">No members loaded.</p>}
        </div>

        <button className="btn-ghost" style={{ marginTop: "1rem", width: "100%" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
