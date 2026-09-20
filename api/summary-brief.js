function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

const path = require("path");
const {
  CATEGORIES,
  CONFERENCE_LABELS,
  clip,
  searchPapers,
  getCorpus,
  publicItem,
} = require("./_lib/field-search");

const ROOT = path.join(__dirname, "..");
const TOPIC_STAT_LIMIT = 120;
const EVIDENCE_LIMIT = 16;
const DEFAULT_PAPER_REASON = "\u4e0e\u5f53\u524d\u7814\u7a76\u65b9\u5411\u91cd\u53e0\uff0c\u9002\u5408\u4f5c\u4e3a\u5ef6\u4f38\u9605\u8bfb\u3002";
const LANDSCAPE_TRIGGERS = [
  "\u56db\u5927\u9876\u4f1a",
  "\u9876\u4f1a\u5168\u666f",
  "\u5168\u666f",
  "\u603b\u89c8",
  "landscape",
  "overview",
  "\u5168\u90e8\u8bba\u6587",
];
const SYSTEM_PROMPT = [
  "\u4f60\u73b0\u5728\u662f FastNews \u7684\u5b9e\u8bc1\u7b80\u62a5\u7f16\u8f91\uff0c\u6587\u98ce\u63a5\u8fd1\u6570\u636e\u65b0\u95fb\u957f\u56fe\uff1a\u5148\u7ed9\u53cd\u5e38\u8bc6\u6216\u9192\u76ee\u7ed3\u8bba\uff0c\u518d\u7528\u8868\u683c\u6570\u5b57\u652f\u6491\uff0c\u6700\u540e\u8ba8\u8bba\u5c40\u9650\u4e0e\u542f\u793a\u3002",
  "\u53ea\u4f7f\u7528\u63d0\u4f9b\u7684 STATS \u4e0e\u5019\u9009\u8bba\u6587\uff0c\u4e0d\u5f97\u7f16\u9020\u8bba\u6587\u3001\u4f1a\u8bae\u3001\u5e74\u4efd\u3001\u94fe\u63a5\u6216\u4efb\u4f55\u7edf\u8ba1\u6570\u5b57\u3002",
  "Return ONLY a JSON object, no markdown.",
  "Schema:",
  '{"kicker":"FastNews \xb7 \u9876\u4f1a\u5b9e\u8bc1\u7b80\u62a5","title":"","hook":"","subtitle":"","lead":"","findings":[{"title":"","body":""}],"method":"","questions":[{"qid":"Q1","question":"","answer":""}],"highlights":[{"id":"<candidate id>","blurb":""}],"limitations":"","discussion":[{"title":"","body":""}]}',
  "Rules:",
  "- All prose must be Chinese",
  "- title: 18 \u5230 36 \u5b57\uff0c\u50cf\u5c01\u9762\u6807\u9898\uff0c\u70b9\u51fa\u6700\u503c\u5f97\u6ce8\u610f\u7684\u6570\u636e\u4e8b\u5b9e\uff0c\u4e0d\u8981\u7a7a\u6cdb\u53e3\u53f7",
  "- hook: 8 \u5230 18 \u5b57\uff0c\u70b9\u51fa\u53cd\u5dee\u6216\u4e3b\u7ed3\u8bba\uff0c\u53ef\u7565\u950b\u5229",
  "- subtitle: \u82f1\u6587\u6216\u6570\u636e\u526f\u6807\u9898\uff0c\u70b9\u660e\u4f1a\u8bae/\u5e74\u4efd/\u6837\u672c\u91cf",
  "- lead: 2 \u5230 4 \u53e5\u3002\u53ef\u7528\u201c\u672c\u671f\u7b80\u62a5/\u6837\u672c\u6e05\u6d17\u540e\u201d\u5f00\u573a\uff0c\u8bf4\u660e\u4e3a\u4ec0\u4e48\u8981\u770b\u8fd9\u7ec4\u6570\u5b57",
  "- findings: \u6070\u597d 3 \u6761\u3002title \u77ed\uff1bbody \u5fc5\u987b\u5f15\u7528 STATS \u91cc\u5df2\u6709\u7684\u6570\u5b57\uff08\u7bc7\u6570\u6216\u767e\u5206\u6bd4\uff09\uff0c\u7981\u6b62\u56db\u820d\u4e94\u5165\u6539\u5199\u5230\u5bf9\u4e0d\u4e0a",
  "- method: 2 \u5230 4 \u53e5\u8bf4\u660e\u6570\u636e\u53e3\u5f84\u3001\u5e74\u4efd\u8303\u56f4\u3001\u5206\u7c7b\u6765\u6e90\u548c\u672a\u8986\u76d6\u7684\u5185\u5bb9\uff08\u65e0\u5f15\u6587\u3001\u65e0\u6770\u51fa\u8bba\u6587\u6807\u7b7e\u3001\u4e0d\u662f\u5386\u53f2\u5168\u96c6\uff09",
  "- questions: 2 \u5230 3 \u4e2a\u3002qid \u7528 Q1/Q2/Q3\u3002question \u662f\u8bfb\u8005\u4f1a\u95ee\u7684\u5bf9\u7167\u95ee\u9898\uff1banswer \u89e3\u8bfb STATS \u8868\u683c\uff0c3 \u5230 5 \u53e5\uff0c\u70b9\u51fa\u4f1a\u573a/\u5e74\u4efd/\u7c7b\u522b\u7684\u5f02\u540c",
  "- highlights: 4 \u5230 8 \u7bc7\uff0c\u53ea\u80fd\u7528\u5019\u9009 id\uff0cblurb \u4e00\u53e5\u8bdd\u8bf4\u5b83\u4e3a\u4ec0\u4e48\u80fd\u652f\u6491\u672c\u671f\u53d1\u73b0",
  "- limitations: 3 \u5230 5 \u53e5\uff0c\u5177\u4f53\uff0c\u7981\u6b62\u7a7a\u6cdb\u5957\u8bdd",
  "- discussion: 2 \u6bb5\u3002\u7b2c\u4e00\u6bb5\u8c08\u5982\u4f55\u8bfb\u8fd9\u7ec4\u5206\u5e03/\u8bc4\u5ba1\u4e0e\u6295\u7a3f\u7ed3\u6784\uff1b\u7b2c\u4e8c\u6bb5\u7ed9\u7814\u7a76\u8005\u7684\u542f\u793a\uff08\u505a\u771f\u95ee\u9898\u3001\u522b\u88ab\u5355\u6b21\u5f55\u7528\u6216\u70ed\u70b9\u5360\u6bd4\u7ed1\u4f4f\uff09",
  "- Length: title<=40, hook<=24, lead<=420, finding.body<=220, method<=420, question.answer<=420, limitations<=500, discussion.body<=360",
].join("\n");

