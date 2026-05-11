import { useState } from "react";
import { Modal } from "./Modal";
import { Button, Banner } from "./ui";
import { Plus, Trash2 } from "lucide-react";
import type {
  AppliedFilter,
  FilterField,
  FilterGroup,
  FilterRuleNode,
  FilterOperator,
} from "./FilterBar";
import { OPERATOR_LABELS } from "./FilterBar";

function emptyRule(fields: FilterField[]): AppliedFilter {
  const first = fields[0];
  return {
    fieldId: first?.id ?? "",
    value: "",
    operator: first?.operators?.[0] ?? (first?.options ? "is" : "contains"),
  };
}

export function AdvancedFilterModal({
  open,
  onClose,
  fields,
  initial,
  onApply,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  fields: FilterField[];
  initial: FilterGroup | null;
  onApply: (group: FilterGroup) => void;
  onClear: () => void;
}) {
  const [group, setGroup] = useState<FilterGroup>(
    () => initial ?? { op: "and", rules: [{ kind: "rule", rule: emptyRule(fields) }] },
  );

  const updateRule = (path: number[], patch: Partial<AppliedFilter>) => {
    setGroup((prev) => mutate(prev, path, (node) => {
      if (node.kind !== "rule") return node;
      return { kind: "rule", rule: { ...node.rule, ...patch } };
    }));
  };
  const updateGroupOp = (path: number[], op: "and" | "or") => {
    setGroup((prev) => mutateGroup(prev, path, (g) => ({ ...g, op })));
  };
  const addRule = (path: number[]) => {
    setGroup((prev) => mutateGroup(prev, path, (g) => ({
      ...g,
      rules: [...g.rules, { kind: "rule", rule: emptyRule(fields) }],
    })));
  };
  const addGroup = (path: number[]) => {
    setGroup((prev) => mutateGroup(prev, path, (g) => ({
      ...g,
      rules: [...g.rules, { kind: "group", group: { op: "and", rules: [{ kind: "rule", rule: emptyRule(fields) }] } }],
    })));
  };
  const removeAt = (path: number[]) => {
    if (path.length === 0) return;
    const parent = path.slice(0, -1);
    const index = path[path.length - 1];
    setGroup((prev) => mutateGroup(prev, parent, (g) => ({
      ...g,
      rules: g.rules.filter((_, i) => i !== index),
    })));
  };

  return (
    <Modal open={open} onClose={onClose} title="Advanced filter" size="lg">
      <div className="advanced-filter">
        <Banner tone="info">
          Build rules with nested AND/OR groups. Apply to replace any existing chip filters.
        </Banner>
        <GroupEditor
          group={group}
          path={[]}
          fields={fields}
          updateRule={updateRule}
          updateGroupOp={updateGroupOp}
          addRule={addRule}
          addGroup={addGroup}
          removeAt={removeAt}
        />
        <div className="advanced-filter__footer">
          <Button onClick={onClear} variant="ghost">Clear</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={() => { onApply(group); onClose(); }}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

function GroupEditor({
  group,
  path,
  fields,
  updateRule,
  updateGroupOp,
  addRule,
  addGroup,
  removeAt,
}: {
  group: FilterGroup;
  path: number[];
  fields: FilterField[];
  updateRule: (path: number[], patch: Partial<AppliedFilter>) => void;
  updateGroupOp: (path: number[], op: "and" | "or") => void;
  addRule: (path: number[]) => void;
  addGroup: (path: number[]) => void;
  removeAt: (path: number[]) => void;
}) {
  return (
    <div className="advanced-filter__group">
      <div className="advanced-filter__group-head">
        <select
          className="input"
          value={group.op}
          onChange={(e) => updateGroupOp(path, e.target.value as "and" | "or")}
          style={{ width: 80 }}
        >
          <option value="and">AND</option>
          <option value="or">OR</option>
        </select>
        <span className="muted">match {group.op === "and" ? "all" : "any"} of the following</span>
        <div style={{ flex: 1 }} />
        <Button size="sm" onClick={() => addRule(path)}><Plus size={12} /> Rule</Button>
        <Button size="sm" onClick={() => addGroup(path)}><Plus size={12} /> Group</Button>
        {path.length > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Remove group"
            onClick={() => removeAt(path)}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="advanced-filter__rules">
        {group.rules.map((node, i) => {
          const nodePath = [...path, i];
          if (node.kind === "group") {
            return (
              <GroupEditor
                key={i}
                group={node.group}
                path={nodePath}
                fields={fields}
                updateRule={updateRule}
                updateGroupOp={updateGroupOp}
                addRule={addRule}
                addGroup={addGroup}
                removeAt={removeAt}
              />
            );
          }
          const rule = node.rule;
          const field = fields.find((f) => f.id === rule.fieldId);
          const ops: FilterOperator[] =
            field?.operators ?? (field?.options ? ["is", "is_not"] : ["contains", "equals", "starts_with"]);
          return (
            <div key={i} className="advanced-filter__rule">
              <select
                className="input"
                value={rule.fieldId}
                onChange={(e) => updateRule(nodePath, { fieldId: e.target.value, value: "" })}
              >
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              <select
                className="input"
                value={rule.operator ?? ops[0]}
                onChange={(e) => updateRule(nodePath, { operator: e.target.value as FilterOperator })}
                style={{ width: 120 }}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                ))}
              </select>
              {field?.options ? (
                <select
                  className="input"
                  value={rule.value}
                  onChange={(e) => updateRule(nodePath, { value: e.target.value })}
                >
                  <option value="">—</option>
                  {field.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={rule.value}
                  onChange={(e) => updateRule(nodePath, { value: e.target.value })}
                  placeholder="Value"
                />
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label="Remove rule"
                onClick={() => removeAt(nodePath)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function mutate(group: FilterGroup, path: number[], fn: (node: FilterRuleNode) => FilterRuleNode): FilterGroup {
  if (path.length === 0) return group;
  const [head, ...rest] = path;
  return {
    ...group,
    rules: group.rules.map((node, i) => {
      if (i !== head) return node;
      if (rest.length === 0) return fn(node);
      if (node.kind !== "group") return node;
      return { kind: "group", group: mutate(node.group, rest, fn) };
    }),
  };
}

function mutateGroup(group: FilterGroup, path: number[], fn: (g: FilterGroup) => FilterGroup): FilterGroup {
  if (path.length === 0) return fn(group);
  const [head, ...rest] = path;
  return {
    ...group,
    rules: group.rules.map((node, i) => {
      if (i !== head) return node;
      if (node.kind !== "group") return node;
      return { kind: "group", group: mutateGroup(node.group, rest, fn) };
    }),
  };
}
