import importlib.util, json, pathlib, sqlite3, tempfile, unittest, zipfile
spec = importlib.util.spec_from_file_location('exporter', pathlib.Path(__file__).with_name('export-convex.py'))
exporter = importlib.util.module_from_spec(spec); spec.loader.exec_module(exporter)

class ExportTests(unittest.TestCase):
    def test_metadata_only_and_file_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); db = sqlite3.connect(root / 'catalog.sqlite')
            db.execute('CREATE TABLE records(id,kind,title,data,updated_at)')
            db.execute('CREATE TABLE documents(id,record_id,url,name,media_type,sha256,status,byte_length,content,text)')
            db.execute('INSERT INTO records VALUES (?,?,?,?,?)', ('opportunity:1','opportunity','Bridge',json.dumps(dict(issuedBy='Test City', descriptionText='Public notice', searchText='Bridge City')),'2026-10-18'))
            sha = 'a' * 64
            db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)', ('doc','opportunity:1','https://example.invalid/doc','test.pdf','application/pdf',sha,'ready',123,b'BINARY_SENTINEL','EXTRACTED_TEXT_SENTINEL'))
            db.commit(); db.close()
            counts = exporter.export(root/'catalog.sqlite', dict(snapshotId='snapshot', publishedAt='2026-10-18', counts={'opportunity':1},files={sha:dict(bytes=123,parts=0)}), 'workspace', 'folder', root)
            self.assertEqual(counts, dict(procurementRecords=1, procurementDetails=1, procurementDocuments=1))
            document = json.loads((root/'procurementDocuments.jsonl').read_text())
            self.assertTrue(document['available']); self.assertEqual(document['bytes'],123)
            self.assertNotIn('content',document); self.assertNotIn('text',document)
            with zipfile.ZipFile(root/'metadata.zip') as archive:
                self.assertEqual(len(archive.namelist()),3)
                content = b''.join(archive.read(name) for name in archive.namelist())
                self.assertNotIn(b'BINARY_SENTINEL',content); self.assertNotIn(b'EXTRACTED_TEXT_SENTINEL',content)
            self.assertEqual(json.loads((root/'activation.json').read_text())['expected'],counts)

if __name__ == '__main__': unittest.main()