function isLandscapeQuery(query) {
  const text = String(query || "").trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  return LANDSCAPE_TRIGGERS.some((item) => lower.indexOf(String(item).toLowerCase()) >= 0);
}

function pct(count, total) {
  if (total <= 0) return 0;
  return Math.round((count * 10000) / total) / 100;
}

function bucket(counter, total, order) {
  const pairs = [];
  const used = new Set();
  if (order && order.length) {
    for (const label of order) {
      const count = counter.get(label) || 0;
      if (!count) continue;
      pairs.push([label, count]);
      used.add(label);
    }
  }
  const leftover = Array.from(counter.entries()).filter((row) => !used.has(row[0]));
  leftover.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  leftover.forEach((row) => pairs.push(row));
  return pairs.filter((row) => row[1]).map((row) => ({
    label: String(row[0]),
    count: Number(row[1]),
    pct: pct(Number(row[1]), total),
  }));
}

function yearSpanPart(start, end) {
  if (start === end) return String(start);
  if (end === start + 1) return start + "/" + end;
  return start + "\u2013" + end;
}

function formatYearSpan(years) {
  const uniq = Array.from(new Set((years || []).map(Number).filter(Number.isInteger))).sort((a, b) => a - b);
  if (!uniq.length) return "";
  const parts = [];
  let start = uniq[0];
  let prev = uniq[0];
  for (let i = 1; i < uniq.length; i += 1) {
    const year = uniq[i];
    if (year === prev + 1) {
      prev = year;
      continue;
    }
    parts.push(yearSpanPart(start, prev));
    start = prev = year;
  }
  parts.push(yearSpanPart(start, prev));
  return parts.join("\u3001");
}

