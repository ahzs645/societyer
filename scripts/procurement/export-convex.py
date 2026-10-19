#!/usr/bin/env python3
"""Operator-only: verify SharePoint snapshot, export metadata for Convex import.
No file bytes or extracted document text are copied to Convex. See the runbook.
"""
import argparse, concurrent.futures, datetime, gzip, hashlib, json, os, pathlib, re, sqlite3, urllib.parse, urllib.request, zipfile
from zoneinfo import ZoneInfo

PROFILE = json.loads(pathlib.Path(__file__).with_name('review-profile.json').read_text())
EVIDENCE_TABLES = tuple(PROFILE['evidenceTables'])
NOTICE_KINDS = set(PROFILE['noticeKinds'])

SOURCE_ZONE = ZoneInfo('America/Vancouver')
MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
ISO = re.compile(r'^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?\s*(Z|[+-]\d{2}:?\d{2})?)?')
WORDY = re.compile(r'(?:^|\b)([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?)?')
SLASHED = re.compile(r'^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?)?')

def _clock(hour, minute, meridiem):
    if hour is None or minute is None: return ''
    h, m = int(hour), int(minute)
    if meridiem:
        if not 1 <= h <= 12: return ''
        h = h % 12 + (12 if meridiem[0] in 'Pp' else 0)
    return f'T{h:02d}:{m:02d}' if h <= 23 and m <= 59 else ''

def _day(y, m, d, time=''):
    try: return datetime.date(int(y), int(m), int(d)).isoformat() + time
    except ValueError: return ''

def sortable_date(value):
    """The source's date as YYYY-MM-DD[THH:MM] in the source zone, or '' when it isn't a date.
    Matches parseSourceDate in src/features/procurementReview/lib/notice.ts."""
    value = (value or '').strip() if isinstance(value, str) else ''
    if not value: return ''
    m = ISO.match(value)
    if m:
        y, mo, d, h, mi, meridiem, offset = m.groups()
        if offset and h is not None and not meridiem:
            try: at = datetime.datetime.fromisoformat(value[:m.end()].replace(' ', 'T').replace('Z', '+00:00'))
            except ValueError: return ''
            return at.astimezone(SOURCE_ZONE).strftime('%Y-%m-%dT%H:%M')
        return _day(y, mo, d, _clock(h, mi, meridiem))
    m = WORDY.search(value)
    if m and m.group(1)[:3].lower() in MONTHS:
        return _day(m.group(3), MONTHS.index(m.group(1)[:3].lower()) + 1, m.group(2), _clock(m.group(4), m.group(5), m.group(6)))
    m = SLASHED.match(value)
    if m:
        year = 2000 + int(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3))
        return _day(year, m.group(1), m.group(2), _clock(m.group(4), m.group(5), m.group(6)))
    return ''

def project_record(row, society, generation):
    data = json.loads(row['data'])
    text = lambda *keys: next((str(data[k]) for k in keys if data.get(k) is not None and str(data[k]).strip()), '')
    # Opportunities sort by closing, awards by award date; `closingAt` is the connector's own instant when the source stated a zone.
    keys = ('awardDate', 'issueDate') if row['kind'] == 'award' else ('closingAt', 'closingDate', 'issueDate')
    date_text = text('closingDate', 'awardDate', 'issueDate')
    date = next((parsed for parsed in (sortable_date(data.get(key)) for key in keys) if parsed), '')
    item = dict(societyId=society, generation=generation, recordKey=row['id'], kind=row['kind'], title=row['title'], organization=text('issuedBy', 'issuingOrganization'), status=text('status'), date=date, dateText=date_text, updatedAt=row['updated_at'])
    item['searchText'] = row.get('searchText') if isinstance(row, dict) and 'searchText' in row else notice_search(row['title'], data, row['id'])
    return item, dict(societyId=society, generation=generation, recordKey=row['id'], dataJson=json.dumps(notice_data(data), separators=(',', ':'), ensure_ascii=False))

def notice_data(data):
    result = {k: v for k, v in data.items() if k in PROFILE['detailFields'] and v is not None and v != '' and v != []}
    if result.get('sourceDescriptionText') == result.get('descriptionText'): result.pop('descriptionText', None)
    return result

def notice_search(title, data, key):
    parts = []
    first = lambda *keys: next((data[k] for k in keys if data.get(k) is not None and str(data[k]).strip()), None)
    for value in [title, first('issuedBy', 'issuingOrganization'), first('searchText', 'description'), first('successfulSupplier', 'mainCommodity'), key]:
        text = str(value).strip() if value is not None else ''
        if not text or any(text in part for part in parts): continue
        parts = [part for part in parts if part not in text]
        parts.append(text)
    return ' '.join(parts)[:16000]

