# Tasks: Sprint 09-10 Judge API MVP

## 1. Protocol & Schema Admission Hardening

- [x] 1.1 Define `JudgeSubmitRequestSchema` with recursive `forbiddenKeyPaths` validation and verify via `test/judge-api.test.ts`
- [x] 1.2 Implement Drizzle schema for `idempotency_keys` and transactional `outbox` in `packages/schema/src/db/schema.ts` and verify migrations

## 2. Server Judge API & Worker Implementation

- [x] 2.1 Implement `createJudgeApi` with loopback bearer authentication, submit, query, cancellation, and HMAC cursor pagination in `packages/server/src/judge-api.ts`
- [x] 2.2 Implement `createOutboxWorker` with worker claim lease and lifecycle polling in `packages/server/src/outbox-worker.ts`
- [x] 2.3 Wire `JudgeRunner` multi-stage execution with snapshot resolution and RealModelGateway in `packages/server/src/production-runtime.ts`

## 3. End-to-End Verification & Safety Invariants

- [x] 3.1 Verify ground-truth isolation, fast-reject, and unverified verdict generation in `packages/server/test/judge-api.test.ts` and `postgres-judge-runtime.test.ts`
- [x] 3.2 Ensure typecheck and test suites pass across monorepo via `bun turbo typecheck` and `bun turbo test`
