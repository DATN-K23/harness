## 1. Modify JSON Schema

- [x] 1.1 Edit `blueprint/contracts/judge-verdict.schema.json` to remove `"content_digest"` from the `required` array in the `evidence` object definition (around line 68). (TV1/WP-02)
- [x] 1.2 Verify that `content_digest` remains defined in the `properties` of `evidence` (as the Orchestrator will still populate it for the final verdict).

## 2. Update Blueprint Documentation

- [x] 2.1 Edit `blueprint/contracts/judge-verdict.md` to specify that `content_digest` is computed independently by the Orchestrator during evidence resolution, rather than expected from the LLM output. (TV1/WP-02)
- [x] 2.2 Review the change to ensure it aligns with the threat model (TM-01, TM-09).