function computeStats(items) {
  const total = (items || []).length;
  const confCounts = new Map();
  const yearCounts = new Map();
  const catCounts = new Map();
  const sourceCounts = new Map();
  const confYears = new Map();
  function bump(map, key, n) {
    map.set(key, (map.get(key) || 0) + n);
  }
  for (const paper of items || []) {
    const venue = String(paper.venue || paper.conference || "\u672a\u77e5");
    const category = String(paper.category || "Uncategorized");
    const source = String(paper.source || "unknown");
    const year = paper.year;
    bump(confCounts, venue, 1);
    bump(catCounts, category, 1);
    bump(sourceCounts, source, 1);
    if (Number.isInteger(year)) {
      bump(yearCounts, year, 1);
      if (!confYears.has(venue)) confYears.set(venue, new Map());
      bump(confYears.get(venue), year, 1);
    }
  }
  const yearsSorted = Array.from(yearCounts.keys()).sort((a, b) => a - b);
  const conferenceOrder = Object.keys(CONFERENCE_LABELS).map((key) => CONFERENCE_LABELS[key]);
  const byConference = bucket(confCounts, total, conferenceOrder).map((row) => {
    const years = {};
    const counter = confYears.get(row.label) || new Map();
    yearsSorted.forEach((year) => {
      years[String(year)] = Number(counter.get(year) || 0);
    });
    return Object.assign({}, row, { years: years });
  });
  return {
    sample_size: total,
    year_span: yearsSorted.length ? formatYearSpan(yearsSorted) : "",
    by_conference: byConference,
    by_year: yearsSorted.map((year) => ({
      label: String(year),
      count: Number(yearCounts.get(year) || 0),
      pct: pct(Number(yearCounts.get(year) || 0), total),
    })),
    by_category: bucket(catCounts, total, CATEGORIES),
    by_source: bucket(sourceCounts, total, ["top-conf", "arxiv"]),
  };
}

function pickEvidence(items, mode) {
  if (mode !== "landscape") return (items || []).slice(0, EVIDENCE_LIMIT);
  const buckets = {};
  for (const paper of items || []) {
    const key = String(paper.category || "Miscellaneous");
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(paper);
  }
  Object.keys(buckets).forEach((name) => {
    buckets[name].sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.title || "").localeCompare(String(b.title || "")));
  });
  const categories = CATEGORIES.filter((name) => buckets[name]);
  Object.keys(buckets).forEach((name) => {
    if (categories.indexOf(name) < 0) categories.push(name);
  });
  const out = [];
  const used = new Set();
  let index = 0;
  while (out.length < EVIDENCE_LIMIT) {
    let progressed = false;
    for (const name of categories) {
      const bucketItems = buckets[name] || [];
      if (index >= bucketItems.length) continue;
      const paper = bucketItems[index];
      const paperId = String(paper.id || "");
      if (paperId && !used.has(paperId)) {
        used.add(paperId);
        out.push(paper);
        progressed = true;
        if (out.length >= EVIDENCE_LIMIT) break;
      }
    }
    if (!progressed) break;
    index += 1;
  }
  return out;
}

