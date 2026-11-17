import type { NewsArticle } from './types'

export function isArxiv(article: NewsArticle) {
  return article.source.toLowerCase().includes('arxiv')
}
