import { useLocation } from "react-router-dom";
import { Spotlight } from "./Spotlight";

/**
 * One-time tip pointing at a record table's "Group" toolbar button. Mounted
 * once in the app shell and re-keyed per page, so it waits for a table
 * toolbar on whichever page the user opens next. Anchored tips never show on
 * phones, and only one tip is on screen at a time.
 */
export function GroupBySpotlight() {
  const { pathname } = useLocation();
  return (
    <Spotlight
      key={pathname}
      spotlightKey="record-table-group-by"
      anchor='[data-record-table-action="group"]'
      placement="bottom"
      title="Group rows by any field — totals per group"
    >
      Select Group to fold this table into sections by status, date, owner or any other field. Each group shows its row count and the total of every amount column.
    </Spotlight>
  );
}
