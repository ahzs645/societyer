import {
  BrandedReportPdfDocument,
  type BrandedReportPdfProps,
} from "../financials/reports/BrandedReportPdfDocument";
import {
  payrollStatementReport,
  type PayrollStatement,
} from "../../../shared/payrollReporting";

export type PayrollStatementPdfProps = Omit<
  BrandedReportPdfProps,
  "report" | "includeGraphs"
> & { statement: PayrollStatement };
/** Native searchable payroll content, using the shared typography, logo, page and pagination pipeline. */
export function PayrollStatementPdfDocument({
  statement,
  ...props
}: PayrollStatementPdfProps) {
  return (
    <BrandedReportPdfDocument
      {...props}
      organization={{
        ...props.organization,
        name: statement.employer.name,
        address: statement.employer.address,
      }}
      report={payrollStatementReport(statement)}
      includeGraphs={false}
    />
  );
}
export async function buildPayrollStatementPdf({
  statement,
  ...props
}: PayrollStatementPdfProps): Promise<Uint8Array> {
  const { buildBrandedReportPdf } =
    await import("../financials/reports/reportPdf");
  return buildBrandedReportPdf({
    ...props,
    organization: {
      ...props.organization,
      name: statement.employer.name,
      address: statement.employer.address,
    },
    report: payrollStatementReport(statement),
    includeGraphs: false,
  });
}
