#!/usr/bin/env python3
"""Inventory a publicly shared Drive tree without credentials.

Public HTML is an undocumented, possibly paginated interface: inventories are
explicitly NOT proof of completeness. No APIs, auth cookies, or API keys used.
Source contents and manifests should be kept outside the git repository.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import signal
import subprocess

FOLDER = 'application/vnd.google-apps.folder'


def parse_listing(html):
    match = re.search(r"AF_initDataCallback\(\{key: 'ds:4'.*?data:", html)
    if not match:
        raise ValueError('Public folder listing not found; access denied or HTML changed')
    tree = json.JSONDecoder().raw_decode(html[match.end():])[0]
    found = {}
    def walk(value):
        if not isinstance(value, list):
            return
        if (len(value) > 34 and isinstance(value[0], list) and
                len(value[0]) == 2 and value[0][0] is None and
                isinstance(value[4], str)):
            fid = value[0][1]
            if not isinstance(fid, str) or not re.fullmatch(r'[\w-]+', fid):
                raise ValueError('Unexpected file ID')
            name = value[24][2][0][2][1][0][0][0]
            if not isinstance(name, str):
                raise ValueError('Unexpected file name')
            # Display labels are rounded, not exact byte counts.
            labels = re.findall(r'Size: ([^\\"\n]+)', json.dumps(value))
            found[fid] = dict(id=fid, name=name, mimeType=value[4],
                              kind='folder' if value[4] == FOLDER else 'file',
                              sizeLabel=labels[0] if labels else None)
            return
        for child in value:
            walk(child)
    walk(tree)
    return list(found.values())


def fetch(folder_id, cache):
    cached = cache / (folder_id + '.html')
    if not cached.exists():
        result = subprocess.run(['curl', '--fail', '-L', '-sS', '--retry', '2',
            '--max-time', '60', 'https://drive.google.com/drive/folders/' + folder_id],
            capture_output=True, check=True)
        cached.write_bytes(result.stdout)
    return parse_listing(cached.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder_id')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-folders', type=int, default=300, help='Total listed/attempted folder limit, including resumed folders')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--retry-errors', action='store_true', help='Retry failed folders when resuming')
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 8 or args.max_folders < 1:
        parser.error('workers must be 1..8 and max-folders must be positive')
    if not re.fullmatch(r'[\w-]+', args.folder_id):
        parser.error('Expected a Drive folder ID')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cache = args.output.parent / 'folder-html'
    cache.mkdir(exist_ok=True)
    manifest = dict(schemaVersion=1, rootFolderId=args.folder_id,
        generatedAt=datetime.now(timezone.utc).isoformat(),
        completeness='unverified-public-html',
        completenessNote='Public HTML may omit paginated items; all counts are observed lower bounds. Authenticated Drive API pagination is required to certify completeness.',
        entries=[], folders=[], errors=[])
    if args.resume and args.output.exists():
        manifest = json.loads(args.output.read_text())
        if manifest['rootFolderId'] != args.folder_id:
            parser.error('Resume manifest belongs to another root')
        manifest['resumedAt'] = datetime.now(timezone.utc).isoformat()
    seen = {f['id'] for f in manifest['folders']}
    canonical = {f['id']: f['path'] for f in manifest['folders']}
    manifest.setdefault('aliases', [])
    # Derive queue from discovered folders as well: supports interrupted older manifests.
    pending = [(args.folder_id, '')] if not seen else []
    pending += [(e['id'],e['path']) for e in manifest['entries']
                if e['kind'] == 'folder' and not e.get('excluded') and e['id'] not in seen]
    if args.retry_errors:
        retry_ids = {f['id'] for f in manifest['folders'] if f['status'] == 'error'}
        pending += [(f['id'],f['path']) for f in manifest['folders'] if f['id'] in retry_ids]
        seen -= retry_ids
        manifest['folders'] = [f for f in manifest['folders'] if f['id'] not in retry_ids]
        manifest['errors'] = [e for e in manifest['errors'] if e['id'] not in retry_ids]
    stop = [False]
    def interrupt(_signum, _frame):
        stop[0] = True
        print('Stopping after current bounded request batch; checkpoint will preserve pending folders.', flush=True)
    signal.signal(signal.SIGINT, interrupt)
    signal.signal(signal.SIGTERM, interrupt)
    inflight = {}
    def save():
        manifest['unvisitedFolders'] = [dict(id=fid,path=path) for fid,path in pending + list(inflight.values())]
        manifest['traversalStatus'] = 'partial' if manifest['unvisitedFolders'] or manifest['errors'] else 'observed-tree-traversed'
        manifest['checkpointAt'] = datetime.now(timezone.utc).isoformat()
        temp = args.output.with_suffix('.tmp')
        temp.write_text(json.dumps(manifest, indent=2))
        temp.replace(args.output)
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
        while pending and len(seen) < args.max_folders and not stop[0]:
            count = min(args.workers, args.max_folders - len(seen))
            batch, pending = pending[:count], pending[count:]
            futures = {}
            for fid, path in batch:
                if fid not in seen:
                    seen.add(fid)
                    canonical[fid] = path
                    futures[pool.submit(fetch, fid, cache)] = (fid, path)
                elif canonical.get(fid) != path:
                    manifest['aliases'].append(dict(id=fid,path=path,canonicalPath=canonical.get(fid)))
            inflight = dict(futures)
            for future in as_completed(futures):
                fid, path = futures[future]
                try:
                    items = future.result()
                    manifest['folders'].append(dict(id=fid, path=path, status='listed',
                        itemCount=len(items), paginationRisk=len(items) >= 50))
                    for item in items:
                        item.update(parentId=fid, path='/'.join(filter(None,[path,item['name']])), excluded=False)
                        if item['name'].startswith('._') or item['name'] in {'.DS_Store','.LexarDataShield','System Volume Information','desktop.ini','Thumbs.db'}:
                            item.update(excluded=True, exclusionReason='filesystem-metadata')
                        manifest['entries'].append(item)
                        if item['kind'] == 'folder' and not item['excluded']:
                            pending.append((item['id'],item['path']))
                    print(f"Listed {path or '/'}: {len(items)} entries; {len(pending)} folders queued", flush=True)
                except Exception as exc:
                    error = dict(id=fid,path=path,error=str(exc))
                    manifest['errors'].append(error)
                    manifest['folders'].append(dict(**error,status='error',paginationRisk=True))
                inflight.pop(future, None)
                save()
    save()

if __name__ == '__main__':
    main()
