# Meeting Minutes Source Audit

Source folders reviewed:

- `/Users/ahmadjalil/Downloads/minutes`
- `/Users/ahmadjalil/Downloads/March 2025 2`

## New Gaps Found

The first schema expansion covered most recurring minutes content, but the source review found three additional structured needs:

- `detailedAttendance.memberIdentifier`: participant/member/student numbers appear in source rosters, especially the OTE participant list.
- `minutes.appendices`: committee reports, agenda attachments, bylaw screenshots, financial workbooks, exhibit references, participant lists, and permit particulars are not always AGM special-resolution exhibits.
- `agmDetails.directorAppointments.votesReceived` and `elected`: AGM election screenshots and participant lists show candidate vote counts and elected/not-elected outcomes.

Remaining items that are intentionally still notes/text unless we add a larger motion/election model:

- Chair role / called-by role, such as “Vice President Ash” or “[President/Vice-President/Secretary-Treasurer]”.
- Procedural validity wording, such as “properly called and constituted.”
- `motionBy` / presiding officer for board-style minutes where “Motion:” is separate from “First/Second”.
- Multiple seconders and textual vote summaries like “In Favour: All.”
- Nested sub-resolutions inside one special resolution.
- Multiple next meetings from one combined meeting.
- Combined AGM plus board business meetings, which are representable with `sessionSegments` but may be cleaner as linked meetings.

## Structured Conversions

### AABC Executive Meeting, January 21, 2026

Source: `/Users/ahmadjalil/Downloads/minutes/9. Exec Meeting minutes_January 21_2026.pdf`

```json
{
  "meeting": {
    "title": "AABC Executive Meeting",
    "type": "Executive",
    "scheduledAt": "2026-01-21T17:30:00-08:00",
    "location": "Zoom",
    "electronic": true
  },
  "minutes": {
    "chairName": "D. Gillard",
    "calledToOrderAt": "2026-01-21T17:32:00-08:00",
    "adjournedAt": "2026-01-21T19:35:00-08:00",
    "remoteParticipation": {
      "url": "https://us06web.zoom.us/j/86266619020?pwd=XWWdW9djsYBlmV8zRDbbWuhkl3M3H8.1",
      "meetingId": "862 6661 9020",
      "instructions": "Join Zoom Meeting; by computer"
    },
    "attendees": ["D. Gillard", "M. Fish", "A. Voronova", "K. Speak", "M. Bos", "L. Glandt", "R. Gamble"],
    "absent": ["J. Sanford"],
    "detailedAttendance": [
      { "name": "D. Gillard", "status": "present", "roleTitle": "meeting chair inferred" },
      { "name": "J. Sanford", "status": "regrets", "quorumCounted": false }
    ],
    "sections": [
      { "type": "motion", "title": "Approval of Agenda", "presenter": "D. Gillard", "discussion": "No December meeting occurred due to lack of quorum.", "decisions": ["January Executive Meeting Agenda approved."] },
      { "type": "report", "title": "Treasurer & Finance Committee Report", "presenter": "M. Fish", "reportSubmitted": true, "decisions": ["December financials approved."] },
      { "type": "report", "title": "Committee and Program Reports", "reportSubmitted": true, "discussion": "Communications, Indigenous Advocacy, Grants and Nominations, Membership, Conference, Programs, and ACA @ UBC reports were presented or submitted." }
    ],
    "motions": [
      { "text": "Approve the January Executive Meeting Agenda.", "movedBy": "D. Gillard", "secondedBy": "M. Fish; A. Voronova; R. Gamble", "outcome": "Approved" },
      { "text": "Approve the November Executive Meeting Minutes.", "movedBy": "D. Gillard", "secondedBy": "M. Fish; R. Gamble", "outcome": "Approved" },
      { "text": "Approve December's financials.", "movedBy": "D. Gillard", "secondedBy": "M. Bos; R. Gamble", "outcome": "Approved" }
    ],
    "appendices": [
      { "title": "AABC Executive Meeting Committee Reports, Jan 21st, 2026", "type": "committee_reports", "reference": "Pages 4-5" }
    ],
    "nextMeetingNotes": "TBD"
  }
}
```