function collectItems(query, options) {
  const mode = options.mode;
  const extraCategories = options.extraCategories || [];
  const conferences = options.conferences || [];
  let source = options.source || "all";
  const arxivDays = options.arxivDays;
  if (mode === "landscape") {
    const landscapeSource = source === "top-conf" || source === "arxiv" ? source : "top-conf";
    const corpus = getCorpus(ROOT, landscapeSource, landscapeSource === "arxiv" ? arxivDays : 0);
    const conferenceSet = new Set(conferences.map((item) => String(item).toLowerCase()).filter(Boolean));
    const items = [];
    for (const paper of corpus) {
      if (extraCategories.length && paper.source === "top-conf" && extraCategories.indexOf(paper.category) < 0) continue;
      if (conferenceSet.size && !conferenceSet.has(paper.conference)) continue;
      items.push(publicItem(paper, 1.0, []));
    }
    return {
      items: items,
      meta: {
        query: query,
        terms: [],
        categories: extraCategories,
        corpus_size: corpus.length,
        hit_count: items.length,
        arxiv_days: arxivDays,
        source_filter: landscapeSource,
      },
    };
  }
  const result = searchPapers(ROOT, query, {
    categories: extraCategories,
    conferences: conferences,
    source: source,
    arxivDays: arxivDays,
    limit: TOPIC_STAT_LIMIT,
  });
  return {
    items: result.items || [],
    meta: {
      query: query,
      terms: result.terms || [],
      categories: result.categories || extraCategories,
      corpus_size: result.corpus_size || 0,
      hit_count: result.hit_count || 0,
      arxiv_days: result.arxiv_days || arxivDays,
      source_filter: result.source_filter || source,
    },
  };
}

function coverageNote(result) {
  const days = result.arxiv_days || 90;
  const arxivPart = days === 0 ? "\u5168\u90e8\u5df2\u6293\u53d6 arXiv" : "\u8fd1 " + days + " \u5929 arXiv cs.CR / cs.AI+cs.CL";
  return "\u8bed\u6599\u8986\u76d6 USENIX Security 2025/2026\u3001IEEE S&P 2026\u3001NDSS 2026 \u7684\u4e2d\u6587\u6458\u8981\uff0c\u4ee5\u53ca" + arxivPart + "\u3002CCS \u4e0e\u66f4\u65e9\u9876\u4f1a\u53ef\u80fd\u7f3a\u5931\uff0c\u8fd9\u4e0d\u662f\u5386\u53f2\u5168\u96c6\u3002";
}

function lexicalReason(item) {
  const terms = (item.matched_terms || []).map((term) => String(term)).filter(Boolean);
  if (terms.length) return "\u547d\u4e2d " + terms.slice(0, 4).join("\u3001") + "\uff0c\u4e0e\u67e5\u8be2\u65b9\u5411\u91cd\u53e0\u3002";
  return DEFAULT_PAPER_REASON;
}

function attachReason(item, reason) {
  return Object.assign({}, item, { reason: clip(reason, 180) || DEFAULT_PAPER_REASON });
}

