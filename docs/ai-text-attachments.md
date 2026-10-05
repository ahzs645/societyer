# AI text attachments and private conversations

The connected assistant reads user-selected UTF-8 TXT, Markdown, CSV and JSON files on the device. Users can review extracted text before pressing Send. Sending includes that text in the authenticated request to the configured server-side AI provider and stores it in the creator’s private chat history. It does not retrieve arbitrary document IDs or fetch attachment URLs.

Each file must contain 1 byte to 32 KiB of valid text. Up to four files can be attached; the composed message is limited to 160 KiB. Client extraction and server validation reject unsupported formats, binary data, invalid UTF-8, malformed JSON, unsafe filenames and oversized input. This is text ingestion, not PDF, image, office-document or OCR extraction. CSV contents are source text, not spreadsheet execution.

Private conversation and agent-run history requires both the original creator and current `tasks:write` permission. Other workspace members, including another Owner or Admin, cannot read it. Missing-creator legacy records remain inaccessible; membership alone cannot claim them. Current role checks also apply before saving provider completions and before delivering streaming tokens. AI tools retain their own resource permissions, tenant boundaries, field allowlists and document ACLs. Explicit workspace task drafts remain the approval queue for users with current write permission.

The readonly assistant shell remains available without subscribing to private history or raw approval payloads. Workspace/actor/permission changes clear visible protected state and invalidate pending extraction or request callbacks. Message errors retain the draft. The client retries through the action only when a streaming endpoint is absent (404/405); it does not automatically replay provider, authorization, network or incomplete-stream failures that may already have saved a message.

AI message image syntax renders as a link requiring a click, so source text and model output do not automatically fetch third-party images. Markdown’s normal URL sanitization remains active.

Real local workspaces can prepare typed drafts and review selected text without transmitting it. Typed drafts persist per local workspace; selected files must be reattached after reload. Live inference remains unavailable in the local/PWA/Electron vault. A configured OpenAI-compatible inference server is usable by the connected server adapter, but no on-device engine or model is bundled. The explicit demo saves creator-attributed simulated conversations and says that no model or file analysis ran; the real local client cannot use that simulation as live inference.

Qualification uses the actual native Convex action and HTTP stream, the installed OpenAI-compatible SDK, and a loopback-only synthetic provider. It verifies that extracted contents reach the adapter, invalid or unauthorized requests do not reach it, and a role downgrade during generation stops late output and persistence. Native and portable fixtures verify five roles, another creator in the same workspace, foreign tenants, missing creators, document ACLs and service scopes. No external AI provider receives qualification data, and these fixtures do not establish the quality of a real model’s analysis.

Repeatable checks:

- `npx tsx scripts/check-ai-file-ingestion.ts`
- `npx tsx scripts/check-ai-chat-privacy.ts`
- `npx tsx scripts/check-ai-chat-stream.ts`
- `npx tsx scripts/check-ai-demo-chat.ts`
- `tests/interface-ai-attachments.spec.ts` and the local-capability regression in `tests/interface-local-capabilities.spec.ts`

Sanitized results: [AI qualification evidence](../artifacts/interface/ai-attachment-qualification.json).
