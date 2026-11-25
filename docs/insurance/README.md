# Organization insurance

The insurance register belongs to the selected organization. Keep a separate record for each policy term, add the coverages it contains, and reuse those records when reviewing a bid or rental. A single renewal ZIP can contain several policies.

## Import a renewal

1. Open **Insurance** and select **Import renewal ZIP**. Choose the ZIP or drop it into the upload area. The upload opens in a centered dialog on desktop and a sheet on phones.
2. Enter the package currency from the original documents. Check which files to include. Select **Review** next to a declaration to inspect the policy fields and coverage lines. **Open original PDF** opens the exact file. Use **Back to files** to return to the same row.
3. Review invoices and supporting documents individually. Check which policy each belongs to. An invoice can establish a billed cost. Coverage limits need their own source. The optional reviewed-fields JSON attaches prior work to matching declarations from this ZIP.
4. Select **Continue**. Check the policy terms and number of originals, acknowledge the review, and select **Save reviewed renewal**. The receipt links to the import session. The register retains original document versions.
5. Open each policy to review its term status. The declaration import starts the term in **Needs review**. Mark it active when the organization has checked the coverage and dates.

If the original file store is unavailable, the import dialog explains the storage requirement. Manual entry is available under **New policy**. The editor has separate Policy, Coverage, Costs and Evidence views. **Record renewal** creates another term in the same series. **Archive** keeps the previous term accessible from its history.

### Try the example

The fictional Juniper Hall Society has two policies. Example Mutual covers commercial general liability at CAD 2 million each occurrence and CAD 5 million aggregate. Sample Assurance covers directors and officers at CAD 1 million per claim and aggregate. The ZIP contains both declarations and a CAD 900 invoice linked to the general liability term. The JSON supplies the reviewed line classifications and ties them to these exact PDFs. Use a local test workspace to follow the steps above.

[Example renewal ZIP](examples/example-renewal.zip) · [Reviewed fields for this ZIP](examples/reviewed-fields.json) · [Desktop and phone walkthrough](walkthrough.md)

## Check a bid or facility rental

Open the opportunity in **Procurement review**, or open the rental in **Agreements**. Select **Insurance requirements → Check against register**. Each saved clause shows its wording, source, review result and evidence stage. Hover over the information icon for a quick comparison or activate it with a click, tap or keyboard for details.

Under **Add requirements**, choose a published source, upload a PDF, DOCX or text file, or paste the wording. Enter the clause manually or explicitly choose **Find clauses with AI** when a provider is available. A reviewer can edit a suggestion, choose which clauses to save and return to the checks. Closing and reopening the dialog on the same record preserves an unfinished draft during that visit.

| Example obligation | What the reviewer sees |
| --- | --- |
| A bid asks for CAD 3 million general liability each occurrence. | The CAD 2 million occurrence line is below the minimum. The CAD 5 million aggregate line has a different basis. |
| The bid also requires professional liability. | The obligation appears even when the register has no corresponding coverage. |
| The buyer asks for a certificate at award. | The clause shows the award stage and recipient. Confirmation requires suitable evidence for that party. |
| A rental asks for CAD 1 million each occurrence for two days within the policy term. | The reviewer can open the applicable policy line, select its supporting declaration, cite the page and record the wording. |
| The landlord also needs additional-insured status. | Record a separate clause. Check wording that grants that status to the landlord. A certificate holder entry alone leaves the requirement unresolved. |

A match identifies a candidate policy line. **Evidence confirmed** records a reviewer’s decision against a specific document version. If the policy or evidence changes, reopen the check and review the quoted wording again.

[Field guide](fields.md) · [Implementation and verification](verification.md)
