## Context

As described in the proposal, LLMs cannot generate reliable SHA-256 hashes, leading to hallucinated `content_digest` values in evidence items. The Orchestrator's evidence resolution currently expects the LLM to provide this digest, which it then validates. 

## Goals / Non-Goals

**Goals:**
- Eliminate LLM hallucination for `content_digest` by removing it from the required LLM output schema.
- Ensure the Orchestrator can still securely bind evidence to the immutable source snapshot by computing the digest itself.

**Non-Goals:**
- Removing `content_digest` entirely from the persistence or API layers (it is still needed for reproducibility and export).

## Decisions

### 1. Orchestrator-Computed Digest
**Decision**: The `content_digest` field will be removed from the `required` array in the LLM's `judge-verdict.schema.json`. During the "evidence resolution" phase, the Orchestrator will read the exact bytes from the immutable source snapshot using the provided `path`, `start_line`, and `end_line`, compute the SHA-256 hash, and inject `content_digest` into the final verified verdict object before persistence.
**Alternatives considered**: 
- *Keeping it as a required field but ignoring its value*: Still costs output tokens and encourages the model to hallucinate, which is a bad pattern.
- *Removing it entirely from the system*: Violates the need for cryptographic evidence binding in the research protocol.

## Risks / Trade-offs

- **Risk**: The Orchestrator might compute a digest that differs from what the model "saw" if line endings (CRLF vs LF) or file encodings are mishandled.
- **Mitigation**: The Orchestrator must use the exact byte span from the canonical source snapshot without any normalization during the hash computation.
