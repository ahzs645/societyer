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
            counts = exporter.export(root/'catalog.sqlite', dict(snapshotId='snapshot', publishedAt='2026-10-18', counts={'opportunity':1},files={sha:dict(bytes=123,parts=0)}), 'workspace', 'folder', root, 'dates-v2')
            self.assertEqual(json.loads((root/'activation.json').read_text())['generation'], 'snapshot-dates-v2')
            self.assertEqual(counts, dict(procurementRecords=1, procurementDetails=1, procurementDocuments=1))
            document = json.loads((root/'procurementDocuments.jsonl').read_text())
            self.assertTrue(document['available']); self.assertEqual(document['bytes'],123)
            self.assertNotIn('content',document); self.assertNotIn('text',document)
            with zipfile.ZipFile(root/'metadata.zip') as archive:
                self.assertEqual(len(archive.namelist()),3)
                content = b''.join(archive.read(name) for name in archive.namelist())
                self.assertNotIn(b'BINARY_SENTINEL',content); self.assertNotIn(b'EXTRACTED_TEXT_SENTINEL',content)
            self.assertEqual(json.loads((root/'activation.json').read_text())['expected'],counts)

    def test_sortable_dates(self):
        cases = {
            '2026-10-30': '2026-10-30',
            '2026-10-30 2:00:00 PM (Pacific)': '2026-10-30T14:00',
            '2026-10-21T21:00:00Z': '2026-10-21T14:00',
            '2026-10-21T14:00:00-07:00': '2026-10-21T14:00',
            'Wed Oct 7, 2026 3:00 PM (PDT)': '2026-10-07T15:00',
            'Tue Oct 27, 2026 4:00:59 PM (PDT)': '2026-10-27T16:00',
            '10/05/26 2:00pm': '2026-10-05T14:00',
            'October 30, 2026': '2026-10-30',
            'submissions can be received at any time': '',
            '2026-02-30': '',
        }
        for raw, expected in cases.items(): self.assertEqual(exporter.sortable_date(raw), expected, raw)

    def test_projection_sorts_by_closing_and_keeps_source_text(self):
        row = dict(id='opportunity:bidsandtenders:x:1', kind='opportunity', title='Pool', updated_at='', data=json.dumps(dict(closingDate='Wed Oct 7, 2026 3:00 PM (PDT)', closingAt='2026-10-07T22:00:00.000Z', issueDate='2026-09-01')))
        item, _ = exporter.project_record(row, 'workspace', 'g')
        self.assertEqual((item['date'], item['dateText']), ('2026-10-07T15:00', 'Wed Oct 7, 2026 3:00 PM (PDT)'))
        row['data'] = json.dumps(dict(closingDate='submissions can be received at any time'))
        item, _ = exporter.project_record(row, 'workspace', 'g')
        self.assertEqual((item['date'], item['dateText']), ('', 'submissions can be received at any time'))
        award = dict(id='award:1', kind='award', title='Award', updated_at='', data=json.dumps(dict(awardDate='2026-09-02', issueDate='2026-08-01')))
        self.assertEqual(exporter.project_record(award, 'workspace', 'g')[0]['date'], '2026-09-02')

if __name__ == '__main__': unittest.main()
