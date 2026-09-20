(() => {
  const form = document.getElementById("impressionForm");
  const input = document.getElementById("impressionText");
  const count = document.getElementById("impressionCount");
  const updated = document.getElementById("impressionUpdated");
  const status = document.getElementById("impressionStatus");
  const submit = document.getElementById("impressionSubmit");
  if (!form || !input) return;

  function setStatus(text, kind) {
    if (!status) return;
    status.hidden = !text;
    status.textContent = text || "";
    if (kind) status.dataset.kind = kind;
    else delete status.dataset.kind;
  }

  function syncCount() {
    if (count) count.textContent = `${input.value.length} / 4000`;
  }

  function formatTime(value) {
    const raw = String(value || "").trim();
    if (!raw) return "尚未保存";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return `更新于 ${date.toLocaleString("zh-CN", { hour12: false })}`;
  }

  function applyImpression(text, updatedAt) {
    if (document.activeElement !== input) input.value = String(text || "");
    syncCount();
    if (updated) updated.textContent = formatTime(updatedAt);
  }

  async function loadImpression() {
    try {
      const response = await fetch("/api/content/impression", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "load failed");
      const impression = payload.impression || {};
      applyImpression(impression.text, impression.updatedAt);
      window.FASTNEWS_IMPRESSION = impression.text || "";
    } catch {
      applyImpression(window.FASTNEWS_IMPRESSION || "", "");
      setStatus("无法读取研究印象，请刷新后重试。", "error");
    }
  }

  async function saveImpression(event) {
    event.preventDefault();
    submit.disabled = true;
    setStatus("正在保存…", "pending");
    try {
      const response = await fetch("/api/content/impression", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "save failed");
      const impression = payload.impression || { text: input.value };
      applyImpression(impression.text, impression.updatedAt);
      window.FASTNEWS_IMPRESSION = impression.text || "";
      document.dispatchEvent(new CustomEvent("fastnews-profile", {
        detail: { impression, inboxUnread: window.FASTNEWS_INBOX_UNREAD || 0 },
      }));
      setStatus("研究印象已保存。领域导读、总结汇报、找论文和每日私信都会使用它。", "ok");
    } catch {
      setStatus("保存失败，请稍后重试。", "error");
    } finally {
      submit.disabled = false;
    }
  }

  input.addEventListener("input", syncCount);
  form.addEventListener("submit", saveImpression);
  document.addEventListener("fastnews-profile", (event) => {
    const impression = event.detail && event.detail.impression;
    if (impression) applyImpression(impression.text, impression.updatedAt);
  });
  syncCount();
  loadImpression();
})();
