# Item tax guidance and jurisdiction packs

This change adds a reviewable tax decision tree to the existing item catalog and invoice line editor. The first reviewed pack covers ordinary domestic supplies in British Columbia on or after 2026-10-01. It is not a complete Canadian or international tax engine. Existing manual tax choices remain available and are identified as unassessed.

For legal entity and incorporation-Act coverage, see [organization-capabilities.md](organization-capabilities.md). For organization tax numbers, issuance snapshots and their historical limits, see [invoice-tax-registrations.md](invoice-tax-registrations.md).

## User workflow

1. In **Organization → Identifiers**, record the full GST/HST account and BC PST registration separately, with their status and effective date where known. Confirm uncertain accounts before marking them active. A bare nine-digit business number is not a complete GST/HST account. A generic sales-tax identifier is not automatically interpreted as PST.
2. In **Invoices → Catalog**, create or edit an item or service and choose **Guide me through tax**. Establish the actual place of supply, supply category, supplier tax status, ordinary-supply scope and the separate federal and provincial decisions.
3. Record the applicable rule and supporting reference for an exception. Software, related services and legal services have extra scope questions. Charity supplies require a specific review. Legal structure or nonprofit status does not establish a sales-tax exemption.
4. Choose **Keep for review** to save unanswered or unsupported decisions without applying a recommendation, or **Confirm and apply tax treatment** after all questions are resolved. Applying a result updates the existing primary/additional tax fields used by invoice calculations and the ledger.
5. When using a catalog item on an invoice, confirm the actual transaction's place/scope, date and customer relief. Catalog evidence does not confer a purchaser-specific exemption. Customer relief records the rule, required evidence, and—where that documentation route applies—the purchaser's PST number for the public document.
6. Issue the invoice only after all attached guided assessments are confirmed and their calculated rates agree. Seller registrations are captured at issue. The customer-facing document includes relevant tax amounts and treatment; internal review notes are excluded.

Manual selection explicitly clears a guided assessment. This preserves existing invoice workflows, but it does not turn a manual rate into a verified tax conclusion.

## Decisions represented separately

| Decision | Meaning in the data |
| --- | --- |
| Standard taxable, collecting | Apply the component's reviewed percentage |
| Standard taxable, not collecting | Supplier collection/registration assessment; not an exempt or zero-rated item |
| Zero-rated | Taxable at 0%; retained independently of the other tax component |
| Exempt | A supported supply exemption |
| Outside scope / not subject | The identified tax does not apply under the recorded assessment |
| Customer relief | Transaction-specific relief from a component that would otherwise be collected |
| Review required | Missing evidence, unresolved applicability or unsupported jurisdiction/date; no recommendation |

An item can therefore be GST zero-rated and PST taxable, or GST taxable and PST exempt. An unresolved result never becomes a silent “No tax” recommendation. A registered charity, nonprofit organization, legal entity type, industry code and tax-account registration are distinct facts.

## Scope of the first pack

`ca-bc-ordinary-sales`, version `2026-11-06.1`, is effective from 2026-10-01 and records a review date of 2026-11-06.

- Ordinary in-scope taxable sales use 5% GST and, for applicable ordinary BC categories, 7% PST. The guide requires the supplier's registration/collection position and category conditions to be resolved.
- General standalone services outside specifically taxable categories can be not subject to PST. Software, services to goods and legal services require their own scope confirmations.
- Accounting/bookkeeping, architecture, engineering/geoscience, non-residential real estate services and security services use the later exemptions in **BC Regulation 161/2026**, effective October 1, 2026. Earlier expansion announcements are not treated as the current rule. Separate goods/software supplies still need separate assessment.
- Food, health/education/care, memberships/admissions/program fees, real property, accommodation and donations/sponsorships require a specific supply review. The category name alone does not decide an exemption. A supported explicit exception can be recorded; otherwise the result remains under review.
- Public bodies, mixed supplies, cross-border or mixed-location transactions, non-resident/marketplace issues, special rates and historical dates before the pack's effective date are outside the ordinary recommendation path.

The evidence fields record the user's review. They do not validate a certificate with an authority, establish charity eligibility, calculate small-supplier turnover tests, or replace a review of the actual supply. The guide does not generate charitable donation receipts, income-tax returns or sales-tax remittances.

### Sources used by the pack

