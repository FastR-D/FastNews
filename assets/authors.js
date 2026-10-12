(() => {
  const STORAGE_KEY = "fastnews.favoriteAuthors";
  const TAG_STORAGE_KEY = "fastnews.customResearchTags";
  const DEFAULT_PANEL_URL = "http://127.0.0.1:5173";
  const DEFAULT_RESEARCH_TAGS = [
    "Web 安全",
    "网络安全",
    "系统安全",
    "硬件安全",
    "密码学",
    "隐私",
    "AI 安全",
    "可用安全",
    "二进制与取证",
    "漏洞分析",
  ];

  const modal = document.getElementById("authorModal");
  const form = document.getElementById("authorForm");
  const list = document.getElementById("authorList");
  const tray = document.getElementById("authorTaskTray");
  const sectionCount = document.getElementById("authorSectionCount");
  const statCount = document.getElementById("authorStatCount");
  const navCount = document.getElementById("authorNavCount");
  const gatewayCount = document.getElementById("authorGatewayCount");
  const toggleForm = document.getElementById("toggleAuthorForm");
  const closeForm = document.getElementById("closeAuthorForm");
  const cancelForm = document.getElementById("cancelAuthor");
  const formTitle = document.getElementById("authorFormTitle");
  const formHint = document.getElementById("authorFormHint");
  const submitLabel = document.getElementById("submitAuthorLabel");
  const researchOptions = document.getElementById("researchOptions");
  const customTagInput = document.getElementById("customResearchTag");
  const addTagButton = document.getElementById("addResearchTag");
  const validation = document.getElementById("authorValidation");

  if (!modal || !form || !list || !toggleForm) return;

  let editingId = "";
  let modalTrigger = null;
  let selectedTags = [];
  const fetchControllers = new Map();
  const dismissTimers = new Map();
  let researchSession = null;
  let authorCache = [];
  let customTagCache = [];
  let persistTimer = 0;

  function readLocalAuthors() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const authors = raw ? JSON.parse(raw) : [];
      return Array.isArray(authors) ? authors.map(normalizeAuthor) : [];
    } catch {
      return [];
    }
  }

  function readLocalTags() {
    try {
      const raw = window.localStorage.getItem(TAG_STORAGE_KEY);
      const tags = raw ? JSON.parse(raw) : [];
      return Array.isArray(tags) ? tags.map(normalizeTag).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function loadAuthors() {
    return authorCache.slice();
  }

  function saveAuthors(authors) {
    authorCache = (Array.isArray(authors) ? authors : []).map(normalizeAuthor).slice(0, 200);
    persistAuthors();
  }

  function loadCustomTags() {
    return customTagCache.slice();
  }

  function saveCustomTags(tags) {
    const unique = uniqueTags(tags).filter((tag) =>
      !DEFAULT_RESEARCH_TAGS.some((item) => item.toLowerCase() === tag.toLowerCase())
    );
    customTagCache = unique;
    persistAuthors();
    return unique;
  }

  function persistAuthors() {
    if (!researchSession) return;
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => { persistTimer = 0; void persistRemote(); }, 200);
  }

  function panelUrl() {
    return String(window.FASTNEWS_PANEL_URL || DEFAULT_PANEL_URL).replace(/\/$/, "");
  }

  async function persistRemote() {
    if (!researchSession) return;
    try {
      await fetch("/api/content/authors", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(researchSession.csrf ? {"X-CSRF-Token":researchSession.csrf} : {}),
          ...(researchSession.session ? { Authorization: `Bearer ${researchSession.session}` } : {}),
        },
        body: JSON.stringify({ authors: authorCache, customTags: customTagCache }),
      });
    } catch {
      // Keep the in-memory list even if the remote save is briefly unavailable.
    }
  }

  function updateIdentityHint() {
    const hint = document.getElementById("authorSectionHint");
    if (!hint) return;
    hint.textContent = researchSession?.person
      ? `已登录 ${researchSession.person} 的关注作者，点击作者行可编辑资料`
      : "点击作者行可编辑资料";
  }

  function stripSsoParams() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("sso") && !url.searchParams.has("research_api")) return;
    url.searchParams.delete("sso");
    url.searchParams.delete("research_api");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  function sessionFromPayload(apiBase, payload, bearer) {
    return {
      apiBase,
      session: payload.session || bearer || "",
      person: payload.person,
      keyId: payload.keyId,
      userId: payload.userId,
      csrf: payload.csrf,
      expiresAt: payload.expiresAt,
    };
  }

  async function fetchCookieSession() {
    const response = await fetch("/api/content/me", { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !(payload.keyId || payload.userId)) return null;
    return sessionFromPayload("", payload);
  }

  async function fetchRemoteAuthors() {
    const response = await fetch("/api/content/authors", {
      credentials: "include",
      headers: researchSession.session ? { Authorization: `Bearer ${researchSession.session}` } : {},
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "无法加载关注作者");
    return payload;
  }

  async function maybeMigrateLocal(keyId) {
    const flag = `fastnews.authorsMigrated.${keyId || "unknown"}`;
    if (window.localStorage.getItem(flag)) return;
    if (authorCache.length || customTagCache.length) {
      window.localStorage.setItem(flag, "1");
      return;
    }
    const localAuthors = readLocalAuthors();
    const localTags = readLocalTags();
    window.localStorage.setItem(flag, "1");
    if (!localAuthors.length && !localTags.length) return;
    authorCache = localAuthors;
    customTagCache = uniqueTags(localTags).filter((tag) =>
      !DEFAULT_RESEARCH_TAGS.some((item) => item.toLowerCase() === tag.toLowerCase())
    );
    await persistRemote();
  }

  async function bootResearchSession() {
    stripSsoParams();
    researchSession = await fetchCookieSession();
    if (!researchSession) {
      return;
    }
    try {
      const payload = await fetchRemoteAuthors();
      authorCache = Array.isArray(payload.authors) ? payload.authors.map(normalizeAuthor) : [];
      customTagCache = uniqueTags(payload.customTags || []).filter((tag) =>
        !DEFAULT_RESEARCH_TAGS.some((item) => item.toLowerCase() === tag.toLowerCase())
      );
      if (!researchSession.userId) await maybeMigrateLocal(researchSession.keyId);
    } catch {
      authorCache = [];
      customTagCache = [];
    }

    const authors = loadAuthors();
    const migrated = authors.map((author) => (
      author.fetchState === "pending"
        ? { ...author, fetchState: "idle", fetchMessage: "" }
        : author
    ));
    if (JSON.stringify(authors) !== JSON.stringify(migrated)) saveAuthors(migrated);
    updateIdentityHint();
    renderTagOptions();
    renderAuthors();
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `author-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeTag(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function uniqueTags(tags) {
    const seen = new Set();
    const result = [];
    for (const tag of tags) {
      const normalized = normalizeTag(tag);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  function authorTags(author) {
    if (Array.isArray(author?.tags) && author.tags.length) return uniqueTags(author.tags);
    if (typeof author?.bio === "string" && author.bio.trim()) {
      return uniqueTags(author.bio.split(/[/、,;|]+/));
    }
    return [];
  }

  function normalizeAuthor(author) {
    const tags = authorTags(author);
    const fetchState = ["pending", "success", "error", "cancelled", "idle"].includes(author?.fetchState)
      ? author.fetchState
      : (author?.parsed ? "success" : "idle");
    return {
      id: String(author?.id || createId()),
      name: String(author?.name || "").trim(),
      homepage: String(author?.homepage || "").trim(),
      tags,
      bio: tags.join(" / "),
      fetchState,
      fetchMessage: String(author?.fetchMessage || ""),
      parsed: author?.parsed && typeof author.parsed === "object" ? author.parsed : null,
    };
  }

  function normalizeHomepage(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function updateCounts(count) {
    if (sectionCount) sectionCount.textContent = `${count} 位作者`;
    if (statCount) statCount.textContent = count;
    if (gatewayCount) gatewayCount.textContent = count;
    if (navCount) navCount.textContent = count;
  }

  function availableTags(extra = []) {
    return uniqueTags([...DEFAULT_RESEARCH_TAGS, ...loadCustomTags(), ...extra]);
  }

  function showValidation(message) {
    if (!validation) return;
    validation.hidden = !message;
    validation.textContent = message || "";
  }

  function setSelectedTags(tags) {
    selectedTags = uniqueTags(tags);
    renderTagOptions();
  }

  function toggleTag(tag) {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    if (selectedTags.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      selectedTags = selectedTags.filter((item) => item.toLowerCase() !== normalized.toLowerCase());
    } else {
      selectedTags = uniqueTags([...selectedTags, normalized]);
    }
    renderTagOptions();
    showValidation("");
  }

  function addCustomTag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) {
      showValidation("请输入自定义研究方向。");
      return false;
    }
    saveCustomTags([...loadCustomTags(), tag]);
    selectedTags = uniqueTags([...selectedTags, tag]);
    if (customTagInput) customTagInput.value = "";
    renderTagOptions();
    showValidation("");
    return true;
  }

  function renderTagOptions() {
    if (!researchOptions) return;
    const tags = availableTags(selectedTags);
    researchOptions.innerHTML = tags.map((tag) => {
      const pressed = selectedTags.some((item) => item.toLowerCase() === tag.toLowerCase());
      return `<button class="research-tag" type="button" aria-pressed="${pressed ? "true" : "false"}">${escapeHtml(tag)}</button>`;
    }).join("");
  }

  function isDialogOpen() {
    return Boolean(modal.open) || modal.hasAttribute("open");
  }

  function openAuthorForm(id = "", trigger = document.activeElement) {
    const authors = loadAuthors();
    const author = authors.find((item) => item.id === id);
    editingId = author ? author.id : "";
    modalTrigger = trigger instanceof HTMLElement ? trigger : toggleForm;
    form.reset();
    showValidation("");
    if (customTagInput) customTagInput.value = "";
    formTitle.textContent = author ? "编辑作者" : "新增作者";
    formHint.textContent = author ? "修改资料后可重新获取并解析主页。" : "填写作者资料，保存后获取并解析主页。";
    submitLabel.textContent = author ? "保存并获取" : "保存并获取";
    form.querySelector("[name=name]").value = author?.name || "";
    form.querySelector("[name=homepage]").value = author?.homepage || "";
    setSelectedTags(author?.tags || []);
    toggleForm.setAttribute("aria-expanded", "true");
    document.body.classList.add("modal-open");
    if (typeof modal.showModal === "function") {
      if (!modal.open) modal.showModal();
    } else {
      modal.setAttribute("open", "");
      modal.hidden = false;
    }
    window.requestAnimationFrame(() => form.querySelector("[name=name]")?.focus());
  }

  function closeAuthorEditor(restoreFocus = true) {
    if (!isDialogOpen() && !document.body.classList.contains("modal-open")) return;
    editingId = "";
    selectedTags = [];
    form.reset();
    showValidation("");
    if (typeof modal.close === "function" && modal.open) modal.close();
    else {
      modal.removeAttribute("open");
      modal.hidden = true;
    }
    document.body.classList.remove("modal-open");
    toggleForm.setAttribute("aria-expanded", "false");
    const trigger = modalTrigger;
    modalTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  function fetchLabel(author) {
    const state = author.fetchState || "idle";
    if (state === "idle") return "";
    const text = author.fetchMessage || {
      pending: "正在获取并解析主页…",
      success: "主页解析完成",
      error: "主页获取失败",
      cancelled: "已取消获取",
    }[state] || "";
    return text ? `<span class="author-fetch-label" data-state="${escapeHtml(state)}">${escapeHtml(text)}</span>` : "";
  }

  function renderAuthors() {
    const authors = loadAuthors();
    updateCounts(authors.length);
    if (!authors.length) {
      list.innerHTML = '<div class="empty">还没有添加关注作者。</div>';
      return;
    }
    list.innerHTML = authors.map((author) => {
      const tags = author.tags.length
        ? `<span class="author-tags">${author.tags.map((tag) => `<span class="author-tag">${escapeHtml(tag)}</span>`).join("")}</span>`
        : `<span class="author-bio">未标注研究方向</span>`;
      return `
      <article class="author-row">
        <button class="author-row-main" type="button" data-edit-id="${escapeHtml(author.id)}" title="编辑 ${escapeHtml(author.name)}">
          <span class="author-name-cell"><span class="author-name">${escapeHtml(author.name)}</span>${fetchLabel(author)}</span>
          ${tags}
          <span class="author-url">${escapeHtml(author.homepage)}</span>
        </button>
        <div class="author-actions">
          <a class="icon-button" href="${escapeHtml(author.homepage)}" target="_blank" rel="noopener noreferrer" aria-label="访问 ${escapeHtml(author.name)} 的主页" title="访问主页"><svg class="icon"><use href="#icon-external"></use></svg></a>
          <button class="icon-button button-danger" type="button" data-delete-id="${escapeHtml(author.id)}" aria-label="删除 ${escapeHtml(author.name)}" title="删除作者"><svg class="icon"><use href="#icon-trash"></use></svg></button>
        </div>
      </article>`;
    }).join("");
  }

  function patchAuthor(id, updates) {
    const authors = loadAuthors();
    const index = authors.findIndex((item) => item.id === id);
    if (index < 0) return null;
    authors[index] = { ...authors[index], ...updates };
    saveAuthors(authors);
    renderAuthors();
    return authors[index];
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, ms);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function parseHomepage(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = (doc.querySelector("title")?.textContent || "").replace(/\s+/g, " ").trim();
    const description = (
      doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
      doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      ""
    ).replace(/\s+/g, " ").trim();
    const headings = [...doc.querySelectorAll("h1, h2, h3")]
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .filter((text) => text && text.length < 140)
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 8);
    const publications = [...doc.querySelectorAll("li, p, cite, a")]
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 28 && text.length < 280)
      .filter((text) => /(20\d{2}|proceedings|conference|arxiv|ieee|usenix|ndss|\bccs\b|acm|journal|workshop|symposium|论文|发表)/i.test(text))
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 8);
    return { url, title, description, headings, publications, fetchedAt: new Date().toISOString() };
  }

  function summarizeParse(parsed) {
    const parts = [];
    if (parsed.title) parts.push(`标题「${parsed.title}」`);
    if (parsed.publications.length) parts.push(`发现 ${parsed.publications.length} 条疑似论文条目`);
    else if (parsed.headings.length) parts.push(`读取到 ${parsed.headings.length} 个页面标题`);
    if (!parts.length) return "主页已获取，但没有解析到明确的论文信息。";
    return `解析完成：${parts.join("，")}。`;
  }

  function taskCard(id) {
    return tray?.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
  }

  function ensureTask(author) {
    if (!tray) return null;
    let card = taskCard(author.id);
    if (!card) {
      card = document.createElement("article");
      card.className = "author-task";
      card.dataset.taskId = author.id;
      card.innerHTML = `
        <div class="author-task-head">
          <h3></h3>
          <button class="icon-button" type="button" data-dismiss-task aria-label="关闭提示" title="关闭提示"><svg class="icon"><use href="#icon-x"></use></svg></button>
        </div>
        <p class="author-task-message"></p>
        <progress class="author-progress" max="100"></progress>
        <p class="author-task-result" hidden></p>
        <div class="author-task-actions">
          <button class="button button-sm" type="button" data-cancel-task>取消</button>
          <button class="button button-sm button-secondary" type="button" data-retry-task hidden>重试</button>
        </div>`;
      tray.prepend(card);
    }
    return card;
  }

  function updateTask(author, options = {}) {
    const card = ensureTask(author);
    if (!card) return;
    const { progress = null, result = "", cancellable = false, retryable = false } = options;
    card.dataset.state = author.fetchState || "pending";
    card.querySelector("h3").textContent = author.fetchState === "success"
      ? `${author.name} 主页已解析`
      : author.fetchState === "error"
        ? `${author.name} 获取失败`
        : author.fetchState === "cancelled"
          ? `已取消获取 ${author.name}`
          : `正在获取 ${author.name} 的主页`;
    card.querySelector(".author-task-message").textContent = author.fetchMessage || "";
    const bar = card.querySelector(".author-progress");
    if (progress == null || author.fetchState === "error" || author.fetchState === "cancelled" || author.fetchState === "success") {
      bar.hidden = author.fetchState !== "pending";
      if (author.fetchState === "pending") bar.removeAttribute("value");
    } else {
      bar.hidden = false;
      bar.max = 100;
      bar.value = progress;
    }
    const resultNode = card.querySelector(".author-task-result");
    if (result) {
      resultNode.hidden = false;
      resultNode.textContent = result;
    } else {
      resultNode.hidden = true;
      resultNode.textContent = "";
    }
    const cancelButton = card.querySelector("[data-cancel-task]");
    const retryButton = card.querySelector("[data-retry-task]");
    cancelButton.hidden = !cancellable;
    retryButton.hidden = !retryable;
    card.querySelector(".author-task-actions").hidden = !cancellable && !retryable;
  }

  function clearDismissTimer(id) {
    const timer = dismissTimers.get(id);
    if (timer) window.clearTimeout(timer);
    dismissTimers.delete(id);
  }

  function removeTask(id) {
    clearDismissTimer(id);
    taskCard(id)?.remove();
  }

  function scheduleRemoveTask(id, delay = 7000) {
    clearDismissTimer(id);
    dismissTimers.set(id, window.setTimeout(() => removeTask(id), delay));
  }

  async function fetchHomepage(url, signal) {
    const response = await fetch(url, {
      signal,
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`主页返回 ${response.status}`);
    const html = await response.text();
    if (!html.trim()) throw new Error("主页内容为空");
    return html;
  }

  async function startFetch(authorId) {
    const existing = fetchControllers.get(authorId);
    existing?.abort();
    const controller = new AbortController();
    fetchControllers.set(authorId, controller);
    const signal = controller.signal;
    const current = loadAuthors().find((item) => item.id === authorId);
    if (!current) return;

    patchAuthor(authorId, { fetchState: "pending", fetchMessage: "正在获取主页…", parsed: current.parsed || null });
    updateTask({ ...current, fetchState: "pending", fetchMessage: "正在获取主页…" }, { progress: 12, cancellable: true });

    try {
      await sleep(360, signal);
      let html = "";
      let fetchNote = "";
      try {
        html = await fetchHomepage(current.homepage, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        fetchNote = error instanceof TypeError
          ? "浏览器无法直接跨域读取该主页，已保存作者资料。"
          : (error?.message || "主页获取失败");
      }

      if (signal.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      if (fetchControllers.get(authorId) !== controller) return;
      patchAuthor(authorId, { fetchState: "pending", fetchMessage: "正在解析页面内容…" });
      updateTask({ ...current, fetchState: "pending", fetchMessage: "正在解析页面内容…" }, { progress: 62, cancellable: true });
      await sleep(420, signal);
      if (fetchControllers.get(authorId) !== controller) return;

      let parsed = current.parsed;
      let result = "";
      if (html) {
        parsed = parseHomepage(html, current.homepage);
        result = summarizeParse(parsed);
      } else {
        parsed = {
          url: current.homepage,
          title: "",
          description: "",
          headings: [],
          publications: [],
          fetchedAt: new Date().toISOString(),
          note: fetchNote,
        };
        result = `${fetchNote} 可点击主页链接查看原文。`;
      }

      const saved = patchAuthor(authorId, {
        fetchState: html ? "success" : "error",
        fetchMessage: html ? "主页解析完成" : "主页获取受限",
        parsed,
      });
      updateTask(saved, {
        progress: 100,
        result,
        retryable: !html,
      });
      if (html) scheduleRemoveTask(authorId);
    } catch (error) {
      if (fetchControllers.get(authorId) !== controller) return;
      if (error?.name === "AbortError") {
        const saved = patchAuthor(authorId, { fetchState: "cancelled", fetchMessage: "已取消获取" });
        if (saved) updateTask(saved, { retryable: true });
        return;
      }
      const saved = patchAuthor(authorId, {
        fetchState: "error",
        fetchMessage: error?.message || "主页获取失败",
      });
      if (saved) updateTask(saved, { retryable: true, result: "请检查链接是否可访问，或稍后重试。" });
    } finally {
      if (fetchControllers.get(authorId) === controller) fetchControllers.delete(authorId);
    }
  }

  toggleForm.addEventListener("click", (event) => { if (!researchSession) { window.location.assign(window.fastNewsApi ? window.fastNewsApi("/login") : "/login"); return; } openAuthorForm("", event.currentTarget); });
  closeForm?.addEventListener("click", () => closeAuthorEditor());
  cancelForm?.addEventListener("click", () => closeAuthorEditor());

  modal.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) event.stopPropagation();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAuthorEditor();
    }
  });

  researchOptions?.addEventListener("click", (event) => {
    const button = event.target.closest(".research-tag");
    if (button) toggleTag(button.textContent);
  });
  addTagButton?.addEventListener("click", () => addCustomTag(customTagInput?.value));
  customTagInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTag(customTagInput.value);
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!researchSession) { window.location.assign(window.fastNewsApi ? window.fastNewsApi("/login") : "/login"); return; }
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const homepage = normalizeHomepage(String(data.get("homepage") || "").trim());
    const tags = uniqueTags(selectedTags);
    if (!name) { showValidation("请填写作者姓名。"); return; }
    if (!homepage) { showValidation("请填写有效的主页链接。"); return; }
    if (!tags.length) { showValidation("请至少选择一个研究方向标签。"); return; }

    const authors = loadAuthors();
    const existingIndex = authors.findIndex((item) => item.id === editingId);
    const previous = existingIndex >= 0 ? authors[existingIndex] : null;
    const author = {
      id: previous?.id || createId(),
      name,
      homepage,
      tags,
      bio: tags.join(" / "),
      fetchState: "pending",
      fetchMessage: "正在获取并解析主页…",
      parsed: previous?.homepage === homepage ? previous.parsed : null,
    };
    if (previous) authors[existingIndex] = author;
    else authors.unshift(author);
    saveAuthors(authors);
    closeAuthorEditor(false);
    renderAuthors();
    toggleForm.focus();
    startFetch(author.id);
  });

  list.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-id]");
    if (edit) {
      openAuthorForm(edit.dataset.editId, edit);
      return;
    }
    const remove = event.target.closest("[data-delete-id]");
    if (!remove) return;
    const id = remove.dataset.deleteId;
    fetchControllers.get(id)?.abort();
    removeTask(id);
    saveAuthors(loadAuthors().filter((item) => item.id !== id));
    renderAuthors();
  });

  tray?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-task-id]");
    if (!card) return;
    const id = card.dataset.taskId;
    if (event.target.closest("[data-dismiss-task]")) {
      fetchControllers.get(id)?.abort();
      removeTask(id);
      return;
    }
    if (event.target.closest("[data-cancel-task]")) {
      fetchControllers.get(id)?.abort();
      return;
    }
    if (event.target.closest("[data-retry-task]")) {
      startFetch(id);
    }
  });

  void bootResearchSession();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && researchSession && persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = 0;
      void persistRemote();
    }
  });
})();
