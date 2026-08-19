import argparse
import json
import sys
from datetime import datetime, UTC
from pathlib import Path
from jinja2 import Environment, FileSystemLoader


def refresh_homepage():
    try:
        root_dir = Path(__file__).resolve().parent.parent
        if str(root_dir) not in sys.path:
            sys.path.insert(0, str(root_dir))
        from generate_homepage import render_homepage

        render_homepage(Path("index.html"))
    except Exception as e:
        print(f"Warning: failed to refresh homepage: {e}")


def conference_label(conference):
    return {
        "usenix": "USENIX Security",
        "ieee-sp": "IEEE S&P",
        "ndss": "NDSS",
        "ccs": "ACM CCS",
    }.get(conference, conference.upper())


def render_conf_report(conference, year):
    in_file = Path(f'top-conf/data/summary/{conference}_{year}_summary.jsonl')
    source_file = Path(f'top-conf/data/conferences/{conference}_{year}.jsonl')
    if not in_file.exists():
        print(f"Error: {in_file} does not exist. Run generate_conf_summary.py first.")
        sys.exit(1)
    if not source_file.exists():
        print(f"Error: {source_file} does not exist.")
        sys.exit(1)

    source_papers = {}
    with source_file.open('r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            paper = json.loads(line)
            paper_id = paper.get('_id') or paper.get('link')
            if paper_id:
                source_papers[paper_id] = paper

    summaries = {}
    with in_file.open('r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            record = json.loads(line)
            paper = record.get('paper', {})
            paper_id = paper.get('_id') or paper.get('link')
            if paper_id in source_papers:
                summaries[paper_id] = record

    categorized_papers = {}
    for paper_id, source_paper in source_papers.items():
        record = summaries.get(paper_id)
        if not record:
            continue
        paper = {**source_paper, **record.get('paper', {})}
        category = record.get('category') or 'Uncategorized'
        categorized_papers.setdefault(category, []).append(paper)

    categorized_papers = dict(sorted(categorized_papers.items()))
    total_papers = sum(len(papers) for papers in categorized_papers.values())
    print(
        f"Loaded {total_papers}/{len(source_papers)} categorized papers "
        f"for {conference.upper()} {year}"
    )

    env = Environment(loader=FileSystemLoader(str(Path(__file__).parent / 'prompt')))
    template = env.get_template('conf_report.html.j2')

    html_content = template.render(
        conference=conference_label(conference),
        year=year,
        generated_date=datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC'),
        total_papers=total_papers,
        categorized_papers=categorized_papers
    )
    html_content = '\n'.join(line.rstrip() for line in html_content.splitlines()) + '\n'
    
    out_dir = Path('top-conf/data/report')
    out_dir.mkdir(parents=True, exist_ok=True)

    base_name = f"{conference.upper()}_{year}_Report"
    html_path = out_dir / f"{base_name}.html"

    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"HTML saved to {html_path}")

    refresh_homepage()

def main():
    parser = argparse.ArgumentParser(description="Generate an HTML report from categorized conference papers")
    parser.add_argument('conference', choices=['usenix', 'ieee-sp', 'ndss', 'ccs'], help="Conference name")
    parser.add_argument('year', type=int, help="Publication year")
    args = parser.parse_args()
    
    render_conf_report(args.conference, args.year)

if __name__ == '__main__':
    main()
