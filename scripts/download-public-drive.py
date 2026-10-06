#!/usr/bin/env python3
"""Download explicitly selected public Drive files into a provenance ledger.

Usage: download-public-drive.py --inventory inventory.json --output-dir sources
       --id DRIVE_ID --id ANOTHER_ID --max-total-mb 150
Does not recurse, download folders, or include excluded metadata. Enforces a
byte budget, rejects HTML error/interstitial pages, hashes downloaded bytes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--id', action='append', required=True)
    p.add_argument('--max-total-mb', type=float, default=150)
    args = p.parse_args()
    if args.max_total_mb <= 0:
        p.error('--max-total-mb must be positive')
    budget = int(args.max_total_mb * 1024 * 1024)
    source = {e['id']: e for e in json.loads(args.inventory.read_text())['entries']}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    ledger_path = args.output_dir / 'downloads.json'
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
    used = 0
    for fid in dict.fromkeys(args.id):
        e = source.get(fid)
        if not e or e['kind'] != 'file' or e.get('excluded'):
            p.error('ID missing, excluded or not a file: ' + fid)
        if not all(c.isalnum() or c in '_-' for c in fid):
            p.error('Invalid ID')
        name = Path(e['name']).name.replace('\\', '_')
        dest = args.output_dir / (fid + '-' + name)
        tmp = dest.with_suffix(dest.suffix + '.part')
        record = dict(id=fid, sourcePath=e['path'], sourceUrl='https://drive.google.com/file/d/'+fid+'/view')
        try:
            if used >= budget:
                raise ValueError('Download budget exhausted')
            subprocess.run(['curl','--fail','-L','-sS','--max-time','120',
                '--max-filesize',str(budget-used),
                'https://drive.google.com/uc?export=download&id='+fid,'-o',str(tmp)], check=True)
            head = tmp.read_bytes()[:1024].lstrip().lower()
            if head.startswith(b'<!doctype html') or head.startswith(b'<html'):
                raise ValueError('Received HTML instead of a source file (download interstitial/access error)')
            size = tmp.stat().st_size
            if not size or size > budget-used:
                raise ValueError('Empty download or byte budget exceeded')
            tmp.replace(dest)
            used += size
            record.update(downloadStatus='downloaded',localPath=str(dest.resolve()),
                sizeBytes=size,sha256=hashlib.sha256(dest.read_bytes()).hexdigest())
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            record.update(downloadStatus='error',error=str(exc))
        ledger = [r for r in ledger if r['id'] != fid] + [record]
        ledger_path.write_text(json.dumps(ledger,indent=2))
        print(fid,record['downloadStatus'])

if __name__ == '__main__':
    main()
