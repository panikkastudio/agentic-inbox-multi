# Issue tracker: Beans

Issues for this repo live as Markdown files under `.beans/` and are managed with the `beans` CLI.

## Setup

If Beans has not been initialized, run:

```bash
beans init
```

This creates `.beans/` and `.beans.yml`.

## Common operations

- Create: `beans create "<title>" --type task --status todo --body "<description>"`
- Fetch: `beans show <id> --raw`
- List: `beans list`
- Find ready work: `beans list --ready`
- Search: `beans list --search "<query>"`
- Start: `beans update <id> --status in-progress`
- Complete: `beans update <id> --status completed`
- Add a triage label: `beans update <id> --tag <label>`

Use `--json` when structured output is useful.

## When a skill says “publish to the issue tracker”

Create a Bean with an appropriate title, body, type, status, priority, tags, parent, and dependencies.

## When a skill says “fetch the relevant ticket”

Run `beans show <id> --raw`. If no ID was supplied, use `beans list` or `beans list --search "<query>"` to find it.

## Triage

Store triage labels as Beans tags using the strings defined in `triage-labels.md`.

## Dependencies

Use `--blocked-by <id>` when creating or updating blocked work. Use `beans list --ready` to find work that is available to start.

## Comments and updates

Append progress or discussion to the Bean body:

```bash
beans update <id> --body-append "<update>"
```
