#!/usr/bin/env python3
"""Operator-only: verify SharePoint snapshot, export metadata for Convex import.
No file bytes or extracted document text are copied to Convex. See the runbook.
"""
import argparse, concurrent.futures, datetime, gzip, hashlib, json, os, pathlib, re, sqlite3, urllib.parse, urllib.request, zipfile
from zoneinfo import ZoneInfo

EVIDENCE_TABLES = ('reviews', 'procurement_stage_runs', 'procurement_requirements', 'procurement_facts', 'procurement_assessments', 'procurement_decisions', 'procurement_tasks', 'procurement_changes', 'procurement_matches', 'procurement_judgements')

SOURCE_ZONE = ZoneInfo('America/Vancouver')
MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
ISO = re.compile(r'^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?\s*(Z|[+-]\d{2}:?\d{2})?)?')
WORDY = re.compile(r'(?:^|\b)([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?)?')
DAY_FIRST_WORDY = re.compile(r'(?:^|\b)(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?)?')
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
    m = DAY_FIRST_WORDY.search(value)
    if m and m.group(2)[:3].lower() in MONTHS:
        return _day(m.group(3), MONTHS.index(m.group(2)[:3].lower()) + 1, m.group(1), _clock(m.group(4), m.group(5), m.group(6)))
    m = SLASHED.match(value)
    if m:
        year = 2000 + int(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3))
        return _day(year, m.group(1), m.group(2), _clock(m.group(4), m.group(5), m.group(6)))
    return ''

def _text(value):
    """A trimmed string, or a finite number as text; anything else is ''. Matches `text` in lib/notice.ts."""
    if isinstance(value, str): return value.strip()
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value in (float('inf'), float('-inf')): return ''
    return str(int(value)) if float(value).is_integer() else repr(value)

def _first(data, *keys): return next((_text(data.get(key)) for key in keys if _text(data.get(key))), '')
def _squash(value): return re.sub(r'[^a-z0-9]+', ' ', value.lower()).strip()

# Zoer's own catalog keys stand in for a reference on sources that publish none (`referenceOf` in lib/notice.ts).
SYNTHETIC_REFERENCE = re.compile(r'^(browser-sites|municipal-sites|bidsandtenders|canadabuys):')
MONEY = re.compile(r'^(-)?\s*(?:CA)?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$')

def reference_of(data):
    """`referenceOf` in lib/notice.ts: the first real reference; a synthetic key falls through to the next field."""
    for key in ('opportunityId', 'externalId', 'referenceNumber', 'solicitationNumber'):
        value = _text(data.get(key))
        if value and not SYNTHETIC_REFERENCE.match(value) and len(value) <= 60:
            return value
    return ''

def attachment_names(data):
    """Files the source lists on the notice: `attachmentsOf` in lib/notice.ts."""
    raw = [*(data.get('attachments') if isinstance(data.get('attachments'), list) else []), *(data.get('addenda') if isinstance(data.get('addenda'), list) else [])]
    items = [dict(name=item) if isinstance(item, str) else item if isinstance(item, dict) else {} for item in raw]
    return [name for name in (_text(item.get('name')) or _text(item.get('title')) or _text(item.get('fileName')) for item in items) if name]

def listed_only(names, documents):
    """Listed names no stored file answers to, compared as NoticeDocuments.tsx does (trimmed, case-insensitive)."""
    stored = {name.strip().lower() for name, _available in documents}
    return sum(1 for name in names if name.strip().lower() not in stored)

def money_value(value):
    """A contract value as a number when it reads as one ("$1,240,000.00", 64800); otherwise None."""
    if isinstance(value, bool): return None
    if isinstance(value, (int, float)): return value if value == value and value not in (float('inf'), float('-inf')) else None
    m = MONEY.match(_text(value))
    if not m: return None
    number = float(m.group(2).replace(',', '') + (m.group(3) or ''))
    number = -number if m.group(1) else number
    return int(number) if number.is_integer() else number

def project_record(row, society, generation, documents=()):
    """The list row (ListRow in src/features/procurementReview/reader/source.ts) and the notice body.
    `documents` is the record's (name, available) files from the documents table."""
    data = json.loads(row['data'])
    text = lambda *keys: next((str(data[k]) for k in keys if data.get(k) is not None and str(data[k]).strip()), '')
    award = row['kind'] == 'award'
    # Opportunities sort by closing, awards by award date; `closingAt` is the connector's own instant when the source stated a zone.
    keys = ('awardDate', 'issueDate') if award else ('closingAt', 'closingDate', 'issueDate')
    date_text = text('closingDate', 'awardDate', 'issueDate')
    date = next((parsed for parsed in (sortable_date(data.get(key)) for key in keys) if parsed), '')
    organization = text('issuedBy', 'issuingOrganization')
    issued_for = _first(data, 'issuedFor')
    item = dict(societyId=society, generation=generation, recordKey=row['id'], kind=row['kind'], title=row['title'], organization=organization, status=text('status'), date=date, dateText=date_text, updatedAt=row['updated_at'],
                issuedFor=issued_for if issued_for and _squash(issued_for) != _squash(organization) else '',
                reference=reference_of(data),
                documents=sum(1 for _name, available in documents if available),
                listedDocuments=listed_only(attachment_names(data), documents),
                supplier=_first(data, 'successfulSupplier', 'supplier') if award else '',
                currency=_first(data, 'currency').upper() if award else '',
                procurementType=_first(data, 'opportunityType', 'type') if award else '')
    value = money_value(data.get('contractValue')) if award else None
    if award and value is None: value = money_value(data.get('contractValueText'))
    if value is not None: item['value'] = value
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
    files = {}
    for row in db.execute('SELECT record_id,name,sha256 FROM documents'):
        files.setdefault(row['record_id'], []).append((row['name'] or '', bool(row['sha256'] and row['sha256'] in manifest['files'])))
    for row in db.execute('SELECT id,kind,title,data,updated_at FROM records ORDER BY id'):
        item, detail = project_record(row, society, generation, files.get(row['id'], ()))
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
