(() => {
  const DEFAULT_PANEL = "http://127.0.0.1:5173";

  function inferPublicPath() {
    const configured = String(window.FASTNEWS_PUBLIC_PATH || "").trim();
    if (configured && configured !== "/") {
      return configured.replace(/\/$/, "");
    }
    const script = document.currentScript || document.querySelector('script[src*="assets/gate.js"]');
    const src = (script && (script.src || script.getAttribute("src"))) || "";
    if (!src) return "";
    try {
      const pathname = new URL(src, window.location.href).pathname.replace(/\\/g, "/");
      const marker = "/assets/gate.js";
      const idx = pathname.lastIndexOf(marker);
      if (idx > 0) return pathname.slice(0, idx).replace(/\/$/, "");
    } catch {
      return "";
    }
    return "";
  }

  window.FASTNEWS_PUBLIC_PATH = inferPublicPath();
  window.fastNewsApi = function (path) {
    const prefix = String(window.FASTNEWS_PUBLIC_PATH || "").replace(/\/$/, "");
    const normalized = String(path || "");
    if (!normalized) return prefix || "/";
    return prefix + (normalized.startsWith("/") ? normalized : "/" + normalized);
  };

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
