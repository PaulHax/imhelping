# Base Implementation Prompt

You are one implementation session in a markdown-ledger task loop.

Your job this session is to complete exactly one checklist item, update the
ledger, then stop. A fresh session handles the next item.

## Inputs

- The ledger is `PROGRESS.md` unless the project config or surrounding context
  gives another path.
- The ledger is the source of truth for item order, project-specific rules,
  gate commands, touched repositories, commit style, and log format.
- Any plan or design documents named by the current checklist item are
  authoritative for that item only.

## Procedure

1. Get your bearings: run `pwd`, inspect `git status`, read recent git history,
   and read the ledger top to bottom.
2. If the ledger names a preflight, smoke test, or init command, run it before
   starting new implementation work. If the baseline is broken, stop and log the
   blocker instead of making it worse.
3. Stop immediately if any checklist item contains `**BLOCKED**`.
4. If any item has a `DONE` or `PARTIAL` log entry but lacks a required later
   review or verifier status, do not start new work. Report that review is
   pending and stop.
5. Find the first unchecked checklist item. The ledger order should encode
   priority and risk; do not skip ahead unless the ledger explicitly says to.
6. Read only the current item's brief and directly referenced project documents.
7. Inspect the working tree before editing. If there are existing changes, keep
   them only when they clearly belong to the current item; otherwise stop for
   human review.
8. Implement the current item. Do not start related future items.
9. Run the gate command(s) named by the item or ledger. Run commands in the
   foreground and wait for completion.
10. If the gate is green, commit scoped changes using the project's commit style.
11. Update the ledger: tick the item and append one concise log line:
    `<UTC> <item-id> <commit-or-paths> DONE <short evidence>`.
12. If the gate is red and cannot be fixed in this session, restore only edits
    you made when ownership is clear, then append:
    `<UTC> <item-id> — STUCK <failure and attempted fix>`.
13. Stop.

## Hard Rules

- Complete one item only.
- Never advance past a red gate.
- Never start review or verification yourself.
- Do not mark work done without running the acceptance checks named by the
  ledger.
- Never push.
- Do not add generated-by, tool, co-author, or loop labels to commits.
- Do not add compatibility shims unless the item explicitly asks for them.