def selected_taxonomy(db):
    terms = {r['id']: json.loads(r['data']) for r in db.execute("SELECT id,data FROM records WHERE kind='taxonomy-term' ORDER BY id")}
    by_code = {}; releases = {d.get('releaseId') for d in terms.values()}
    for key, data in terms.items(): by_code.setdefault((data.get('releaseId'), data.get('code')), []).append(key)
    needed = set()
    def add_code(code, release):
        if not isinstance(code, str): return
        release = release or (next(iter(releases)) if len(releases) == 1 else '')
        needed.update(by_code.get((release, code), []))
    for row in db.execute("SELECT kind,data FROM records WHERE kind IN ('opportunity','award','opportunity-classification') ORDER BY id"):
        data = json.loads(row['data'])
        if row['kind'] == 'opportunity-classification':
            notice = db.execute('SELECT kind FROM records WHERE id=?', (data.get('recordId'),)).fetchone()
            if notice and notice['kind'] in NOTICE_KINDS and isinstance(data.get('termId'), str): needed.add(data['termId'])
            continue
        for code in data.get('classificationCodes') or []: add_code(code, data.get('taxonomyReleaseId'))
        for item in data.get('commodityClassifications') or []:
            if not isinstance(item, dict): continue
            if isinstance(item.get('termId'), str): needed.add(item['termId'])
            add_code(item.get('code'), data.get('taxonomyReleaseId'))
    selected = set(); missing = set(); pending = list(needed)
    while pending:
        key = pending.pop()
        if key in selected: continue
        data = terms.get(key)
        if not data: missing.add(key); continue
        selected.add(key)
        if isinstance(data.get('parentId'), str): pending.append(data['parentId'])
        pending.extend(v for v in data.get('ancestors') or [] if isinstance(v, str))
    result = []
    for key in sorted(selected):
        d = terms[key]
        result.append(dict(key=key, releaseId=d['releaseId'], scheme=d['scheme'], version=d['version'], code=str(d['code']), title=d['title'], parentKey=d.get('parentId')))
    return result, dict(sourceTerms=len(terms), selectedTerms=len(result), unresolvedReferences=len(missing))

