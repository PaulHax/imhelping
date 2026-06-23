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

Use `base-review-with-simplify.md` when the review worker should use native
review and simplify tools if the current CLI exposes them. Use `base-review.md`
for correctness-only review passes.
