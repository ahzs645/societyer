/** Real React hooks in isolated tab realms, with only auth/query transport stubbed. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setMaxListeners } from "node:events";
import vm from "node:vm";
import path from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const renderer = process.env.SOCIETYER_TEST_RENDERER_PATH || require.resolve("react-test-renderer");
const entry = `
import React, {useLayoutEffect} from 'react';
import {create, act} from ${JSON.stringify(renderer)};
import * as society from ${JSON.stringify(path.join(root, "src/hooks/useSociety.ts"))};
import * as user from ${JSON.stringify(path.join(root, "src/hooks/useCurrentUser.ts"))};
let tree;
function Reader(){
  const s=society.useSocietySelection(); const u=user.useCurrentUserId(); const current=user.useCurrentUser();
  return React.createElement('span', null, [s.societyId,u,current?.role].join(':'));
}
function SwitchOnMount(){useLayoutEffect(()=>{society.setStoredSocietyId('b')},[]);return null}
export function setup(ids, options={}){
  globalThis.fixture={...options,societies:ids.map(id=>({_id:id,name:id}))};
  user.setPrincipalUsers(ids.map(id=>({_id:'user-'+id,role:id==='a'?'Owner':'Admin'})));
  society.setMembershipSocietyIds(ids.map(id=>({societyId:id,userId:'user-'+id})));
  act(()=>{tree=create(React.createElement(React.Fragment,null,...Array.from({length:5},(_,key)=>React.createElement(Reader,{key})),options.switchOnMount?React.createElement(SwitchOnMount):null))});
}
export function select(id){let result;act(()=>{result=society.setStoredSocietyId(id)});return result}
export function receive(event){act(()=>window.dispatchEvent(event))}
export function snapshot(){const nodes=tree.toJSON();return (Array.isArray(nodes)?nodes:[nodes]).map(n=>n.children[0])}
export function unmount(){act(()=>tree.unmount())}
export {society,user};
`;
const { outputFiles } = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "transport-fixtures", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve("react") }));
    b.onResolve({ filter: /AuthProvider$|^convex\/react$|authMode$|staticRuntime$|useLocalWorkspaceReady$|useRecordQuery$|^@\/lib\/convexApi$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ loader: "js", contents:
      a.path.includes("AuthProvider") ? 'export function useAuth(){return {mode:globalThis.fixture.mode??"convex",isConvexAuthenticated:true,membershipStatus:"bound",societies:globalThis.fixture.societies}}' :
      a.path === "convex/react" ? 'export function useQuery(){return globalThis.fixture.societies}' :
      a.path.includes("authMode") ? 'export function getAuthMode(){return globalThis.fixture?.mode??"convex"}' :
      a.path.includes("staticRuntime") ? 'export function isLocalDataRuntime(){return globalThis.fixture?.local===true};export function isStaticDemoRuntime(){return globalThis.fixture?.demo===true}' :
      a.path.includes("useLocalWorkspaceReady") ? 'export function useLocalWorkspaceReady(){return true}' :
      a.path.includes("useRecordQuery") ? 'export function useRecordQuery(){return undefined}' : 'export const api={society:{list:"list"},users:{get:"get"}}',
    }));
  } }],
});
const SOCIETY = "societyer.currentSocietyId", USER = "societyer.currentUserId";
function environment(initial = [[SOCIETY, "a"], [USER, "user-a"]]) {
  const values = new Map(initial), tabs = [], events = [];
  let failWrites = false;
  function tab() {
    const window = new EventTarget(); setMaxListeners(0, window);
    const t = { window }, module = { exports: {} }; tabs.push(t);
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (failWrites) throw new Error("Storage unavailable"); if (values.get(key) === value) return; values.set(key, value); events.push([t, key]); },
      removeItem(key) { if (failWrites) throw new Error("Storage unavailable"); if (values.delete(key)) events.push([t, key]); },
    };
    vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, require, console, process, Event, EventTarget, setTimeout, clearTimeout, setImmediate, clearImmediate, performance, window, localStorage: storage });
    t.api = module.exports;
    return t.api;
  }
  function flush() {
    let count = 0;
    while (events.length) {
      assert.ok(++count < 100, "Workspace preference events must settle");
      const [origin, key] = events.shift();
      for (const t of tabs) {
        if (t === origin) continue;
        const event = new Event("storage"); Object.defineProperty(event, "key", { value: key }); t.api.receive(event);
      }
    }
  }
  return { values, tab, flush, failWrites: () => { failWrites = true; }, close: () => tabs.forEach(t => t.api.unmount()) };
}
function shows(tab, expected) { assert.ok(tab.snapshot().every(row => row === expected), `Every reader must show ${expected}; got ${tab.snapshot()}`); }

// Reproduces the invitation email opening a new tab while the old tab knows
// only the person's original workspace. The previous code reverted both to A.
const env = environment(), old = env.tab(), invited = env.tab();
old.setup(["a"]); invited.setup(["a", "b"]); env.flush();
assert.equal(invited.select("b"), true); env.flush();
shows(invited, "b:user-b:Admin"); shows(old, "a:user-a:Owner");
assert.equal(env.values.get(SOCIETY), "b"); assert.equal(env.values.get(USER), "user-b");
// Even stale getters must not erase a newer tab's saved choice.
old.society.getStoredSocietyId(); old.user.getStoredUserId(); env.flush();
assert.equal(env.values.get(SOCIETY), "b");
// Reload/new tab remembers the last valid choice, preserving its own role.
const reload = env.tab();
assert.equal(reload.society.getStoredSocietyId(), null, "Unresolved access stays closed");
assert.equal(env.values.get(SOCIETY), "b", "Hydration retains the durable preference");
reload.setup(["a", "b"]); shows(reload, "b:user-b:Admin");
assert.equal(invited.select("foreign"), false); env.flush(); shows(invited, "b:user-b:Admin");
assert.equal(env.values.get(SOCIETY), "b", "A rejected selection does not clear the active workspace");
old.select("a"); env.flush(); shows(invited, "b:user-b:Admin");
invited.select("a"); env.flush(); shows(invited, "a:user-a:Owner");
invited.select("b"); env.flush(); shows(invited, "b:user-b:Admin");
env.failWrites(); assert.equal(invited.select("a"), true); shows(invited, "a:user-a:Owner"); env.close();

// A selection made before passive subscriptions attach must still reach all
// readers; useSyncExternalStore checks the snapshot when subscribing.
const mount = environment(), duringMount = mount.tab(); duringMount.setup(["a", "b"], { switchOnMount: true });
shows(duringMount, "b:user-b:Admin"); mount.close();
const local = environment(), localTab = local.tab(); localTab.setup(["a", "b"], { mode: "none", local: true });
localTab.select("b"); assert.ok(localTab.snapshot().every(row => row.startsWith("b:"))); local.close();
const demo = environment(), demoTab = demo.tab(); demoTab.setup(["a", "b"], { mode: "none", local: true, demo: true });
demoTab.select("b"); assert.equal(demo.values.get("societyer.demo.currentSocietyId"), "b"); assert.equal(demo.values.get(SOCIETY), "a"); demo.close();
console.log("Workspace selection passed: stale invitation tab cannot undo switching; per-tab workspace/user/role consistency; reload persistence; unknown membership denial; hydration and mount timing; unavailable storage; local and demo compatibility.");
