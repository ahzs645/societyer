import assert from 'node:assert/strict';
import { inventoryFrontendWrites, inventoryExplicitDispatch } from './lib/frontendWriteInventory';
import { assertLocalWriteCapability } from '../src/lib/staticConvexParity';
const source = `
import {api as backend} from '@/lib/convexApi';
import {useMutation as mutate, useAction} from 'convex/react';
import {usePermissionedMutation as guarded} from '@/hooks/usePermissionedMutation';
import * as hooks from 'convex/react';
import * as endpoint from '../convex/_generated/api';
const update = backend.tasks.update;
const {create: createTask} = backend.tasks;
mutate(update); guarded(createTask, allowed);
hooks.useMutation(backend['tasks']['remove']);
useAction(endpoint.api.providers.remote.submit);
mutate(flag ? backend.tasks.update : backend.tasks.create);
const partial = flag ? backend.tasks.create : dynamicReference;
mutate(partial);
function shadow(mutate: any, backend: any) { mutate(backend.fake.write); }
client.mutation(backend.tasks.update, {});
client.action('provider:sync', {});
// useMutation(api.comment.notARealCall)
const fixture = 'api.another.fake';
`;
const result = inventoryFrontendWrites([{ fileName: '/src/fixture.ts', text: source }]);
assert.deepEqual([...result.refs.keys()].sort(), ['provider:sync', 'providers/remote:submit', 'tasks:create', 'tasks:remove', 'tasks:update']);
assert.equal(result.unresolved.length, 1, 'a partially dynamic conditional cannot be silently marked covered');
assert.match(result.unresolved[0], /mutate\(partial\)/);
assert.equal(inventoryFrontendWrites([{ fileName: '/src/dynamic.ts', text: `import {useMutation} from 'convex/react'; useMutation(dynamic);` }]).unresolved.length, 1);
const dispatch = inventoryExplicitDispatch([{ fileName: '/src/dispatch.ts', text: `
// if (name === 'fake:comment') return {};
console.log('fake:log'); const fixture = 'fake:fixture';
if (name === 'real:one') return doWrite();
if (['real:two', 'real:three'].includes(name)) throw new Error('Unsupported');
switch(name) { case 'real:four': return save(); }
` }]);
assert.deepEqual([...dispatch].sort(), ['real:four', 'real:one', 'real:three', 'real:two']);
assert.throws(() => assertLocalWriteCapability('meetingTranscription:editSegment'), /hosted|connected/i);
assert.doesNotThrow(() => assertLocalWriteCapability('tasks:update'));
console.log('Interaction write inventory checks passed: aliases, namespaces, wrappers, destructuring, computed names, shadowing, partial dynamics, explicit dispatch and local capability rejection.');
