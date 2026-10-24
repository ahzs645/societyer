import {
  payrollStatementCsv,
  payrollStatementReport,
  type PayrollStatement,
} from "../../../shared/payrollReporting";
import { ReportPdfDownload } from "../financials/reports/ReportPdfDownload";
import { useFinancePermissions } from "../../hooks/useFinancePermissions";
import { triggerBlobDownload } from "../../lib/zip";

export function PayrollStatementActions({
  societyId,
  statement,
  disabled = false,
}: {
  societyId: string;
  statement: PayrollStatement;
  disabled?: boolean;
}) {
  const { canExport } = useFinancePermissions();
  const report = payrollStatementReport(statement);
  const filename = `Pay statement ${statement.statementNumber}`.replace(
    /[^a-z0-9 _-]/gi,
    "_",
  );
  return (
    <div className="form-stack">
      <ReportPdfDownload
        societyId={societyId}
        report={report}
        filename={filename}
        label="Download pay statement PDF"
        organizationOverride={{
          name: statement.employer.name,
          address: statement.employer.address,
        }}
        disabled={disabled || !canExport}
      />
      <button
        type="button"
        className="btn btn--sm"
        disabled={disabled || !canExport}
        onClick={() =>
          triggerBlobDownload(
            new Blob([payrollStatementCsv(statement)], {
              type: "text/csv;charset=utf-8",
            }),
            `${filename}.csv`,
          )
        }
      >
        Export pay statement CSV
      </button>
    </div>
  );
}
