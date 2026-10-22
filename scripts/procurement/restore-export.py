#!/usr/bin/env python3
"""Prepare an append-only restore of a backup's active procurement generation; no network writes."""
import argparse,collections,json,os,pathlib,zipfile,hashlib,datetime,math
from integrity import TABLES, canonical, seal_export, validate_export

def normalize_numbers(value):
    """Convex exports integral numbers as 1.0; use the same JSON form as JS/source projections.
    Embedded dataJson is source text and remains byte-for-byte unchanged.
    """
    if isinstance(value,float):
        if not math.isfinite(value): raise ValueError('Non-finite number in serving backup')
        return int(value) if value.is_integer() else value
    if isinstance(value,dict): return {key:normalize_numbers(item) for key,item in value.items()}
    if isinstance(value,list): return [normalize_numbers(item) for item in value]
    return value

def prepare(backup, society, output):
    os.umask(0o077)
    output.mkdir(mode=0o700,exist_ok=False)
    with zipfile.ZipFile(backup) as source:
        if source.testzip() is not None: raise ValueError('Backup integrity verification failed')
        with source.open('procurementCatalogs/documents.jsonl') as handle:
            catalogs=[json.loads(line) for line in handle if json.loads(line).get('societyId')==society]
        if len(catalogs)!=1: raise ValueError('Backup must have exactly one active catalog for this workspace')
        catalog=normalize_numbers({k:v for k,v in catalogs[0].items() if k not in ('_id','_creationTime')})
        if catalog.get('syncRunId'): raise ValueError('A backup captured during incremental import is not a completed publication')
        physical_generation=catalog.pop('storageGeneration',catalog['generation'])
        for key in ('activatedAt','tables','inventoryHash','archives','schemaVersion','searchReady'): catalog.pop(key,None)
        expected={}; kinds=collections.Counter()
        with zipfile.ZipFile(output/'metadata.zip','w',compression=zipfile.ZIP_DEFLATED) as target:
            for table in TABLES:
                count=0
                with source.open(table+'/documents.jsonl') as rows, target.open(table+'/documents.jsonl','w') as dest, (output/(table+'.jsonl')).open('wb') as local:
                    for line in rows:
                        row=normalize_numbers(json.loads(line))
                        if row.get('societyId')!=society or row.get('generation')!=physical_generation or row.get('archived'): continue
                        # Imported IDs are recreated; source keys and every stored field are preserved.
                        row={k:v for k,v in row.items() if k not in ('_id','_creationTime','archived','syncKey')}
                        row['generation']=catalog['generation']
                        line=(json.dumps(row,separators=(',',':'),ensure_ascii=False)+'\n').encode()
                        dest.write(line);local.write(line);count+=1
                        if table=='procurementRecords': kinds[row['kind']]+=1
                expected[table]=count
        if dict(kinds)!=catalog['counts'] or expected['procurementRecords']!=expected['procurementDetails']: raise ValueError('Backup catalog counts differ from its stored generation')
        terms=[]
        if catalog.get('taxonomyCount',0):
            with source.open('procurementTaxonomyTerms/documents.jsonl') as handle:
                terms=[{k:v for k,v in json.loads(line).items() if k not in ('_id','_creationTime')} for line in handle if json.loads(line).get('societyId')==society and json.loads(line).get('releaseId') in catalog.get('taxonomyReleases',[])]
        terms.sort(key=lambda row:(row['releaseId'],row['key']))
        (output/'procurementTaxonomyTerms.jsonl').write_text(''.join(canonical(row)+'\n' for row in terms))
        indexes=[]
        for release in sorted({row['releaseId'] for row in terms}):
            rows=[row for row in terms if row['releaseId']==release]
            content=''.join(canonical({k:v for k,v in row.items() if k!='societyId'})+'\n' for row in rows)
            content_hash=hashlib.sha256(content.encode()).hexdigest()
            indexes.append(dict(releaseId=release,contentHash=content_hash,count=len(rows)))
            with zipfile.ZipFile(output/('taxonomy-'+content_hash+'.zip'),'w',compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('procurementTaxonomyTerms/documents.jsonl',''.join(canonical(row)+'\n' for row in rows))
        if catalog.get('taxonomyCount',0)!=len(terms): raise ValueError('Backup taxonomy incomplete')
        catalog['taxonomyIndexes']=indexes
        with pathlib.Path(backup).open('rb') as handle:
            digest=hashlib.sha256()
            while chunk:=handle.read(1024*1024): digest.update(chunk)
        catalog['restoration']=dict(backupSha256=digest.hexdigest(),sourceGeneration=catalog['generation'],preparedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        activation=seal_export(output,dict(catalog,expected=expected))
        if not activation.get('contentHash'):
            activation['contentHash']=activation['inventoryHash']
            seal_export(output,activation)
        validate_export(output)
        return dict(generation=catalog['generation'],expected=expected)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup',required=True);parser.add_argument('--workspace',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    print(json.dumps(prepare(pathlib.Path(args.backup),args.workspace,pathlib.Path(args.output))))
