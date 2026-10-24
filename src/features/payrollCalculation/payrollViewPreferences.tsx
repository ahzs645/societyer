import { useEffect, useState } from "react";
import { useCurrentUserId } from "../../hooks/useCurrentUser";
import {
  cleanPayrollViewPreferences,
  payrollViewPreferenceKey,
  payrollView,
  type PayrollViewId,
  type PayrollViewPreferences,
} from "./payrollViewRegistry";

function readPreference(key: string | null) {
  if (!key) return cleanPayrollViewPreferences(null);
  try {
    const raw = localStorage.getItem(key);
    return cleanPayrollViewPreferences(
      raw && raw.length <= 8192 ? JSON.parse(raw) : null,
    );
  } catch {
    return cleanPayrollViewPreferences(null);
  }
}
export function usePayrollViewPreferences(societyId: string) {
  const userId = useCurrentUserId(),
    key = userId ? payrollViewPreferenceKey(societyId, userId) : null;
  const [state, setState] = useState(() => ({
    key,
    preferences: readPreference(key),
    error: "",
  }));
  const current =
    state.key === key
      ? state
      : { key, preferences: readPreference(key), error: "" };
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key)
        setState({ key, preferences: readPreference(key), error: "" });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  function update(
    change: (previous: PayrollViewPreferences) => PayrollViewPreferences,
  ) {
    setState((previous) => {
      const preferences = cleanPayrollViewPreferences(
        change(
          previous.key === key ? previous.preferences : readPreference(key),
        ),
      );
      let error = "";
      try {
        if (key) localStorage.setItem(key, JSON.stringify(preferences));
        else
          error =
            "Sign in to retain these presentation preferences for your user.";
      } catch {
        error =
          "Browser storage is unavailable; these presentation preferences apply to this tab.";
      }
      return { key, preferences, error };
    });
  }
  return {
    preferences: current.preferences,
    error: current.error,
    update,
    reset: () => update(() => cleanPayrollViewPreferences(null)),
  };
}
export function PayrollViewSettings({
  preferences,
  onChange,
  onReset,
  error,
}: {
  preferences: PayrollViewPreferences;
  onChange: (
    change: (previous: PayrollViewPreferences) => PayrollViewPreferences,
  ) => void;
  onReset: () => void;
  error: string;
}) {
  function toggle(
    key: "hidden" | "favorites",
    id: PayrollViewId,
    value: boolean,
  ) {
    onChange((previous) => ({
      ...previous,
      [key]: value
        ? [...previous[key], id]
        : previous[key].filter((old) => old !== id),
    }));
  }
  function move(id: PayrollViewId, direction: -1 | 1) {
    onChange((previous) => {
      const order = [...previous.order],
        from = order.indexOf(id),
        to = from + direction;
      if (from <= 0 || to <= 0 || to >= order.length) return previous;
      [order[from], order[to]] = [order[to], order[from]];
      return { ...previous, order };
    });
  }
  return (
    <details className="payroll-calculator__notice">
      <summary>Customize payroll views</summary>
      <p>
        Visibility, order, favorites and expanded sections are saved for your
        user and workspace in this browser. Calculate stays available. Direct
        links to registered views continue to work.
      </p>
      {error && <p role="status">{error}</p>}
      <div className="payroll-calculator__table-wrap">
        <table className="table" aria-label="Payroll view preferences">
          <thead>
            <tr>
              <th>View</th>
              <th>Visible</th>
              <th>Favorite</th>
              <th>Order</th>
            </tr>
          </thead>
          <tbody>
            {preferences.order.map((id, index) => {
              const view = payrollView(id);
              return (
                <tr key={id}>
                  <th scope="row">{view.label}</th>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Show ${view.label}`}
                        checked={!preferences.hidden.includes(id)}
                        disabled={view.required}
                        onChange={(event) =>
                          toggle("hidden", id, !event.target.checked)
                        }
                      />
                      {view.required ? "Required" : "Shown in navigation"}
                    </label>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Favorite ${view.label}`}
                      checked={preferences.favorites.includes(id)}
                      onChange={(event) =>
                        toggle("favorites", id, event.target.checked)
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={`Move ${view.label} up`}
                      disabled={view.required || index <= 1}
                      onClick={() => move(id, -1)}
                    >
                      Up
                    </button>{" "}
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={`Move ${view.label} down`}
                      disabled={
                        view.required || index === preferences.order.length - 1
                      }
                      onClick={() => move(id, 1)}
                    >
                      Down
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn--sm" onClick={onReset}>
        Reset payroll views
      </button>
    </details>
  );
}
