# PIPA Privacy Program Checklist

Last reviewed: 2026-04-21

Use this as a short internal checklist before marking Societyer privacy program
status as `Documented`.

This is not legal advice.

## Minimum Baseline

- [ ] Privacy officer or responsible role is designated.
- [ ] Privacy officer title/contact information is available on request.
- [ ] Privacy policy is adopted.
- [ ] Complaint process is documented.
- [ ] Access/correction request process is documented.
- [ ] Collection notices are used on forms and intakes.
- [ ] Consent basis is documented for mailing lists, events, member records,
  volunteers, staff, grants, and public forms.
- [ ] Data inventory lists the systems holding personal information.
- [ ] Member data access status is recorded.
- [ ] Member-data gap memo is completed if the full member list is held by a
  university, parent body, collection agent, or other institution.
- [ ] Retention and disposal rules are documented.
- [ ] Access permissions are role-limited.
- [ ] MFA is enabled where practical for key systems.
- [ ] Paper records are stored securely.
- [ ] Service providers that handle personal information are listed.
- [ ] Breach response steps are documented.
- [ ] Staff/director/volunteer privacy training is logged.
- [ ] Annual review date is set.

## Societyer Fields

On `/app/society`, set:

- `Privacy program status`: `Documented` only after the baseline above is true.
- `Program reviewed`: the date the board/officer last reviewed the privacy
  program.
- `Privacy program notes`: where the policy, complaint process, request process,
  and retention rules are kept.
- `Member data access`: one of `Society-controlled`, `Partially available`,
  `Institution-held`, `Not applicable`, or `Unknown`.
- `Member data-access gap documented`: checked only after the memo is complete.
- `Member data access notes`: what is controlled, what is held externally, and
  what evidence supports that conclusion.

On `/app/documents`, link or upload:

- current privacy policy;
- member-data access gap memo;
- institution correspondence;
- privacy training evidence;
- complaint/access-request procedure;
- retention schedule; and
- data-sharing agreements or service-provider terms.

## Suggested First Pass for a Small Student Society

1. Assign a role-based privacy contact such as `Privacy Officer` and a monitored
   email address.
2. Adopt a short privacy policy using the template in this folder.
3. Complete the member-data access gap memo if the university does not provide a
   member list.
4. Identify every system holding personal information, including Societyer,
   Paperless, email, cloud drives, grant portals, accounting tools, forms,
   mailing lists, and payroll or contractor records.
5. Lock down access to personal information.
6. Add collection notices to forms.
7. Keep old or sensitive records only as long as there is a legal, governance,
   audit, funding, or operational reason.
8. Review the setup before each AGM, election, referendum, grant cycle, or major
   system change.
