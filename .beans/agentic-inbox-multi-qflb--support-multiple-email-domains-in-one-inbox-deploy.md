---
# agentic-inbox-multi-qflb
title: Support multiple email domains in one inbox deployment
status: completed
type: feature
priority: normal
created_at: 2026-08-26T14:12:19Z
updated_at: 2026-08-26T15:58:01Z
---

## Problem Statement

An operator can configure and display more than one email domain, but the deployment does not yet provide dependable multi-domain behavior. Incoming messages are assigned from the MIME `To` header instead of Cloudflare's SMTP envelope recipient, so BCC mail, redirected mail, and messages with multiple visible recipients can be ignored or stored in the wrong mailbox. When the exact-address allowlist is not configured, the mailbox API also accepts addresses from domains that are not configured, creating mailboxes that cannot reliably receive or send mail.

The operator needs one Agentic Inbox deployment to serve multiple email domains they control while preserving mailbox isolation, existing agent behavior, and the current shared-access trust model.

## Solution

Allow one trusted operator to configure multiple email domains on one Worker deployment. Each domain will be onboarded separately to Cloudflare Email Routing and Email Sending, while all domains continue to use the same Worker, Email Service binding, R2 bucket, Durable Object namespaces, and Cloudflare Access policy.

The Worker will treat Cloudflare's envelope recipient as the authoritative inbound mailbox address. Mailbox creation will accept only an exact configured address when `EMAIL_ADDRESSES` is present, or an address under a configured `DOMAINS` entry otherwise. Domain and address configuration will be normalized consistently. The full normalized email address will remain the mailbox identity, so the same local part on two domains remains two isolated mailboxes without a storage migration.

## User Stories

1. As an operator, I want one Agentic Inbox deployment to receive mail for several domains I control, so that I do not need to deploy and maintain one application per domain.
2. As an operator, I want to configure several domains in the existing domain setting, so that deployment configuration remains simple.
3. As an operator, I want configured domains normalized consistently, so that capitalization and whitespace do not create duplicate or unusable entries.
4. As an operator, I want the mailbox creation interface to list every configured domain, so that I can select the correct sender and receiver identity.
5. As an operator, I want to create a mailbox under any configured domain, so that each brand or project can have its own address.
6. As an operator, I want `hello@alpha.com` and `hello@beta.com` to be separate mailboxes, so that identical local parts do not mix data across domains.
7. As an operator, I want mailbox creation outside the configured domains to be rejected, so that the application cannot create identities Cloudflare is unable to serve.
8. As an operator using an exact-address allowlist, I want only listed addresses to be creatable, so that the stricter deployment policy remains enforced.
9. As an operator using an exact-address allowlist, I want configured addresses from several domains to work together, so that restricted deployments can still be multi-domain.
10. As an operator, I want an invalid mailbox request to return a clear authorization error, so that configuration mistakes are distinguishable from transient failures.
11. As an operator, I want an incoming message routed by its SMTP envelope recipient, so that it reaches the mailbox Cloudflare actually accepted it for.
12. As an operator, I want BCC messages to reach the correct mailbox, so that delivery does not depend on the mailbox appearing in the MIME `To` header.
13. As an operator, I want messages with multiple visible recipients to reach the correct mailbox, so that the first MIME recipient cannot redirect storage accidentally.
14. As an operator, I want redirected or aliased mail to use the Cloudflare routing destination, so that message headers cannot override delivery identity.
15. As an operator, I want the original `To`, `Cc`, and `Bcc` headers preserved as email metadata, so that the message display still reflects what the sender composed.
16. As an operator, I want mail for a configured domain but nonexistent mailbox to be ignored safely and logged, so that catch-all routing does not create mailboxes implicitly.
17. As an operator, I want inbound messages for different domains stored in their respective mailbox Durable Objects, so that email history remains isolated.
18. As an operator, I want attachments from different domains to remain accessible only through their owning mailbox, so that multi-domain routing does not weaken existing attachment checks.
19. As an operator, I want each mailbox's settings and system prompt to remain independent, so that domains can represent different brands and voices.
20. As an operator, I want each mailbox's Email Agent conversation to remain independent, so that AI context from one domain does not leak into another.
21. As an operator, I want MCP tools to continue requiring a full mailbox address, so that an external agent selects an unambiguous domain identity.
22. As an operator, I want to send from a mailbox on any onboarded domain, so that every receiving identity can also send and reply.
23. As an operator, I want outgoing mail to require the sender to match the selected mailbox exactly, so that one mailbox cannot impersonate another domain or address.
24. As an operator, I want outgoing Message-IDs to use the selected mailbox's domain, so that replies thread correctly and identify the proper sending domain.
25. As an operator, I want reply and forward flows to preserve the selected mailbox identity, so that multi-domain support applies consistently beyond new messages.
26. As an operator, I want the existing single-domain deployment behavior to remain unchanged, so that adding this support does not require reconfiguration or migration.
27. As an operator, I want existing mailboxes to retain their data and settings, so that enabling another domain is non-destructive.
28. As an operator, I want all configured domains to remain behind the existing Worker-level Cloudflare Access policy, so that the current trusted-operator security model remains intact.
29. As an operator, I want setup instructions to explain that Email Routing and Email Sending must be onboarded for every domain, so that adding a value to application configuration is not mistaken for completing DNS setup.
30. As an operator, I want setup instructions to include an end-to-end test for each domain, so that I can detect missing routing or sending configuration before relying on a mailbox.
31. As an operator, I want failures to identify the affected mailbox address and domain without logging message contents, so that delivery problems are diagnosable without unnecessary sensitive output.
32. As a maintainer, I want multi-domain behavior covered at the Worker boundary, so that tests protect user-visible routing and validation rather than private helper implementations.
33. As a maintainer, I want the implementation to reuse the full email address as the mailbox key, so that no new domain persistence model or data migration is required.
34. As a maintainer, I want Cloudflare to remain responsible for sender-domain onboarding and DNS verification, so that the application does not duplicate platform control-plane behavior.

