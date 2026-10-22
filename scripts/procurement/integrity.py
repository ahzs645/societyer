"""Fail-closed validation for a private, complete procurement projection export."""
import hashlib, json, pathlib, re, zipfile

TABLES = ('procurementRecords', 'procurementDetails', 'procurementDocuments', 'procurementEvidence')
ALL_TABLES = (*TABLES, 'procurementTaxonomyTerms')

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)

def digest(data): return hashlib.sha256(data).hexdigest()

def parse_json(data):
    def invalid(value): raise ValueError('Non-finite JSON value: '+value)
    return json.loads(data,parse_constant=invalid)

def file_entry(path):
    data = path.read_bytes()
    return dict(path=path.name, rowCount=len(data.splitlines()), bytes=len(data), sha256=digest(data))

def seal_export(directory, activation):
    """Called by exporters only after each handle and archive has been closed."""
    directory = pathlib.Path(directory)
    for table in ALL_TABLES:
        (directory / (table + '.jsonl')).touch(exist_ok=True)
    activation['schemaVersion'] = 1
    activation['tables'] = {table: file_entry(directory / (table + '.jsonl')) for table in ALL_TABLES}
    activation['inventoryHash'] = digest(canonical(dict(schemaVersion=1, tables=activation['tables'])).encode())
    activation['archives'] = {path.name: dict(bytes=path.stat().st_size, sha256=digest(path.read_bytes())) for path in sorted(directory.glob('*.zip'))}
    activation.setdefault('coverage', dict(complete=False, sources=[]))
    (directory / 'activation.json').write_text(canonical(activation) + '\n', encoding='utf-8')
    return activation

def archive_eligible(activation):
    coverage = activation.get('coverage')
    return isinstance(coverage, dict) and coverage.get('complete') is True and isinstance(coverage.get('sources'), list) and all(isinstance(source, dict) and source.get('complete') is True for source in coverage['sources'])

