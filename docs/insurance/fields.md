# Insurance field guide

Start with one record for each term issued to the organization. Record the original wording and citation along with any classification used for matching. A missing amount, party or date stays unknown.

| Record | Fields to capture | What to check in the original |
| --- | --- | --- |
| Policy identity | Insurer, broker, policy number, named insured, policy kind, coverholder and broker customer number | Copy the legal name of the insured. A broker and an insurer can both appear on one page. |
| Term and renewal | Start, end, renewal date, term label, series key, version type, status | New terms have separate IDs. Preserve the prior term and its evidence. |
| Costs and exposures | Currency, term premium, policy fee, total invoiced cost, minimum retained premium percentage, billing method, declared operations and gross receipts | Keep the total premium on the term. Record a coverage allocation only when the source gives a breakdown. Keep currencies separate. |
| Coverage lines | Line ID, label, coverage type and code, limit, basis, deductible, currency, covered class, effective and expiry dates, form number, optional allocated premium, notes and citation | Record each occurrence, aggregate, per-claim or other basis as written. A line can have its own dates within a term. |
| Parties | Named insured, classes such as directors or volunteers, named additional insureds, limitations and sources | Record what the wording includes. An organization's use of volunteers alone does not establish volunteer coverage. |
| Locations, rooms and events | Insured premises, covered activities, event or room requirements, landlord and certificate details where captured | Check the premises and dates against the specific rental. |
| Definitions, exclusions and amendments | Terms defined in the policy, restrictions, endorsement or form number, affected coverage, wording and sources where available | Read the form and the declaration together. An endorsement listed on a schedule may still need its full wording. |
| Claims-made terms | Retroactive or continuity dates, reporting conditions, retentions and source wording | Keep the actual dates and triggering conditions. |
| Invoices | Reference, observed date, due date, amount, currency, policy links and review status | Review invoice dates independently of policy effective dates. A shared invoice needs separate allocation evidence before assigning its cost to one term. |
| Contractual requirement | Originating opportunity or agreement, quoted text, source, page or section, version, coverage, individual test, minimum, currency, basis, insured entity, beneficiary, coverage period, evidence stage and due date | Split independently testable obligations. Distinguish a submission deadline from a proof obligation at award or occupancy. |
| Confirmed evidence | Clause revision, policy, line, document and version IDs, supporting quote, page or section, reviewer and review time | Open the cited original. For additional-insured wording, check the named beneficiary and the grant of status. |

Monetary values in the reviewed JSON use integer cents. For example, CAD 2 million is stored as `200000000` with currency `CAD`. Calendar dates use `YYYY-MM-DD`. A required date range includes its final day. The coverage comparison treats the policy expiry date as the end of cover.

The reviewed bundle matches the source hash, policy number, start and end dates. A new scan or renewal needs a fresh source match. Earlier policy kinds and source labels remain readable. A broad legacy kind may describe a package without identifying its individual covered risks.

[Download the field guide workbook](insurance-field-guide.xlsx) · [Sample JSON with two terms and three coverage lines](examples/reviewed-fields.json) · [Organization insurance](README.md)
