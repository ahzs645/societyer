/**
 * Saving timeline date changes: the new dates show at once (an override on
 * top of the records), save through tasks:update, and offer Undo in the
 * toast. An override goes as soon as the records carry the same dates, when
 * the save fails, or a few seconds after it succeeds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useUndoableAction } from "../../../hooks/useUndoableAction";
import type { TaskRecord } from "../taskModel";
import { describeSchedule, schedulePatch, type DatePatch, type TaskSchedule } from "./timelineMath";
import type { TimelineTaskRow } from "./timelineRows";

type UpdatePatch = DatePatch & { clearFields?: "dueDate"[] };
/** Dates shown before the server confirms them; "" means cleared. */
type Override = { startDate?: string; dueDate?: string; token: number };

/** How long a confirmed override may outlive the save if the records lag. */
const OVERRIDE_GRACE_MS = 5000;

function withOverride(task: TaskRecord, override: Override | undefined): TaskRecord {
  if (!override) return task;
  const next: TaskRecord = { ...task };
  if (override.startDate !== undefined) next.startDate = override.startDate || undefined;
  if (override.dueDate !== undefined) next.dueDate = override.dueDate || undefined;
  return next;
}

function overrideMatches(task: TaskRecord, override: Override) {
  return (override.startDate === undefined || (task.startDate ?? "") === override.startDate)
    && (override.dueDate === undefined || (task.dueDate ?? "") === override.dueDate);
}

/**
 * `tasks` are the records with unsaved dates applied; `commit(row, next,
 * message)` saves the dates in `next` that differ from the row's (a null
 * leaves that date alone).
 */
export function useTimelineSaving(records: TaskRecord[], currentYear: number) {
  const update = useMutation(api.tasks.update);
  const undoable = useUndoableAction();
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const tokenRef = useRef(0);

  const tasks = useMemo(
    () => records.map((task) => withOverride(task, overrides[String(task._id)])),
    [records, overrides],
  );

  // Confirmed dates replace the shown ones as soon as the records carry them.
  useEffect(() => {
    setOverrides((current) => {
      const keys = Object.keys(current);
      if (keys.length === 0) return current;
      const byId = new Map(records.map((task) => [String(task._id), task]));
      let changed = false;
      const next: Record<string, Override> = {};
      for (const key of keys) {
        const task = byId.get(key);
        if (task && overrideMatches(task, current[key])) changed = true;
        else next[key] = current[key];
      }
      return changed ? next : current;
    });
  }, [records]);

  const send = useCallback(async (key: string, patch: UpdatePatch) => {
    tokenRef.current += 1;
    const token = tokenRef.current;
    const override: Override = { token };
    if (patch.startDate !== undefined) override.startDate = patch.startDate;
    if (patch.dueDate !== undefined) override.dueDate = patch.dueDate;
    if (patch.clearFields?.includes("dueDate")) override.dueDate = "";
    setOverrides((current) => ({ ...current, [key]: override }));
    const drop = () => setOverrides((current) => {
      if (current[key]?.token !== token) return current;
      const { [key]: _dropped, ...rest } = current;
      return rest;
    });
    try {
      await update({ id: key as Id<"tasks">, patch });
      // Normally the records catch up first; never hold dates the server didn't keep.
      window.setTimeout(drop, OVERRIDE_GRACE_MS);
    } catch (error) {
      drop();
      throw error;
    }
  }, [update]);

  const commit = useCallback((row: TimelineTaskRow, next: TaskSchedule, message: string) => {
    const patch = schedulePatch(row.schedule, next);
    if (patch.startDate === undefined && patch.dueDate === undefined) return;
    const { task } = row;
    // Undo restores the dates as they were, clearing a due date the change added.
    const undoPatch: UpdatePatch = {};
    if (patch.startDate !== undefined && task.startDate) undoPatch.startDate = task.startDate;
    if (patch.dueDate !== undefined) {
      if (task.dueDate) undoPatch.dueDate = task.dueDate;
      else undoPatch.clearFields = ["dueDate"];
    }
    const shown: TaskSchedule = { start: next.start ?? row.schedule.start, due: next.due ?? row.schedule.due };
    void undoable({
      message,
      description: `${task.title} · ${describeSchedule(shown, currentYear)}`,
      errorMessage: "Could not change the dates",
      dedupeKey: `task-dates-${row.key}`,
      run: () => send(row.key, patch),
      undo: () => send(row.key, undoPatch),
      undoneMessage: "Dates put back",
    });
  }, [currentYear, send, undoable]);

  return { tasks, commit };
}
