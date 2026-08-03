import argparse
import json
import os
import sys
from datetime import datetime, UTC
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
import subprocess, platform

# On macOS, WeasyPrint needs Homebrew native libs (pango, glib)
if platform.system() == 'Darwin':
    try:
        brew_prefix = subprocess.check_output(['brew', '--prefix'], text=True).strip()
        dyld = os.environ.get('DYLD_FALLBACK_LIBRARY_PATH', '')
        os.environ['DYLD_FALLBACK_LIBRARY_PATH'] = f"{brew_prefix}/lib:{dyld}".rstrip(':')
    except Exception:
        pass

try:
    from weasyprint import HTML
    HAS_WEASYPRINT = True
except (ImportError, OSError):
    HAS_WEASYPRINT = False
    print("Warning: WeasyPrint not available, skipping PDF generation.")


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
    if not in_file.exists():
        print(f"Error: {in_file} does not exist. Run generate_conf_summary.py first.")
        sys.exit(1)
        
    categorized_papers = {}
    with open(in_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            cat = rec.get("category", "Uncategorized")
            if cat not in categorized_papers:
                categorized_papers[cat] = []
            categorized_papers[cat].append(rec.get("paper", {}))
            
    # Sort categories nicely
    categorized_papers = dict(sorted(categorized_papers.items()))
        
    total_papers = sum(len(papers) for papers in categorized_papers.values())
    print(f"Loaded {total_papers} categorized papers for {conference.upper()} {year}")
    
    env = Environment(loader=FileSystemLoader(str(Path(__file__).parent / 'prompt')))
    template = env.get_template('conf_report.html.j2')
    
    html_content = template.render(
        conference=conference_label(conference),
        year=year,
        generated_date=datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC'),
        total_papers=total_papers,
        categorized_papers=categorized_papers
    )
    
    out_dir = Path('top-conf/data/report')
    out_dir.mkdir(parents=True, exist_ok=True)
    
    base_name = f"{conference.upper()}_{year}_Report"
    html_path = out_dir / f"{base_name}.html"
    pdf_path = out_dir / f"{base_name}.pdf"
    
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    print(f"HTML saved to {html_path}")
    
    print("Generating PDF...")
    if HAS_WEASYPRINT:
        try:
            HTML(string=html_content).write_pdf(target=str(pdf_path))
            print(f"PDF saved to {pdf_path}")
        except Exception as e:
            print(f"Failed to generate PDF: {e}")
    else:
        print("Skipping PDF (WeasyPrint not available). Install pango: brew install pango")

    refresh_homepage()

def main():
    parser = argparse.ArgumentParser(description="Generate PDF and HTML report from categorized conference papers")
    parser.add_argument('conference', choices=['usenix', 'ieee-sp', 'ndss', 'ccs'], help="Conference name")
    parser.add_argument('year', type=int, help="Publication year")
    args = parser.parse_args()
    
    render_conf_report(args.conference, args.year)

if __name__ == '__main__':
    main()
