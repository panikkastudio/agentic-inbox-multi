---
# agentic-inbox-multi-6eqn
title: Configure, create, and send from multiple domains
status: completed
type: task
priority: normal
created_at: 2026-08-26T14:17:34Z
updated_at: 2026-08-26T15:21:05Z
parent: agentic-inbox-multi-qflb
blocked_by:
    - agentic-inbox-multi-jiik
---

## Parent

`agentic-inbox-multi-qflb` — Support multiple email domains in one inbox deployment

## What to build

Make configured domains the effective mailbox policy across configuration, mailbox creation, the existing domain selector, and outbound mail. An operator must be able to create and send from mailboxes on two configured domains while unauthorized addresses are rejected. The exact-address allowlist remains the stricter alternative when configured.

## Acceptance criteria

- [ ] Comma-separated domains are trimmed, lowercased, deduplicated, and normalized without a trailing DNS dot.
- [ ] The public configuration response exposes the normalized effective domains and exact addresses.
- [ ] The mailbox creation interface offers every effective domain returned by the Worker.
- [ ] An operator can create mailboxes under either of two configured domains.
- [ ] The same local part under two domains creates independent mailboxes with independent settings and storage.
- [ ] Creating a mailbox outside the configured domains returns HTTP 403 and creates no mailbox state.
- [ ] When exact addresses are configured, listed addresses across multiple domains are accepted and every unlisted address is rejected.
- [ ] New outbound mail can be sent from a mailbox on either configured and Cloudflare-onboarded domain through the shared Email Service binding.
- [ ] A mailbox cannot send using another mailbox's address.
- [ ] Outgoing Message-IDs use the selected mailbox's domain.
- [ ] Worker-boundary tests cover the multi-domain, rejection, exact-address, and single-domain regression behavior.
- [ ] Operator documentation shows the comma-separated domain configuration format.
- [ ] Existing mailbox data requires no migration.

## Blocked by

- Establish the Worker behavior test seam.


## Completion

Implemented in `c323446` with review fixes in `3b6dc51`.

Verification:

- `npm run test:worker` — 11 tests passed.
- `npm run typecheck` — passed.
- Final Hunk review — no feedback.