class MetadataWriter:
    def __init__(self, manifest, society, folder, output, suffix=None):
        if suffix and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', suffix): raise ValueError('Invalid generation suffix')
        self.manifest, self.society, self.folder, self.output = manifest, society, folder, output
        self.generation = manifest['snapshotId'] + '-' + (suffix or 'reader-v2')
        self.handles = {}; self.counts = {}; self.kinds = {}; self.releases = set(); self.terms = 0
        self.fingerprint = hashlib.sha256(PROFILE['profile'].encode())
        self.taxonomy = {}; self.record_keys = set(); self.term_keys = set(); self.document_keys = set()
    def emit(self, table, item):
        line = json.dumps(item, separators=(',', ':'), ensure_ascii=False)
        if len(line.encode()) > 800000: raise ValueError('Metadata row exceeds safe Convex document size')
        if table not in self.handles: self.handles[table] = open(self.output / (table + '.jsonl'), 'w')
        self.handles[table].write(line + '\n'); self.counts[table] = self.counts.get(table, 0) + 1
        canonical = {k: v for k, v in item.items() if k not in ('generation', 'societyId')}
        self.fingerprint.update(json.dumps([table, canonical], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
    def record(self, row):
        if row['kind'] not in NOTICE_KINDS: raise ValueError('Compact catalog contains an unsupported notice kind')
        if row['id'] in self.record_keys: raise ValueError('Duplicate notice key')
        self.record_keys.add(row['id'])
        item, detail = project_record(row, self.society, self.generation)
        self.emit('procurementRecords', item); self.emit('procurementDetails', detail)
        self.kinds[row['kind']] = self.kinds.get(row['kind'], 0) + 1
    def document(self, d):
        if d['recordKey'] not in self.record_keys: raise ValueError('Document belongs to a notice outside the hosted catalog')
        if d['id'] in self.document_keys: raise ValueError('Duplicate document key')
        self.document_keys.add(d['id'])
        sha = d.get('sha256') or ''; file = self.manifest['files'].get(sha)
        self.emit('procurementDocuments', dict(societyId=self.society, generation=self.generation, recordKey=d['recordKey'], documentKey=d['id'], name=d['name'], mediaType=d.get('mediaType') or 'application/octet-stream', sha256=sha, sourceUrl=d['url'], status=d['status'], bytes=file['bytes'] if file else 0, parts=file['parts'] if file else 0, available=file is not None))
    def evidence(self, source, key, data):
        if source not in EVIDENCE_TABLES: raise ValueError('Unsupported evidence table')
        if key not in self.record_keys: raise ValueError('Evidence belongs to a notice outside the hosted catalog')
        self.emit('procurementEvidence', dict(societyId=self.society, generation=self.generation, recordKey=key, source=source, dataJson=json.dumps(data, separators=(',', ':'), ensure_ascii=False)))
    def term(self, data):
        key = (data['releaseId'], data['key'])
        if key in self.term_keys: raise ValueError('Duplicate taxonomy key')
        self.term_keys.add(key)
        self.emit('procurementTaxonomyTerms', dict(societyId=self.society, **data)); self.terms += 1; self.releases.add(data['releaseId'])
    def finish(self):
        for h in self.handles.values(): h.close()
        if not sum(self.kinds.values()): raise ValueError('Refusing an empty hosted catalog')
        expected = {k: v for k, v in self.counts.items() if k != 'procurementTaxonomyTerms'}
        metadata = dict(societyId=self.society, generation=self.generation, folder=self.folder, publishedAt=self.manifest['publishedAt'], counts=self.kinds, expected=expected, profileVersion=2, contentHash=self.fingerprint.hexdigest(), sourceCounts=self.manifest['counts'], taxonomyReleases=sorted(self.releases), taxonomyCount=self.terms)
        (self.output / 'activation.json').write_text(json.dumps(metadata))
        with zipfile.ZipFile(self.output / 'metadata.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for table in expected: archive.write(self.output / (table + '.jsonl'), table + '/documents.jsonl')
        (self.output / 'statistics.json').write_text(json.dumps(dict(profile=PROFILE['profile'], sourceCounts=self.manifest['counts'], hostedCounts=self.kinds, taxonomy=self.taxonomy, jsonlBytes={table:(self.output/(table+'.jsonl')).stat().st_size for table in self.handles})))
        return expected

def export(db_path, manifest, society, folder, output, generation_suffix=None):
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True); db.row_factory = sqlite3.Row
    writer = MetadataWriter(manifest, society, folder, output, generation_suffix)
    try:
        for row in db.execute("SELECT id,kind,title,data,updated_at FROM records WHERE kind IN ('opportunity','award') ORDER BY id"): writer.record(dict(row))
        for row in db.execute("SELECT d.id,d.record_id,d.url,d.name,d.media_type,d.sha256,d.status FROM documents d JOIN records r ON r.id=d.record_id WHERE r.kind IN ('opportunity','award') ORDER BY d.id"):
            writer.document(dict(id=row['id'], recordKey=row['record_id'], url=row['url'], name=row['name'], mediaType=row['media_type'], sha256=row['sha256'], status=row['status']))
        existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in EVIDENCE_TABLES:
            if table not in existing: continue
            for row in db.execute(f"SELECT e.* FROM {table} e JOIN records r ON r.id=e.record_id WHERE r.kind IN ('opportunity','award') ORDER BY e.record_id,e.rowid"):
                writer.evidence(table, row['record_id'], dict(row))
        terms, writer.taxonomy = selected_taxonomy(db)
        for term in terms: writer.term(term)
        return writer.finish()
    finally:
        for h in writer.handles.values(): h.close()
        db.close()

def export_review(path, manifest, society, folder, output, suffix=None):
    writer = MetadataWriter(manifest, society, folder, output, suffix)
    try:
        with path.open() as source:
            for line in source:
                if len(line.encode()) > 800000: raise ValueError('Compact row too large')
                e = json.loads(line)
                if e['type'] == 'record':
                    r = e['record']; writer.record(dict(id=r['id'], kind=r['kind'], title=r['title'], updated_at=r['updatedAt'], searchText=r['searchText'], data=json.dumps(r['data'], separators=(',', ':'), ensure_ascii=False)))
                elif e['type'] == 'document': writer.document(e['document'])
                elif e['type'] == 'evidence': writer.evidence(e['source'], e['recordKey'], e['data'])
                elif e['type'] == 'taxonomy': writer.term(e['term'])
                else: raise ValueError('Unknown compact catalog entry')
        writer.taxonomy = manifest['review']['taxonomy']
        if writer.kinds != manifest['review']['counts'] or writer.terms != writer.taxonomy['selectedTerms']: raise ValueError('Compact catalog counts do not match its manifest')
        return writer.finish()
    finally:
        for h in writer.handles.values(): h.close()

def download(config, folder, output):
    body = urllib.parse.urlencode(dict(client_id=config['clientId'], client_secret=config['clientSecret'], scope='https://graph.microsoft.com/.default', grant_type='client_credentials')).encode()
    req = urllib.request.Request(f"https://login.microsoftonline.com/{config['tenantId']}/oauth2/v2.0/token", data=body)
    token = json.load(urllib.request.urlopen(req, timeout=60))['access_token']
    def read(path, limit=4 * 1024 * 1024):
        encoded = urllib.parse.quote(folder + '/' + path, safe='/')
        url = f"https://graph.microsoft.com/v1.0/drives/{config['driveId']}/root:/{encoded}"
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        meta = json.load(urllib.request.urlopen(req, timeout=90))
        target = meta['@microsoft.graph.downloadUrl']; parsed = urllib.parse.urlparse(target)
        if parsed.scheme != 'https' or not parsed.hostname.endswith('.sharepoint.com'): raise ValueError('Unexpected SharePoint transfer host')
        data = urllib.request.urlopen(target, timeout=180).read(limit + 1)
        if len(data) > limit: raise ValueError('SharePoint response exceeds transfer budget')
        return data
    manifest = json.loads(read('manifest.json'))
    if manifest.get('formatVersion') != 1 or manifest.get('pluginId') != 'bc-bid-monitor': raise ValueError('Unsupported manifest')
    if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{12}', manifest.get('snapshotId', '')): raise ValueError('Invalid snapshot ID')
    review = manifest.get('review')
    if review and (review.get('formatVersion') != 1 or review.get('profile') != PROFILE['profile'] or review.get('encoding') != 'gzip'): raise ValueError('Unsupported compact review profile; update the operator tools')
    resource = review or manifest['catalog']
    cap = 128 * 1024 * 1024 if review else 1024 * 1024 * 1024
    if not isinstance(resource.get('bytes'), int) or not 0 < resource['bytes'] <= cap: raise ValueError('Catalog exceeds transfer budget')
    if not 1 <= len(resource['parts']) <= 160: raise ValueError('Invalid catalog part count')
    def part(entry):
        expected_prefix = 'snapshots/' + manifest['snapshotId'] + '/' + ('review-' + resource['sha256'][:16] + '.part-' if review else 'catalog.part-')
        if not re.fullmatch(re.escape(expected_prefix) + r'\d{3}', entry['path']): raise ValueError('Unexpected catalog part path')
        if not isinstance(entry['bytes'], int) or not 0 < entry['bytes'] <= 7 * 1024 * 1024: raise ValueError('Invalid catalog part size')
        data = read(entry['path'], entry['bytes'])
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']: raise ValueError('Catalog part integrity failure')
        target = output / pathlib.Path(entry['path']).name; target.write_bytes(data)
        return target
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: paths = list(pool.map(part, resource['parts']))
    compressed = output / 'catalog.gz'
    with compressed.open('wb') as dest:
        for path in paths: dest.write(path.read_bytes()); path.unlink()
    catalog = output / ('review.jsonl' if review else 'catalog.sqlite'); digest = hashlib.sha256(); size = 0
    with gzip.open(compressed, 'rb') as source, catalog.open('wb') as dest:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > resource['bytes']: raise ValueError('Catalog exceeds declared size')
            digest.update(chunk); dest.write(chunk)
    compressed.unlink()
    if size != resource['bytes'] or digest.hexdigest() != resource['sha256']: raise ValueError('Catalog integrity failure')
    return catalog, manifest

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generation-suffix', help='Reproject an existing snapshot into a fresh immutable generation without appending duplicate rows');
    parser.add_argument('--keep-source', action='store_true', help='Retain the verified source locally for companion-only publishing; keep this directory private')
    parser.add_argument('--config', required=True); parser.add_argument('--society-id', required=True); parser.add_argument('--folder'); parser.add_argument('--output', required=True)
    args = parser.parse_args(); os.umask(0o077)
    folder = args.folder or f'Zoer/bc-bid-monitor/{args.society_id}'
    if folder != f'Zoer/bc-bid-monitor/{args.society_id}' and not folder.startswith(f'Zoer/bc-bid-monitor/{args.society_id}/'): raise ValueError('Folder must belong to workspace')
    output = pathlib.Path(args.output); output.mkdir(parents=True, exist_ok=False, mode=0o700)
    config = json.loads(pathlib.Path(args.config).expanduser().read_text())
    catalog, manifest = download(config, folder, output)
    try:
        method = export_review if manifest.get('review') else export
        counts = method(catalog, manifest, args.society_id, folder, output, args.generation_suffix)
    finally:
        if not args.keep_source: catalog.unlink(missing_ok=True)
    print(json.dumps(dict(snapshot=manifest['snapshotId'], counts=counts, output=str(output))))

if __name__ == '__main__': main()
