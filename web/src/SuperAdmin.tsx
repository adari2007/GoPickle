import { FormEvent, useEffect, useState } from "react";
import { api, setAuthToken } from "./lib/api";
import { THEME_PRESETS, fileToDataUrl } from "./lib/org";
import logo from "./assets/logo-pickle.svg";

const FEATURE_LABELS: { key: string; label: string }[] = [
  { key: "buddies", label: "Buddies" },
  { key: "clubs", label: "Clubs" },
  { key: "games", label: "Games" },
  { key: "tournaments", label: "Tournaments" },
  { key: "leagues", label: "Leagues" },
  { key: "quickPlay", label: "Quick Play" },
];

const SUPER_KEY = "gp_super";

// Platform console at /super: list every organization, toggle its features,
// and override its branding/theme when needed.
export function SuperAdmin() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem(SUPER_KEY); } catch { return null; }
  });
  const [creds, setCreds] = useState({ email: "", password: "" });
  const [orgs, setOrgs] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [admins, setAdmins] = useState<{ id: string; email: string }[]>([]);
  const [newAdmin, setNewAdmin] = useState({ email: "", password: "" });
  const [pwForm, setPwForm] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", preset: "pickle", adminName: "", adminContact: "", adminPassword: "" });
  const [createdInfo, setCreatedInfo] = useState<string | null>(null);
  const [orgMembers, setOrgMembers] = useState<Record<string, { id: string; name: string; email?: string; phone?: string; role: "ADMIN" | "MEMBER" }[]>>({});
  const [newOrgAdmin, setNewOrgAdmin] = useState({ name: "", contact: "", password: "" });

  useEffect(() => {
    if (!token) return;
    setAuthToken(token);
    api.superListOrgs()
      .then(r => { setOrgs(r.orgs); return api.superListAdmins(); })
      .then(r => setAdmins(r.admins))
      .catch(e => {
        setErr((e as Error).message);
        setToken(null);
        setAuthToken(null);
        try { localStorage.removeItem(SUPER_KEY); } catch {}
      });
  }, [token]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await api.superLogin(creds);
      try { localStorage.setItem(SUPER_KEY, r.token); } catch {}
      setToken(r.token);
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }

  async function patchOrg(slug: string, patch: any) {
    setErr(null);
    try {
      const r = await api.superUpdateOrg(slug, patch);
      setOrgs(prev => prev.map(o => o.slug === slug ? r.org : o));
    } catch (e) { setErr((e as Error).message); }
  }

  async function onCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const slug = slugify(createForm.slug || createForm.name);
    const preset = THEME_PRESETS.find(p => p.id === createForm.preset) ?? THEME_PRESETS[0];
    const isPhone = /^[+\d]/.test(createForm.adminContact);
    try {
      const r = await api.createOrg({
        slug,
        name: createForm.name,
        theme: { primary: preset.primary, accent: preset.accent, bg: preset.bg, preset: preset.id },
        admin: {
          name: createForm.adminName,
          email: isPhone ? undefined : createForm.adminContact || undefined,
          phone: isPhone ? createForm.adminContact : undefined,
          password: createForm.adminPassword
        }
      });
      setOrgs(prev => [...prev, r.org]);
      setCreatedInfo(`Organization ready at /${slug}. Share the app link and the admin credentials with ${createForm.adminName}.`);
      setCreateForm({ name: "", slug: "", preset: "pickle", adminName: "", adminContact: "", adminPassword: "" });
      setShowCreate(false);
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setPwMsg(null);
    try {
      await api.superChangePassword({ currentPassword: pwForm.current, newPassword: pwForm.next });
      setPwForm({ current: "", next: "" });
      setPwMsg("Password updated.");
    } catch (e2) { setErr((e2 as Error).message); }
  }

  async function onAddAdmin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api.superAddAdmin(newAdmin);
      setAdmins(prev => [...prev, r.admin]);
      setNewAdmin({ email: "", password: "" });
    } catch (e2) { setErr((e2 as Error).message); }
  }

  async function onRemoveAdmin(id: string) {
    setErr(null);
    try {
      await api.superRemoveAdmin(id);
      setAdmins(prev => prev.filter(a => a.id !== id));
    } catch (e2) { setErr((e2 as Error).message); }
  }

  async function toggleExpanded(slug: string) {
    const next = expanded === slug ? null : slug;
    setExpanded(next);
    setNewOrgAdmin({ name: "", contact: "", password: "" });
    if (next && !orgMembers[next]) {
      try {
        const r = await api.superGetOrgMembers(next);
        setOrgMembers(prev => ({ ...prev, [next]: r.members }));
      } catch (e2) { setErr((e2 as Error).message); }
    }
  }

  async function onToggleOrgMemberRole(slug: string, m: { id: string; role: "ADMIN" | "MEMBER" }) {
    setErr(null);
    const role = m.role === "ADMIN" ? "MEMBER" : "ADMIN";
    try {
      await api.superSetOrgMemberRole(slug, m.id, role);
      setOrgMembers(prev => ({ ...prev, [slug]: (prev[slug] ?? []).map(x => x.id === m.id ? { ...x, role } : x) }));
    } catch (e2) { setErr((e2 as Error).message); }
  }

  async function onAddOrgAdmin(e: React.FormEvent, slug: string) {
    e.preventDefault();
    setErr(null);
    const isPhone = /^[+\d]/.test(newOrgAdmin.contact);
    try {
      const r = await api.superAddOrgMember(slug, {
        name: newOrgAdmin.name,
        email: isPhone ? undefined : newOrgAdmin.contact || undefined,
        phone: isPhone ? newOrgAdmin.contact : undefined,
        password: newOrgAdmin.password,
        role: "ADMIN"
      });
      setOrgMembers(prev => ({ ...prev, [slug]: [{ id: r.member.id, name: newOrgAdmin.name, email: isPhone ? undefined : newOrgAdmin.contact, phone: isPhone ? newOrgAdmin.contact : undefined, role: "ADMIN" }, ...(prev[slug] ?? [])] }));
      setNewOrgAdmin({ name: "", contact: "", password: "" });
    } catch (e2) { setErr((e2 as Error).message); }
  }

  async function onOrgLogoFile(slug: string, file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file, 900_000);
      await patchOrg(slug, { logoData: dataUrl });
    } catch (e2) { setErr((e2 as Error).message); }
  }

  if (!token) {
    return (
      <div className="auth-root" style={{ gridTemplateColumns: "1fr" }}>
        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-card-logo-mobile" style={{ display: "flex" }}>
              <img src={logo} alt="" />
              <span>GoPickle Platform</span>
            </div>
            <h2 className="auth-title">Super admin</h2>
            <p className="auth-subtitle">Platform console sign-in</p>
            <form onSubmit={onLogin} className="auth-form">
              <div className="field">
                <label>Email</label>
                <input value={creds.email} autoComplete="username"
                  onChange={e => setCreds({ ...creds, email: e.target.value })} />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" value={creds.password} autoComplete="current-password"
                  onChange={e => setCreds({ ...creds, password: e.target.value })} />
              </div>
              {err && <p className="auth-error">{err}</p>}
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Please wait…" : "Sign in"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-root">
      <nav className="topbar">
        <div className="topbar-brand">
          <img src={logo} alt="" className="topbar-logo" />
          <span className="topbar-name">Platform Console</span>
        </div>
        <div />
        <div className="topbar-user">
          <button className="btn-ghost" onClick={() => {
            setToken(null); setAuthToken(null);
            try { localStorage.removeItem(SUPER_KEY); } catch {}
          }}>Sign out</button>
        </div>
      </nav>

      <main className="page">
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h2>Organizations <span className="grad-text">({orgs.length})</span></h2>
            <p className="muted">Enable features and control branding per organization.</p>
          </div>
          <button className="btn-primary" style={{ width: "auto", padding: "0.5rem 1rem" }} onClick={() => setShowCreate(v => !v)}>
            {showCreate ? "Cancel" : "+ New organization"}
          </button>
        </div>

        {createdInfo && (
          <div style={{ border: "1px solid var(--purple)", borderRadius: 10, padding: "0.7rem 0.9rem", marginBottom: "0.9rem", color: "var(--text)" }}
            onClick={() => setCreatedInfo(null)}>
            {createdInfo} <span aria-hidden style={{ color: "var(--muted)" }}>×</span>
          </div>
        )}

        {showCreate && (
          <form onSubmit={onCreateOrg} className="auth-form" style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "1rem", marginBottom: "1rem", maxWidth: 520 }}>
            <h3 style={{ marginBottom: "0.3rem" }}>Create organization</h3>
            <div className="field"><label>Name</label>
              <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Acme Pickleball" /></div>
            <div className="field"><label>URL name (slug)</label>
              <input value={createForm.slug} onChange={e => setCreateForm({ ...createForm, slug: e.target.value })} placeholder="acme-pickleball" /></div>
            <div className="field"><label>Theme</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {THEME_PRESETS.map(pp => (
                  <button key={pp.id} type="button" onClick={() => setCreateForm({ ...createForm, preset: pp.id })}
                    style={{ padding: "0.35rem 0.6rem", borderRadius: 8, cursor: "pointer", border: createForm.preset === pp.id ? "2px solid var(--text)" : "1px solid var(--border)", background: `linear-gradient(135deg, ${pp.primary}, ${pp.accent})`, color: "#fff", fontWeight: 700, fontSize: "0.75rem" }}>
                    {pp.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field"><label>First admin — name</label>
              <input value={createForm.adminName} onChange={e => setCreateForm({ ...createForm, adminName: e.target.value })} /></div>
            <div className="field"><label>First admin — email or phone</label>
              <input value={createForm.adminContact} onChange={e => setCreateForm({ ...createForm, adminContact: e.target.value })} /></div>
            <div className="field"><label>First admin — password</label>
              <input type="password" value={createForm.adminPassword} onChange={e => setCreateForm({ ...createForm, adminPassword: e.target.value })} autoComplete="new-password" /></div>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create organization"}</button>
          </form>
        )}
        {err && <div className="toast-error" role="alert" onClick={() => setErr(null)}>{err} <span aria-hidden>×</span></div>}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {orgs.map(o => (
            <div key={o.slug} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "0.9rem 1rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: `linear-gradient(135deg, ${o.theme?.primary ?? "#ff4d8d"}, ${o.theme?.accent ?? "#7c6bff"})` }} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{o.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>/{o.slug} · {o.status}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="btn-ghost" onClick={() => patchOrg(o.slug, { status: o.status === "READY" ? "SUSPENDED" : "READY" })}>
                    {o.status === "READY" ? "Suspend" : "Reactivate"}
                  </button>
                  <button className="btn-ghost" onClick={() => toggleExpanded(o.slug)}>
                    {expanded === o.slug ? "Collapse" : "Manage"}
                  </button>
                </div>
              </div>

              {expanded === o.slug && (
                <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>Features</div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {FEATURE_LABELS.map(f => {
                        const on = o.features?.[f.key] !== false;
                        return (
                          <button key={f.key} className="btn-ghost"
                            style={{
                              border: `1px solid ${on ? "var(--pink)" : "var(--border)"}`,
                              color: on ? "var(--text)" : "var(--muted)",
                              opacity: on ? 1 : 0.7
                            }}
                            onClick={() => patchOrg(o.slug, { features: { [f.key]: !on } })}>
                            {on ? "✓ " : "✗ "}{f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>Theme</div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      {THEME_PRESETS.map(p => (
                        <button key={p.id} type="button"
                          onClick={() => patchOrg(o.slug, { theme: { primary: p.primary, accent: p.accent, bg: p.bg, preset: p.id } })}
                          style={{ padding: "0.35rem 0.6rem", borderRadius: 8, cursor: "pointer", border: "1px solid var(--border)", background: `linear-gradient(135deg, ${p.primary}, ${p.accent})`, color: "#fff", fontWeight: 700, fontSize: "0.75rem" }}>
                          {p.label}
                        </button>
                      ))}
                      <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        Primary
                        <input type="color" value={o.theme?.primary ?? "#ff4d8d"}
                          onChange={e => patchOrg(o.slug, { theme: { ...o.theme, primary: e.target.value } })} />
                      </label>
                      <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        Accent
                        <input type="color" value={o.theme?.accent ?? "#7c6bff"}
                          onChange={e => patchOrg(o.slug, { theme: { ...o.theme, accent: e.target.value } })} />
                      </label>
                      <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        Background
                        <input type="color" value={o.theme?.bg ?? "#f4f6fb"}
                          onChange={e => patchOrg(o.slug, { theme: { ...o.theme, bg: e.target.value } })} />
                      </label>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>Logo</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      {o.logoUrl && <img src={o.logoUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "contain", background: "var(--surface)" }} />}
                      <input type="file" accept="image/*" style={{ fontSize: "0.75rem", color: "var(--muted)" }}
                        onChange={e => onOrgLogoFile(o.slug, e.target.files?.[0])} />
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>
                      Members & admins
                      {orgMembers[o.slug] && <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {orgMembers[o.slug].filter(m => m.role === "ADMIN").length} admin(s), {orgMembers[o.slug].length} total</span>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", maxWidth: 560 }}>
                      {(orgMembers[o.slug] ?? []).map(m => (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", border: "1px solid var(--border)", borderRadius: 8, padding: "0.35rem 0.6rem" }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                            <span style={{ fontSize: "0.72rem", color: "var(--muted)", marginLeft: 8 }}>{m.email ?? m.phone ?? ""}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: m.role === "ADMIN" ? "var(--pink)" : "var(--muted)" }}>{m.role}</span>
                            <button className="btn-ghost" onClick={() => onToggleOrgMemberRole(o.slug, m)}>
                              {m.role === "ADMIN" ? "Demote" : "Make admin"}
                            </button>
                          </div>
                        </div>
                      ))}
                      {orgMembers[o.slug]?.length === 0 && <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>No members yet.</span>}
                      <form onSubmit={e => onAddOrgAdmin(e, o.slug)} style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.3rem" }}>
                        <input placeholder="name" value={newOrgAdmin.name} style={{ flex: 2, minWidth: 110 }}
                          onChange={e => setNewOrgAdmin({ ...newOrgAdmin, name: e.target.value })} />
                        <input placeholder="email or phone" value={newOrgAdmin.contact} style={{ flex: 2, minWidth: 130 }}
                          onChange={e => setNewOrgAdmin({ ...newOrgAdmin, contact: e.target.value })} />
                        <input placeholder="password" type="password" value={newOrgAdmin.password} style={{ flex: 2, minWidth: 110 }} autoComplete="new-password"
                          onChange={e => setNewOrgAdmin({ ...newOrgAdmin, password: e.target.value })} />
                        <button type="submit" className="btn-primary" style={{ width: "auto", padding: "0.4rem 0.8rem" }}
                          disabled={!newOrgAdmin.name || !newOrgAdmin.contact || newOrgAdmin.password.length < 6}>
                          Add admin
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {orgs.length === 0 && <p className="muted">No organizations yet.</p>}
        </div>

        <div className="page-header" style={{ marginTop: "2rem" }}>
          <h2>Super admins <span className="grad-text">({admins.length})</span></h2>
          <p className="muted">Platform-level administrators.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 520 }}>
          {admins.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: 10, padding: "0.5rem 0.8rem" }}>
              <span>{a.email}</span>
              <button className="btn-ghost" onClick={() => onRemoveAdmin(a.id)} disabled={admins.length <= 1}>Remove</button>
            </div>
          ))}
          <form onSubmit={onChangePassword} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.3rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", width: "100%" }}>Change my password</span>
            <input placeholder="current password" type="password" value={pwForm.current} style={{ flex: 2, minWidth: 140 }} autoComplete="current-password"
              onChange={e => setPwForm({ ...pwForm, current: e.target.value })} />
            <input placeholder="new password (8+ chars)" type="password" value={pwForm.next} style={{ flex: 2, minWidth: 140 }} autoComplete="new-password"
              onChange={e => setPwForm({ ...pwForm, next: e.target.value })} />
            <button type="submit" className="btn-primary" style={{ width: "auto", padding: "0.45rem 0.9rem" }} disabled={!pwForm.current || pwForm.next.length < 8}>Update</button>
            {pwMsg && <span style={{ fontSize: "0.8rem", color: "var(--purple-soft)" }}>{pwMsg}</span>}
          </form>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.6rem" }}>Add a super admin</span>
          <form onSubmit={onAddAdmin} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.3rem" }}>
            <input placeholder="email" value={newAdmin.email} style={{ flex: 2, minWidth: 160 }}
              onChange={e => setNewAdmin({ ...newAdmin, email: e.target.value })} />
            <input placeholder="password (8+ chars)" type="password" value={newAdmin.password} style={{ flex: 2, minWidth: 140 }} autoComplete="new-password"
              onChange={e => setNewAdmin({ ...newAdmin, password: e.target.value })} />
            <button type="submit" className="btn-primary" style={{ width: "auto", padding: "0.45rem 0.9rem" }}>Add</button>
          </form>
        </div>
      </main>
    </div>
  );
}
