# Design: System Overview & Core Modes

## Affected Files
1. `blueprint/README.md` & `docs/blueprint/README.md`
2. `blueprint/architecture/system-overview.md` & `docs/blueprint/architecture/system-overview.md`
3. `blueprint/vocabulary.md` & `docs/blueprint/vocabulary.md`

## Structural Changes

### 1. System Redefinition
Replace the existing "RQ1" and "Evaluation System" text with the new definition of Harness:
- **Core Entity**: A local-first Agent system managing LLMs.
- **Capabilities**: Source code reading, tool execution, context management, multi-turn reasoning.
- **Purpose**: Autonomous vulnerability detection and verification for blockchain smart contracts, providing superior outcomes compared to standard chat interfaces.

### 2. Core Operation Modes
Introduce two distinct operational modes into the architecture overview:
- **Audit Mode**:
  - The system analyzes a given smart contract repository from scratch.
  - Generates new "findings" (vulnerabilities, logic errors, gas optimizations) similar to the output expected in Code4rena or Sherlock audits.
- **Judge Mode**:
  - The system takes an existing set of findings (or a single finding) as input.
  - Evaluates the validity of the findings by checking the codebase.
  - Identifies and filters out duplicate findings.

### 3. Vocabulary Updates
- Remove outdated terms related to the research evaluation (e.g., `Scorer`, `Evaluation Pipeline`).
- Add terms: `Audit Mode`, `Judge Mode`, `Finding`, `Duplicate Filtering`, `Smart Contract Auditing`.
