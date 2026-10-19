import hashlib, importlib.util, json, pathlib, sqlite3, tempfile, unittest, zipfile
spec = importlib.util.spec_from_file_location('exporter', pathlib.Path(__file__).with_name('export-convex.py'))
exporter = importlib.util.module_from_spec(spec); spec.loader.exec_module(exporter)

class ExportTests(unittest.TestCase):
    def test_references_are_compact_and_shared_and_raw_notice_fields_are_omitted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); db = sqlite3.connect(root/'catalog.sqlite')
            db.execute('CREATE TABLE records(id TEXT PRIMARY KEY,kind,title,data,updated_at)')
            db.execute('CREATE TABLE documents(id,record_id,url,name,media_type,sha256,status)')
            rows = [
                ('opportunity:1', 'opportunity', dict(descriptionText='Notice', sourceDescriptionText='Notice', rawSourceData='RAW_SOURCE_SENTINEL', searchText='Notice City', classificationCodes=['110'], taxonomyReleaseId='release:1')),
                ('taxonomy:parent', 'taxonomy-term', dict(releaseId='release:1', scheme='UNSPSC', version='1', code='100', title='Parent', parentId=None, ancestors=[], definition='DEFINITION_SENTINEL')),
                ('taxonomy:child', 'taxonomy-term', dict(releaseId='release:1', scheme='UNSPSC', version='1', code='110', title='Child', parentId='taxonomy:parent', ancestors=['taxonomy:parent'])),
                ('taxonomy:unused', 'taxonomy-term', dict(releaseId='release:1', scheme='UNSPSC', version='1', code='999', title='Unused')),
            ]
            for key, kind, data in rows: db.execute('INSERT INTO records VALUES(?,?,?,?,?)',(key,kind,key,json.dumps(data),'2026-10-18'))
            db.commit(); db.close()
            manifest = dict(snapshotId='snapshot', publishedAt='2026-10-18', counts={'opportunity':1,'taxonomy-term':3}, files={})
            counts = exporter.export(root/'catalog.sqlite', manifest, 'workspace', 'folder', root)
            self.assertEqual(counts, dict(procurementRecords=1, procurementDetails=1))
            terms = [json.loads(line) for line in (root/'procurementTaxonomyTerms.jsonl').read_text().splitlines()]
            self.assertEqual({t['key'] for t in terms}, {'taxonomy:parent', 'taxonomy:child', 'taxonomy:unused'})
            self.assertTrue(all('generation' not in t and 'definition' not in t and 'ancestors' not in t for t in terms))
            detail = json.loads(json.loads((root/'procurementDetails.jsonl').read_text())['dataJson'])
            self.assertEqual(detail, {'sourceDescriptionText':'Notice'})
            activation = json.loads((root/'activation.json').read_text())
            self.assertEqual(activation['counts'], {'opportunity':1}); self.assertEqual(activation['taxonomyCount'],3)
            index = activation['taxonomyIndexes'][0]
            canonical = ''.join(json.dumps({k:v for k,v in t.items() if k != 'societyId'}, sort_keys=True, separators=(',', ':'), ensure_ascii=False)+'\n' for t in terms)
            self.assertEqual(hashlib.sha256(canonical.encode()).hexdigest(), index['contentHash'])
            with zipfile.ZipFile(root/('taxonomy-'+index['contentHash']+'.zip')) as archive:
                self.assertEqual(len(archive.read('procurementTaxonomyTerms/documents.jsonl').splitlines()),3)
            # The companion reader and legacy fallback produce equivalent imports.
            entries = [dict(type='record', record=dict(id='opportunity:1', kind='opportunity', title='opportunity:1', updatedAt='2026-10-18', data=exporter.notice_data(rows[0][2])))]
            entries += [dict(type='taxonomy',term={k:v for k,v in t.items() if k != 'societyId'}) for t in terms]
            companion = root/'review.jsonl'; companion.write_text('\n'.join(json.dumps(e) for e in entries)+'\n')
            other = root/'compact'; other.mkdir()
            manifest['review'] = dict(counts={'opportunity':1}, taxonomy=dict(sourceTerms=3,indexedTerms=3,referencedTerms=2,unresolvedReferences=0))
            exporter.export_review(companion, manifest, 'workspace', 'folder', other)
            self.assertEqual(json.loads((other/'activation.json').read_text())['contentHash'],activation['contentHash'])
            with zipfile.ZipFile(other/'metadata.zip') as archive: self.assertNotIn('procurementTaxonomyTerms/documents.jsonl',archive.namelist())

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
            listed = json.loads((root/'procurementRecords.jsonl').read_text())
            self.assertEqual((listed['documents'], listed['listedDocuments']), (1, 0), 'test.pdf is stored and published')
            self.assertLessEqual(len(listed.get('searchText', '')), 4000, 'Only short list columns support already-open paged-reader tabs')
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
            '30 Oct 2026': '2026-10-30',
            'October 24, 2026 at 2:00 PM': '2026-10-24T14:00',
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

    def test_list_fields(self):
        # Matches describeNotice in src/features/procurementReview/lib/notice.ts and NoticeDocuments.tsx.
        data = dict(issuedBy='BC Housing', issuedFor='Ministry of Housing', opportunityId='BCH-2026-0588',
                    attachments=[dict(name='RFP.pdf', url='https://example.invalid/1'), dict(name='Drawings.pdf', url='https://example.invalid/2'), 'Form A.docx', dict(title='')],
                    addenda=[dict(title='Addendum 1', link='https://example.invalid/3')])
        row = dict(id='opportunity:1', kind='opportunity', title='Tenant support', updated_at='', data=json.dumps(data))
        item, _ = exporter.project_record(row, 'workspace', 'g', [(' rfp.PDF ', True), ('Drawings.pdf', False), ('Extra.pdf', True)])
        self.assertEqual((item['issuedFor'], item['reference'], item['documents'], item['listedDocuments']), ('Ministry of Housing', 'BCH-2026-0588', 2, 2),
                         'Only published files count; a stored but unpublished file still answers to its listing; Form A and the addendum were never downloaded')
        self.assertEqual((item['supplier'], item['currency'], item['procurementType']), ('', '', ''))
        self.assertNotIn('value', item)
        same = dict(row, data=json.dumps(dict(issuedBy='City of Surrey', issuedFor='city of  surrey', opportunityId='bidsandtenders:surrey:abc', externalId='1220-030')))
        item, _ = exporter.project_record(same, 'workspace', 'g')
        self.assertEqual((item['issuedFor'], item['reference'], item['documents'], item['listedDocuments']), ('', '1220-030', 0, 0), 'The buyer issuing for itself is not repeated; a synthetic key falls through to the source\'s own number')
        synthetic = dict(row, data=json.dumps(dict(opportunityId='canadabuys:tender:ws123:000')))
        self.assertEqual(exporter.project_record(synthetic, 'workspace', 'g')[0]['reference'], '', 'A key Zoer made up is not a reference')
        award = dict(issuingOrganization='Ministry of Health', successfulSupplier='Cedar & Main', contractValue=148500, currency='cad', opportunityType='Request for Proposals', awardDate='2026-10-16')
        row = dict(id='award:1', kind='award', title='Evaluation', updated_at='', data=json.dumps(award))
        item, _ = exporter.project_record(row, 'workspace', 'g')
        self.assertEqual((item['organization'], item['supplier'], item['value'], item['currency'], item['procurementType'], item['date']), ('Ministry of Health', 'Cedar & Main', 148500, 'CAD', 'Request for Proposals', '2026-10-16'))
        for raw, text, expected in [(None, '$1,240,000.50', 1240000.5), ('64,800', '', 64800), (None, 'TBD', None), (True, '', None), (None, '-$2,500', -2500)]:
            row['data'] = json.dumps(dict(award, contractValue=raw, contractValueText=text))
            item, _ = exporter.project_record(row, 'workspace', 'g')
            self.assertEqual(item.get('value'), expected, (raw, text))

if __name__ == '__main__': unittest.main()
