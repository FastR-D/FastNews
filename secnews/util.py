import feedparser
from datetime import datetime, UTC

def fetch_rss(url):
    feed = feedparser.parse(url)
    fetched_at = datetime.now(UTC)
    res = []
    for entry in feed.entries:
        announce_type = entry.get('arxiv_announce_type')
        if announce_type and announce_type != 'new':
            continue
        res.append({
            'title': entry.get('title', ''),
            'link': entry.get('link', ''),
            'description': entry.get('summary', '') or entry.get('description', ''),
            'published': entry.get('published', '') or entry.get('updated', ''),
            'author': entry.get('author', ''),
            'categories': [tag.get('term', '') for tag in entry.get('tags', [])],
            '_id': url + '/' + (entry.get('id', '') or entry.get('guid', '')),
            'source': url,
            'fetched_at': fetched_at,
        })
    return res


SOURCES = {
    'bleepingcomputer': 'https://www.bleepingcomputer.com/feed/',
    'arxiv_cs_cr': 'https://rss.arxiv.org/atom/cs.cr',
    'arxiv_cs_ai': 'https://rss.arxiv.org/atom/cs.ai+cs.cl',
}