function lexicalBrief(query, stats, mode, coverage) {
  const sample = Number(stats.sample_size || 0);
  const cats = stats.by_category || [];
  const years = stats.by_year || [];
  const confs = stats.by_conference || [];
  const span = stats.year_span || "";
  const title = mode === "landscape"
    ? "\u56db\u5927\u9876\u4f1a\u8fd1\u5e74\u7814\u7a76\u683c\u5c40\uff1a\u7c7b\u522b\u5206\u5e03\u5e76\u4e0d\u5747\u5300"
    : clip(query, 18) + "\uff1a\u8fd1\u5e74\u6837\u672c\u7684\u4f1a\u573a\u4e0e\u7c7b\u522b\u5bf9\u7167";
  const hook = mode === "landscape" ? "\u5148\u770b\u7ed3\u6784\uff0c\u518d\u8c08\u70ed\u70b9" : "\u6570\u5b57\u5148\u4e8e\u5370\u8c61";
  const findings = [];
  if (cats.length) {
    const top = cats[0];
    const extra = cats.length > 1
      ? "\uff0c\u7b2c\u4e8c\u662f " + cats[1].label + " " + cats[1].count + " \u7bc7\uff08" + cats[1].pct + "%\uff09"
      : "";
    findings.push({
      title: top.label + " \u5360\u6bd4\u6700\u9ad8",
      body: "\u6e05\u6d17\u540e " + sample + " \u7bc7\u6837\u672c\u91cc\uff0c" + top.label + " \u6709 " + top.count + " \u7bc7\uff08" + top.pct + "%\uff09" + extra + "\u3002",
    });
  }
  if (years.length >= 2) {
    const first = years[0];
    const last = years[years.length - 1];
    const direction = last.count >= first.count ? "\u589e\u52a0" : "\u51cf\u5c11";
    findings.push({
      title: first.label + " \u5230 " + last.label + " \u6837\u672c\u91cf" + direction,
      body: first.label + " \u5e74 " + first.count + " \u7bc7\uff0c" + last.label + " \u5e74 " + last.count + " \u7bc7\uff1b\u8fd9\u662f\u8bed\u6599\u8986\u76d6\uff0c\u4e0d\u662f\u8be5\u65b9\u5411\u7684\u771f\u5b9e\u4ea7\u91cf\u3002",
    });
  } else if (years.length) {
    findings.push({
      title: "\u6837\u672c\u96c6\u4e2d\u5728 " + years[0].label + " \u5e74",
      body: years[0].label + " \u5e74\u6709 " + years[0].count + " \u7bc7\uff08" + years[0].pct + "%\uff09\uff0c\u5e74\u4efd\u8de8\u5ea6\u6709\u9650\uff0c\u4e0d\u5b9c\u5916\u63a8\u957f\u671f\u8d8b\u52bf\u3002",
    });
  }
  if (confs.length) {
    const top = confs[0];
    findings.push({
      title: top.label + " \u6837\u672c\u6700\u591a",
      body: top.label + " \u8d21\u732e " + top.count + " \u7bc7\uff08" + top.pct + "%\uff09\u3002\u4f1a\u573a\u5f55\u7528\u89c4\u6a21\u4e0d\u540c\uff0c\u4e0d\u80fd\u76f4\u63a5\u8bfb\u6210\u8be5\u65b9\u5411\u53ea\u9752\u7750\u67d0\u4e00\u4f1a\u8bae\u3002",
    });
  }
  const questions = [];
  if (cats.length) {
    questions.push({
      qid: "Q1",
      question: "\u5404\u7c7b\u522b\u5360\u6bd4\u5982\u4f55\uff0c\u6709\u6ca1\u6709\u4e00\u5bb6\u72ec\u5927\uff1f",
      answer: "\u89c1\u4e0b\u65b9\u7c7b\u522b\u5bf9\u7167\u3002\u5206\u7c7b\u6765\u81ea FastNews \u5bf9\u9876\u4f1a\u6458\u8981\u7684\u81ea\u52a8\u6807\u6ce8\uff0c\u4e0d\u662f\u4f1a\u8bae\u5b98\u65b9 session\u3002",
    });
  }
  if (confs.length) {
    questions.push({
      qid: "Q2",
      question: "\u56db\u5927\u4f1a\u8bae\u7684\u6837\u672c\u662f\u5426\u5747\u8861\uff1f",
      answer: "\u89c1\u4f1a\u573a\u5bf9\u7167\u8868\u3002\u5f55\u7528\u603b\u6570\u672c\u8eab\u4e0d\u540c\uff0c\u767e\u5206\u6bd4\u53ea\u80fd\u8bf4\u660e\u5f53\u524d\u8bed\u6599\u7ed3\u6784\uff0c\u4e0d\u80fd\u5355\u72ec\u8bc1\u660e\u4f1a\u8bae\u504f\u597d\u3002",
    });
  }
  return {
    kicker: "FastNews \xb7 \u9876\u4f1a\u5b9e\u8bc1\u7b80\u62a5",
    title: title,
    hook: hook,
    subtitle: [span, sample + " \u7bc7\u6709\u6548\u6837\u672c"].filter(Boolean).join(" \xb7 "),
    lead: "\u672c\u671f\u7b80\u62a5\u628a FastNews \u5df2\u603b\u7ed3\u7684\u9876\u4f1a\u4e2d\u6587\u6458\u8981\u644a\u5f00\uff0c\u5148\u6838\u5bf9\u6837\u672c\u91cf\u3001\u4f1a\u573a\u548c\u7c7b\u522b\uff0c\u518d\u8ba8\u8bba\u8fd9\u610f\u5473\u7740\u4ec0\u4e48\u3002\u6ca1\u6709\u5f15\u6587\u7a97\u53e3\uff0c\u4e5f\u6ca1\u6709\u6770\u51fa\u8bba\u6587\u6807\u7b7e\u3002",
    findings: findings.slice(0, 3),
    method: coverage,
    questions: questions,
    limitations: "\u8bed\u6599\u4ee5 2023\u20132026 \u5b89\u5168\u56db\u5927\u9876\u4f1a\u4e2d\u6587\u6458\u8981\u4e3a\u4e3b\uff0c\u4e0d\u662f\u8fd1\u4e94\u5e74\u5168\u96c6\uff1b\u5206\u7c7b\u7531 FastNews \u81ea\u52a8\u5b8c\u6210\uff0c\u672a\u505a\u4eba\u5de5\u9010\u7bc7\u590d\u6838\uff0c\u4e5f\u6ca1\u6709\u5f15\u7528\u6b21\u6570\u6216\u83b7\u5956\u4fe1\u606f\u3002",
    discussion: [
      {
        title: "\u8bfb\u5206\u5e03\uff0c\u4e0d\u8981\u53ea\u8bfb\u5355\u7bc7\u70ed\u70b9",
        body: "\u4f1a\u573a\u89c4\u6a21\u3001\u5e74\u4efd\u8986\u76d6\u548c\u5206\u7c7b\u53e3\u5f84\u90fd\u4f1a\u6539\u53d8\u89c2\u611f\u3002\u628a\u5355\u7bc7\u5de5\u4f5c\u653e\u56de\u8fd9\u5f20\u8868\u91cc\uff0c\u66f4\u4e0d\u5bb9\u6613\u88ab\u77ed\u671f\u70ed\u70b9\u53d9\u4e8b\u5e26\u8d70\u3002",
      },
      {
        title: "\u65f6\u95f4\u4ecd\u662f\u66f4\u597d\u7684\u88c1\u5224",
        body: "\u9ad8\u9891\u7c7b\u522b\u53ea\u8bf4\u660e\u8fd1\u5e74\u6295\u7a3f\u4e0e\u5f55\u7528\u7ed3\u6784\uff0c\u4e0d\u81ea\u52a8\u7b49\u4e8e\u957f\u671f\u5b66\u672f\u4ef7\u503c\u3002\u628a\u95ee\u9898\u505a\u624e\u5b9e\uff0c\u6bd4\u8fce\u5408\u5f53\u4e0b\u5360\u6bd4\u66f4\u6709\u751f\u547d\u529b\u3002",
      },
    ],
  };
}

