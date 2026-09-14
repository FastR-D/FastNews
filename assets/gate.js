(() => {
  const DEFAULT_PANEL = "http://127.0.0.1:5173";
  const panel = () => String(window.FASTNEWS_PANEL_URL || DEFAULT_PANEL).replace(/\/$/, "");
  const ready = () => document.documentElement.classList.add("fastnews-ready");
  const bounce = () => { window.location.replace(panel()); };
  const params = new URLSearchParams(window.location.search);
  if (params.get("sso") || params.get("research_api")) {
    bounce();
    return;
  }
  fetch("/api/content/me", { credentials: "include" })
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((payload) => {
      if (!payload || !payload.keyId) throw new Error("no session");
      ready();
    })
    .catch(bounce);
})();
