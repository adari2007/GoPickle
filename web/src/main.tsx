import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { OrgLanding } from "./OrgLanding";
import { SuperAdmin } from "./SuperAdmin";
import { api, setAuthToken, setOnUnauthorized, setOrgSlug } from "./lib/api";
import { applyBranding, clearSession, loadSession, parseSlug } from "./lib/org";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

function render(node: React.ReactNode) {
  root.render(<React.StrictMode>{node}</React.StrictMode>);
}

// Org resolution happens before the app renders: /  → landing,
// /super → platform console, /<slug> → that organization's branded app.
async function bootstrap() {
  const slug = parseSlug();

  if (!slug) {
    document.title = "GoPickle";
    render(<OrgLanding />);
    return;
  }

  if (slug === "super") {
    document.title = "GoPickle Platform";
    render(<SuperAdmin />);
    return;
  }

  try {
    const org = await api.getOrgBranding(slug);
    setOrgSlug(slug);
    applyBranding(org);

    const session = loadSession(slug);
    if (session) setAuthToken(session.token);
    setOnUnauthorized(() => {
      clearSession(slug);
      setAuthToken(null);
      window.location.reload();
    });

    render(<App org={org} initialUser={session?.user ?? null} />);
  } catch {
    document.title = "GoPickle";
    render(<OrgLanding notFoundSlug={slug} />);
  }
}

bootstrap();
