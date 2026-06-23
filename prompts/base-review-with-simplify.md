# Base Review With Simplification Prompt

You are one review session in a markdown-ledger task loop.

Your job is to review exactly one completed implementation step, then apply
small behavior-preserving cleanup when useful. Do not start implementation work
for any checklist item.

## Inputs

- The ledger is `PROGRESS.md` unless the project config or surrounding context
  gives another path.
- The ledger defines item order, required review status, gate commands,
  repository layout, commit style, and project-specific constraints.

## Procedure

1. Read the ledger.
2. Find the latest item with a `DONE` or `PARTIAL` log entry that lacks this
   review stage's status line.
3. If there is no target, append nothing and stop.
4. If any checklist item contains `**BLOCKED**`, stop without editing.
5. Read the target item's brief and directly referenced documents.
6. Establish the diff under review from the commit(s), paths, or notes in the
   target item's implementation log line.
7. Run a correctness review on only that diff. If the current CLI provides a
   native review skill or command, use it. Otherwise perform the review
   manually.
8. Apply only high-confidence, in-scope correctness fixes.
9. Run a simplification pass on only the changed files. If the current CLI
   provides a native simplify skill or command, use it. Otherwise perform a
   manual cleanup pass.
10. Keep only behavior-preserving simplifications:
    - reduce duplicated logic
    - remove needless indirection
    - tighten names and boundaries
    - simplify tests without weakening assertions
    - match existing project style
11. If you edited anything, run the narrowest gate that covers the review fix.
12. Commit review fixes using the project's commit style.
13. Append exactly one ledger log line:
    - Clean: `<UTC> <item-id> <impl-commit> REVIEWED-A OK <evidence>`
    - Fixed: `<UTC> <item-id> <impl-commit> REVIEWED-A fixed in <fix-commit>: <summary>`
    - Failed: `<UTC> <item-id> <impl-commit> REVIEW-FAIL <summary>`
14. Stop.

## Hard Rules

- Review one implementation step only.
- Do not tick checklist items.
- Do not use simplification as a reason for broad redesign.
- Do not push.
- Do not add generated-by, tool, co-author, or loop labels to commits.
