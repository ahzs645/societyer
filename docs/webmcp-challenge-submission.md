# WebMCP Challenge submission draft

## Project

**Societyer — the agent-native governance operations desk**

- Live demo: https://society.ahmadjalil.com/demo/app
- Public repository: https://github.com/ahzs645/societyer
- License: MIT

## Short description

Societyer gives volunteer-run societies one shared workspace for deadlines, filings, meetings, evidence, and follow-up work. Its WebMCP tools let a browser agent inspect that connected governance context, discuss priorities with the operator, create an approved batch of follow-up tasks, and open the exact records the human should review.

## Why this is a strong fit for WebMCP

Governance work is spread across records whose relationships matter: a late filing may depend on a board decision, supporting minutes, a receipt, and a task owner. A visual agent would have to click through several dense tables and infer field meanings from the interface. A traditional remote MCP integration would need separate authentication and a duplicate API surface.

WebMCP lets Societyer expose the task-level meaning already present in the open workspace. The tool runs in the page, uses the same selected organization and live data as the person, and sends its results back into the same visible interface. The agent gets structured access without scraping, while the human keeps the browser's site-access prompt and the application's normal permission boundary.

## Better user experience

The operator can ask one natural-language question such as, “What is overdue, what is due in the next 60 days, and what should the secretary do first?” The agent receives a bounded governance snapshot instead of guessing from pixels. After discussing the result, it can create the approved work in one batch and Societyer opens Tasks so the operator can immediately inspect, edit, assign, or complete it.

This removes repetitive navigation and transcription without hiding the outcome. The person and agent remain on one shared work surface: the agent handles cross-record retrieval and structured entry; the person supplies judgment, approvals, and legal context.

## What people and agents can do together now

- Review deadlines, filings, meetings, tasks, and rule-based compliance flags as one bounded snapshot.
- Turn an agreed remediation plan into several properly shaped Societyer tasks in one call.
- Move together to the relevant dashboard, deadlines, filings, meetings, tasks, or AI workspace for human review.
- Repeat the snapshot after a change to verify that visible application state and agent-visible state agree.

Before WebMCP, this required manual tab-by-tab review, copy/paste into chat, and re-entering each action item. Visual automation could attempt it, but it was brittle around dense record tables, route changes, and dynamic data.

## WebMCP implementation

Societyer feature-detects `document.modelContext` and registers three imperative tools when an organization workspace is active:

1. `get_governance_snapshot` — a read-only, bounded cross-record view with `readOnlyHint: true` and `untrustedContentHint: true`.
2. `create_governance_tasks` — validates a batch of one to eight tasks, writes them through the same mutation used by the visible task interface, then opens Tasks for review.
3. `open_governance_view` — navigates the shared browser surface to an allowlisted Societyer view.

Each tool has a strict JSON Schema, validates inputs again at execution time, returns concise JSON, uses the active workspace and existing authorization path, and unregisters through an `AbortSignal` when the page lifecycle ends. The public demo uses Societyer's browser-local fixture runtime, so judges can exercise the full flow without credentials or a hosted database.

## Suggested judge prompt

> Review this Societyer workspace for overdue governance work and anything due in the next 60 days. Summarize the three highest-priority issues. Then create the follow-up tasks I approve and open the Tasks view so I can review them.

## Demo video outline (target: 2 minutes 20 seconds)

### 0:00–0:20 — The problem

Open the Societyer dashboard. Explain that volunteer boards track filings, deadlines, minutes, evidence, and task owners in different places, and that visual automation has to guess its way through dense tables.

### 0:20–0:40 — Show the WebMCP surface

Open the ChatGPT in-app browser's site-tools menu. Show the three registered tools and point out that they are scoped to the active organization visible on the page.

### 0:40–1:15 — Ask for a governance snapshot

Use the suggested prompt. Show ChatGPT calling `get_governance_snapshot`, then briefly compare one overdue item in the answer with the same deadline or filing visible in Societyer.

### 1:15–1:55 — Human approval plus agent action

Approve two concrete follow-up tasks. Show ChatGPT calling `create_governance_tasks`. Societyer should navigate to Tasks; highlight the new rows, priorities, due dates, assignee, and the `webmcp` / `agent-created` tags.

### 1:55–2:15 — Shared context, not a hidden integration

Ask ChatGPT to open Deadlines. Show `open_governance_view` moving the same browser surface. Emphasize that the agent used the application's real actions and that the human can continue editing normally.

### 2:15–2:20 — Close

“Societyer turns governance records into a shared operating surface for people and their agents.”

## Final submission checklist

- [ ] Push the WebMCP implementation and root `LICENSE` to the public repository.
- [ ] Confirm the GitHub About section shows the MIT license.
- [ ] Deploy the final commit and test the live `/demo/app` URL in ChatGPT's in-app browser.
- [ ] Run a valid call for all three tools and an invalid-input call for the task tool.
- [ ] Record a public, audio-enabled YouTube demo under three minutes.
- [ ] Paste the live URL, repository URL, description, and video URL into Devpost.
- [ ] Re-check eligibility, excluded territories, and the official submission deadline in the challenge rules.
