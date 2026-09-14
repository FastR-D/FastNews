(() => {
  const config = window.FASTNEWS_SECNEWS || {};
  const newsDays = Array.isArray(config.newsDays) ? config.newsDays : [];
  const newsDayMap = new Map(newsDays.map((item) => [item.date, item]));
  const articleBase = config.articleBase || "data/articles/";
  const summaryBase = config.summaryBase || "data/daily_summaries/";
  const TOP_N = 10;
  const CHANNELS = [
    { key: "bleepingcomputer", label: "BleepingComputer" },
    { key: "arxiv", label: "arXiv" },
  ];

  const calendarMonth = document.getElementById("calendarMonth");
  const calendarGrid = document.getElementById("calendarGrid");
  const previousMonth = document.getElementById("previousMonth");
  const nextMonth = document.getElementById("nextMonth");
  const newsDateTitle = document.getElementById("newsDateTitle");
  const newsDateCount = document.getElementById("newsDateCount");
  const newsDateSub = document.getElementById("newsDateSub");
  const newsList = document.getElementById("newsList");
  const newsPagination = document.getElementById("newsPagination");
  const newsDetailToggle = document.getElementById("newsDetailToggle");
  const weekdays = ["\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d", "\u65e5"];
  let selectedDate = newsDays.length ? newsDays[newsDays.length - 1].date : "";
  let visibleMonth = selectedDate ? new Date(selectedDate + "T00:00:00") : new Date();
  let requestToken = 0;
  let currentArticles = [];
  let showAllNews = false;
  const channelOpen = { bleepingcomputer: true, arxiv: true, other: true };

  const HIGH_KEYWORDS = [
    "zero-day", "0-day", "rce", "remote code", "ransomware", "actively exploited",
    "critical", "supply chain", "backdoor", "nation-state", "apt ", "breach",
    "malware", "vulnerability", "exploit", "privacy",
  ];

  function pad(value) { return String(value).padStart(2, "0"); }
  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function formatPublishedDate(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(parsed).replaceAll("/", "-");
  }
  function formatDate(date) {
    const parts = date.split("-");
    return parts[0] + "\u5e74" + Number(parts[1]) + "\u6708" + Number(parts[2]) + "\u65e5";
  }
  function channelKey(source, channel) {
    if (channel === "bleepingcomputer" || channel === "arxiv" || channel === "other") return channel;
    const text = String(source || "").toLowerCase();
    if (text.includes("bleepingcomputer")) return "bleepingcomputer";
    if (text.includes("arxiv")) return "arxiv";
    return "other";
  }
  function sourceLabel(key, source) {
    if (key === "bleepingcomputer") return "BleepingComputer";
    if (key === "arxiv") return "arXiv";
    const text = String(source || "").toLowerCase();
    if (text.includes("bleepingcomputer")) return "BleepingComputer";
    if (text.includes("arxiv")) return "arXiv";
    return "\u5176\u4ed6\u6765\u6e90";
  }
  function heuristicScore(article) {
    const categories = Array.isArray(article.categories) ? article.categories : [];
    const blob = [article.title, article.title_zh, article.summary_zh, article.description, categories.join(" ")].join(" ").toLowerCase();
    let score = 4.2;
    if (channelKey(article.source, article.channel) === "bleepingcomputer") score += 0.4;
    for (const keyword of HIGH_KEYWORDS) {
      if (blob.includes(keyword)) score += (keyword === "zero-day" || keyword === "0-day" || keyword === "actively exploited") ? 2.0 : 0.7;
    }
    if (categories.some((item) => String(item).toLowerCase().includes("cs.cr"))) score += 0.6;
    return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
  }
  function articleScore(article) {
    const raw = Number(article.score);
    if (Number.isFinite(raw)) return Math.max(0, Math.min(10, raw));
    return heuristicScore(article);
  }
  function decorateArticles(articles) {
    return articles.map((article) => {
      const channel = channelKey(article.source, article.channel);
      return Object.assign({}, article, {
        _channel: channel,
        _score: articleScore(article),
      });
    }).sort((left, right) => {
      if (right._score !== left._score) return right._score - left._score;
      return String(right.published || "").localeCompare(String(left.published || ""));
    });
  }
  function monthKey(date) { return date.getFullYear() * 12 + date.getMonth(); }
  const availableMonths = newsDays.map((item) => monthKey(new Date(item.date + "T00:00:00")));
  const firstMonth = availableMonths.length ? Math.min(...availableMonths) : monthKey(new Date());
  const lastMonth = availableMonths.length ? Math.max(...availableMonths) : firstMonth;
  function updateMonthControls() {
    const current = monthKey(visibleMonth);
    previousMonth.disabled = current <= firstMonth;
    nextMonth.disabled = current >= lastMonth;
  }
  function renderCalendar() {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    calendarMonth.textContent = year + "\u5e74" + (month + 1) + "\u6708";
    updateMonthControls();
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const dayCount = new Date(year, month + 1, 0).getDate();
    const cells = weekdays.map((day) => '<span class="calendar-weekday">' + day + "</span>");
    for (let i = 0; i < firstDay; i += 1) cells.push('<span class="calendar-day"></span>');
    for (let day = 1; day <= dayCount; day += 1) {
      const key = year + "-" + pad(month + 1) + "-" + pad(day);
      const info = newsDayMap.get(key);
      const buttonClasses = [];
      if (info) buttonClasses.push("has-news");
      if (key === selectedDate) buttonClasses.push("selected");
      const label = info ? (key + "\uff0c" + info.count + " \u6761\u65b0\u95fb") : (key + "\uff0c\u65e0\u65b0\u95fb");
      cells.push('<span class="calendar-day"><button class="' + buttonClasses.join(" ") + '" type="button" data-news-date="' + key + '" aria-label="' + label + '" ' + (info ? "" : "disabled") + ">" + day + "</button></span>");
    }
    calendarGrid.innerHTML = cells.join("");
  }
  function renderArticle(article, rank) {
    const channel = article._channel;
    const categories = Array.isArray(article.categories) ? article.categories.slice(0, 2) : [];
    const tags = categories.map((category) => '<span class="news-tag">' + escapeHtml(category) + "</span>").join("");
    const published = formatPublishedDate(article.published);
    const meta = [sourceLabel(channel, article.source), article.author || "", published ? ("\u53d1\u5e03\u4e8e " + published) : ""].filter(Boolean).map(escapeHtml).join(" \u00b7 ");
    const title = article.title_zh || article.title || "\u65e0\u6807\u9898";
    const description = article.summary_zh || article.intro || article.description || "\u6682\u65e0\u6458\u8981";
    const score = Number(article._score).toFixed(1);
    const reason = article.score_reason ? (' title="' + escapeHtml(article.score_reason) + '"') : "";
    const rowClass = ["news-row", channel === "arxiv" ? "is-arxiv" : "", channel === "bleepingcomputer" ? "is-bc" : "", rank ? "is-pick" : ""].filter(Boolean).join(" ");
    const rankBadge = rank ? ('<span class="news-rank">' + rank + "</span>") : "";
    const scoreClass = article._score >= 8 ? "news-score is-high" : "news-score";
    return '<article class="' + rowClass + '"><div class="news-title-row">' + rankBadge + '<h4 class="news-title"><a href="' + escapeHtml(article.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(title) + '</a></h4><span class="' + scoreClass + '"' + reason + ">\u4ef7\u503c " + score + "</span></div><p class=\"news-description\">" + escapeHtml(description) + '</p><div class="news-meta"><span>' + meta + "</span>" + tags + "</div></article>";
  }
  function renderBoard(title, kicker, countLabel, articles, ranked, channel) {
    const rows = articles.length
      ? articles.map((article, index) => renderArticle(article, ranked ? index + 1 : 0)).join("")
      : '<div class="news-channel-empty">\u8be5\u6e20\u9053\u8fd9\u4e00\u5929\u6ca1\u6709\u6761\u76ee\u3002</div>';
    const head = '<div><span class="news-board-kicker">' + escapeHtml(kicker) + '</span><h4 class="news-board-title">' + escapeHtml(title) + '</h4></div><span class="news-board-meta"><span class="news-board-count">' + escapeHtml(countLabel) + "</span>" + (channel ? '<span class="news-board-chevron" aria-hidden="true"></span>' : "") + "</span>";
    if (!channel) {
      return '<section class="news-board"><div class="news-board-head">' + head + "</div>" + rows + "</section>";
    }
    const isOpen = channelOpen[channel] !== false;
    return '<details class="news-board is-collapsible"' + (isOpen ? " open" : "") + ' data-news-channel="' + escapeHtml(channel) + '"><summary class="news-board-head">' + head + '</summary><div class="news-board-body">' + rows + "</div></details>";
  }
  function updateDetailToggle(total) {
    if (!newsDetailToggle) return;
    newsDetailToggle.hidden = total === 0;
    newsDetailToggle.disabled = total === 0;
    newsDetailToggle.setAttribute("aria-pressed", showAllNews ? "true" : "false");
    newsDetailToggle.setAttribute("aria-expanded", showAllNews ? "true" : "false");
    newsDetailToggle.classList.remove("button-primary");
    newsDetailToggle.textContent = showAllNews ? "\u6536\u8d77\u8be6\u60c5" : "\u8be6\u7ec6\u8d44\u8baf";
  }
  function renderNewsView() {
    const articles = currentArticles;
    if (newsPagination) newsPagination.innerHTML = "";
    if (!articles.length) {
      newsList.innerHTML = '<div class="news-status">\u8fd9\u4e00\u5929\u6ca1\u6709\u53ef\u5c55\u793a\u7684\u65b0\u95fb\u3002</div>';
      if (newsDateSub) newsDateSub.textContent = "\u6682\u65e0\u53ef\u63a8\u8350\u7684\u8d44\u8baf";
      updateDetailToggle(0);
      return;
    }
    const topItems = articles.slice(0, Math.min(TOP_N, articles.length));
    const byChannel = {
      bleepingcomputer: articles.filter((item) => item._channel === "bleepingcomputer"),
      arxiv: articles.filter((item) => item._channel === "arxiv"),
      other: articles.filter((item) => item._channel === "other"),
    };
    if (newsDateSub) {
      newsDateSub.textContent = showAllNews
        ? ("BleepingComputer " + byChannel.bleepingcomputer.length + " \u6761 \u00b7 arXiv " + byChannel.arxiv.length + " \u6761")
        : ("\u4f18\u5148\u63a8\u8350 " + topItems.length + " \u6761\u9ad8\u4ef7\u503c\u8d44\u8baf");
    }
    updateDetailToggle(articles.length);
    if (!showAllNews) {
      newsList.innerHTML = renderBoard("\u4f18\u5148\u63a8\u8350", "TOP PICKS", "\u4eca\u65e5 " + topItems.length + " / " + articles.length, topItems, true);
      return;
    }
    const parts = CHANNELS.map((channel) => renderBoard(channel.label, "CHANNEL", byChannel[channel.key].length + " \u6761", byChannel[channel.key], false, channel.key));
    if (byChannel.other.length) {
      parts.push(renderBoard("\u5176\u4ed6\u6765\u6e90", "CHANNEL", byChannel.other.length + " \u6761", byChannel.other, false, "other"));
    }
    newsList.innerHTML = parts.join("");
  }
  function renderNews(articles) {
    currentArticles = decorateArticles(articles);
    renderNewsView();
  }
  async function selectDate(date) {
    const info = newsDayMap.get(date);
    if (!info) return;
    selectedDate = date;
    showAllNews = false;
    visibleMonth = new Date(date + "T00:00:00");
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") !== date) {
      url.searchParams.set("date", date);
      window.history.replaceState(null, "", url);
    }
    renderCalendar();
    newsDateTitle.textContent = formatDate(date);
    newsDateCount.textContent = info.count + " \u6761\u8d44\u8baf";
    if (newsDateSub) newsDateSub.textContent = "\u6b63\u5728\u7b5b\u9009\u4f18\u5148\u63a8\u8350\u2026";
    newsList.innerHTML = '<div class="news-status">\u6b63\u5728\u52a0\u8f7d\u65b0\u95fb\u2026</div>';
    updateDetailToggle(0);
    const token = ++requestToken;
    try {
      let articles;
      const summaryResponse = await fetch(summaryBase + date + ".json");
      if (summaryResponse.ok) {
        const summaryPayload = await summaryResponse.json();
        if (summaryPayload.complete && Array.isArray(summaryPayload.articles)) articles = summaryPayload.articles;
      }
      if (!articles) {
        const response = await fetch(articleBase + date + ".jsonl");
        if (!response.ok) throw new Error("request failed");
        articles = [];
        for (const line of (await response.text()).split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const article = JSON.parse(line);
            if (article && typeof article === "object") articles.push(article);
          } catch (error) {
            // Keep displaying valid entries when a JSONL line is malformed.
          }
        }
      }
      if (token === requestToken) renderNews(articles);
    } catch (error) {
      if (token === requestToken) newsList.innerHTML = '<div class="news-status">\u65b0\u95fb\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002</div>';
    }
  }
  calendarGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-news-date]");
    if (button) selectDate(button.dataset.newsDate);
  });
  previousMonth.addEventListener("click", () => {
    if (previousMonth.disabled) return;
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  nextMonth.addEventListener("click", () => {
    if (nextMonth.disabled) return;
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  newsList.addEventListener("toggle", (event) => {
    const board = event.target;
    if (!(board instanceof HTMLDetailsElement)) return;
    const key = board.getAttribute("data-news-channel");
    if (!key) return;
    channelOpen[key] = board.open;
  }, true);
  if (newsDetailToggle) {
    newsDetailToggle.addEventListener("click", () => {
      if (!currentArticles.length) return;
      showAllNews = !showAllNews;
      renderNewsView();
      newsList.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  window.addEventListener("popstate", () => {
    const date = new URL(window.location.href).searchParams.get("date");
    if (newsDayMap.has(date)) selectDate(date);
  });
  renderCalendar();
  const requestedDate = new URL(window.location.href).searchParams.get("date");
  if (newsDayMap.has(requestedDate)) selectedDate = requestedDate;
  if (selectedDate) selectDate(selectedDate);
  else {
    newsDateTitle.textContent = "\u6682\u65e0\u65b0\u95fb";
    newsDateCount.textContent = "0 \u6761\u65b0\u95fb";
    if (newsDateSub) newsDateSub.textContent = "";
    newsList.innerHTML = '<div class="news-status">\u8fd8\u6ca1\u6709\u6293\u53d6\u5230\u65b0\u95fb\u3002</div>';
    updateDetailToggle(0);
  }
})();
