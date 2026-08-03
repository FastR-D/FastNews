import json
import os
from datetime import datetime, UTC, timedelta
from pathlib import Path
from retry import retry

from openai import OpenAI
from jinja2 import Template
from dotenv import load_dotenv

from secnews.util import SOURCES

load_dotenv()

LLM_MODEL = os.getenv('LLM_MODEL')
ARTICLES_DIR = Path('secnews/data/articles')
NEWSPAPERS_DIR = Path('secnews/data/newspapers')


@retry(tries=3, delay=2, backoff=2)
def query_llm(prompt):
    client = OpenAI()

    completion = client.chat.completions.create(
        model=LLM_MODEL or "gemini-3-flash-preview",
        messages=[
            {"role": "system", "content": open('secnews/prompt/sys.j2', encoding='utf-8').read()},
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"},
    )

    print('usage: ', completion.usage)

    res = completion.choices[0].message.content
    print(res)
    return res


def _get_last_newspaper_time():
    """Get the generated_at time of the most recent newspaper."""
    if not NEWSPAPERS_DIR.exists():
        return datetime.now(UTC) - timedelta(days=2)

    files = sorted(NEWSPAPERS_DIR.glob('*.json'))
    if not files:
        return datetime.now(UTC) - timedelta(days=2)

    with open(files[-1], encoding='utf-8') as f:
        data = json.load(f)
    return datetime.fromisoformat(data['generated_at'])


def _load_articles_since(since: datetime):
    """Load all articles from JSONL files with fetched_at > since."""
    if not ARTICLES_DIR.exists():
        return []

    articles = []
    since_date = since.strftime('%Y-%m-%d')

    for filepath in sorted(ARTICLES_DIR.glob('*.jsonl')):
        # Skip files older than since date by filename
        if filepath.stem < since_date:
            continue
        with open(filepath, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                article = json.loads(line)
                fetched_at = datetime.fromisoformat(article['fetched_at'])
                if fetched_at > since:
                    articles.append(article)
    return articles


@retry(tries=3, delay=2, backoff=2)
def main():
    last_newspaper_time = _get_last_newspaper_time()
    print(f"{last_newspaper_time = }")

    all_articles = _load_articles_since(last_newspaper_time)
    print(f"Total articles since last newspaper: {len(all_articles)}")

    def get_articles(source):
        source_url = SOURCES[source]
        return [a for a in all_articles if a['source'] == source_url][:200]

    def enrich(id_intro, full):
        res = []
        for it in id_intro:
            _id, intro = it['_id'], it['intro']
            print(f"{_id = }, {intro = }")
            p = next(filter(lambda i: i['_id'] == _id, full))

            res.append({**p, "intro": intro})

            print(intro, p, '\n')
        return res

    def gen_arxiv(source):
        with open('secnews/prompt/arxiv.j2', encoding='utf-8') as f:
            arxiv_j2 = f.read()
            docs = get_articles(source)
            if not docs:
                return []
            print(docs)

            prompt = Template(arxiv_j2).render(articles=docs)
            return enrich(json.loads(query_llm(prompt)), docs)

    def gen_bleepingcomputer():
        with open('secnews/prompt/bleepingcomputer.j2', encoding='utf-8') as f:
            bleepingcomputer_j2 = f.read()
            docs = get_articles('bleepingcomputer')
            if not docs:
                return []
            print(docs)

            prompt = Template(bleepingcomputer_j2).render(articles=docs)
            return enrich(json.loads(query_llm(prompt)), docs)

    now = datetime.now(UTC)
    result = {
        'generated_at': now.isoformat(),
        'article_start_at': last_newspaper_time.isoformat(),
        'articles': {
            'bleepingcomputer': gen_bleepingcomputer(),
            'arxiv_cs_cr': gen_arxiv('arxiv_cs_cr'),
            'arxiv_cs_ai': gen_arxiv('arxiv_cs_ai')
        }
    }

    NEWSPAPERS_DIR.mkdir(parents=True, exist_ok=True)
    today = now.strftime('%Y-%m-%d')
    output_path = NEWSPAPERS_DIR / f'{today}.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Newspaper saved to {output_path}")


if __name__ == "__main__":
    main()
