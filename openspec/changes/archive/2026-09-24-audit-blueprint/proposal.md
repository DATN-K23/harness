# Proposal: Reorient Harness as a Blockchain Auditing & Judging Agent System

## Goal
Redefine the core identity of Harness in the blueprint. It is not a research evaluation system. It is a local-first AI Agent system designed to wrap LLMs and provide them with tools, context management, and multi-turn reasoning to autonomously analyze source code and discover/verify vulnerabilities.

## Context & Problem
Currently, the blueprint (inherited from a previous project) describes Harness as a tool to measure whether an agent's orchestration is better than a single-shot prompt (measuring RQ1). This is incorrect for our thesis (DATN). Our goal is to build the Agent Harness itself, focusing specifically on Web3/Blockchain security (smart contracts). 

## Proposed Changes
We will update the system overviews across the blueprint to define the system's true purpose and its two primary modes of operation:
1. **Audit Mode**: The agent acts as an auditor for blockchain source code (similar to Code4rena, Sherlock contests), actively searching for new vulnerabilities (findings).
2. **Judge Mode**: The agent acts as a judge, taking an existing list of findings or a single finding, filtering out duplicates, and verifying their validity against the codebase.

## Success Criteria
- The blueprint clearly explains what Harness is without referencing research evaluation or scoring methodologies.
- Both Audit Mode and Judge Mode are well-defined in the architecture overview.
