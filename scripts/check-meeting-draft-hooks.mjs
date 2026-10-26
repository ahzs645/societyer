/** Real React draft hooks; only auth, runtime and browser storage are fixtures. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const entry = `
import React from 'react';
import {create, act} from ${JSON.stringify(require.resolve("react-test-renderer"))};
import {MeetingDraftScopeContext, useMeetingDraftScope} from ${JSON.stringify(path.join(root, "src/features/meetings/useMeetingDraft.tsx"))};
import {useMeetingFormDraft} from ${JSON.stringify(path.join(root, "src/features/meetings/useMeetingFormDraft.ts"))};
import {meetingDraftIdentityKey} from ${JSON.stringify(path.join(root, "src/features/meetings/lib/meetingDraftStore.ts"))};
let tree, latest;
function Editor() {
  latest = useMeetingFormDraft('test-editor', v => !!v && typeof v.text === 'string', v => !!v && typeof v.expected === 'string');
  return React.createElement('span', null, latest.value?.text ?? 'saved view');
}
function Reader() {
  const f = globalThis.fixture;
  const scope = useMeetingDraftScope(f.meetingId, f.societyId, f.userId);
  return React.createElement(MeetingDraftScopeContext.Provider, {value:scope}, React.createElement(Editor, {key:scope ? meetingDraftIdentityKey(scope.identity) : 'locked'}));
}
export function mount() { act(() => { tree=create(React.createElement(Reader)) }); }
export function changeFixture(patch) { Object.assign(globalThis.fixture,patch);act(() => tree.update(React.createElement(Reader))); }
export function write(text) { act(() => { if(!latest.value)latest.controller.begin({text:''},{expected:'original'});latest.controller.change({text}); }); }
export function restoreFirst() { act(() => latest.controller.restore(latest.recovery.journal.recover(latest.recovery.recoveries[0]))); }
export function journal() { return latest.recovery.journal; }
export function snapshot() { return {text:tree.toJSON().children[0],count:latest.recovery.recoveries.length,error:latest.recovery.error,durable:latest.recovery.savedOnDevice}; }
export function unmount() { act(() => tree.unmount()); }
`;
const { outputFiles } = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", write: false,
  define: { "import.meta.env.VITE_CONVEX_URL": JSON.stringify("https://synthetic.invalid") },
  plugins: [{ name: "identity-fixtures", setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve("react") }));
    build.onResolve({ filter: /AuthProvider$|useCurrentUser$|useSociety$|staticRuntime$|runtimeMode$|components\/(Modal|Toast)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents:
      args.path.endsWith("AuthProvider") ? `export const useAuth=()=>({mode:fixture.mode,session:fixture.accountId?{user:{id:fixture.accountId}}:null,isAuthenticated:fixture.authenticated,membershipStatus:fixture.membershipStatus});` :
      args.path.endsWith("useCurrentUser") ? `export const getStoredUserId=()=>fixture.verifiedUserId;` :
      args.path.endsWith("useSociety") ? `export const getStoredSocietyId=()=>fixture.verifiedSocietyId;` :
      args.path.endsWith("staticRuntime") ? `export const isStaticDemoRuntime=()=>fixture.demo;export const isLocalDataRuntime=()=>fixture.local||fixture.demo;` :
      args.path.endsWith("runtimeMode") ? `export const getRuntimeMode=()=>fixture.runtime;` :
      args.path.endsWith("Modal") ? `export const useConfirm=()=>async()=>true;` : `export const useToast=()=>({error(){}});`,
    }));
  } }],
});

const values = new Map();
let blocked = false;
const storage = {
  get length() { return values.size; },
  key: index => [...values.keys()][index] ?? null,
  getItem: key => { if (blocked) throw new Error("Storage blocked"); return values.get(key) ?? null; },
  setItem: (key, value) => { if (blocked) throw new Error("Storage blocked"); values.set(key, value); },
  removeItem: key => values.delete(key),
};
const fixture = { mode: "none", authenticated: true, membershipStatus: "bound", accountId: null, userId: "user-a", societyId: "workspace-a", meetingId: "meeting-a", verifiedUserId: "user-a", verifiedSocietyId: "workspace-a", local: true, demo: false, runtime: "convex-self-hosted" };
const window = new EventTarget(); window.localStorage = storage;
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, require, console, process, window, fixture, setTimeout, clearTimeout, setImmediate, clearImmediate, performance });
const app = module.exports;
app.mount();
assert.ok(app.journal(), "bound no-auth local workspaces enable scoped recovery");
app.write("Local draft before navigation");
assert.equal(app.snapshot().durable, true);
const previous = app.journal();
app.unmount(); app.mount();
assert.equal(app.snapshot().count, 1);
assert.equal(app.snapshot().text, "saved view", "mounting never silently restores a draft");
app.restoreFirst();
assert.equal(app.snapshot().text, "Local draft before navigation");

app.changeFixture({ authenticated: false });
assert.equal(app.journal(), null);
assert.equal(app.snapshot().text, "saved view");
assert.equal(previous.isActive(), false);
assert.ok(values.size > 0, "signout keeps durable copies");
app.changeFixture({ authenticated: true, membershipStatus: "loading" });
assert.equal(app.journal(), null, "unresolved membership cannot read drafts");
app.changeFixture({ membershipStatus: "bound" });
assert.equal(app.snapshot().count, 1);

app.changeFixture({ demo: true });
assert.equal(app.snapshot().count, 0, "demo cannot recover a local workspace draft with the same IDs");
app.write("Demo draft");
app.changeFixture({ demo: false, local: false, mode: "convex", accountId: "account-a" });
assert.equal(app.snapshot().count, 0, "live Convex cannot recover demo or browser-local drafts");
app.write("Hosted draft");
const hosted = app.journal();
app.changeFixture({ accountId: "account-b" });
assert.equal(app.snapshot().count, 0);
assert.equal(hosted.isActive(), false);
app.changeFixture({ accountId: "account-a", verifiedSocietyId: "workspace-b" });
assert.equal(app.journal(), null, "the selected workspace must match the verified membership");
app.changeFixture({ verifiedSocietyId: "workspace-a" });
assert.equal(app.snapshot().count, 1);

blocked = true;
app.write("Keystrokes while storage is blocked");
assert.equal(app.snapshot().text, "Keystrokes while storage is blocked");
assert.equal(app.snapshot().durable, false);
assert.match(app.snapshot().error, /Keep this editor open/);
app.unmount();
console.log("Meeting draft React hooks: explicit restore, local/demo/hosted isolation, verified account/workspace transitions, signout retention and blocked storage passed.");