def validate_export(directory, require_archives=True):
    """Never interpret absent files as empty. Validate before creating any delta."""
    directory = pathlib.Path(directory)
    activation = parse_json((directory / 'activation.json').read_text())
    if not all(isinstance(activation.get(key),str) and 0<len(activation[key])<=500 for key in ('societyId','generation','folder','publishedAt')): raise ValueError('Invalid publication scope or timestamp')
    if activation.get('profileVersion') == 2 and (not activation.get('sourceSnapshotId') or not re.fullmatch('[a-f0-9]{64}', activation.get('sourceCatalogSha256','')) or not re.fullmatch('[a-f0-9]{64}',activation.get('contentHash',''))): raise ValueError('Invalid compact source provenance')
    if set(activation.get('expected',{}))!=set(TABLES) or any(type(count) is not int or count<0 for count in activation['expected'].values()) or any(kind not in ('opportunity','award') or type(count) is not int or count<0 for kind,count in activation.get('counts',{}).items()) or sum(activation.get('counts',{}).values())<1: raise ValueError('Invalid expected table or notice counts')
    if not isinstance(activation.get('coverage'),dict) or type(activation['coverage'].get('complete')) is not bool or not isinstance(activation['coverage'].get('sources'),list): raise ValueError('Invalid coverage declaration')
    for source in activation['coverage']['sources']:
        if not isinstance(source,dict) or not isinstance(source.get('source'),str) or type(source.get('complete')) is not bool: raise ValueError('Invalid source coverage')
    if activation.get('schemaVersion') != 1 or set(activation.get('tables', {})) != set(ALL_TABLES):
        raise ValueError('A verified five-table inventory is required; re-export legacy publications before importing')
    tables = activation['tables']
    if activation.get('inventoryHash') != digest(canonical(dict(schemaVersion=1, tables=tables)).encode()):
        raise ValueError('Publication inventory hash mismatch')
    rows = {}
    for table in ALL_TABLES:
        entry = tables[table]
        if entry.get('path') != table + '.jsonl' or not all(type(entry.get(k)) is int and entry[k] >= 0 for k in ('rowCount', 'bytes')) or not re.fullmatch('[a-f0-9]{64}', entry.get('sha256', '')):
            raise ValueError('Invalid table inventory: ' + table)
        path = directory / entry['path']
        if not path.is_file() or path.is_symlink(): raise ValueError('Required export table missing or unsafe: ' + table)
        data = path.read_bytes()
        if len(data) != entry['bytes'] or digest(data) != entry['sha256']: raise ValueError('Table integrity mismatch: ' + table)
        parsed = []
        for line in data.splitlines():
            if len(line)>800000: raise ValueError('Projection row exceeds safe document size: '+table)
            row = parse_json(line)
            if not isinstance(row, dict) or row.get('societyId') != activation['societyId'] or (table != 'procurementTaxonomyTerms' and row.get('generation') != activation['generation']):
                raise ValueError('Unscoped export row: ' + table)
            if any(key in row for key in ('_id', '_creationTime', 'archived', 'syncKey')): raise ValueError('Serving-only fields in source export: ' + table)
            parsed.append(row)
        if len(parsed) != entry['rowCount']: raise ValueError('Table row count mismatch: ' + table)
        if table in TABLES and activation.get('expected', {}).get(table) != len(parsed): raise ValueError('Expected table count mismatch: ' + table)
        rows[table] = parsed
    records = {row['recordKey']: row for row in rows['procurementRecords']}
    if len(records) != len(rows['procurementRecords']): raise ValueError('Duplicate record key')
    details = {row['recordKey'] for row in rows['procurementDetails']}
    if details != set(records) or len(details) != len(rows['procurementDetails']): raise ValueError('Record/detail relationship mismatch')
    kinds = {}
    for row in records.values(): kinds[row['kind']] = kinds.get(row['kind'], 0) + 1
    if {k:v for k,v in activation['counts'].items() if v} != kinds: raise ValueError('Notice kind count mismatch')
    for table in TABLES[1:]:
        for row in rows[table]:
            if row['recordKey'] not in records: raise ValueError('Orphaned ' + table + ' row')
            if 'dataJson' in row and not isinstance(parse_json(row['dataJson']), dict): raise ValueError('Invalid structured evidence or detail payload')
    documents = [row['documentKey'] for row in rows['procurementDocuments']]
    if len(set(documents)) != len(documents): raise ValueError('Duplicate document key')
    evidence = []
    for row in rows['procurementEvidence']:
        identity=parse_json(row['dataJson']).get('id')
        if identity is not None and not (isinstance(identity,str) or not isinstance(identity,bool) and isinstance(identity,(int,float)) and identity == int(identity) and abs(identity)<=9007199254740991): raise ValueError('Invalid evidence identity')
        if isinstance(identity,float): identity=int(identity)
        evidence.append((row['recordKey'],row['source'],canonical(identity) if identity is not None else digest(row['dataJson'].encode())))
    if len(set(evidence)) != len(evidence): raise ValueError('Duplicate evidence key')
    terms = {(row['releaseId'], row['key']) for row in rows['procurementTaxonomyTerms']}
    if len(terms) != len(rows['procurementTaxonomyTerms']) or activation.get('taxonomyCount', 0) != len(terms): raise ValueError('Taxonomy inventory mismatch')
    for row in rows['procurementTaxonomyTerms']:
        if row.get('parentKey') is not None and (row['releaseId'], row['parentKey']) not in terms: raise ValueError('Orphaned taxonomy parent')
    indexes=activation.get('taxonomyIndexes',[])
    if len(indexes)>32 or len({index['releaseId'] for index in indexes})!=len(indexes) or any(not isinstance(index.get('releaseId'),str) or not index['releaseId'] or type(index.get('count')) is not int or index['count']<1 or not re.fullmatch('[a-f0-9]{64}',index.get('contentHash','')) for index in indexes) or sum(index['count'] for index in indexes)!=len(terms) or sorted(activation.get('taxonomyReleases',[]))!=sorted(index['releaseId'] for index in indexes): raise ValueError('Invalid taxonomy release inventory')
    if require_archives:
        archives = activation.get('archives', {})
        if 'metadata.zip' not in archives: raise ValueError('Metadata archive inventory missing')
        for name, entry in archives.items():
            if name != pathlib.Path(name).name or not name.endswith('.zip'): raise ValueError('Unsafe archive path')
            path = directory / name
            if not path.is_file() or path.is_symlink() or path.stat().st_size != entry.get('bytes') or digest(path.read_bytes()) != entry.get('sha256'): raise ValueError('Archive integrity mismatch: ' + name)
        with zipfile.ZipFile(directory / 'metadata.zip') as archive:
            if set(archive.namelist()) != {table + '/documents.jsonl' for table in TABLES}: raise ValueError('Metadata archive table inventory mismatch')
            for table in TABLES:
                if digest(archive.read(table + '/documents.jsonl')) != tables[table]['sha256']: raise ValueError('Archive differs from verified table: ' + table)
        for index in activation.get('taxonomyIndexes', []):
            name = 'taxonomy-' + index['contentHash'] + '.zip'
            if name not in archives: raise ValueError('Taxonomy archive inventory missing')
            expected = b''.join((canonical({k:v for k,v in row.items() if k != 'societyId'})+'\n').encode() for row in rows['procurementTaxonomyTerms'] if row['releaseId'] == index['releaseId'])
            if digest(expected) != index['contentHash'] or len(expected.splitlines()) != index['count']: raise ValueError('Taxonomy release inventory mismatch')
            with zipfile.ZipFile(directory / name) as archive:
                actual = [parse_json(line) for line in archive.read('procurementTaxonomyTerms/documents.jsonl').splitlines()]
                if actual != [row for row in rows['procurementTaxonomyTerms'] if row['releaseId'] == index['releaseId']]: raise ValueError('Taxonomy archive differs from inventory')
    return activation
