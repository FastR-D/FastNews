import json
import os
import sys
from datetime import datetime, UTC, timedelta
from pathlib import Path

from jinja2 import Template
import subprocess, platform

# On macOS, WeasyPrint needs Homebrew native libs (pango, glib)
if platform.system() == 'Darwin':
    try:
        brew_prefix = subprocess.check_output(['brew', '--prefix'], text=True).strip()
        dyld = os.environ.get('DYLD_FALLBACK_LIBRARY_PATH', '')
        os.environ['DYLD_FALLBACK_LIBRARY_PATH'] = f"{brew_prefix}/lib:{dyld}".rstrip(':')
    except Exception:
        pass

from weasyprint import HTML

NEWSPAPERS_DIR = Path('secnews/data/newspapers')


def refresh_homepage():
    try:
        root_dir = Path(__file__).resolve().parent.parent
        if str(root_dir) not in sys.path:
            sys.path.insert(0, str(root_dir))
        from generate_homepage import render_homepage

        render_homepage(Path("index.html"))
    except Exception as e:
        print(f"Warning: failed to refresh homepage: {e}")


def get_report_title(date_obj):
    # Cap the week number at 3 (0-indexed) so a month only has 4 weeks max
    week_num = min((date_obj.day - 1) // 7, 3)
    week_names = ["第一周", "第二周", "第三周", "第四周"]
    return f"{date_obj.year}年{date_obj.month}月{week_names[week_num]}安全事件报告"

def get_safe_filename(date_obj):
    week_num = min((date_obj.day - 1) // 7 + 1, 4)
    return f"{date_obj.year}.{date_obj.month}.{week_num}-report"

def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7

    since_date = (datetime.now(UTC) - timedelta(days=days)).strftime('%Y-%m-%d')

    if not NEWSPAPERS_DIR.exists():
        print("No newspapers directory found. Skipping PDF generation.")
        sys.exit(0)

    # Load newspaper files from the past N days
    docs = []
    for filepath in sorted(NEWSPAPERS_DIR.glob('*.json')):
        if filepath.stem >= since_date:
            with open(filepath, encoding='utf-8') as f:
                docs.append(json.load(f))

    if not docs:
        print("No newspapers found in the past week. Skipping PDF generation.")
        sys.exit(0)

    # Collect all articles across all newspaper documents
    all_bleeping = []
    all_cs_cr = []
    all_cs_ai = []
    seen_ids = set()

    for doc in docs:
        articles = doc.get('articles', {})
        for item in articles.get('bleepingcomputer', []):
            if item['_id'] not in seen_ids:
                seen_ids.add(item['_id'])
                all_bleeping.append(item)
        for item in articles.get('arxiv_cs_cr', []):
            if item['_id'] not in seen_ids:
                seen_ids.add(item['_id'])
                all_cs_cr.append(item)
        for item in articles.get('arxiv_cs_ai', []):
            if item['_id'] not in seen_ids:
                seen_ids.add(item['_id'])
                all_cs_ai.append(item)

    # Date range from filenames
    start_date = docs[0]['generated_at'][:10]
    end_date = docs[-1]['generated_at'][:10]
    date_range = f"{start_date} ~ {end_date}"

    print(f"Date range: {date_range}")
    print(f"Articles: bleepingcomputer={len(all_bleeping)}, cs.cr={len(all_cs_cr)}, cs.ai={len(all_cs_ai)}")

    # Render HTML
    with open('secnews/prompt/newspaper.html.j2', encoding='utf-8') as f:
        template = Template(f.read())

    report_title = get_report_title(datetime.strptime(end_date, '%Y-%m-%d'))
    html_content = template.render(
        report_title=report_title,
        date_range=date_range,
        sections={
            'bleepingcomputer': all_bleeping,
            'arxiv_cs_cr': all_cs_cr,
            'arxiv_cs_ai': all_cs_ai,
        },
        generated_at=datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC'),
    )

    # Generate Release Output (PDF and HTML)
    os.makedirs('output', exist_ok=True)
    dt_obj = datetime.strptime(end_date, '%Y-%m-%d')
    filename_base = get_safe_filename(dt_obj)
    
    release_html_path = os.path.join('output', f"{filename_base}.html")
    release_pdf_path = os.path.join('output', f"{filename_base}.pdf")
    
    with open(release_html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    HTML(string=html_content).write_pdf(release_pdf_path)
    print(f"Release files generated in output/: {filename_base}.html/pdf")

    # Generate Repository Backup (HTML only)
    os.makedirs('secnews/data/report', exist_ok=True)
    backup_html_path = os.path.join('secnews/data/report', f"{filename_base}.html")
    with open(backup_html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print(f"Backup HTML generated: {backup_html_path}")
    refresh_homepage()

    # Export to GitHub Actions output if needed
    if 'GITHUB_OUTPUT' in os.environ:
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
            f.write(f"REPORT_TITLE={report_title}\n")
            f.write(f"REPORT_FILENAME={filename_base}\n")

if __name__ == '__main__':
    main()
