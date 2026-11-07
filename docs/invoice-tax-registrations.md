# Invoice seller tax registrations

## Organization setup

Save seller numbers under **Organization → Identifiers** as separate **GST/HST registration** and **BC PST registration** records. Use `active` only for a confirmed registration and record its effective date when known. `needs_review` and `inactive` entries are not selected for invoices. The active-status field is a user-maintained assertion; Societyer does not query a government registry to verify a number.

The GST/HST format is a nine-digit business number followed by `RT` and a four-digit account reference, for example `123456789RT0001`. A business-number identifier containing that complete account is accepted for compatibility; a bare nine-digit business number is not promoted to a tax account. The format follows [CRA GST/HST memorandum 2-1, paragraphs 52–54 and Example 3](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/2-1/required-registration.html).

BC PST uses `PST-1234-5678`, as described under “After you register” in [BC's registration guidance](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/register). The selector normalizes spaces, separators and letter case. The PST identifier kind is explicitly for British Columbia; other provinces and countries need their own reviewed registration definitions.

An older generic `sales_tax` identifier is not guessed to be federal or provincial. Edit it to the specific registration kind after checking the original registration. More than one distinct eligible number for the same tax leaves that tax unselected. The user must resolve the ambiguity instead of Societyer choosing a branch account automatically.

## Invoice lifecycle

`shared/invoiceTaxRegistrations.ts` resolves eligible numbers using the invoice's issue date, any provided registration effective date, and the user's active-status declaration. **The effective-date field is optional.** When it is absent, the selector retains compatibility by accepting an otherwise eligible active entry; this is not verification that the registration was effective on a historical invoice date. A provided future or invalid effective date is excluded. The existing identifier model has no expiry date or historical status timeline. It cannot reconstruct a previously active registration from an entry now marked inactive.

First issue through `markSentPortable`, or a first settlement that issues a draft, records `issuerTaxRegistrationsSnapshot` on the invoice. Its fields are `capturedAtISO`, `effectiveDate`, and `registrations[]`, whose entries carry `taxId`, `label`, `number`, and optional `jurisdiction`. An empty registrations array records that no eligible numbers were selected. Changes to the organization do not update this snapshot. Duplicating an invoice starts a new draft without the previous snapshot.

Confirmed guided lines that collect `CA-GST` or `CA-BC-PST` require the corresponding eligible seller number before any invoice ledger writes. Existing manual tax rates remain compatible and do not gain that new issuance blocker. Storing a number alone never assigns a tax rate, exemption or collection obligation to an item.

A guided standard taxable item cannot claim non-collection based on a seller-registration exception while an eligible active registration for that tax exists. This conflict must be reviewed before issue, including when multiple eligible branch numbers make automatic number selection ambiguous. Genuine exempt, zero-rated, not-subject and customer-relief treatments are unaffected by this conflict check.

Manual recurring delivery freezes these numbers when its outgoing document is prepared, then preserves the same snapshot when the provider's acceptance is finalized. Such prepared draft tax and transaction fields are locked. Guided recurring schedules pause before creating an occurrence or queuing mail and record the reason in delivery history; each occurrence must be generated as a draft and its transaction-specific tax decisions reviewed.

## Public documents and historical records

HTML, print, PDF, PDF positioned address blocks, and payment receipts use the saved snapshot. Guided collecting lines force the seller registration block to remain visible when a template hides its optional tax-registration field. Public tax-treatment disclosures and the purchaser's PST number for a number-based exemption route remain visible independently of optional line-table tax columns. Internal exemption evidence is excluded by the shared tax disclosure helper.

Old issued invoices without a snapshot do not borrow current organization numbers. An internal detail note explains the missing historical capture and directs the user to the original issued document. No automatic migration invents historical registration evidence.

The generic snapshot shape allows further tax regimes without changing previously issued invoices. A new regime still needs reviewed number formats, jurisdiction selection, item guidance, issue validation and output tests. The current adapters cover GST/HST and BC PST only.

## Regression checks

Run:

```sh
node --import tsx scripts/check-invoice-tax-registrations.ts
node --import tsx scripts/check-invoice-tax-rendering.ts
node --import tsx scripts/check-invoices.ts
```

The registration check covers active/effective selection, ambiguous numbers, issue and first-payment gates, snapshot stability, duplicate behavior, and recurring preparation/finalization using the portable MemoryDb runtime. The rendering check exercises the actual HTML and Forme PDF components, extracts PDF text, and verifies tax disclosure visibility, purchaser/seller number separation, historical numbers, private evidence exclusion and receipt propagation.
