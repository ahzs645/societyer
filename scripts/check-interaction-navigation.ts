import assert from 'node:assert/strict';
import { transactionDeepLink } from '../src/features/financials/transactions/transactionDeepLink';
import { transcriptLink, linkedTranscriptRange, transcriptSearch } from '../src/features/meetings/transcript/transcriptLinks';
import { canPinFavorite, orderedFavoriteRoutes } from '../src/lib/favoriteProjection';
const cases = [
  { locationHref: 'https://example.test/app/financials', runtimeMode: 'web' as any, baseUrl: '/', demo: false },
  { locationHref: 'https://example.test/societyer/app/financials', runtimeMode: 'web' as any, baseUrl: '/societyer/', demo: false },
  { locationHref: 'https://example.test/demo/app/financials', runtimeMode: 'web' as any, baseUrl: '/', demo: true },
  { locationHref: 'file:///Applications/Societyer/index.html?obsolete=1#/app/financials?tab=old', runtimeMode: 'electron-local' as const, demo: false },
];
for (const options of cases) {
  const url = new URL(transactionDeepLink('txn:space & /', 'workspace:a&b', options));
  const route = options.runtimeMode === 'electron-local' ? new URL(url.hash.slice(1), 'https://route.test') : url;
  assert.equal(route.searchParams.get('tab'), 'transactions');
  assert.equal(route.searchParams.get('transactionId'), 'txn:space & /');
  assert.equal(route.searchParams.get('societyId'), 'workspace:a&b');
  assert.match(route.pathname, /\/app\/financials$/);
  const transcript = new URL(transcriptLink(12.5, 24.75, { pathname: '/app/meetings/test-id', search: '?tab=minutes&societyId=scope' }, options));
  const target = options.runtimeMode === 'electron-local' ? new URL(transcript.hash.slice(1), 'https://route.test') : transcript;
  assert.equal(target.searchParams.get('tab'), 'transcript');
  assert.equal(target.searchParams.get('societyId'), 'scope');
  assert.deepEqual(linkedTranscriptRange(target.search), { start: 12.5, end: 24.75 });
  if (options.runtimeMode === 'electron-local') assert.equal(transcript.search, '', 'no outer browser query can hide a router query');
  else assert.ok(target.pathname.startsWith(options.demo ? '/demo/app' : `${options.baseUrl?.replace(/\/$/, '')}/app`));
}
assert.deepEqual(linkedTranscriptRange(transcriptSearch('?tab=motions', { startSec: 1, endSec: 2 })), { start: 1, end: 2 });
assert.equal(linkedTranscriptRange('?t=10-2'), null);
assert.equal(linkedTranscriptRange('?t=Infinity'), null);
const routes = new Set(['/app/tasks', '/app/meetings']); const commands = new Set(['new-task']);
assert.equal(canPinFavorite({ id: 'page', to: '/app/tasks' }, routes, commands), true);
assert.equal(canPinFavorite({ id: 'record', to: '/app/tasks?taskId=1' }, routes, commands), false);
assert.equal(canPinFavorite({ id: 'new-task', run() {} }, routes, commands), true);
assert.equal(canPinFavorite({ id: 'dynamic', run() {} }, routes, commands), false);
const allowed = Array.from({ length: 5 }, (_, index) => ({ to: `/app/${index}`, label: String(index) }));
const order = [4, 0, 1, 2, 3].map(index => ({ kind: 'route' as const, id: `/app/${index}` }));
assert.deepEqual(orderedFavoriteRoutes(order, allowed).slice(0, 4).map(row => row.label), ['4', '0', '1', '2']);
assert.deepEqual(orderedFavoriteRoutes(order, allowed.filter(row => row.label !== '4')).slice(0, 4).map(row => row.label), ['0', '1', '2', '3']);
assert.equal(orderedFavoriteRoutes([...order, order[0]], allowed).length, 5);
assert.deepEqual(orderedFavoriteRoutes([{ kind: 'command', id: 'new-task' }, { kind: 'view', viewsKey: 'tasks', viewId: 'x' }, ...order], allowed), orderedFavoriteRoutes(order, allowed));
console.log('Interaction navigation checks passed: root/base/demo/hash round trips, workspace/time range, durable pin eligibility, filtered ordered phone tabs.');