### PGAIR AGM and Board Meeting, March 18, 2025

Source: `/Users/ahmadjalil/Downloads/minutes/March 18 2025 PGAIR AGM & Board Meeting Minutes.docx`

```json
{
  "meeting": {
    "title": "PGAIR AGM & Board Meeting",
    "type": "AGM+Board",
    "scheduledAt": "2025-03-18T17:00:00-07:00",
    "location": "Zoom",
    "electronic": true
  },
  "minutes": {
    "chairName": "Cindi Pohl",
    "recorderName": "Patience Rakochy",
    "calledToOrderAt": "2025-03-18T17:11:00-07:00",
    "adjournedAt": "2025-03-18T18:52:00-07:00",
    "remoteParticipation": { "instructions": "ZOOM" },
    "quorumMet": true,
    "sessionSegments": [
      { "type": "public", "title": "AGM", "startedAt": "2025-03-18T17:11:00-07:00", "endedAt": "2025-03-18T17:31:00-07:00" },
      { "type": "other", "title": "Board business meeting", "startedAt": "2025-03-18T17:31:00-07:00", "endedAt": "2025-03-18T18:52:00-07:00" }
    ],
    "detailedAttendance": [
      { "name": "Cindi Pohl", "status": "present", "roleTitle": "Chair", "affiliation": "Chamber of Commerce", "quorumCounted": true },
      { "name": "Ben Weinstein", "status": "proxy", "affiliation": "Ministry of Environment & Parks", "proxyFor": "Gail Roth", "quorumCounted": true },
      { "name": "Patience Rakochy", "status": "staff", "roleTitle": "General Manager PGAIR; notes", "affiliation": "PGAIR", "quorumCounted": false },
      { "name": "Gail Roth", "status": "regrets", "affiliation": "Ministry of Environment & Parks", "quorumCounted": false }
    ],
    "sections": [
      { "type": "motion", "title": "Adoption of AGM Agenda", "decisions": ["AGM agenda adopted."] },
      { "type": "discussion", "title": "Appointment of Directors for 2025", "decisions": ["2025 directors appointed/confirmed subject to Gina confirmation."] },
      { "type": "motion", "title": "Receipt of 2024 Financials", "reportSubmitted": true, "decisions": ["2024 financial statements accepted."] },
      { "type": "discussion", "title": "Other Business", "discussion": "City funding, UNBC MOU, FBC agreements, AQMP update, and file-transfer/storage were discussed." }
    ],
    "agmDetails": {
      "financialStatementsPresented": true,
      "financialStatementsNotes": "2024 financial statements accepted; 2024 GM Secretariat/Secretariate Report received.",
      "directorElectionNotes": "All directors in good standing remain for 2025 except Randi Zurowski and Terry Robert. New directors/proxies include Patience Rakochy, Kim Menounos, and Ben Weinstein.",
      "directorAppointments": [
        { "name": "Cindi Pohl", "roleTitle": "Chair", "affiliation": "Prince George Chamber of Commerce", "term": "2025", "status": "confirmed" },
        { "name": "Gina Layte Liston", "affiliation": "Regional District of Fraser-Fort George", "term": "2025", "status": "to_confirm" }
      ]
    },
    "appendices": [
      { "title": "Table of 2025 PGAIR Directors", "type": "roster" },
      { "title": "For Information - PGAIR Current Vacancies", "type": "roster" },
      { "title": "2025 FBC Staff", "type": "staff_contact" },
      { "title": "Table of 2025 Operations Committee", "type": "committee_roster" },
      { "title": "Table of 2025 AQMP Committee", "type": "committee_roster" }
    ],
    "nextMeetingAt": "2025-06-17",
    "nextMeetingNotes": "Operations Committee meeting also scheduled for April 17, 2025."
  }
}
```

