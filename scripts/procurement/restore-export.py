#!/usr/bin/env python3
"""Prepare an append-only restore of a backup's active procurement generation; no network writes."""
import argparse,collections,json,os,pathlib,zipfile

def prepare(backup, society, output):
    os.umask(0o077)
    output.mkdir(mode=0o700,exist_ok=False)
    with zipfile.ZipFile(backup) as source:
        if source.testzip() is not None: raise ValueError('Backup integrity verification failed')
        with source.open('procurementCatalogs/documents.jsonl') as handle:
            catalogs=[json.loads(line) for line in handle if json.loads(line).get('societyId')==society]
        if len(catalogs)!=1: raise ValueError('Backup must have exactly one active catalog for this workspace')
        catalog={k:v for k,v in catalogs[0].items() if k not in ('_id','_creationTime')}
        expected={}; kinds=collections.Counter()
        with zipfile.ZipFile(output/'metadata.zip','w',compression=zipfile.ZIP_DEFLATED) as target:
            for table in ('procurementRecords','procurementDetails','procurementDocuments','procurementEvidence'):
                count=0
                with source.open(table+'/documents.jsonl') as rows, target.open(table+'/documents.jsonl','w') as dest:
                    for line in rows:
                        row=json.loads(line)
                        if row.get('societyId')!=society or row.get('generation')!=catalog['generation']: continue
                        # Imported IDs are recreated; source keys and every stored field are preserved.
                        row={k:v for k,v in row.items() if k not in ('_id','_creationTime')}
                        dest.write((json.dumps(row,separators=(',',':'),ensure_ascii=False)+'\n').encode());count+=1
                        if table=='procurementRecords': kinds[row['kind']]+=1
                expected[table]=count
        if dict(kinds)!=catalog['counts'] or expected['procurementRecords']!=expected['procurementDetails']: raise ValueError('Backup catalog counts differ from its stored generation')
        (output/'activation.json').write_text(json.dumps(dict(catalog,expected=expected)))
        return dict(generation=catalog['generation'],expected=expected)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup',required=True);parser.add_argument('--workspace',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    print(json.dumps(prepare(pathlib.Path(args.backup),args.workspace,pathlib.Path(args.output))))
