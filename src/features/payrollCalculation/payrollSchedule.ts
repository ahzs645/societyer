import type { PayrollRunType } from "../../../shared/payrollCalculation";

/** Ordinary scheduled payments use their actual date. An unscheduled payment
 * must never silently select the previous/next regular period for the user. */
export function payrollScheduleSelection({
  payDate,
  runType,
  payDates,
  selectedDate = "",
}: {
  payDate: string;
  runType: PayrollRunType;
  payDates: readonly string[];
  selectedDate?: string;
}) {
  const scheduled = payDates.includes(payDate);
  const showSelector = !scheduled && runType !== "regular";
  return {
    scheduled,
    showSelector,
    required: showSelector && (runType === "off_cycle" || runType === "final"),
    regularPayDate:
      showSelector && selectedDate && payDates.includes(selectedDate)
        ? selectedDate
        : undefined,
  };
}
