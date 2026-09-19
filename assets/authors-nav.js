(() => {
  window.FASTNEWS_IMPRESSION = window.FASTNEWS_IMPRESSION || "";
  window.FASTNEWS_INBOX_UNREAD = window.FASTNEWS_INBOX_UNREAD || 0;
  window.FASTNEWS_INBOX = window.FASTNEWS_INBOX || null;

  const navCount = document.getElementById("authorNavCount");
  const navLinks = [...document.querySelectorAll(".nav-list a, .mobile-nav a")];
  const authorLinks = navLinks.filter((link) => (link.getAttribute("href") || "").endsWith("#authors"));
  const homeLinks = navLinks.filter((link) => {
    const href = link.getAttribute("href") || "";
    return href === "index.html" || href === "../index.html";
  });
  const inboxCounts = [...document.querySelectorAll("#inboxNavCount, #inboxStatUnread")];
  const sidebarToggle = document.getElementById("sidebarToggle");

  function onHomePage() {
    const path = window.location.pathname.replace(/\\/g, "/");
    return !/\/(top-conf|field-briefing|secnews|inbox|impression)(?:\/|$)/.test(path);
  }

  function syncActive() {
    if (!authorLinks.length) return;
    const highlightAuthors = onHomePage() && window.location.hash === "#authors";
    authorLinks.forEach((link) => link.classList.toggle("active", highlightAuthors));
    homeLinks.forEach((link) => {
      if (highlightAuthors) link.classList.remove("active");
      else if (onHomePage()) link.classList.add("active");
    });
  }

  function setUnread(count) {
    const unread = Number(count) || 0;
    window.FASTNEWS_INBOX_UNREAD = unread;
    inboxCounts.forEach((node) => {
      node.textContent = String(unread);
      node.classList.toggle("is-unread", unread > 0);
    });
  }

  function applySidebar(collapsed) {
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
    window.localStorage.setItem("fastnews.sidebarCollapsed", collapsed ? "1" : "0");
    if (sidebarToggle) {
      sidebarToggle.title = collapsed ? "打开总览栏" : "隐藏总览栏";
      sidebarToggle.setAttribute("aria-label", sidebarToggle.title);
      sidebarToggle.setAttribute("aria-pressed", collapsed ? "true" : "false");
    }
  }

  if (authorLinks.length) {
    window.addEventListener("hashchange", syncActive);
    syncActive();
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      applySidebar(!document.documentElement.classList.contains("sidebar-collapsed"));
    });
    applySidebar(document.documentElement.classList.contains("sidebar-collapsed"));
  }

  fetch("/api/content/me", { credentials: "include" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (!payload) return;
      if (navCount && Array.isArray(payload.authors)) navCount.textContent = String(payload.authors.length);
      if (payload.impression && typeof payload.impression.text === "string") {
        window.FASTNEWS_IMPRESSION = payload.impression.text;
      }
      if (typeof payload.inboxUnread === "number") setUnread(payload.inboxUnread);
      document.dispatchEvent(new CustomEvent("fastnews-profile", {
        detail: {
          impression: payload.impression || { text: window.FASTNEWS_IMPRESSION, updatedAt: "" },
          inboxUnread: window.FASTNEWS_INBOX_UNREAD,
        },
      }));
    })
    .catch(() => {});

  fetch("/api/content/inbox", { credentials: "include" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (!payload) return;
      window.FASTNEWS_INBOX = payload;
      if (typeof payload.unread === "number") setUnread(payload.unread);
      document.dispatchEvent(new CustomEvent("fastnews-inbox", { detail: payload }));
    })
    .catch(() => {});
})();
