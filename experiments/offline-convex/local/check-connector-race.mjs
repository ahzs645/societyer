// Deterministic connector scheduling against the actual SDK SQLite/outbox.
// Transport results are staged; this check makes no backend business calls.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const uncaught = []; page.on('pageerror', error => uncaught.push(error.message));
  await page.goto('http://127.0.0.1:4194/meeting.html');
  const result = await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.ts');
    const { MeetingConnector } = await import('/src/meetingConnector.ts');
    const scope = { deployment: 'connector-race-only', issuer: 'test-only', subject: crypto.randomUUID(), societyId: crypto.randomUUID() };
    const db = await openDatabase(scope);
    try {
      const command = { version: 1, operationId: crypto.randomUUID(), meetingUuid: crypto.randomUUID(), baseRevision: 1, kind: 'edit-minutes', discussion: 'Concurrent accepted command' };
      await db.writeTransaction(async tx => {
        await tx.execute('INSERT INTO offlineMeetingCommands (id,society_id,body,_metadata) VALUES (?,?,?,?)', [command.operationId, scope.societyId, JSON.stringify(command), JSON.stringify({ scope, command })]);
        await tx.execute("INSERT INTO meetingCommandHistory (id,meeting_uuid,body,state) VALUES (?,?,?,'waiting')", [command.operationId, command.meetingUuid, JSON.stringify(command)]);
      });
      let signalStarted, rejectLate;
      const started = new Promise(resolve => { signalStarted = resolve; });
      const delayed = new Promise((_, reject) => { rejectLate = reject; });
      const accepted = { accepted: true, revision: 2, mappings: [{ table: 'minutes', uuid: crypto.randomUUID(), nativeId: 'retained-native-mapping' }], replay: false };
      const success = new MeetingConnector(scope, { applyCommand: async () => accepted }, () => true);
      const losing = new MeetingConnector(scope, { applyCommand: async () => { signalStarted(); return delayed; } }, () => true);
      const loser = losing.uploadData(db).catch(error => error.message);
      await started; await success.uploadData(db);
      rejectLate(new Error('Lost acknowledgement after other upload accepted'));
      const lateError = await loser;
      return { accepted, lateError, history: await db.getOptional('SELECT state,result FROM meetingCommandHistory WHERE id=?', [command.operationId]),
        pending: await db.getOptional('SELECT count(*) AS n FROM ps_crud') };
    } finally { await db.close(); }
  });
  assert.equal(result.lateError, 'Lost acknowledgement after other upload accepted');
  assert.equal(result.history.state, 'accepted'); assert.deepEqual(JSON.parse(result.history.result), result.accepted);
  assert.equal(result.pending.n, 0); assert.deepEqual(uncaught, []);
  writeFileSync(new URL('../../../artifacts/offline/connector-ack-race.json', import.meta.url), JSON.stringify({ timestamp: new Date().toISOString(), passed: true,
    check: 'Concurrent uploads: a later lost acknowledgement preserves already accepted receipt and native mappings', runtime: 'Actual PowerSync SDK SQLite and durable queue in Chromium; staged transport scheduling',
    limitations: ['This check stages transport responses; separate live tests qualify actual Convex receipts and replication'] }, null, 2) + '\n');
  console.log('PASS concurrent lost acknowledgement preserves accepted receipt/mappings and completed real SQLite queue');
} finally { await browser.close(); }