## Implementation Decisions

- The feature targets multiple email domains owned by one trusted operator. It does not introduce customer tenancy.
- One Worker deployment will handle inbound events, HTTP requests, the UI, agents, and MCP for every configured domain.
- The existing comma-separated `DOMAINS` setting remains the domain registry. Entries will be trimmed, lowercased, deduplicated, and treated without a trailing DNS dot.
- The existing `EMAIL_ADDRESSES` setting remains an optional stricter mode. When it contains entries, mailbox creation and inbound acceptance require an exact normalized address match. When it is empty, the normalized domain portion must match a configured domain.
- The configuration endpoint will expose normalized, deduplicated domains and addresses so the browser and Worker apply the same effective configuration.
- Cloudflare's email event envelope recipient is the sole authority for selecting an inbound mailbox. MIME recipients are message metadata and never determine storage ownership.
- Each inbound event resolves to one normalized mailbox address. The Worker will not fan one event out based on MIME recipient headers.
- Mailbox existence remains explicit. Catch-all routing will not automatically create a mailbox when mail arrives.
- The full normalized email address remains the identifier for mailbox settings, Mailbox Durable Objects, Email Agent instances, API routes, query keys, and MCP parameters.
- No database schema, Durable Object migration, R2 migration, or new Domain entity will be introduced.
- Existing mailbox records remain compatible because they already use full email addresses as identifiers.
- Outbound sender validation continues to require an exact match between the selected mailbox and the sender address.
- One unrestricted Email Service binding will be reused. Cloudflare will continue to reject sender domains that have not been onboarded to Email Sending; a generated sender-address allowlist will not be added to deployment configuration.
- Each domain must be onboarded independently to Cloudflare Email Routing and Email Sending. Each receiving rule may target the same Worker.
- The application will not attempt to create DNS records, onboard domains, or mutate Cloudflare routing rules.
- The existing Worker-level Cloudflare Access application remains the single trust boundary. Every authenticated operator can access every mailbox across every domain.
- Email-domain support is independent from HTTP Custom Domains. Receiving email for a domain will not require serving the web UI from that domain.
- Invalid mailbox creation outside the effective configuration will return HTTP 403 with a clear configuration-focused message. Existing duplicate and validation responses remain unchanged.
- Inbound events for addresses outside the exact-address allowlist or without an existing mailbox will perform no persistence or agent trigger and will produce a concise diagnostic log.
- Delivery parsing, attachment storage, thread construction, auto-drafting, and outgoing composition remain unchanged after the correct mailbox has been selected.
- Documentation will show comma-separated multi-domain configuration and repeat the required routing, sending, DNS, and delivery checks for each domain.

