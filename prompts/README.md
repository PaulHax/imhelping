# Prompt Templates

These prompts are reusable defaults. They intentionally avoid project-specific
paths, branches, commands, and architecture rules.

Put project-specific details in the ledger:

- repository paths
- plan documents
- item briefs
- gate commands
- commit style
- review status names
- invariants for verifier phases

Then point `imhelping.json` stages at one of these templates:

```json
{
  "implementation": {
    "engine": "codex",
    "prompt": "prompts/base-implementation.md",
    "status": "DONE"
  },
  "reviews": [
    {
      "key": "review-a",
      "engine": "claude",
      "prompt": "prompts/base-review-with-simplify.md",
      "status": "REVIEWED-A"
    }
  ]
}
```

Use `base-review-with-simplify.md` (the `init` default) when the review worker
should run a correctness review, apply its findings, and finish with a
behavior-preserving simplify pass, using the current CLI's native review and
simplify tools if it exposes them. Use `base-review.md` for correctness-only
review passes.
