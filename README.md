This project is an implementation of the approach described in the paper:

> **L. Chen, R. Yan, T. Wong, Y. Chen, J. Wang, and C. Zhang, "SmartPoC: Generating Executable and Validated PoCs for Smart Contract Bug Reports," _arXiv preprint arXiv:2511.12993_, 2025. [Online]. Available: https://arxiv.org/abs/2511.12993**

## Audit Mode Reference Implementation (Demo)

This branch includes a working reference implementation of SmartPoC for Audit Mode to help teammates understand how BCE, GRE, and DV work in practice before reviewing the Judge Mode proposal.

> Read: [Audit Mode Reference Implementation Guide](audit-mode-reference-implementation-guide.md)

## Proposal: SmartPoC as the Core Agent for Judge Mode

This branch presents the architectural proposal to evolve SmartPoC from a downstream audit filter into the primary autonomous adjudication agent for **Judge Mode**.

Key enhancements in the proposal:

- **Bidirectional Report Verification:** Pairs forward reachability exploration with active backward exploit reconstruction from the claimed impact state to evaluate submitter report narratives against BCE code slices.
- **Consensus & Empirical Witness Resolution:** When static forward and backward reasoning align, verdicts are reached directly; when disputed or inconclusive, the SmartPoC execution sandbox synthesizes and runs a targeted Foundry witness test to objectively arbitrate the claim.

> Read: [Proposal: SmartPoC as the Core Agent for Judge Mode](proposal.md)
