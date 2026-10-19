"""Deterministic, lossless delta between two verified metadata exports."""
import hashlib,json,pathlib
TABLES=('procurementRecords','procurementDetails','procurementDocuments','procurementEvidence')
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def clean(row): return {k:v for k,v in row.items() if k not in ('societyId','generation','_id','_creationTime')}
def key_for(table,row):
 if table=='procurementDocuments': return row['documentKey']
 if table=='procurementEvidence':
  data=json.loads(row['dataJson']); identity=data.get('id')
  if identity is None: identity=hashlib.sha256(canonical(data).encode()).hexdigest()
  return canonical([row['recordKey'],row['source'],identity])
 return row['recordKey']
def inventory(directory,table):
 path=pathlib.Path(directory)/(table+'.jsonl'); rows={}
 if not path.exists(): return rows
 with path.open('rb') as source:
  while True:
   offset=source.tell();line=source.readline()
   if not line: break
   row=json.loads(line);key=key_for(table,row)
   if key in rows: raise ValueError('Duplicate incremental key: '+table+' '+key)
   rows[key]=(offset,hashlib.sha256(canonical(clean(row)).encode()).hexdigest())
 return rows
def plan_delta(baseline,current):
 baseline,current=pathlib.Path(baseline),pathlib.Path(current)
 if baseline.resolve()==current.resolve(): raise ValueError('Keep the previous successful export separately')
 old=json.loads((baseline/'activation.json').read_text()); new=json.loads((current/'activation.json').read_text())
 if old['societyId']!=new['societyId'] or old['folder']!=new['folder']: raise ValueError('Baseline belongs to a different workspace/folder')
 if old.get('profileVersion')!=2 or new.get('profileVersion')!=2: raise ValueError('Incremental import requires compact profile v2')
 digest=hashlib.sha256(); counts={}; operations=0
 with (current/'delta.jsonl').open('w') as out:
  for table in TABLES:
   before,after=inventory(baseline,table),inventory(current,table); changed=removed=0
   def row_at(directory,entry):
    if entry is None: return None
    with (directory/(table+'.jsonl')).open('rb') as source:
     source.seek(entry[0]);return json.loads(source.readline())
   for key in sorted(set(before)|set(after)):
    old_entry,new_entry=before.get(key),after.get(key)
    if old_entry is not None and new_entry is not None and old_entry[1]==new_entry[1]: continue
    prior,row=row_at(baseline,old_entry),row_at(current,new_entry)
    op=dict(table=table,key=key,recordKey=(row or prior)['recordKey'],row=row,before=prior)
    line=canonical(op)+'\n'; out.write(line);digest.update(line.encode());operations+=1
    if row is None: removed+=1
    else: changed+=1
   counts[table]=dict(upserts=changed,archived=removed)
 manifest=dict(formatVersion=1,baseContentHash=old['contentHash'],baseGeneration=old['generation'],societyId=new['societyId'],folder=new['folder'],targetContentHash=new['contentHash'],operations=operations,sha256=digest.hexdigest(),changes=counts)
 (current/'delta-manifest.json').write_text(canonical(manifest)+'\n')
 return manifest
