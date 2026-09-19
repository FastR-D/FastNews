import argparse
import json
import os
import sys
from pathlib import Path
from openai import OpenAI
from retry import retry
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-3-flash-preview")

if not OPENAI_API_KEY:
    print("Error: OPENAI_API_KEY not set.")
    sys.exit(1)

client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL,
    timeout=180
)

@retry(tries=3, delay=2, backoff=2)
def query_llm_batch(prompt_text):
    print("Sending batch to LLM...")
    try:
        sys_prompt_path = Path(__file__).parent / 'prompt' / 'conf_sys.j2'
        with open(sys_prompt_path, 'r', encoding='utf-8') as f:
            sys_prompt = f.read()
            
        completion = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_text}
            ],
            temperature=0.3
        )
        content = completion.choices[0].message.content.strip()
        if content.startswith('```json'):
            content = content[7:]
        if content.startswith('```'):
            content = content[3:]
        if content.endswith('```'):
            content = content[:-3]
        return content.strip()
    except Exception as e:
        print(f"LLM Error: {e}")
        raise

def process_papers(conference, year, batch_size=12):
    in_file = Path(f'top-conf/data/conferences/{conference}_{year}.jsonl')
    out_dir = Path('top-conf/data/summary')
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f'{conference}_{year}_summary.jsonl'
    
    if not in_file.exists():
        print(f"Error: {in_file} does not exist. Run fetch_big4.py first.")
        sys.exit(1)
        
    papers = []
    with open(in_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                papers.append(json.loads(line))
                
    processed_ids = set()
    if out_file.exists():
        with open(out_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    rec = json.loads(line)
                    if '_id' in rec.get('paper', {}):
                        processed_ids.add(rec['paper']['_id'])
                        
    print(f"Loaded {len(papers)} total papers for {conference.upper()} {year}.")
    print(f"Found {len(processed_ids)} already processed papers. Resuming...")
    
    unprocessed_papers = [p for p in papers if p.get('_id') not in processed_ids]
    print(f"Remaining papers to process: {len(unprocessed_papers)}")
    
    if not unprocessed_papers:
        print("\nAll papers processed successfully!")
        return

    import time
    batches = [unprocessed_papers[i:i+batch_size] for i in range(0, len(unprocessed_papers), batch_size)]
    print(f"Split into {len(batches)} batches of {batch_size} (or less).")
    
    def compact_paper(paper):
        return {
            "_id": paper.get("_id"),
            "title": paper.get("title"),
            "link": paper.get("link"),
            "author": paper.get("author"),
            "description": paper.get("description") or "",
        }

    def merge_llm_paper(original, summarized):
        merged = dict(original)
        if isinstance(summarized, dict):
            merged.update({k: v for k, v in summarized.items() if v})
        return merged

    def write_records(records):
        with open(out_file, "a", encoding="utf-8") as f:
            for record in records:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def records_from_result(originals, result):
        by_id = {paper.get("_id"): paper for paper in originals if paper.get("_id")}
        by_title = {(paper.get("title") or "").strip().lower(): paper for paper in originals}
        used = set()
        records = []
        if not isinstance(result, dict):
            return records, originals
        for category, items in result.items():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                original = by_id.get(item.get("_id"))
                if original is None:
                    original = by_title.get((item.get("title") or "").strip().lower())
                if original is None:
                    continue
                paper_id = original.get("_id")
                if paper_id in used:
                    continue
                used.add(paper_id)
                records.append({
                    "category": category,
                    "paper": merge_llm_paper(original, item),
                })
        leftover = [paper for paper in originals if paper.get("_id") not in used]
        return records, leftover

    def summarize_one(paper):
        single_response = query_llm_batch(json.dumps([compact_paper(paper)], ensure_ascii=False))
        single_result = json.loads(single_response)
        records, leftover = records_from_result([paper], single_result)
        if records:
            return records[0]
        paper = dict(paper)
        paper["summary_zh"] = paper.get("description") or "No abstract available."
        return {"category": "Uncategorized", "paper": paper}

    for i, batch in enumerate(batches):
        print(f"\nProcessing batch {i+1}/{len(batches)} ({len(batch)} papers)...")
        prompt_text = json.dumps([compact_paper(paper) for paper in batch], ensure_ascii=False)
        leftover = batch
        try:
            response_text = query_llm_batch(prompt_text)
            batch_result = json.loads(response_text)
            records, leftover = records_from_result(batch, batch_result)
            if records:
                write_records(records)
            print(f"Batch {i+1} completed ({len(records)}/{len(batch)}).")
            time.sleep(1)
        except Exception as e:
            print(f"Batch {i+1} failed ({e}), initiating sequential single-paper fallback...")

        if leftover:
            print(f"  sequential fallback for {len(leftover)} papers...")
            for single_paper in leftover:
                try:
                    write_records([summarize_one(single_paper)])
                    time.sleep(1)
                except Exception as inner_e:
                    print(f"Skipping LLM for '{single_paper.get('title')}' due to error, moving to Uncategorized.")
                    failed = dict(single_paper)
                    failed["summary_zh"] = failed.get("description") or "No abstract available."
                    write_records([{"category": "Uncategorized (API Error)", "paper": failed}])
            
    print("\nAll papers processed successfully!")


def main():
    parser = argparse.ArgumentParser(description="Process conference papers via LLM")
    parser.add_argument('conference', choices=['usenix', 'ieee-sp', 'ndss', 'ccs'], help="Conference name")
    parser.add_argument('year', type=int, help="Publication year")
    parser.add_argument('--batch-size', type=int, default=12, help="Papers per LLM request")
    args = parser.parse_args()
    
    process_papers(args.conference, args.year, args.batch_size)

if __name__ == '__main__':
    main()
