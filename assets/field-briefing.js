(function () {
  const form = document.getElementById("fieldBriefingForm");
  const queryInput = document.getElementById("fieldQuery");
  const categoryInput = document.getElementById("fieldCategory");
  const sourceInput = document.getElementById("fieldSource");
  const submitButton = document.getElementById("fieldBriefingSubmit");
  const statusNode = document.getElementById("fieldBriefingStatus");
  const resultNode = document.getElementById("fieldBriefingResult");
  const config = window.FASTNEWS_FIELD_BRIEFING || {};
  const examples = config.examples || ["LLM jailbreak", "侧信道", "TEE", "提示注入", "模糊测试", "差分隐私"];
  let impressionText = String(window.FASTNEWS_IMPRESSION || "");

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
  function sourceLabel(source) {
    return source === "arxiv" ? "arXiv" : "顶会";
  }
  function renderExamples() {
    const box = document.getElementById("fieldBriefingExamples");
    if (!box) return;
    box.innerHTML = examples.map((item) => `<button class="field-chip" type="button" data-query="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("");
    box.querySelectorAll(".field-chip").forEach((button) => {
      button.addEventListener("click", () => {
        queryInput.value = button.dataset.query || "";
        box.querySelectorAll(".field-chip").forEach((node) => node.classList.toggle("is-active", node === button));
        form.requestSubmit();
      });
    });
  }
  function renderPapers(title, items, emptyText) {
    if (!items || !items.length) {
      return `<section class="briefing-papers"><div class="section-head"><div><h2>${escapeHtml(title)}</h2></div><span class="section-count">0</span></div><div class="empty">${escapeHtml(emptyText)}</div></section>`;
    }
    const rows = items.map((item) => {
      const href = safeHttpUrl(item.link);
      const titleText = item.title_zh ? `${item.title} · ${item.title_zh}` : item.title;
      const heading = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(titleText)}</a>`
        : escapeHtml(titleText);
      const reason = item.reason ? `<p class="conference-reason">${escapeHtml(item.reason)}</p>` : "";
      const actions = window.fastNewsFastReadButton ? `<div class="paper-actions">${window.fastNewsFastReadButton(item)}</div>` : "";
      return `<article class="conference-row has-reason">
        <h3 class="conference-title">${heading}</h3>
        ${item.summary ? `<p class="conference-summary">${escapeHtml(item.summary)}</p>` : ""}
        ${reason}
        <p class="conference-meta"><span class="conference-tag">${escapeHtml(item.category || sourceLabel(item.source))}</span><span>${escapeHtml([item.year, item.venue, item.author].filter(Boolean).join(" · "))}</span><span class="briefing-kind">${escapeHtml(sourceLabel(item.source))}</span></p>
        ${actions}
      </article>`;
    }).join("");
    return `<section class="briefing-papers"><div class="section-head"><div><h2>${escapeHtml(title)}</h2></div><span class="section-count">${items.length}</span></div><div class="briefing-paper-list">${rows}</div></section>`;
  }
  function briefingHasReview(briefing) {
    return Boolean(briefing && (briefing.scope || briefing.gaps || (Array.isArray(briefing.categories) && briefing.categories.length)));
  }
  function renderBriefing(payload) {
    const briefing = payload.briefing || {};
    const title = briefing.field_zh || payload.query || "领域导读";
    const categories = Array.isArray(briefing.categories) ? briefing.categories : [];
    const scopeHtml = briefing.scope
      ? `<article class="briefing-scope"><h3>综述范围</h3><p>${escapeHtml(briefing.scope)}</p></article>`
      : "";
    const catHtml = categories.length
      ? `<div class="briefing-categories">${categories.map((item, index) => `<article class="briefing-category">
          <h3><span class="briefing-cat-index">${index + 1}</span>${escapeHtml(item.name || "")}</h3>
          ${item.consensus ? `<p class="briefing-consensus"><strong>共识</strong>${escapeHtml(item.consensus)}</p>` : ""}
          ${item.developments ? `<p class="briefing-developments">${escapeHtml(item.developments)}</p>` : ""}
        </article>`).join("")}</div>`
      : "";
    const gapsHtml = briefing.gaps
      ? `<article class="briefing-gaps"><h3>研究不足</h3><p>${escapeHtml(briefing.gaps)}</p></article>`
      : "";
    const intro = `<section class="briefing-panel">
      <p class="briefing-kicker">FIELD BRIEFING</p>
      <h2 class="briefing-title">${escapeHtml(title)}</h2>
      ${briefing.field_en ? `<p class="briefing-en">${escapeHtml(briefing.field_en)}</p>` : ""}
      <p class="briefing-coverage">${escapeHtml(briefing.coverage || payload.coverage || "")}</p>
      ${scopeHtml}
      ${catHtml}
      ${gapsHtml}
    </section>`;
    resultNode.innerHTML = intro + renderPapers("奠基与综述", payload.surveys || [], "未找到足够相关的综述或 SoK。") + renderPapers("FastNews 高相关", payload.papers || [], "没有找到足够相关的论文。");
    resultNode.hidden = false;
  }
  async function runBriefing(event) {
    event.preventDefault();
    let query = queryInput.value.trim();
    if (!query) {
      query = impressionText.trim().split(/\n/)[0].trim().slice(0, 120);
    }
    if (!query) {
      setStatus("请输入一个研究方向，或先在研究印象中写下你的方向。", "error");
      queryInput.focus();
      return;
    }
    submitButton.disabled = true;
    setStatus(impressionText ? "正在结合你的研究印象检索顶会摘要与近期 arXiv…" : "正在检索顶会摘要与近期 arXiv，并生成领域导读…", "pending");
    try {
      const response = await fetch("/api/field-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          category: categoryInput.value,
          source: sourceInput.value || "all",
          impression: impressionText,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || ("field-briefing http " + response.status));
      renderBriefing(payload);
      const count = Array.isArray(payload.papers) ? payload.papers.length : 0;
      if (!count && !briefingHasReview(payload.briefing)) {
        setStatus("没有找到足够相关的论文，试着换英文别名或放宽类别。", "error");
      } else if (payload.source === "llm") {
        setStatus("已根据「" + query + "」生成导读，并推荐 " + count + " 篇 FastNews 论文。", "ok");
      } else {
        setStatus("导读服务暂不可用，已按本地相关度列出 " + count + " 篇论文。", "fallback");
      }
    } catch (_error) {
      resultNode.hidden = true;
      resultNode.innerHTML = "";
      setStatus("生成失败，请稍后重试或更换更具体的研究方向。", "error");
    } finally {
      submitButton.disabled = false;
    }
  }

  function applyImpression(text) {
    impressionText = String(text || "").trim();
    if (!queryInput.value.trim() && impressionText) {
      const line = impressionText.split(/\n/)[0].trim().slice(0, 80);
      if (line) queryInput.placeholder = "已结合研究印象，也可再输入更具体的方向，例如 " + line;
    }
  }
  document.addEventListener("fastnews-profile", (event) => {
    applyImpression(event.detail && event.detail.impression && event.detail.impression.text);
  });
  applyImpression(window.FASTNEWS_IMPRESSION);
  renderExamples();
  form.addEventListener("submit", runBriefing);
})();
