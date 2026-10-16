import assert from "node:assert/strict";
import { roleHolderInlinePatch } from "../src/lib/roleHolderInlineEdit";

// The share/right class is stored by name and by id; voting power reads the
// id. An inline edit of the name must keep the id in step (audit M7).
const classes = [
  { _id: "class_common", className: "Class A common" },
  { _id: "class_pref", className: "Class B preferred" },
];
const holder = { _id: "rh1", fullName: "Avery Chen", membershipClassName: "Class A common", membershipClassId: "class_common" };

const relinked = roleHolderInlinePatch(holder, "membershipClassName", "class b preferred", classes);
assert.equal(relinked.membershipClassName, "class b preferred");
assert.equal(relinked.membershipClassId, "class_pref", "typing another class's name links that class");

const unknown = roleHolderInlinePatch(holder, "membershipClassName", "Founders", classes);
assert.equal(unknown.membershipClassId, undefined, "a name matching no class drops the old class id");

const cleared = roleHolderInlinePatch(holder, "membershipClassName", "", classes);
assert.equal(cleared.membershipClassId, undefined, "clearing the name clears the id");

const noClasses = roleHolderInlinePatch(holder, "membershipClassName", "Class B preferred", undefined);
assert.equal(noClasses.membershipClassId, undefined, "without the class list, a changed name still drops the stale id");

const respaced = roleHolderInlinePatch(holder, "membershipClassName", "  class a COMMON ", undefined);
assert.equal(respaced.membershipClassId, "class_common", "case or spacing changes keep the same class");

const otherField = roleHolderInlinePatch(holder, "fullName", "Avery C.", classes);
assert.equal(otherField.membershipClassId, "class_common", "other fields leave the class alone");
assert.equal(otherField.fullName, "Avery C.");

console.log("role holder inline edit: ok");
