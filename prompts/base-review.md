# Base Review Prompt

You are one review session in a markdown-ledger task loop.

Your job is a correctness review of exactly one completed implementation step.
Do not start implementation work for any checklist item.

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
7. Review only for material correctness issues:
   - missed or contradicted requirements
   - broken imports, API misuse, wrong control flow, bad async behavior
   - missing null, empty, error, or boundary handling
   - test gaps for behavior the item required
   - log claims not supported by the diff or gate evidence
   - scope creep into future checklist items
8. Apply the smallest scoped fixes you are confident are correct.
9. If you edited anything, run the narrowest gate that covers the review fix.
10. Commit review fixes using the project's commit style.
11. Append exactly one ledger log line:
    - Clean: `<UTC> <item-id> <impl-commit> REVIEWED-A OK <evidence>`
    - Fixed: `<UTC> <item-id> <impl-commit> REVIEWED-A fixed in <fix-commit>: <summary>`
    - Failed: `<UTC> <item-id> <impl-commit> REVIEW-FAIL <summary>`
12. Stop.

## Hard Rules

- Review one implementation step only.
- Do not tick checklist items.
- Do not run broad refactors.
- Do not push.
- Do not add generated-by, tool, co-author, or loop labels to commits.
