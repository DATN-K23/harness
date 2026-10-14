# Audit Pipeline Proposal

This proposal adopts the approach described in the core paper:

> **Bernhard Mueller, "Hound: Relation-First Knowledge Graphs for Complex-System Reasoning in Security Audits," _arXiv preprint arXiv:2510.09633_, 2025. [Online]. Available: [https://arxiv.org/abs/2510.09633](https://arxiv.org/abs/2510.09633) ([HTML](https://arxiv.org/html/2510.09633v1))**  
> **Reference Implementation:** [https://github.com/scabench-org/hound](https://github.com/scabench-org/hound)

## Overview

Hound introduces a relation-first graph engine designed for system-level reasoning across complex smart contract codebases:

- **Relation-First Knowledge Graphs:** Analyst-defined, multi-scale aspect graphs (system architecture, authentication/authorization roles, value/monetary flows, call graphs, protocol invariants) with typed annotations that ground cross-component code retrieval.
- **Persistent Belief System:** Long-lived vulnerability hypotheses updated as evidence accrues across auditing loops.
- **Adaptive Planning & QA Finalization:** Coverage sweep followed by intuition-driven deep dives, verified with dedicated QA before emitting findings.
