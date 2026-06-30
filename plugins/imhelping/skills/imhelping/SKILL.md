---
name: imhelping
description: >-
  Set up and run an imhelping markdown-ledger loop. Use when the user wants to
  turn a plan/BUILD/spec doc into a phased, red/green TDD implementation that
  auto-loops via the imhelping CLI (codex implements, claude reviews each phase),
  OR when they point at an existing PROGRESS.md and want the loop driven against
  it. Scaffolds imhelping.json + PROGRESS.md NEXT TO the plan/ledger, authors
  phased TDD items with an end-to-end test where the phase has visible behavior,
  validates with `imhelping status`, and runs `imhelping loop` when asked.
  Triggers: "use imhelping on <doc>", "set up an imhelping loop", "build this
  plan with imhelping", "run the loop on <PROGRESS.md>", "kick off the loop".
---

# imhelping loop

`imhelping` is a globally-installed CLI (a markdown-ledger task-loop runner). It
runs one phase per fresh headless CLI session — an implementation stage, then a
review stage — advancing only when the ledger records the required status.

This skill covers two jobs, often back to back:

- **Set up** a ledger from a plan doc (most of the steps below).
- **Run** the loop — when the user says "run it" / "kick off the loop", or points
  at an existing `PROGRESS.md` and asks you to drive it. See **Run the loop**.

A working session needs TWO files side by side: `PROGRESS.md` (the ledger) and
`imhelping.json` (the config). `imhelping init` creates both. Never hand-author
just a `PROGRESS.md` and expect the loop to run — with no config there is nothing
to point `--config` at. If a ledger already exists without a config, run `init`
to create the missing config (it leaves an existing `PROGRESS.md` untouched).

## Prerequisites

Check the CLI is on PATH in the environment where the coding engines live:

```
imhelping --help        # if the project is under WSL, run via: wsl.exe -e bash -lc 'imhelping --help'
```

If missing: `npm install -g github:PaulHax/imhelping` (or `npm link` from a
checkout). It needs `node >= 22` and the `codex` and/or `claude` CLIs on PATH.

## Inputs to resolve first

1. **Plan doc**: the path the user gave. Its directory is the **session home**;
   the config and ledger live there, never inside the imhelping checkout.
2. **Target checkout (`--workdir`)**: the repo/worktree the loop edits. Look for
   a "target worktree" line in the plan doc; otherwise ask the user.
3. **Engines**: default is codex (implementation) + claude (review-a). Only
   change if the user says so or only one CLI is installed.

## Procedure

1. **Read the plan doc fully.** Note its phases, the target worktree, any
   project constraints (e.g. an AGENTS.md "no back-compat / no shims"), and the
   acceptance criteria.
2. **Detect the gate commands and test harness** in `--workdir`: the test runner
   (pytest / npm test / cargo etc.), how to run unit vs e2e, and whether an e2e
   harness exists (Playwright, a `tests/*_e2e` convention, a server fixture).
   Read one existing test to learn the project's conventions.
3. **Scaffold** (writes `imhelping.json` + `PROGRESS.md` in the plan dir):
   ```
   imhelping init --config <plan-dir>/imhelping.json \
     --plan <plan-doc> --workdir <target-checkout> --name <slug>
   ```
