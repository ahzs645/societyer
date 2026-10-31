/** S03: ordinary and paged exports obey identical confidentiality decisions. */
import assert from 'node:assert/strict';
import { loadPagedTranscript } from '../shared/pagedTranscriptExport';
import { exportTranscriptWithPolicy } from '../shared/transcriptExportPolicy';
import { TRANSCRIPT_DOWNLOAD_FORMATS } from '../shared/transcriptExport';
import type { TranscriptSegment } from '../shared/transcriptModel';
const segment = (text: string, startSec: number, endSec: number): TranscriptSegment => ({ speaker: 'SPEAKER_00', text, startSec, endSec, words: [{ text, startSec, endSec }] });
const pages = [
  { segments: [segment('PUBLIC_START', 0, 9), segment('SECRET_FIRST_PAGE', 10, 19)] },
  { segments: [segment('SECRET_SECOND_PAGE', 20, 29), segment('PUBLIC_END', 30, 39)] },
];
const speakers = [{ label: 'SPEAKER_00', name: 'Synthetic Speaker' }];
const minutes = { sessionSegments: [{ type: 'in_camera', title: 'Confidential', recordingStartSec: 10, recordingEndSec: 30 }] };
const unmarked = { sections: [{ type: 'in_camera', title: 'Unmarked session' }] };
const loaded = await loadPagedTranscript({ pageCount: pages.length, speakers, loadPage: async index => pages[index], signal: new AbortController().signal });
const ordinary = { segments: pages.flatMap(page => page.segments), speakers };
for (const { id } of TRANSCRIPT_DOWNLOAD_FORMATS) {
  const options = { minutes, canIncludeInCamera: false, consent: { includeInCamera: false, acknowledgeUnmarked: false } };
  const file = exportTranscriptWithPolicy(loaded, id, options);
  assert.equal(file.content, exportTranscriptWithPolicy(ordinary, id, options).content);
  assert.match(file.content, /PUBLIC_START/); assert.match(file.content, /PUBLIC_END/);
  assert.doesNotMatch(file.content, /SECRET_FIRST_PAGE|SECRET_SECOND_PAGE/);
  assert.equal(file.inCameraCount, 1, 'a confidential run spanning pages is one redaction');
  assert.throws(() => exportTranscriptWithPolicy(loaded, id, { ...options, consent: { includeInCamera: true, acknowledgeUnmarked: false } }), /access/);
  assert.match(exportTranscriptWithPolicy(loaded, id, { ...options, canIncludeInCamera: true, consent: { includeInCamera: true, acknowledgeUnmarked: false } }).content, /SECRET_SECOND_PAGE/);
  for (const canIncludeInCamera of [true, false]) {
    assert.throws(() => exportTranscriptWithPolicy(loaded, id, { ...options, minutes: unmarked, canIncludeInCamera }), /unmarked/);
  }
  assert.throws(() => exportTranscriptWithPolicy(loaded, id, { ...options, minutes: unmarked, consent: { includeInCamera: false, acknowledgeUnmarked: true } }), /unmarked/);
  assert.match(exportTranscriptWithPolicy(loaded, id, { ...options, minutes: unmarked, canIncludeInCamera: true, consent: { includeInCamera: false, acknowledgeUnmarked: true } }).content, /PUBLIC_START/);
  assert.throws(() => exportTranscriptWithPolicy(loaded, id, { ...options, minutes: undefined }), /load/);
  console.log(`✓ ${id}: complete multi-page export, cross-page redaction, authority, explicit inclusion and unmarked-session acknowledgement`);
}
const opts = { pageCount: 2, speakers, loadPage: async (index: number) => pages[index], signal: new AbortController().signal };
await assert.rejects(() => loadPagedTranscript({ ...opts, loadPage: async index => { if (index === 1) throw new Error('Injected page failure'); return pages[index]; } }), /Injected/);
await assert.rejects(() => loadPagedTranscript({ ...opts, byteLimit: 2 }), /limit/);
await assert.rejects(() => loadPagedTranscript({ ...opts, pageCount: 0 }), /count/);
await assert.rejects(() => loadPagedTranscript({ ...opts, loadPage: async () => null as any }), /unavailable/);
const abort = new AbortController(); let fetched = 0;
await assert.rejects(() => loadPagedTranscript({ ...opts, signal: abort.signal, loadPage: async index => { fetched++; abort.abort(); return pages[index]; } }), /abort/i);
assert.equal(fetched, 1, 'cancellation after a page never fetches or emits the remaining content');
console.log('Interaction transcript export checks passed.');
