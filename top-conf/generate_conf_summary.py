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
    timeout=60
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

def process_papers(conference, year, batch_size=40):
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
    
    for i, batch in enumerate(batches):
        print(f"\nProcessing batch {i+1}/{len(batches)} ({len(batch)} papers)...")
        prompt_text = json.dumps(batch, ensure_ascii=False)
        try:
            response_text = query_llm_batch(prompt_text)
            batch_result = json.loads(response_text)
            
            with open(out_file, 'a', encoding='utf-8') as f:
                for cat, items in batch_result.items():
                    if isinstance(items, list):
                        for p in items:
                            record = {"category": cat, "paper": p}
                            f.write(json.dumps(record, ensure_ascii=False) + '\n')
            
            print(f"Batch {i+1} completed.")
            time.sleep(2)
            
        except Exception as e:
            print(f"Batch {i+1} failed ({e}), initiating sequential single-paper fallback...")
            for single_paper in batch:
                try:
                    single_prompt = json.dumps([single_paper], ensure_ascii=False)
                    single_response = query_llm_batch(single_prompt)
                    single_result = json.loads(single_response)
                    
                    found_category = "Uncategorized"
                    summarized_paper = single_paper
                    for cat, items in single_result.items():
                        if items:
                            found_category = cat
                            summarized_paper = items[0]
                            break
                            
                    record = {"category": found_category, "paper": summarized_paper}
                    with open(out_file, 'a', encoding='utf-8') as f:
                        f.write(json.dumps(record, ensure_ascii=False) + '\n')
                    time.sleep(1)
                except Exception as inner_e:
                    print(f"Skipping LLM for '{single_paper.get('title')}' due to error, moving to Uncategorized.")
                    single_paper["summary_zh"] = single_paper.get("description", "No abstract available.")
                    record = {"category": "Uncategorized (API Error)", "paper": single_paper}
                    with open(out_file, 'a', encoding='utf-8') as f:
                        f.write(json.dumps(record, ensure_ascii=False) + '\n')
            
    print("\nAll papers processed successfully!")


def main():
    parser = argparse.ArgumentParser(description="Process conference papers via LLM")
    parser.add_argument('conference', choices=['usenix', 'ieee-sp', 'ndss', 'ccs'], help="Conference name")
    parser.add_argument('year', type=int, help="Publication year")
    parser.add_argument('--batch-size', type=int, default=40, help="Papers per LLM request")
    args = parser.parse_args()
    
    process_papers(args.conference, args.year, args.batch_size)

if __name__ == '__main__':
    main()
