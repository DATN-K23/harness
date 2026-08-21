# Judge Verdict Semantics

Normative: yes  
Schema: `judge-verdict.schema.json` (`judge-verdict-v1`)  
Owner: TV1; collaborators: TV4, TV5

## Cross-field rules

1. `validity=valid` requires severity `low|medium|high|critical`.
2. `validity=invalid` requires severity `none`.
3. Confidence is finite and within inclusive `[0,1]`; it is not a calibrated probability claim.
4. At least one evidence item is required for either validity value.
5. JSON Schema path syntax is only a first check. Workspace authorization, line ordering/range, symlink resolution, and content digest are validated against the run's immutable source snapshot.
6. `verification_status` is fixed to `unverified`. No provider response can override it.
7. A valid JSON object that fails evidence resolution cannot complete the run.

## Repair boundary

Schema and evidence failures produce safe field-level issues. When the versioned repair flag is enabled, these issues may be returned to the model within configured attempt and run budgets. Raw prohibited path resolution and ground-truth material never enter repair context.

## Fixtures

| File | Expected | Reason |
|---|---|---|
| `examples/verdict-valid.json` | pass | Valid verdict, bounded confidence, one evidence item, unverified. |
| `examples/verdict-invalid.json` | pass | Invalid finding with severity none and evidence. |
| `examples/verdict-confidence-zero.json` | pass | Inclusive lower confidence boundary. |
| `examples/verdict-confidence-one.json` | pass | Inclusive upper confidence boundary. |
| `examples/verdict-invalid-severity.json` | fail | Invalid finding claims high severity. |
| `examples/verdict-missing-evidence.json` | fail | Evidence array is empty. |
| `examples/verdict-path-traversal.json` | fail | Evidence path contains parent traversal. |
| `examples/verdict-confidence-out-of-range.json` | fail | Confidence exceeds one. |