function evidenceLines(papers) {
  return (papers || []).map((paper, index) => {
    return [
      (index + 1) + ". id=" + paper.id,
      "   title=" + paper.title,
      "   year=" + paper.year + " venue=" + paper.venue + " category=" + paper.category + " source=" + paper.source,
      "   summary=" + clip(paper.summary, 220),
    ].join("\n");
  }).join("\n");
}

function buildPrompts(query, stats, evidence, impression, coverage, mode) {
  const userLines = [
    "\u7b80\u62a5\u4e3b\u9898: " + query,
    "\u6a21\u5f0f: " + (mode === "landscape" ? "\u56db\u5927\u9876\u4f1a\u5168\u666f" : "\u65b9\u5411\u5b9e\u8bc1"),
    "\u8bf7\u6839\u636e STATS \u5199\u4e00\u671f\u6570\u636e\u65b0\u95fb\u5f0f\u603b\u7ed3\u6c47\u62a5\uff1a\u5c01\u9762\u7ed3\u8bba\u3001\u4e09\u6761\u53d1\u73b0\u3001\u6570\u636e\u53e3\u5f84\u3001\u4e24\u4e2a\u5bf9\u7167\u95ee\u9898\u3001\u5c40\u9650\u4e0e\u8ba8\u8bba\u3002",
    "\u6240\u6709\u6570\u5b57\u5fc5\u987b\u4e0e STATS \u4e00\u81f4\u3002",
    "\u8bed\u6599\u8bf4\u660e: " + coverage,
    "",
    "STATS:",
    JSON.stringify(stats),
    "",
    "\u5019\u9009\u8bba\u6587:",
    evidenceLines(evidence) || "(none)",
  ];
  impression = clip(impression, 800);
  if (impression) userLines.push("", "\u7814\u7a76\u8005\u5370\u8c61 / \u4e2a\u4eba\u7814\u7a76\u65b9\u5411:", impression);
  return { systemPrompt: SYSTEM_PROMPT, userPrompt: userLines.join("\n") };
}

