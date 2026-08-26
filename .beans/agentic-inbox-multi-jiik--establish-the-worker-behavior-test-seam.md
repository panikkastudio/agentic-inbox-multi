---
# agentic-inbox-multi-jiik
title: Establish the Worker behavior test seam
status: completed
type: task
priority: normal
created_at: 2026-08-26T14:17:25Z
updated_at: 2026-08-26T14:44:40Z
parent: agentic-inbox-multi-qflb
---

## Parent

`agentic-inbox-multi-qflb` — Support multiple email domains in one inbox deployment

## What to build

Establish one minimal, repeatable Worker-boundary test seam before changing multi-domain behavior. The seam must exercise the exported HTTP and email entrypoints with Cloudflare-compatible local bindings and prove the current single-domain path remains operational. Tests should observe responses and mailbox state rather than private helper calls.

## Acceptance criteria

- [ ] One documented command runs the Worker behavior tests locally.
- [ ] The harness invokes the exported HTTP entrypoint with working local mailbox, Durable Object, and R2 bindings.
- [ ] A baseline behavior test creates and reads a mailbox through the public API.
- [ ] The harness invokes the exported email entrypoint with a realistic Cloudflare email event.
- [ ] A baseline behavior test delivers an email to an existing single-domain mailbox and observes it through public Worker behavior.
- [ ] Tests do not assert private helper calls, generated Durable Object IDs, or internal storage queries.
- [ ] Existing type checking continues to pass.

## Blocked by

None (can start immediately).


## Completion

Implemented and committed as `b3dc40c` (`test(worker): model email event`).

Verification:

- `npm run test:worker` — 2 tests passed.
- `npm run typecheck` — passed.
- Final Hunk review — no feedback.
