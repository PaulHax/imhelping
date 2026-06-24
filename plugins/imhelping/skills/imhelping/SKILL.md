---
name: imhelping
description: >-
  Turn a plan/BUILD/spec doc into an imhelping markdown-ledger loop. Use when the
  user wants to point at a plan doc and have it built out as a phased, red/green
  TDD implementation that auto-loops via the imhelping CLI (codex implements,
  claude reviews each phase). Scaffolds imhelping.json + PROGRESS.md NEXT TO the
  plan doc, authors phased TDD items with an end-to-end test where the phase has
  visible behavior, validates with `imhelping status`, then hands over the run
  command. Triggers: "use imhelping on <doc>", "set up an imhelping loop", "build
  this plan with imhelping".
---

# imhelping loop setup

`imhelping` is a globally-installed CLI (a markdown-ledger task-loop runner). It
runs one phase per fresh headless CLI session: an implementation stage, then a
review stage, advancing only when the ledger records the required status. Your
job in this skill is to translate a plan doc into a runnable ledger, not to run
the whole loop yourself.

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
7. **Hand over.** Print the run commands; do NOT start the loop yourself (it
   commits across many sessions in the target repo). Offer a single dry-run step.
   ```
   imhelping status --config <plan-dir>/imhelping.json   # next action, no run
   imhelping once   --config <plan-dir>/imhelping.json   # run one stage
   imhelping loop   --config <plan-dir>/imhelping.json   # run until done/blocked
   ```

## Notes

- **Sessions live next to the plan doc.** Never put `imhelping.json` / `PROGRESS.md`
  inside the imhelping checkout. Bundled prompts resolve from the install, so the
  config needs no path back into the checkout (omit `prompt`, or use a bare name
  like `base-review-with-codex`).
- **WSL projects:** run `imhelping`, `node`, and the engines through the shell
  where they are installed (`wsl.exe -e bash -lc '...'` on a Windows host).
- **Ledger contract:** ids must be the first token of the checkbox line. Log
  lines are `<UTC> <item-id> <commit-or-paths> <STATUS> <note>`; the implementation
  session appends `DONE`, the review session appends `REVIEWED-A`. The loop will
  not start the next item while a `DONE` lacks its required review status.
- **One item per session.** Keep items small enough to implement, test, and
  commit in a single focused session. Place riskier integration work earlier.
- **Don't auto-run `loop`** unless the user explicitly asks. It is a long,
  unattended, committing run against the target repo.
