(function () {
  const LABEL = "跳转 FastRead";
  const PENDING = "正在跳转…";

  function clip(value, max) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function escapeAttr(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function paperFromElement(el) {
    const root = el.closest("[data-fastread-title]") || el;
    const dataset = root.dataset || {};
    return {
      title: clip(dataset.fastreadTitle, 300),
      authors: clip(dataset.fastreadAuthors, 400),
      abstract: clip(dataset.fastreadAbstract, 800),
      url: clip(dataset.fastreadUrl, 2048),
      venue: clip(dataset.fastreadVenue, 80),
      year: clip(dataset.fastreadYear, 8),
      id: clip(dataset.fastreadId, 180),
    };
  }

  window.fastNewsFastReadButton = function (paper) {
    const title = clip(paper && (paper.title || paper.title_zh), 300);
    if (!title) return "";
    const attrs = {
      "data-fastread": "",
      "data-fastread-title": title,
      "data-fastread-authors": clip(paper.authors || paper.author, 400),
      "data-fastread-abstract": clip(paper.abstract || paper.summary, 800),
      "data-fastread-url": clip(paper.url || paper.link, 2048),
      "data-fastread-venue": clip(paper.venue || paper.conference_label || paper.conference, 80),
      "data-fastread-year": clip(paper.year, 8),
      "data-fastread-id": clip(paper.id || paper.paperId, 180),
    };
    const encoded = Object.entries(attrs)
      .map(([key, value]) => (value === "" && key !== "data-fastread" ? "" : value === "" ? key : `${key}="${escapeAttr(value)}"`))
      .filter(Boolean)
      .join(" ");
    return `<button type="button" class="button button-secondary button-sm fastread-open" ${encoded}>${LABEL}</button>`;
  };

  async function openFastRead(paper, button) {
    if (!paper.title) return;
    const popup = window.open("", "fastread-handoff");
    const previous = button ? button.textContent : LABEL;
    if (button) {
      button.disabled = true;
      button.textContent = PENDING;
    }
    try {
      const response = await fetch("/api/fastread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paper),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.redirect) {
        throw new Error(payload.error || ("fastread http " + response.status));
      }
      if (popup && !popup.closed) popup.location.replace(payload.redirect);
      else window.location.assign(payload.redirect);
      if (button) button.textContent = LABEL;
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      if (button) {
        button.title = error.message || "跳转 FastRead 失败";
        button.textContent = "跳转失败";
      }
    } finally {
      if (button) {
        button.disabled = false;
        window.setTimeout(() => {
          if (button.textContent === PENDING || button.textContent === previous) {
            button.textContent = LABEL;
          }
        }, 1600);
      }
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-fastread]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const paper = paperFromElement(button);
    if (!paper.title) return;
    void openFastRead(paper, button);
  });
})();