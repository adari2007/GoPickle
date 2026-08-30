import { FormEvent, useState } from "react";
import { api } from "./lib/api";
import logo from "./assets/logo-pickle.svg";

// Landing page shown at "/" (no org slug) or when a slug doesn't resolve.
// Organizations are provisioned by the platform team (super admins), so the
// only action here is finding an existing organization.
export function OrgLanding({ notFoundSlug }: { notFoundSlug?: string }) {
  const [findSlug, setFindSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function slugify(v: string) {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  async function onFind(e: FormEvent) {
    e.preventDefault();
    const slug = slugify(findSlug);
    if (!slug) return;
    setLoading(true);
    try {
      await api.getOrgBranding(slug);
      window.location.href = `/${slug}`;
    } catch {
      setError(`No organization found at "${slug}".`);
      setLoading(false);
    }
  }

  return (
    <div className="auth-root">
      <div className="auth-brand">
        <div className="auth-brand-inner">
          <img src={logo} alt="GoPickle" className="auth-brand-logo" />
          <h1 className="auth-brand-name">GoPickle</h1>
          <p className="auth-brand-tagline">
            White-label pickleball platform — every organization gets its own branded app.
          </p>
          <ul className="auth-features">
            <li>🎨 Your name, logo &amp; theme</li>
            <li>👥 Your own members &amp; admins</li>
            <li>🏆 Tournaments, leagues &amp; more</li>
            <li>🔒 Fully separate per organization</li>
          </ul>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-logo-mobile">
            <img src={logo} alt="" />
            <span>GoPickle</span>
          </div>

          {notFoundSlug && (
            <p className="auth-error">Organization “{notFoundSlug}” was not found.</p>
          )}

          <h2 className="auth-title">Find your organization</h2>
          <p className="auth-subtitle">Enter your organization's short name</p>

          <form onSubmit={onFind} className="auth-form">
            <div className="field">
              <label>Organization</label>
              <input placeholder="e.g. acme-pickleball" value={findSlug}
                onChange={e => { setFindSlug(e.target.value); setError(null); }} />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading || !findSlug.trim()}>
              {loading ? "Please wait…" : "Go to my organization"}
            </button>
          </form>

          <p className="auth-switch">
            Want your own organization? Contact the platform team to get set up.
          </p>
        </div>
      </div>
    </div>
  );
}
