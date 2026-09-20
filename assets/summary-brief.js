(function () {
  const form = document.getElementById("summaryBriefForm");
  const queryInput = document.getElementById("summaryQuery");
  const categoryInput = document.getElementById("summaryCategory");
  const sourceInput = document.getElementById("summarySource");
  const submitButton = document.getElementById("summaryBriefSubmit");
  const statusNode = document.getElementById("summaryBriefStatus");
  const resultNode = document.getElementById("summaryBriefResult");
  const config = window.FASTNEWS_SUMMARY_BRIEF || {};
  const examples = config.examples || ["\u56db\u5927\u9876\u4f1a\u5168\u666f", "LLM jailbreak", "\u4fa7\u4fe1\u9053", "\u6a21\u7cca\u6d4b\u8bd5", "\u5dee\u5206\u9690\u79c1"];
  let impressionText = String(window.FASTNEWS_IMPRESSION || "");
  const UI = {
    landscape: "\u56db\u5927\u9876\u4f1a\u5168\u666f",
    venueTop: "\u9876\u4f1a",
    papersTitle: "\u76f8\u5173\u8bba\u6587",
    papersEmpty: "\u6ca1\u6709\u8db3\u591f\u7684\u76f8\u5173\u8bba\u6587\u3002",
    pending: "\u6b63\u5728\u6838\u5bf9\u9876\u4f1a\u6458\u8981\u5e76\u751f\u6210\u5b9e\u8bc1\u7b80\u62a5\u2026",
    pendingImpression: "\u6b63\u5728\u7ed3\u5408\u7814\u7a76\u5370\u8c61\u6838\u5bf9\u9876\u4f1a\u6458\u8981\u2026",
    okPrefix: "\u5df2\u6839\u636e\u300c",
    okSuffix: "\u300d\u751f\u6210\u5b9e\u8bc1\u7b80\u62a5\uff0c\u6837\u672c ",
    okTail: "\u7bc7\u3002",
    fallback: "\u6a21\u578b\u63a5\u53e3\u4e0d\u53ef\u7528\uff0c\u5df2\u7528\u672c\u5730\u7edf\u8ba1\u751f\u6210\u7b80\u62a5\u3002",
    error: "\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
    emptySample: "\u6ca1\u6709\u8db3\u591f\u6837\u672c\uff0c\u8bf7\u6362\u4e00\u4e2a\u65b9\u5411\u6216\u6539\u6210\u56db\u5927\u9876\u4f1a\u5168\u666f\u3002",
  };

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
    return source === "arxiv" ? "arXiv" : UI.venueTop;
  }
  function formatPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return String(Math.round(n * 100) / 100);
  }
  function renderExamples() {
    const box = document.getElementById("summaryBriefExamples");
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
      const titleText = item.title_zh ? `${item.title} \xb7 ${item.title_zh}` : item.title;
      const heading = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(titleText)}</a>`
        : escapeHtml(titleText);
      const reason = item.reason ? `<p class="conference-reason">${escapeHtml(item.reason)}</p>` : "";
      const actions = window.fastNewsFastReadButton ? `<div class="paper-actions">${window.fastNewsFastReadButton(item)}</div>` : "";
      return `<article class="conference-row has-reason">
        <h3 class="conference-title">${heading}</h3>
        ${item.summary ? `<p class="conference-summary">${escapeHtml(item.summary)}</p>` : ""}
        ${reason}
        <p class="conference-meta"><span class="conference-tag">${escapeHtml(item.category || sourceLabel(item.source))}</span><span>${escapeHtml([item.year, item.venue, item.author].filter(Boolean).join(" \xb7 "))}</span><span class="briefing-kind">${escapeHtml(sourceLabel(item.source))}</span></p>
        ${actions}
      </article>`;
    }).join("");
    return `<section class="briefing-papers"><div class="section-head"><div><h2>${escapeHtml(title)}</h2></div><span class="section-count">${items.length}</span></div><div class="briefing-paper-list">${rows}</div></section>`;
  }
  function renderBars(title, rows) {
    if (!rows || !rows.length) return "";
    const max = Math.max.apply(null, rows.map((row) => Number(row.count) || 0)) || 1;
    const body = rows.slice(0, 10).map((row, index) => {
      const count = Number(row.count) || 0;
      const width = Math.max(6, Math.round((count * 100) / max));
      const fillClass = index === 0 ? "brief-bar-fill is-accent" : "brief-bar-fill";
      return `<div class="brief-bar-row">
        <span class="brief-bar-label">${escapeHtml(row.label || "")}</span>
        <span class="brief-bar-track"><span class="${fillClass}" style="width:${width}%"></span></span>
        <span class="brief-bar-value">${count} \xb7 ${escapeHtml(formatPct(row.pct))}%</span>
      </div>`;
    }).join("");
    return `<p class="brief-chart-title">${escapeHtml(title)}</p><div class="brief-bars">${body}</div>`;
  }
  function renderTable(headers, rows) {
    if (!rows || !rows.length) return "";
    const head = headers.map((item) => `<th${item.num ? ' class="num"' : ""}>${escapeHtml(item.label)}</th>`).join("");
    const body = rows.map((row) => {
      const cells = row.map((cell, index) => `<td${headers[index] && headers[index].num ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<div class="brief-table-wrap"><table class="brief-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function renderStats(stats) {
    const conferences = Array.isArray(stats.by_conference) ? stats.by_conference : [];
    const years = Array.isArray(stats.by_year) ? stats.by_year : [];
    const categories = Array.isArray(stats.by_category) ? stats.by_category : [];
    const yearLabels = years.map((row) => String(row.label || ""));
    const conferenceHeaders = [
      { label: "\u4f1a\u573a" },
      { label: "\u7bc7\u6570", num: true },
      { label: "\u5360\u6bd4", num: true },
    ].concat(yearLabels.map((label) => ({ label, num: true })));
    const conferenceRows = conferences.map((row) => {
      const yearCells = yearLabels.map((label) => String((row.years && row.years[label]) || 0));
      return [row.label || "", String(row.count || 0), formatPct(row.pct) + "%"].concat(yearCells);
    });
    const categoryHeaders = [
      { label: "\u7c7b\u522b" },
      { label: "\u7bc7\u6570", num: true },
      { label: "\u5360\u6bd4", num: true },
    ];
    const categoryRows = categories.slice(0, 12).map((row) => [row.label || "", String(row.count || 0), formatPct(row.pct) + "%"]);
    return [
      renderBars("\u7c7b\u522b\u5206\u5e03", categories),
      renderBars("\u4f1a\u573a\u5bf9\u7167", conferences),
      renderBars("\u5e74\u4efd\u8986\u76d6", years),
      conferenceRows.length ? renderTable(conferenceHeaders, conferenceRows) : "",
      categoryRows.length ? renderTable(categoryHeaders, categoryRows) : "",
      `<p class="brief-note">${escapeHtml("\u6570\u5b57\u53ea\u6765\u81ea\u672c\u671f STATS\uff0c\u4e0d\u542b\u5f15\u7528\u6b21\u6570\u6216\u6770\u51fa\u8bba\u6587\u6807\u7b7e\u3002")}</p>`,
    ].join("");
  }
  function renderQuestions(items) {
    if (!items || !items.length) return "";
    return items.map((item) => `<article class="brief-q"><h3><span class="brief-qid">${escapeHtml(item.qid || "Q")}</span>${escapeHtml(item.question || "")}</h3><p>${escapeHtml(item.answer || "")}</p></article>`).join("");
  }
  function renderBrief(payload) {
    const brief = payload.brief || {};
    const stats = payload.stats || {};
    const sample = Number(stats.sample_size) || 0;
    const findings = Array.isArray(brief.findings) ? brief.findings : [];
    const questions = Array.isArray(brief.questions) ? brief.questions : [];
    const discussion = Array.isArray(brief.discussion) ? brief.discussion : [];
    const pills = [];
    if (stats.year_span) pills.push(stats.year_span);
    pills.push(sample + " \u7bc7\u6709\u6548\u6837\u672c");
    (stats.by_conference || []).slice(0, 4).forEach((row) => {
      if (row && row.label) pills.push(row.label);
    });
    const pillHtml = pills.length
      ? `<div class="brief-pills">${pills.map((item) => `<span class="brief-pill">${escapeHtml(item)}</span>`).join("")}</div>`
      : "";
    const findingHtml = findings.map((item, index) => `<article class="brief-finding"><h3>(${index + 1}) ${escapeHtml(item.title || "")}</h3><p>${escapeHtml(item.body || "")}</p></article>`).join("");
    const discussHtml = discussion.map((item) => `<article><h3>${escapeHtml(item.title || "")}</h3><p>${escapeHtml(item.body || "")}</p></article>`).join("");
    const cover = `<section class="brief-cover">
      <p class="brief-kicker">${escapeHtml(brief.kicker || "FastNews \xb7 \u9876\u4f1a\u5b9e\u8bc1\u7b80\u62a5")}</p>
      <h2 class="brief-title">${escapeHtml(brief.title || payload.query || UI.landscape)}</h2>
      ${brief.hook ? `<p class="brief-hook">${escapeHtml(brief.hook)}</p>` : ""}
      ${brief.subtitle ? `<p class="brief-subtitle">${escapeHtml(brief.subtitle)}</p>` : ""}
      ${brief.lead ? `<p class="brief-lead">${escapeHtml(brief.lead)}</p>` : ""}
      ${pillHtml}
    </section>`;
    const overview = `<section class="brief-section">
      <div class="brief-section-head"><span class="brief-section-num">01</span><h2>Overview</h2><p>${escapeHtml(String(sample))} \u7bc7\u6837\u672c</p></div>
      <div class="brief-findings">${findingHtml}</div>
    </section>`;
    const method = `<section class="brief-section">
      <div class="brief-section-head"><span class="brief-section-num">02</span><h2>\u6570\u636e\u53e3\u5f84</h2></div>
      <p class="brief-method">${escapeHtml(brief.method || payload.coverage || "")}</p>
    </section>`;
    const tables = `<section class="brief-section">
      <div class="brief-section-head"><span class="brief-section-num">03</span><h2>\u4f1a\u573a\u3001\u5e74\u4efd\u4e0e\u7c7b\u522b</h2></div>
      ${renderStats(stats)}
      ${renderQuestions(questions)}
    </section>`;
    const limits = brief.limitations
      ? `<section class="brief-section"><div class="brief-section-head"><span class="brief-section-num">04</span><h2>\u5c40\u9650</h2></div><p class="brief-method">${escapeHtml(brief.limitations)}</p></section>`
      : "";
    const discuss = discussHtml
      ? `<section class="brief-section"><div class="brief-section-head"><span class="brief-section-num">05</span><h2>\u8ba8\u8bba</h2></div><div class="brief-discuss">${discussHtml}</div></section>`
      : "";
    resultNode.innerHTML = `<article class="brief-doc">${cover}${overview}${method}${tables}</article>`
      + renderPapers(UI.papersTitle, payload.papers || [], UI.papersEmpty)
      + `<article class="brief-doc">${limits}${discuss}</article>`;
    resultNode.hidden = false;
  }
  async function runBrief(event) {
    event.preventDefault();
    let query = queryInput.value.trim();
    if (!query && impressionText) {
      query = impressionText.trim().split(/\n/)[0].trim().slice(0, 120);
    }
    submitButton.disabled = true;
    setStatus(impressionText ? UI.pendingImpression : UI.pending, "pending");
    try {
      const response = await fetch("/api/summary-brief", {
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
      if (!response.ok) throw new Error(payload.error || ("summary-brief http " + response.status));
      const sample = payload.stats && Number(payload.stats.sample_size) || 0;
      if (!sample && !payload.brief) {
        resultNode.hidden = true;
        resultNode.innerHTML = "";
        setStatus(UI.emptySample, "error");
        return;
      }
      renderBrief(payload);
      const shown = payload.query || query || UI.landscape;
      if (payload.source === "llm") {
        setStatus(UI.okPrefix + shown + UI.okSuffix + sample + UI.okTail, "ok");
      } else {
        setStatus(UI.fallback, "fallback");
      }
    } catch (_error) {
      resultNode.hidden = true;
      resultNode.innerHTML = "";
      setStatus(UI.error, "error");
    } finally {
      submitButton.disabled = false;
    }
  }
  function applyImpression(text) {
    impressionText = String(text || "").trim();
    if (!queryInput.value.trim() && impressionText) {
      const line = impressionText.split(/\n/)[0].trim().slice(0, 80);
      if (line) queryInput.placeholder = "\u5df2\u7ed3\u5408\u7814\u7a76\u5370\u8c61\uff0c\u4e5f\u53ef\u518d\u8f93\u5165\u66f4\u5177\u4f53\u7684\u65b9\u5411\uff0c\u4f8b\u5982 " + line;
    }
  }
  document.addEventListener("fastnews-profile", (event) => {
    applyImpression(event.detail && event.detail.impression && event.detail.impression.text);
  });
  applyImpression(window.FASTNEWS_IMPRESSION);
  renderExamples();
  form.addEventListener("submit", runBrief);
})();
