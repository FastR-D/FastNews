import argparse
import json
import traceback
from datetime import datetime, UTC, timedelta
from pathlib import Path

from secnews.util import fetch_rss, SOURCES

DATA_DIR = Path('secnews/data/articles')


def main():
    parser = argparse.ArgumentParser(
        description="Fetch RSS entries and append them to today's JSONL data file"
    )
    parser.add_argument(
        "source",
        choices=sorted(SOURCES),
        help="RSS source to fetch: " + ", ".join(SOURCES),
    )
    args = parser.parse_args()

    entries = fetch_rss(SOURCES[args.source])
    print(f'#entries: {len(entries)}')
    
    if not entries:
        print("No entries fetched. Exiting.")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now(UTC).strftime('%Y-%m-%d')
    filepath = DATA_DIR / f'{today}.jsonl'

    # Load existing IDs across recent files to prevent duplicate entries
    # when crossing day boundaries or when the script runs frequently.
    existing_ids = set()
    
    # Check the last 7 days of files for duplicates
    for i in range(7):
        check_date = (datetime.now(UTC) - timedelta(days=i)).strftime('%Y-%m-%d')
        check_file = DATA_DIR / f'{check_date}.jsonl'
        if check_file.exists():
            try:
                with open(check_file, encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            # Primary deduplication by _id
                            if '_id' in data:
                                existing_ids.add(data['_id'])
                            # Fallback deduplication by link if _id is missing or unhelpful
                            if 'link' in data and data['link']:
                                existing_ids.add(data['link'])
            except Exception as e:
                print(f"Warning: Could not read {check_file} for deduplication: {e}")

    # Write new entries
    new_count = 0
    with open(filepath, 'a', encoding='utf-8') as f:
        for entry in entries:
            # Deduplicate using both _id and link as safety
            entry_id = entry.get('_id')
            entry_link = entry.get('link')
            
            if entry_id not in existing_ids and (not entry_link or entry_link not in existing_ids):
                # Add to existing_ids immediately so we don't insert duplicates from the same fetch batch
                if entry_id:
                    existing_ids.add(entry_id)
                if entry_link:
                    existing_ids.add(entry_link)
                    
                # Convert datetime to ISO string for JSON serialization
                if isinstance(entry.get('fetched_at'), datetime):
                    entry['fetched_at'] = entry['fetched_at'].isoformat()
                
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
                new_count += 1

    print(f"insert: {new_count}, skipped: {len(entries) - new_count}")


if __name__ == '__main__':
    try:
        main()
    except:
        traceback.print_exc()
