## Why

Currently, the `judge-verdict.schema.json` requires the LLM to output a `content_digest` (a SHA-256 hash) for the evidence it finds. LLMs are incapable of reliably computing cryptographic hashes, which leads to hallucinated values. This causes evidence resolution to fail at the Orchestrator level, triggering retries and ultimately resulting in Denial of Service (DoS) via budget exhaustion without a valid verdict. We need to fix this to ensure reliable agent execution and save API costs.

## What Changes

- Remove `content_digest` from the `required` array in the `evidence` object of the LLM-facing `judge-verdict.schema.json`.
- Keep `content_digest` in the broader storage/schema definitions (as it's needed for persistence and tracking) but mark it as an Orchestrator-computed field.
- Update `judge-verdict.md` to specify that the Orchestrator computes the digest based on `path`, `start_line`, and `end_line` against the immutable source snapshot during evidence resolution.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-judge-verdict`: Remove the requirement for the LLM to provide `content_digest` in evidence items; shift the responsibility of computing `content_digest` to the Orchestrator.

## Impact

- **Blueprint:** Modifications to `blueprint/contracts/judge-verdict.schema.json` and `blueprint/contracts/judge-verdict.md`.
- **System:** Eliminates a systemic hallucination failure mode, greatly improving reliability and reducing retry costs. The Orchestrator's evidence resolution logic will now independently compute the digest from the snapshot rather than blindly expecting the LLM to provide it.
