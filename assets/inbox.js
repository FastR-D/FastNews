(() => {
  const todayNode = document.getElementById("inboxToday");
  const historyNode = document.getElementById("inboxHistory");
  const statusNode = document.getElementById("inboxStatus");
  const unreadNode = document.getElementById("inboxStatUnread");
  const totalNode = document.getElementById("inboxStatTotal");
  if (!todayNode || !historyNode) return;

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }
  function setStatus(text, kind) {
    if (!statusNode) return;
    statusNode.hidden = !text;
    statusNode.textContent = text || "";
    if (kind) statusNode.dataset.kind = kind;
    else delete statusNode.dataset.kind;
  }
  function todayStamp() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const shanghai = new Date(utc + 8 * 3600000);
    const year = shanghai.getFullYear();
    const month = String(shanghai.getMonth() + 1).padStart(2, "0");
    const day = String(shanghai.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  function renderCard(item, isToday) {
    const href = safeHttpUrl(item.url);
    const title = item.title_zh ? `${item.title} · ${item.title_zh}` : (item.title || "未命名论文");
    const heading = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
      : escapeHtml(title);
    const reason = item.reason ? `<p class="inbox-reason">${escapeHtml(item.reason)}</p>` : "";
    const summary = item.summary ? `<p class="inbox-summary">${escapeHtml(item.summary)}</p>` : "";
    const meta = [item.year, item.venue, item.authors].filter(Boolean).join(" · ");
    const actions = window.fastNewsFastReadButton ? `<div class="paper-actions">${window.fastNewsFastReadButton(item)}</div>` : "";
    return `<article class="inbox-card${isToday ? " is-today" : ""}">
      <p class="inbox-kicker">${isToday ? "今日推送" : escapeHtml(item.date || "")}</p>
      <h3>${heading}</h3>
      ${summary}
      ${reason}
      <p class="inbox-meta">${item.category ? `<span class="inbox-tag">${escapeHtml(item.category)}</span>` : ""}<span>${escapeHtml(meta)}</span><span>${escapeHtml(item.source || "")}</span></p>
      ${actions}
    </article>`;
  }
  function render(payload) {
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    const today = todayStamp();
    const todayItems = items.filter((item) => item && item.date === today && (item.kind || "daily-paper") === "daily-paper");
    const history = items.filter((item) => !(item && item.date === today && (item.kind || "daily-paper") === "daily-paper"));
    const unread = typeof payload.unread === "number" ? payload.unread : items.filter((item) => item && !item.read).length;
    if (unreadNode) unreadNode.textContent = String(unread);
    if (totalNode) totalNode.textContent = String(items.length);
    if (!todayItems.length) {
      todayNode.innerHTML = `<div class="empty">今天还没有推送。可先关注作者或完善研究印象，稍后刷新。</div>`;
    } else {
      todayNode.innerHTML = todayItems.map((item) => renderCard(item, true)).join("");
    }
    if (!history.length) {
      historyNode.innerHTML = `<div class="empty">还没有历史私信。</div>`;
    } else {
      historyNode.innerHTML = history.map((item) => renderCard(item, false)).join("");
    }
    const ids = todayItems.filter((item) => item && item.id && !item.read).map((item) => item.id);
    if (ids.length) markRead(ids);
  }
  async function markRead(ids) {
    try {
      const response = await fetch("/api/content/inbox", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readIds: ids }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.unread === "number") {
        document.querySelectorAll("#inboxNavCount, #inboxStatUnread").forEach((node) => {
          node.textContent = String(payload.unread);
          node.classList.toggle("is-unread", payload.unread > 0);
        });
      }
    } catch {
      // ignore
    }
  }

  if (window.FASTNEWS_INBOX) {
    render(window.FASTNEWS_INBOX);
    setStatus(window.FASTNEWS_INBOX.generatedToday ? "已根据关注作者与研究印象生成今日论文。" : "", window.FASTNEWS_INBOX.generatedToday ? "ok" : "");
  } else {
    setStatus("正在优先按关注作者挑选今日论文…", "pending");
  }
  document.addEventListener("fastnews-inbox", (event) => {
    const payload = event.detail || { items: [] };
    render(payload);
    if (payload.generatedToday) setStatus("已根据关注作者与研究印象生成今日论文。", "ok");
    else if ((payload.items || []).length) setStatus("");
    else setStatus("暂时没有可推送的论文，先写研究印象或关注作者后再刷新。", "error");
  });
})();