4. **Author the ledger** (`<plan-dir>/PROGRESS.md`), replacing the placeholder
   item. Decompose the plan into one checklist item per shippable sub-step, in
   dependency order, each with a **stable id** as the first token
   (`- [ ] **A1 - ...**`). Per item:
   - **Brief**: what to do; cite plan section and `file:symbol` touch points.
   - **Done means**: observable acceptance (from the plan's "done when").
   - **TDD**: the failing test to write first (red), then the green criteria.
   - **E2E**: for any item with user-visible behavior, the end-to-end assertion
     on rendered/observable output (never on internal state); else "n/a, unit".
   - **Scope**: which repo/area.
   - **Gate**: the gate name(s) the item must pass before commit.
5. **Fill the Gates and Conventions sections** with the real commands from step 2
   (e.g. `GATE-UNIT`, `GATE-E2E`, `GATE-FULL`). Keep the red/green TDD and
   one-item-per-session conventions the scaffold provides.
6. **Validate**: `imhelping status --config <plan-dir>/imhelping.json` should
   print `next implementation item=<first-id>`. Fix the ledger if it reports
   "no checkbox items" (ids missing) or "blocked".
7. **Hand over or run.** Print the run commands. If the user asked you to set up
   *and* run, continue to **Run the loop**. Otherwise stop here — `loop` commits
   unattended across many sessions, so don't start it uninvited.
   ```
   imhelping status --config <plan-dir>/imhelping.json   # next action, no run
   imhelping once   --config <plan-dir>/imhelping.json   # run one stage
   imhelping loop   --config <plan-dir>/imhelping.json   # run until done/blocked
   ```

## Run the loop

When the user asks you to run / kick off the loop, or points you at an existing
`PROGRESS.md`:

1. **Locate the ledger.** Its directory is the session home, and `imhelping.json`
   lives beside it. If the config is missing, create it — `init` writes only the
   missing config and leaves an existing `PROGRESS.md` unchanged:
   ```
   imhelping init --config <ledger-dir>/imhelping.json \
     --plan <plan-or-ledger> --workdir <target-checkout> --name <slug>
   ```
   Ask for `--workdir` if nothing names the target checkout.
2. **Confirm the next action** before running anything:
   ```
   imhelping status --config <ledger-dir>/imhelping.json
   ```
   It prints e.g. `next review-a item=P1 ...`. If it reports an unexpected stage
   or `no checkbox items`, the ledger format is off — see **Ledger contract**.
3. **Run it:**
   ```
   imhelping once --config <ledger-dir>/imhelping.json   # one stage, to sanity-check
   imhelping loop --config <ledger-dir>/imhelping.json   # until done or blocked
   ```
4. **Expect silence.** Each stage runs an engine headless; `claude -p` and
   `codex exec` may print nothing until the stage finishes, which can take
   several minutes, so the stage log sits empty meanwhile. That is NOT a hang —
   do not interrupt or relaunch. Follow progress by tailing the `log:` path the
   runner prints, or by running `imhelping status` between stages.

## Notes

- **Sessions live next to the plan doc.** Never put `imhelping.json` / `PROGRESS.md`
  inside the imhelping checkout. Bundled prompts resolve from the install, so the
  config needs no path back into the checkout (omit `prompt`, or use a bare name
  like `base-review-with-simplify`).
- **WSL projects:** run `imhelping`, `node`, and the engines through the shell
  where they are installed (`wsl.exe -e bash -lc '...'` on a Windows host).
- **Ledger contract.** Two line shapes drive the loop, and a malformed one is
  the usual reason `status` reports the wrong next action:
  - **Checklist item:** the id is the first token of the checkbox text, e.g.
    `- [ ] **P1 - ...**`. Items advance in file order.
  - **Log line:** the UTC timestamp must be the first real token (a leading `- `
    bullet is tolerated, nothing else) — `<UTC> <item-id> <commit-or-paths>
    <STATUS> <note>`. The implementation session appends `DONE`; the review
    session appends `REVIEWED-A`. The loop will not start the next item while a
    `DONE` lacks its required review status. If a `DONE` line is mis-formatted
    (timestamp not first, or `<item-id>` not matching the checkbox id), the loop
    can't see it and skips ahead to the next item's implementation.
- **One item per session.** Keep items small enough to implement, test, and
  commit in a single focused session. Place riskier integration work earlier.
- **`loop` is unattended and commits** across many sessions in the target repo.
  Run it when the user asks (see **Run the loop**); when you are only setting up
  a ledger, hand over the commands instead of starting it uninvited.
