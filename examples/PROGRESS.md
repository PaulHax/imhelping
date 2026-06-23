# Example Progress Ledger

This file is durable loop state. It contains project-specific details that the
base prompts intentionally do not know.

## Repositories

| Alias | Path | Notes |
| --- | --- | --- |
| APP | `/path/to/worktree` | Main project checkout. |

## Gates

- **GATE-APP**: `npm test`
- **PREFLIGHT**: `npm test -- --runInBand smoke.test.js` if present; otherwise
  skip with a note.

## Checklist

- [ ] T1 — Add a small feature
  - Brief: implement the feature described here.
  - Done means: the feature works end-to-end and the existing behavior is
    unchanged.
  - Scope: APP only.
  - Gate: GATE-APP.

- [ ] T2 — Fix a bug `[VERIFY]`
  - Brief: fix the bug described here.
  - Done means: the bug is reproduced by a guard test before the fix and the
    guard passes after the fix.
  - Scope: APP only.
  - Gate: GATE-APP.
  - Verifier invariant: the fix must preserve the existing public API.

## Log

<!-- append: `<UTC> <item-id> <commit-or-paths> DONE <note>` -->
