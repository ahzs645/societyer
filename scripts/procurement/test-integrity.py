"""Regression cases for incomplete publications and exact incremental planning."""
import importlib.util, json, pathlib, sqlite3, tempfile, unittest, hashlib
from integrity import ALL_TABLES, validate_export, seal_export, canonical
from delta import plan_delta

spec = importlib.util.spec_from_file_location('exporter', pathlib.Path(__file__).with_name('export-convex.py'))
exporter = importlib.util.module_from_spec(spec); spec.loader.exec_module(exporter)

def fixture(directory, keys=('award:1',), complete=True, title='Award'):
    directory.mkdir()
    db = sqlite3.connect(directory/'source.sqlite')
    db.execute('CREATE TABLE records(id TEXT PRIMARY KEY,kind,title,data,updated_at)')
    db.execute('CREATE TABLE documents(id,record_id,url,name,media_type,sha256,status)')
    for key in keys:
        db.execute('INSERT INTO records VALUES(?,?,?,?,?)',(key,'award',title,json.dumps(dict(successfulSupplier='Supplier',contractValue='1,200.50',currency='CAD',awardDate='2026-10-01')),'2026-10-20'))
    db.commit(); db.close()
    exporter.export(directory/'source.sqlite',dict(snapshotId=directory.name,publishedAt='2026-10-21',collectedAt='2026-10-20',counts={'award':len(keys)},files={},catalog={'sha256':'a'*64},coverage={'complete':complete,'sources':[{'source':'test','complete':complete}]}),'workspace','folder',directory)
    return validate_export(directory)

class IntegrityTests(unittest.TestCase):
    def test_verified_empty_files_are_present_and_importable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary); activation=fixture(root/'target')
            self.assertEqual(set(activation['tables']),set(ALL_TABLES))
            for table in ('procurementDocuments','procurementEvidence','procurementTaxonomyTerms'):
                self.assertEqual(activation['tables'][table]['rowCount'],0)
                self.assertEqual((root/'target'/(table+'.jsonl')).read_bytes(),b'')

    def test_every_missing_or_corrupt_baseline_and_target_file_fails_before_plan(self):
        for side in ('baseline','target'):
            for table in ALL_TABLES:
                for corruption in ('missing','corrupt'):
                    with self.subTest(side=side,table=table,corruption=corruption), tempfile.TemporaryDirectory() as temporary:
                        root=pathlib.Path(temporary); fixture(root/'baseline'); fixture(root/'target')
                        path=root/side/(table+'.jsonl')
                        if corruption=='missing': path.unlink()
                        else: path.write_bytes(path.read_bytes()+b'{}\n')
                        with self.assertRaises((ValueError,FileNotFoundError)): plan_delta(root/'baseline',root/'target')
                        self.assertFalse((root/'target'/'delta.jsonl').exists())

    def test_complete_removals_and_unchanged_replay(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary); fixture(root/'baseline',('award:1','award:2')); fixture(root/'target')
            plan=plan_delta(root/'baseline',root/'target')
            self.assertEqual(plan['formatVersion'],2)
            self.assertEqual(plan['operations'],2)
            self.assertEqual(plan['changes']['procurementDetails']['archived'],1)
            first=(root/'target'/'delta.jsonl').read_bytes()
            self.assertEqual(plan_delta(root/'baseline',root/'target'),plan)
            self.assertEqual((root/'target'/'delta.jsonl').read_bytes(),first)

    def test_incomplete_coverage_never_permits_archival(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary); fixture(root/'baseline',('award:1','award:2')); fixture(root/'target',complete=False)
            with self.assertRaisesRegex(ValueError,'complete source/window coverage'): plan_delta(root/'baseline',root/'target')
            self.assertFalse((root/'target'/'delta.jsonl').exists())

    def test_relationships_are_checked_even_when_hashes_and_declared_counts_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary); activation=fixture(root/'target')
            (root/'target'/'procurementDetails.jsonl').write_bytes(b'')
            activation['expected']['procurementDetails']=0
            seal_export(root/'target',activation)
            with self.assertRaisesRegex(ValueError,'relationship mismatch'): validate_export(root/'target')

    def test_archive_bytes_are_bound_to_the_verified_table_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary); fixture(root/'target')
            path=root/'target'/'metadata.zip'; path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError,'Archive integrity mismatch'): validate_export(root/'target')

    def test_upstream_envelope_inventory_detects_omitted_evidence_before_projection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary)
            entry=dict(type='record',record=dict(id='award:1',kind='award',title='Award',updatedAt='',data={}))
            raw=(canonical(entry)+'\n').encode(); path=root/'review.jsonl';path.write_bytes(raw)
            tables={table:dict(path='review.jsonl.gz#'+table,present=True,rowCount=0,bytes=0,sha256=hashlib.sha256(b'').hexdigest()) for table in ('records','documents','taxonomy',*exporter.EVIDENCE_TABLES)}
            tables['records'].update(rowCount=1,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
            review=dict(schemaVersion=1,tables=tables,inventoryHash=hashlib.sha256(canonical(dict(schemaVersion=1,tables=tables)).encode()).hexdigest())
            exporter.validate_compact_source(path,review)
            tables['reviews'].update(rowCount=1,bytes=100,sha256='a'*64)
            review['inventoryHash']=hashlib.sha256(canonical(dict(schemaVersion=1,tables=tables)).encode()).hexdigest()
            with self.assertRaisesRegex(ValueError,'source table integrity mismatch: reviews'): exporter.validate_compact_source(path,review)

if __name__=='__main__': unittest.main()