### NUGSS Public Board Meeting, March 29, 2022

Source: `/Users/ahmadjalil/Downloads/minutes/Board of Directors Mar 29 2022 Public Meeting Minutes - Draft.docx`

```json
{
  "meeting": {
    "title": "Regular Meeting of the Board of Directors",
    "type": "Board",
    "scheduledAt": "2022-03-29T13:15:00-07:00",
    "location": "Teams",
    "electronic": true,
    "status": "Draft"
  },
  "minutes": {
    "chairName": "Sarah Ash",
    "calledToOrderAt": "2022-03-29T13:19:00-07:00",
    "adjournedAt": "2022-03-29T15:51:00-07:00",
    "remoteParticipation": { "instructions": "Click here to join the meeting; meeting held by Teams." },
    "detailedAttendance": [
      { "name": "Calin Claassens", "status": "present", "roleTitle": "President", "affiliation": "NUGSS Board", "quorumCounted": true },
      { "name": "Sarah Ash", "status": "present", "roleTitle": "Vice President", "affiliation": "NUGSS Board", "quorumCounted": true },
      { "name": "Lukas Dauksas", "status": "present-left-early", "roleTitle": "Director", "notes": "Left during Studentcare presentation due to class schedule." },
      { "name": "Doug Minaker", "status": "staff", "roleTitle": "General Manager", "quorumCounted": false },
      { "name": "Alisha Thapar", "status": "guest", "roleTitle": "incoming Director", "quorumCounted": false }
    ],
    "sections": [
      { "title": "1 - Call to order", "type": "procedural", "presenter": "Vice President Ash" },
      { "title": "5.3 - TRU Student Union discussion", "type": "discussion/motion", "presenter": "Leif Douglass (Campaigns Coordinator)", "decisions": ["Letter of support approved as presented."] },
      { "title": "5.6 - Studentcare Annual Presentation", "type": "presentation/motion", "presenter": "Bahareh Jokar", "decisions": ["Pacific Blue Cross approved as provider.", "Virtual healthcare declined."] },
      { "title": "6.1 - In-Camera", "type": "executive_session", "decisions": ["Moved to In-Camera."] }
    ],
    "sessionSegments": [
      { "type": "public", "title": "Public Session", "startedAt": "2022-03-29T13:19:00-07:00", "notes": "Exact transition time to In-Camera not stated." },
      { "type": "in_camera", "title": "In-Camera", "notes": "Motion carried; no in-camera content or return time recorded in public minutes." }
    ],
    "appendices": [
      { "title": "Embedded bylaw screenshots", "type": "source_image", "reference": "Item 5.5" }
    ],
    "nextMeetingAt": "2022-04-08T10:30:00-07:00",
    "nextMeetingLocation": "Teams"
  }
}
```

### OTE AGM, March 31, 2025 Bundle

Sources:

- `/Users/ahmadjalil/Downloads/March 2025 2/AGM Minutes OTE.docx`
- `/Users/ahmadjalil/Downloads/March 2025 2/Participant List.docx`
- `/Users/ahmadjalil/Downloads/March 2025 2/Agenda.docx`
- `/Users/ahmadjalil/Downloads/March 2025 2/Changes.docx`
- `/Users/ahmadjalil/Downloads/March 2025 2/Screenshot 2025-03-31 at 9.55.29 PM.png`