## Testing Decisions

- Tests will assert externally observable behavior: Worker responses, mailbox persistence, email metadata, and agent-trigger eligibility. They will not assert helper calls, specific Durable Object IDs, or internal normalization steps.
- The primary seam is the deployed Worker boundary. Tests will invoke the exported HTTP and email entrypoints with Cloudflare-compatible bindings, then observe API responses and mailbox state through public Worker behavior.
- This seam covers both relevant entry modes without introducing several helper-level test seams: HTTP requests exercise configuration and mailbox creation, while email events exercise inbound routing.
- A configuration behavior test will prove that comma-separated domains are normalized, deduplicated, and returned consistently.
- A mailbox creation behavior test will prove that an address under either of two configured domains succeeds.
- A mailbox isolation behavior test will prove that the same local part under two domains creates independent mailboxes.
- A rejection behavior test will prove that an address outside configured domains receives HTTP 403 and creates no mailbox state.
- An exact-address mode test will prove that a listed address succeeds while an unlisted address on the same domain is rejected.
- An envelope-routing test will provide an envelope recipient that differs from the first MIME `To` recipient and prove that storage follows the envelope recipient.
- A BCC-style test will omit the envelope recipient from the MIME `To` header and prove that delivery still reaches the existing mailbox.
- A metadata test will prove that MIME `To`, `Cc`, and `Bcc` values remain stored as message metadata after envelope-based routing.
- A missing-mailbox test will prove that a valid catch-all delivery to an uncreated address creates no email and triggers no agent work.
- A two-domain inbound test will deliver one message to each domain and prove that each is visible only through its own mailbox API.
- An outbound validation test will prove that the selected mailbox cannot send using another mailbox's address.
- A regression test will prove that one configured domain and an empty exact-address allowlist retain the existing single-domain behavior.
- The repository currently has no automated test suite or prior test pattern. The implementation should add only the minimum Worker-boundary harness necessary for these scenarios and avoid a parallel unit-test architecture.
- Type checking remains a required implementation check, but it is not a substitute for the behavior tests above.

## Out of Scope

- Customer tenancy, organizations, memberships, and per-domain user authorization.
- Allowing different Cloudflare Access policies for different email domains.
- Automatically proving domain ownership inside Agentic Inbox.
- Calling Cloudflare APIs to onboard domains or create Email Routing, Email Sending, or DNS configuration.
- A domain administration dashboard, setup wizard, health checker, or DNS status monitor.
- Serving the web application from multiple HTTP Custom Domains.
- Separate R2 buckets, Durable Object namespaces, Workers, or Email Service bindings per domain.
- Cross-domain aggregate inboxes, unified search, or moving messages between mailboxes.
- Aliases that deliver one address into another mailbox.
- Automatically creating mailboxes from catch-all deliveries.
- Changing mailbox deletion behavior or cleaning up existing orphaned Durable Object and attachment data.
- Raising Cloudflare platform limits or implementing domain-scale pagination unrelated to the initial feature.

## Further Notes

- This specification chooses the recommended one-operator scope because the existing product explicitly uses one shared Cloudflare Access policy and exposes all mailboxes to every authenticated operator.
- Cloudflare currently documents separate onboarding for Email Routing and Email Sending. Sending setup creates bounce MX, SPF, DKIM, and DMARC records; routing setup creates its own root-domain mail records.
- Cloudflare's email event exposes the SMTP envelope recipient as a singular `to` value. That value is more authoritative than MIME headers and is the key correctness change in this feature.
- Cloudflare currently documents limits including 30 Email Routing or Email Sending domains per zone, 200 routing rules per domain, 200 destination addresses per account, and a 25 MiB inbound message size.
- A practical acceptance pass should use two domains with the same local part and verify inbound, BCC inbound, new outbound mail, reply, and mailbox isolation for both.


## Completion

Completed through child Assignments `agentic-inbox-multi-jiik`, `agentic-inbox-multi-6eqn`, and `agentic-inbox-multi-be01`. Final implementation is integrated into `main` through `d461d6d`.

Verification:

- `npm run test:worker` — 17 tests passed.
- `npm run typecheck` — passed.
- `git diff --check origin/main..HEAD` — passed.
- Final Hunk review — no feedback.