function parseModelObject(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("model output is not an object");
  return data;
}

function normalizeFindings(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const title = clip(item.title, 40);
    const body = clip(item.body, 280);
    if (!title || !body) continue;
    out.push({ title: title, body: body });
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeQuestions(items) {
  const out = [];
  const list = Array.isArray(items) ? items : [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!item || typeof item !== "object") continue;
    const question = clip(item.question, 80);
    const answer = clip(item.answer, 500);
    if (!question || !answer) continue;
    out.push({ qid: clip(item.qid, 8) || ("Q" + (index + 1)), question: question, answer: answer });
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeDiscussion(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const title = clip(item.title, 40);
    const body = clip(item.body, 420);
    if (!title || !body) continue;
    out.push({ title: title, body: body });
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeHighlights(items, evidence) {
  const byId = new Map((evidence || []).map((paper) => [String(paper.id), paper]));
  const out = [];
  const used = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const paperId = String(item.id || "");
    const paper = byId.get(paperId);
    if (!paper || used.has(paperId)) continue;
    used.add(paperId);
    out.push(attachReason(paper, clip(item.blurb || item.reason, 180)));
    if (out.length >= 8) break;
  }
  if (out.length < 4) {
    for (const paper of evidence || []) {
      const paperId = String(paper.id || "");
      if (!paperId || used.has(paperId)) continue;
      out.push(attachReason(paper, lexicalReason(paper)));
      used.add(paperId);
      if (out.length >= 6) break;
    }
  }
  return out;
}

function parseBrief(content, query, stats, evidence, mode, coverage) {
  const data = parseModelObject(content);
  const fallback = lexicalBrief(query, stats, mode, coverage);
  return {
    brief: {
      kicker: clip(data.kicker, 40) || fallback.kicker,
      title: clip(data.title, 48) || fallback.title,
      hook: clip(data.hook, 32) || fallback.hook,
      subtitle: clip(data.subtitle, 80) || fallback.subtitle,
      lead: clip(data.lead, 500) || fallback.lead,
      findings: normalizeFindings(data.findings).length ? normalizeFindings(data.findings) : fallback.findings,
      method: clip(data.method, 500) || fallback.method,
      questions: normalizeQuestions(data.questions).length ? normalizeQuestions(data.questions) : fallback.questions,
      limitations: clip(data.limitations, 600) || fallback.limitations,
      discussion: normalizeDiscussion(data.discussion).length ? normalizeDiscussion(data.discussion) : fallback.discussion,
    },
    papers: normalizeHighlights(data.highlights || data.papers, evidence),
  };
}

function isDeepseek() {
  const blob = String(process.env.OPENAI_BASE_URL || "") + " " + String(process.env.LLM_MODEL || "");
  return blob.toLowerCase().indexOf("deepseek") >= 0;
}

function summaryBriefRequestPayload(systemPrompt, userPrompt) {
  const payload = {
    model: process.env.LLM_MODEL || "gemini-3-flash-preview",
    temperature: 0.3,
    max_tokens: 10000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (isDeepseek()) {
    payload.thinking = { type: "disabled" };
  } else {
    payload.response_format = { type: "json_object" };
  }
  return payload;
}

function messageText(message) {
  const body = message && typeof message === "object" ? message : {};
  let content = body.content;
  if (Array.isArray(content)) {
    content = content.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return String(item.text || item.content || "");
      return "";
    }).join("");
  }
  return String(content || body.reasoning_content || "").trim();
}

async function completeChat(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("missing api key");
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const payload = summaryBriefRequestPayload(systemPrompt, userPrompt);
  try {
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("upstream llm error");
    const choice = data && data.choices && data.choices[0] ? data.choices[0] : {};
    const message = choice.message || {};
    const content = messageText(message);
    if (!content) {
      console.error("summary-brief empty content keys=" + Object.keys(message).join(",") + " finish=" + String(choice.finish_reason || ""));
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = readBody(req);
  const impression = clip(body.impression, 4000);
  let query = clip(body.query || body.topic || body.q, 120);
  if (!query) query = clip(impression, 120);
  const mode = isLandscapeQuery(query) ? "landscape" : "topic";
  if (mode === "landscape" && !query) query = "\u56db\u5927\u9876\u4f1a\u5168\u666f";
  if (!query) {
    res.status(400).json({ error: "query required" });
    return;
  }
  const category = clip(body.category, 80);
  const extraCategories = CATEGORIES.indexOf(category) >= 0 ? [category] : [];
  let source = clip(body.source, 20) || "all";
  if (["all", "top-conf", "arxiv"].indexOf(source) < 0) source = "all";
  let arxivDays = Number(body.arxiv_days);
  if (!Number.isFinite(arxivDays)) arxivDays = 90;
  arxivDays = Math.max(0, Math.min(arxivDays, 3650));
  const conference = clip(body.conference, 20);
  let searchQuery = query;
  const extra = clip(impression, 200);
  if (mode === "topic" && extra && query.indexOf(extra) < 0) searchQuery = (query + " " + extra).trim();
  const collected = collectItems(mode === "topic" ? searchQuery : query, {
    mode: mode,
    extraCategories: extraCategories,
    conferences: conference ? [conference] : [],
    source: source,
    arxivDays: arxivDays,
  });
  const items = collected.items || [];
  const meta = collected.meta || {};
  const stats = computeStats(items);
  const evidence = pickEvidence(items, mode);
  const coverage = coverageNote({ arxiv_days: meta.arxiv_days || arxivDays });
  const payload = {
    query: query,
    mode: mode,
    terms: meta.terms || [],
    categories: meta.categories || extraCategories,
    corpus_size: meta.corpus_size || 0,
    hit_count: meta.hit_count || 0,
    stats: stats,
    brief: null,
    papers: [],
    source: "lexical",
    coverage: coverage,
  };
  if (!items.length) {
    res.status(200).json(payload);
    return;
  }
  const fallbackBrief = lexicalBrief(query, stats, mode, coverage);
  const fallbackPapers = evidence.map((paper) => attachReason(paper, lexicalReason(paper)));
  if (!process.env.OPENAI_API_KEY) {
    payload.brief = fallbackBrief;
    payload.papers = fallbackPapers;
    res.status(200).json(payload);
    return;
  }
  try {
    const prompts = buildPrompts(query, stats, evidence, impression, coverage, mode);
    const parsed = parseBrief(await completeChat(prompts.systemPrompt, prompts.userPrompt), query, stats, evidence, mode, coverage);
    Object.assign(payload, parsed, { source: "llm" });
    res.status(200).json(payload);
  } catch (error) {
    console.error("summary-brief fallback", error && error.message);
    payload.brief = fallbackBrief;
    payload.papers = fallbackPapers;
    res.status(200).json(payload);
  }
};