```json
{
  "meeting": {
    "title": "OTE Annual General Meeting",
    "type": "AGM",
    "scheduledAt": "2025-03-31T18:00:00-07:00",
    "location": "NUGSS April Price Board Room",
    "electronic": true
  },
  "minutes": {
    "chairName": "Behrouz (Bruce) Danesh",
    "calledToOrderAt": "2025-03-31T18:00:00-07:00",
    "attendees": ["Behrouz (Bruce) Danesh", "Ahmad Jalil", "Lina Maksymova", "Nahid Yari", "Paul Peng", "Parniya Peykamiyan", "Amir Etminanrad", "Caleb Mueller"],
    "detailedAttendance": [
      { "name": "Caleb Mueller", "status": "present", "memberIdentifier": "230133258", "quorumCounted": true },
      { "name": "Paul Peng", "status": "present", "memberIdentifier": "230140411", "quorumCounted": true },
      { "name": "Behrouz Danesh", "status": "present", "memberIdentifier": "230136160", "roleTitle": "President", "quorumCounted": true },
      { "name": "Lina Maksymova", "status": "present", "memberIdentifier": "230161606", "roleTitle": "General Director", "quorumCounted": true },
      { "name": "Nahid Yari", "status": "present", "memberIdentifier": "230162487", "roleTitle": "General Director", "quorumCounted": true },
      { "name": "Parniya Peykamiyan", "status": "present", "memberIdentifier": "230151939", "quorumCounted": true },
      { "name": "Amir Etminanrad", "status": "present", "memberIdentifier": "230137850", "quorumCounted": true }
    ],
    "quorumMet": true,
    "sections": [
      { "type": "acknowledgement", "title": "Land Acknowledgment" },
      { "type": "motion", "title": "Approval of Agenda", "decisions": ["Agenda approved."] },
      { "type": "report", "title": "Reports", "reportSubmitted": true, "discussion": "Editor-in-Chief, financial statement, and social media updates were reviewed." },
      { "type": "motion", "title": "Special Resolutions: Bylaw Amendments", "decisions": ["Bylaw amendments approved by two-thirds majority."] },
      { "type": "election", "title": "Election of New Board of Directors" }
    ],
    "agmDetails": {
      "financialStatementsPresented": true,
      "financialStatementsNotes": "Financial records complete up to August 2024; pre-August 2024 still being finalized. Current net input approximately $51,351; expenses approximately $27,000.",
      "directorElectionNotes": "President and Vice-President uncontested. General Director vote used Microsoft Forms with 8 responses.",
      "directorAppointments": [
        { "name": "Behrouz Danesh", "roleTitle": "President", "elected": true, "status": "confirmed by acclamation" },
        { "name": "Ahmad Jalil", "roleTitle": "Vice-President", "elected": true, "status": "confirmed by acclamation" },
        { "name": "Lina Maksymova", "roleTitle": "General Director", "votesReceived": 7, "elected": true },
        { "name": "Nahid Yari", "roleTitle": "General Director", "votesReceived": 5, "elected": true },
        { "name": "Parniya Peykamiyan", "roleTitle": "General Director", "votesReceived": 5, "elected": true },
        { "name": "Amir Etminanrad", "roleTitle": "General Director", "votesReceived": 4, "elected": false },
        { "name": "Paul Peng", "roleTitle": "General Director", "votesReceived": 3, "elected": false }
      ],
      "specialResolutionExhibits": [
        { "title": "Proposed Bylaw Amendments", "reference": "Changes.docx" }
      ]
    },
    "appendices": [
      { "title": "Participant List", "type": "attendance_roster", "reference": "Participant List.docx" },
      { "title": "Agenda", "type": "agenda", "reference": "Agenda.docx" },
      { "title": "Proposed Bylaw Amendments", "type": "bylaw_amendments", "reference": "Changes.docx" },
      { "title": "General Director Vote Results", "type": "election_results", "reference": "Microsoft Forms screenshot" }
    ]
  }
}
```

### AGM Minutes Template

Source: `/Users/ahmadjalil/Downloads/minutes/Annual General Meeting Minutes (TEMPLATE) (ID 50189)_0.docx`

This is not a completed meeting record. It is useful as a style/template source. It maps to the structured shape with placeholders for chair, secretary, notice date, quorum declaration, director appointments, financial statement acceptance, special resolutions attached as Exhibit A, and signature lines. Its main schema lessons were `chairRole`, procedural validity wording, nested resolution clauses, and signature layout.
