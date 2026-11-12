export interface Paper {
  id: string
  source: string
  title: string
  title_zh?: string
  author?: string
  authors?: string
  year?: number | string
  venue?: string
  conference?: string
  category?: string
  link?: string
  url?: string
  summary?: string
  reason?: string
  award?: string
  cited_by?: number
  read?: boolean
  date?: string
  receivedAt?: string
  paperId?: string
}
export interface Author {
  id: string
  name: string
  homepage: string
  tags: string[]
  bio?: string
  research?: string
  fetchStatus?: string
  fetchSummary?: string
  lastFetchedAt?: string
  papers?: { url: string; title: string }[]
}
export interface Impression {
  text: string
  updatedAt: string
}
export interface Profile {
  role?: string
  userId: string
  person: string
  email: string
  source: string
  csrf: string
  authors: Author[]
  customTags: string[]
  impression: Impression
  inboxUnread: number
}
export interface Report {
  title: string
  kind: string
  html: string
  pdf?: string
  size: number
  updated: string
}
export interface Catalog {
  papers: number
  topPapers: number
  reports: Report[]
  dates: string[]
  categories: string[]
  years: number[]
  conferences: Record<string, string>
  publicReports: boolean
}
export interface NewsArticle {
  score_reason?: string
  _id: string
  title: string
  title_zh?: string
  description?: string
  summary_zh?: string
  source: string
  link: string
  author?: string
  published?: string
  channel?: string
  recommendation_score?: number
  importance?: number
  score?: number
}
export interface Count {
  label: string
  count: number
  pct: number
  years?: Record<string, number>
}
export interface Stats {
  sample_size: number
  year_span: string
  by_conference: Count[]
  by_year: Count[]
  by_category: Count[]
  citation_coverage: number
  citation_total: number
  distinguished_count: number
}
export interface Generation {
  warning?: string
  fallback?: boolean
  surveys?: Paper[]
  query: string
  coverage: string
  papers: Paper[]
  briefing?: {
    field_zh: string
    scope: string
    categories: {
      name: string
      consensus: string
      developments: string
      gaps: string
      paper_ids: string[]
    }[]
    gaps: string
    limitations: string
  }
  stats?: Stats
  brief?: {
    title: string
    kicker: string
    hook: string
    subtitle: string
    lead: string
    findings: { title: string; body: string }[]
    method: string
    questions: { qid: string; question: string; answer: string }[]
    limitations: string
    discussion: { title: string; body: string }[]
  }
  items?: { id: string; score: number; reason: string }[]
  candidates?: Paper[]
}