- [CRA: type of supply](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-type-supply.html)
- [CRA: GST/HST rates, collection and invoices](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html)
- [CRA: registration requirements](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html)
- [CRA: nonprofit organizations, RC4081](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4081/gst-hst-information-non-profit-organizations.html)
- [CRA: charities, RC4082](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4082/gst-hst-information-charities.html)
- [BC Regulation 161/2026](https://www.bclaws.gov.bc.ca/civix/document/id/bcgaz2/bcgaz2/v69n16_161-2026)
- [BC PST Regulation, including sections 85–86](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/1295368594)
- [BC PST on software](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/publications/software)
- [BC related services, PST 301](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-301-related-services.pdf)
- [BC legal services, PST 106](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-106-legal-services.pdf)
- [BC general exemption certificate, FIN 490](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/forms/fin-490-certificate-exemption-general.pdf)

PST seller and purchaser numbers serve different purposes. Some purchaser exemptions require a number on the invoice, receipt, bill or related written agreement; this guide's number route prints it on the invoice. Other exemptions require a permitted certificate or other evidence. The FIN 490 eligibility restriction is not applied to every other certificate. See the linked regulation and the actual certificate instructions.

## Shared implementation

`shared/tax/types.ts` defines the versioned assessment, independent tax components, questions, conditional visibility and jurisdiction-pack contract. `shared/tax/index.ts` resolves a pack from the **actual tax jurisdiction and assessment date**, validates answers, recomputes outcomes and maps confirmed decisions to the existing money engine. It never selects tax jurisdiction from currency or incorporation address.

Each pack supplies:

- Its ID/version, jurisdiction and applicability dates.
- A review date and primary-source references.
- Questions, permitted answers and conditional visibility.
- An answer-update hook that invalidates dependent evidence after a changed decision.
- An evaluator that returns component decisions and explicit review issues.

`TaxAssessmentEditor` is shared by catalog, invoice, quote and repair line editing. The backend uses the same rules through portable handlers and Convex validators. Client-supplied components, status flags and rates are not authoritative: the server recomputes the assessment from the recorded answers.

Guided assessments persist on catalog items and invoice lines. The schema additions are optional; no mandatory data migration or guessed historic assessment is introduced.

### Preventing stale decisions

- Catalog selection, duplication, recurring occurrences, quote conversion and repair conversion require a fresh transaction review. Scope confirmation and purchaser evidence are reset, including non-registration evidence that needs to be reconsidered for the transaction.
- Customer, address, delivery, date and currency changes invalidate draft assessments. Editing the saved customer record follows the same rule for draft invoices and quotes.
- An open guide closes and discards its unsaved answers when its document or item context changes, including a new unsaved invoice.
- Changing category, supplier status, jurisdiction or dependent exception answers clears the previous decision's evidence. Replacing a purchaser number or certificate requires renewed conditions confirmation.
- Issued guided tax decisions and their recipient/delivery/date context cannot be changed in place. A replacement invoice is required. Prepared automated invoices also retain the tax and party facts used by their frozen delivery document.
- The issue gate applies to normal issue, first payment on a draft and quote publication. A batch is checked before ledger writes.
- Automated delivery pauses a recurring series containing guided decisions before invoice allocation. The user creates the next draft, reviews it and sends it explicitly. This version does not automate recurring exemption revalidation.

## Documents, compatibility and historical limits

HTML/print and PDF use the same public treatment helper. Zero/exempt/non-collection explanations and a purchaser PST number remain visible even if a template hides the optional tax column. Guided collecting components retain separate tax totals and required seller-registration output when optional template switches are off. Free-text supporting evidence remains internal.

Issuer snapshots retain the tax numbers captured for that invoice. Issued legacy invoices without a snapshot do not borrow today's numbers and claim those were the original details. The existing organization identifier model has an active status and optional effective date, but no complete historical validity intervals; historical registration validity cannot be reconstructed automatically.

Manual legacy taxes remain functional. Their presence does not imply that this new guide assessed the item or that all statutory invoice-content requirements have been checked. A future rollout can add a deliberate workspace policy requiring guided assessments; this change does not silently impose one on every existing invoice.

## Adding another jurisdiction or structure

1. Review that jurisdiction's actual place-of-supply, supplier-registration, category, exemption and invoice-evidence rules. Do not assume that another province uses separate federal/provincial taxes or that a nonprofit is exempt.
2. Add an explicit pack with its own questions, dependencies, authorities and evaluator. Register it in `TAX_RULE_PACKS`; no supported pack means a review result. Add source-backed effective boundaries and keep prior versions available for historical interpretation. When changing rules, define whether old draft decisions need renewed confirmation and preserve issued evidence.
3. Extend the organization-registration adapter for the pack's tax IDs, number format, jurisdiction, effective/status rules and conflicting accounts. The snapshot format supports additional IDs, but a new ID is not complete support by itself.
4. Verify the calculation model before enabling automatic rates. The current adapter uses **parallel percentage taxes on the existing invoice tax base**. Combined HST should be one component. Compounded taxes, fixed/per-unit taxes, nonstandard tax bases, special rounding and currency minor-unit changes require explicit money/ledger changes and tests. Do not force those rules into the ordinary GST/PST adapter.
5. Test taxable, zero/exempt, non-registration, customer-relief and unsupported cases; effective-date transitions; source/evidence retention; invoice/quote/repair/recurring reuse; actual HTML/PDF output; permissions; and local/Convex parity.
6. Add legal-entity governance and preparation support separately, using the Act/profile/pathway registries. International identity onboarding and local filing flows remain separate work from a tax-pack registration.

## Verification commands

```sh
npm run test:organization-capabilities
npm run test:tax-guidance
npm run test:tax-guidance-ui
npm run convex:typecheck
npm run test:portable-manifest
```

`test:tax-guidance` includes the pure rules, dependency invalidation, real Convex schema/handler persistence and authorization, registration/issue snapshots and real HTML/PDF output. The Playwright suite covers desktop and phone catalog/invoice use, context changes, persistence and unsupported-jurisdiction issue blocking. Neighboring invoice, money, ledger, billing-document and automation suites cover existing behavior.

The dedicated GitHub Actions workflow runs these integration gates on Ubuntu 24.04, including browser installation, frontend and Convex typechecking, and retained browser evidence. Local sandbox limitations or a successful unit test must not be described as a successful browser run or hosted deployment.
