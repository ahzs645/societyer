#!/usr/bin/env python3
"""Operator-only: verify SharePoint snapshot, export metadata for Convex import.
No file bytes or extracted document text are copied to Convex. See the runbook.
"""
import argparse, concurrent.futures, gzip, hashlib, json, os, pathlib, sqlite3, urllib.parse, urllib.request, zipfile

EVIDENCE_TABLES = ('reviews', 'procurement_stage_runs', 'procurement_requirements', 'procurement_facts', 'procurement_assessments', 'procurement_decisions', 'procurement_tasks', 'procurement_changes', 'procurement_matches', 'procurement_judgements')

def project_record(row, society, generation):
    data = json.loads(row['data'])
    text = lambda *keys: next((str(data[k]) for k in keys if data.get(k) is not None), '')
    item = dict(societyId=society, generation=generation, recordKey=row['id'], kind=row['kind'], title=row['title'], organization=text('issuedBy', 'issuingOrganization'), status=text('status'), date=text('closingDate', 'awardDate', 'issueDate'), updatedAt=row['updated_at'])
    item['searchText'] = ' '.join([item['title'], item['organization'], text('searchText', 'description'), text('successfulSupplier', 'mainCommodity'), row['id']])[:16000]
    return item, dict(societyId=society, generation=generation, recordKey=row['id'], dataJson=row['data'])

def export(db_path, manifest, society, folder, output):
    generation = manifest['snapshotId']
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True); db.row_factory = sqlite3.Row
    handles = {}; counts = {}
    def emit(table, item):
        line = json.dumps(item, separators=(',', ':'), ensure_ascii=False)
        if len(line.encode()) > 800000: raise ValueError(f'{table}: metadata row exceeds safe Convex document size; nothing has been activated')
        if table not in handles: handles[table] = open(output / f'{table}.jsonl', 'w')
        handles[table].write(line + '\n'); counts[table] = counts.get(table, 0) + 1
    for row in db.execute('SELECT id,kind,title,data,updated_at FROM records ORDER BY id'):
        item, detail = project_record(row, society, generation)
        emit('procurementRecords', item); emit('procurementDetails', detail)
    for row in db.execute('SELECT id,record_id,url,name,media_type,sha256,status,byte_length FROM documents ORDER BY id'):
        sha = row['sha256']; file = manifest['files'].get(sha) if sha else None
        emit('procurementDocuments', dict(societyId=society, generation=generation, recordKey=row['record_id'], documentKey=row['id'], name=row['name'], mediaType=row['media_type'] or 'application/octet-stream', sha256=sha or '', sourceUrl=row['url'], status=row['status'], bytes=file['bytes'] if file else 0, parts=file['parts'] if file else 0, available=file is not None))
    existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in EVIDENCE_TABLES:
        if table not in existing: continue
        for row in db.execute(f'SELECT * FROM {table} ORDER BY record_id'):
            value = dict(row)
            emit('procurementEvidence', dict(societyId=society, generation=generation, recordKey=value['record_id'], source=table, dataJson=json.dumps(value, separators=(',', ':'))))
    for handle in handles.values(): handle.close()
    db.close()
    metadata = dict(societyId=society, generation=generation, folder=folder, publishedAt=manifest['publishedAt'], counts=manifest['counts'], expected=counts)
    (output / 'activation.json').write_text(json.dumps(metadata))
    # Only populated tables: ZIP import can append all of them in one operator step.
    with zipfile.ZipFile(output / 'metadata.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for table in handles: archive.write(output / f'{table}.jsonl', f'{table}/documents.jsonl')
    return counts

def download(config, folder, output):
    body = urllib.parse.urlencode(dict(client_id=config['clientId'], client_secret=config['clientSecret'], scope='https://graph.microsoft.com/.default', grant_type='client_credentials')).encode()
    req = urllib.request.Request(f"https://login.microsoftonline.com/{config['tenantId']}/oauth2/v2.0/token", data=body)
    token = json.load(urllib.request.urlopen(req, timeout=60))['access_token']
    def read(path):
        encoded = urllib.parse.quote(folder + '/' + path, safe='/')
        url = f"https://graph.microsoft.com/v1.0/drives/{config['driveId']}/root:/{encoded}"
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        meta = json.load(urllib.request.urlopen(req, timeout=90))
        target = meta['@microsoft.graph.downloadUrl']; parsed = urllib.parse.urlparse(target)
        if parsed.scheme != 'https' or not parsed.hostname.endswith('.sharepoint.com'): raise ValueError('Unexpected SharePoint transfer host')
        return urllib.request.urlopen(target, timeout=180).read()
    manifest = json.loads(read('manifest.json'))
    if manifest.get('formatVersion') != 1 or manifest.get('pluginId') != 'bc-bid-monitor': raise ValueError('Unsupported manifest')
    def part(entry):
        data = read(entry['path'])
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']: raise ValueError('Catalog part integrity failure')
        target = output / pathlib.Path(entry['path']).name; target.write_bytes(data)
        return target
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: paths = list(pool.map(part, manifest['catalog']['parts']))
    compressed = output / 'catalog.gz'
    with compressed.open('wb') as dest:
        for path in paths: dest.write(path.read_bytes()); path.unlink()
    catalog = output / 'catalog.sqlite'; digest = hashlib.sha256(); size = 0
    with gzip.open(compressed, 'rb') as source, catalog.open('wb') as dest:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > manifest['catalog']['bytes']: raise ValueError('Catalog exceeds declared size')
            digest.update(chunk); dest.write(chunk)
    compressed.unlink()
    if size != manifest['catalog']['bytes'] or digest.hexdigest() != manifest['catalog']['sha256']: raise ValueError('Catalog integrity failure')
    return catalog, manifest

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True); parser.add_argument('--society-id', required=True); parser.add_argument('--folder'); parser.add_argument('--output', required=True)
    args = parser.parse_args(); os.umask(0o077)
    folder = args.folder or f'Zoer/bc-bid-monitor/{args.society_id}'
    if folder != f'Zoer/bc-bid-monitor/{args.society_id}' and not folder.startswith(f'Zoer/bc-bid-monitor/{args.society_id}/'): raise ValueError('Folder must belong to workspace')
    output = pathlib.Path(args.output); output.mkdir(parents=True, exist_ok=False, mode=0o700)
    config = json.loads(pathlib.Path(args.config).expanduser().read_text())
    catalog, manifest = download(config, folder, output)
    try: counts = export(catalog, manifest, args.society_id, folder, output)
    finally: catalog.unlink(missing_ok=True)
    print(json.dumps(dict(snapshot=manifest['snapshotId'], counts=counts, output=str(output))))

if __name__ == '__main__': main()
