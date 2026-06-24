# imhelping

Reusable Node runner for large markdown-ledger implementation sessions.

It keeps state outside the model context:

- a markdown checklist with `- [ ]` / `- [x]` items
- an append-only `## Log`
- git commits and per-stage logs

Each implementation or review stage starts as a fresh CLI process.

## Install

```bash
npm install -g github:PaulHax/imhelping   # or, from a checkout: npm link
```

This puts `imhelping` on your PATH. You never need to vendor this repo into a
project. Keep one install and put each session's `imhelping.json` + `PROGRESS.md`
**next to the plan doc** it drives; the bundled prompts are resolved from the
install, not from the session dir.

## Quickstart

```bash
imhelping init --plan ./PLAN.md --workdir /path/to/checkout --name my-loop
# edit the generated PROGRESS.md: set GATE-APP and the checklist
imhelping status --config ./imhelping.json
imhelping loop   --config ./imhelping.json
```

`init` scaffolds `imhelping.json` and a `PROGRESS.md` skeleton in the config's
directory (default: the current dir) and never overwrites existing files unless
you pass `--force`.

## Commands

```bash
imhelping init   --plan PLAN.md --workdir DIR   # scaffold a session
imhelping status --config imhelping.json        # print next action, no run
imhelping once   --config imhelping.json        # run the next ready stage
imhelping loop   --config imhelping.json        # run until done or blocked
imhelping pause  --config imhelping.json        # clean pause after current stage
imhelping resume --config imhelping.json        # clear the pause
```

`once` runs the next ready stage. `loop` keeps running stages until the ledger is
complete, blocked, or a real failure occurs.

## Pausing a run

`pause` writes a sentinel file (`imhelping.pause`, next to the config by default;
override with `session.pauseFile`). A running `loop` checks it at each stage
boundary: the in-flight stage finishes (commit + log), then the loop stops
cleanly with exit code 14, leaving the ledger consistent and resumable. `resume`
removes the sentinel so `loop` can continue. This is the clean way to stop a long
unattended run; Ctrl-C is a hard stop that can leave the in-flight stage
half-done.

## Ledger Contract

Checklist items need stable ids at the start of each checkbox line:

```markdown
- [ ] **F1 — Add the guard test and port the fix**
- [ ] 2.3 — Update the provider lifecycle
```

Log lines use:

```text
<UTC> <item-id> <commit-or-paths> DONE <note>
<UTC> <item-id> <commit-or-paths> PARTIAL <note>
<UTC> <item-id> <commit-or-paths> REVIEWED-A <note>
<UTC> <item-id> VERIFIED <note>
```

The runner will not start a new implementation if the latest `DONE` or
`PARTIAL` line still lacks a configured review status.

Set `logAfter` when a progress file has older log history that should not count
for the current loop. The original refactor loop uses this to ignore work logged
before its `review-baseline` marker.

## Config Shape

```json
{
  "session": {
    "name": "example",
    "workdir": "/path/to/worktree",
    "progress": "PROGRESS.md",
    "logs": "logs",
    "addDirs": ["/path/to/plan-dir"],
    "watchGit": ["/path/to/worktree"],
    "watchFiles": [],
    "maxSteps": 40,
    "logAfter": ""
  },
  "implementation": {
    "engine": "codex",
    "prompt": "AGENT_PROMPT.md",
    "status": "DONE"
  },
  "reviews": [
    {
      "key": "review-a",
      "enabled": true,
      "engine": "claude",
      "prompt": "REVIEW_PROMPT.md",
      "status": "REVIEWED-A",
      "model": "opus"
    },
    {
      "key": "verify",
      "enabled": true,
      "engine": "claude",
      "prompt": "VERIFY_PROMPT.md",
      "status": "VERIFIED",
      "itemFilter": "[VERIFY]",
      "verdictFile": "logs/verdict.json",
      "blockOnVerdictFail": true,
      "cleanupAfter": true
    }
  ]
}
```

Reusable base prompts live under [prompts](prompts/):

- [base-implementation.md](prompts/base-implementation.md)
- [base-review.md](prompts/base-review.md)
- [base-review-with-simplify.md](prompts/base-review-with-simplify.md)
- [base-verifier.md](prompts/base-verifier.md)

Each stage's `prompt` is optional and resolves in three forms:

- **omitted**: the bundled default (`base-implementation` for the
  implementation stage, `base-review` for a review stage).
- **a bare name** like `"base-review-with-simplify"`: resolved from the
  installed `prompts/` dir, so a config beside a plan doc needs no path back into
  this checkout.
- **a path**: resolved relative to the config file.

Use the base prompts across projects and put project-specific paths, gates,
constraints, and item briefs in the ledger. See
[examples/PROGRESS.md](examples/PROGRESS.md) for the expected shape.

Keep the ledger explicit about:

- what "done" means for each item
- gate commands that must pass before committing
- any preflight or smoke check agents should run before new work
- item order, with riskier integration work placed earlier when appropriate
- edge cases that must not be skipped

Engines:

- `codex`: runs `codex exec` with the prompt on stdin.
- `claude`: runs `claude -p` with the prompt on stdin.
- `none`: disabled.

Per-stage `model` and `args` are optional. To switch implementation or review
ownership, edit the relevant `engine` value. To disable a review stage, set
`enabled` to `false` or `engine` to `none`.

## Usage-Limit Handling

The runner scans each stage log for quota, usage, rate-limit, and reset strings.
If found, it sleeps until the parsed reset hint or `retrySleep`, then retries the
same stage without advancing the ledger. `retryMax` caps repeated failures.

Tests use fake `codex` and `claude` executables to verify both provider paths:

```bash
npm test
```

## Practical Defaults

- Make implementation prompts finish exactly one item, commit, update the log,
  then stop.
- Make review prompts inspect only the newest unreviewed implementation, commit
  scoped fixes if needed, append their review status, then stop.
- Use the simplification review prompt when the reviewer should call native
  review or simplify tools if available.
- Keep verifier prompts read-only and have them write a JSON verdict file; the
  runner can append `VERIFIED` or mark the item blocked.
- Use `loop` for long unattended runs when every configured stage can run
  non-interactively.
