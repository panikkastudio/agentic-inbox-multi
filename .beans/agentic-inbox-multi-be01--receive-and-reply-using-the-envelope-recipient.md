---
# agentic-inbox-multi-be01
title: Receive and reply using the envelope recipient
status: completed
type: task
priority: normal
created_at: 2026-08-26T14:17:42Z
updated_at: 2026-08-26T15:57:51Z
parent: agentic-inbox-multi-qflb
blocked_by:
    - agentic-inbox-multi-6eqn
---

## Parent

`agentic-inbox-multi-qflb` — Support multiple email domains in one inbox deployment

## What to build

Route incoming mail using Cloudflare's SMTP envelope recipient and complete the multi-domain receive-and-reply path. BCC, redirected, and multi-recipient MIME messages must reach the mailbox Cloudflare accepted them for while their original recipient headers remain available as message metadata. Mail for unauthorized or nonexistent mailboxes must not create state or trigger an agent.

## Acceptance criteria

- [ ] The Cloudflare email event's envelope recipient is the sole authority for selecting the inbound mailbox.
- [ ] A message whose first MIME `To` recipient differs from the envelope recipient is stored in the envelope recipient's mailbox.
- [ ] A BCC-style message reaches its envelope mailbox when that address is absent from the MIME `To` header.
- [ ] Original `To`, `Cc`, and `Bcc` values remain stored as message metadata.
- [ ] Each inbound event resolves to one normalized mailbox and does not fan out based on MIME recipients.
- [ ] Mail outside the effective exact-address policy creates no email and triggers no agent work.
- [ ] Mail for a configured domain but nonexistent mailbox creates no mailbox or email and triggers no agent work.
- [ ] Diagnostic logs identify the affected address without including message contents.
- [ ] Messages sent to the same local part on two domains remain isolated, including attachments, mailbox settings, and Email Agent context.
- [ ] Reply and forward flows send from the mailbox that received the message and retain its domain identity.
- [ ] Worker-boundary tests cover mismatched MIME recipients, BCC delivery, missing mailboxes, two-domain isolation, and reply behavior.
- [ ] Operator documentation explains that every domain must be onboarded separately to Cloudflare Email Routing and Email Sending and routed to the same Worker.
- [ ] Operator documentation includes an acceptance checklist for inbound, BCC inbound, outbound, reply, and isolation on two domains.

## Blocked by

- Configure, create, and send from multiple domains.


## Completion

Implemented in `78601e1` with isolation coverage and routing fix in `d461d6d`.

Verification:

- `npm run test:worker` — 17 tests passed.
- `npm run typecheck` — passed.
- Final Hunk review — no feedback.
