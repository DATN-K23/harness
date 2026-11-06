import { expect, test } from "bun:test"
import { realpath } from "node:fs/promises"
import { createReviewedFoundryVerification, type ReviewedFoundryFixture } from "@harness/core/verification"
import { InMemorySnapshot } from "@harness/core/testing"
import { textDigest } from "../../src/util/digest"

const snapshotId = "benign-reviewed-fixture"
const files = { "src/Target.sol": "pragma solidity 0.8.30; contract Target { function value() external pure returns (uint) { return 7; } }" }
const source = new InMemorySnapshot({ snapshotId, files })
const testFile = (expected = 7) => `pragma solidity 0.8.30;
import "../src/Target.sol";
contract ReviewedTest {
  function testValue() public {
    require(new Target().value() == ${expected}, "fixture value mismatch");
  }
}`
const unavailable = { version: "unavailable", path: "missing-executable", digest: `sha256:${"0".repeat(64)}` }
const nativeToolchain = {
  platform: process.platform, architecture: process.arch, forge: unavailable, solc: unavailable,
}
const manifest = (code = testFile(), toolchain = nativeToolchain): ReviewedFoundryFixture => ({
  snapshotId, files: { "src/Target.sol": textDigest(files["src/Target.sol"]) },
  testDigest: textDigest(code), contract: "ReviewedTest", test: "testValue", toolchain,
})
const input = { runId: "fixture", snapshotId, testFile: testFile() }

test("verification denies unreviewed source, PoC and path overrides", async () => {
  const verifier = createReviewedFoundryVerification({ enabled: true, snapshot: source, approvedFixture: manifest() })
  expect(await verifier.runSingleShot({ ...input, testFile: testFile(9) })).toMatchObject({ outcome: "denied", telemetry: { processMs: 0 } })
  expect(await verifier.runSingleShot({ ...input, snapshotId: "unreviewed" })).toMatchObject({ outcome: "denied" })
  const stale = { ...manifest(), files: { "src/Target.sol": textDigest("modified") } }
  expect(await createReviewedFoundryVerification({ enabled: true, snapshot: source, approvedFixture: stale }).runSingleShot(input))
    .toMatchObject({ outcome: "denied", telemetry: { processMs: 0 } })
  const escape = { ...manifest(), files: { "src/../Target.sol": textDigest(files["src/Target.sol"]) } }
  expect(await createReviewedFoundryVerification({ enabled: true, snapshot: source, approvedFixture: escape }).runSingleShot(input))
    .toMatchObject({ outcome: "denied", telemetry: { processMs: 0 } })
})

test("missing toolchains and disabled verification never produce execution evidence", async () => {
  const approvedFixture = manifest()
  const verifier = createReviewedFoundryVerification({ enabled: true, snapshot: source, approvedFixture })
  expect(await verifier.runSingleShot(input)).toMatchObject({ outcome: "unavailable", trace: "", telemetry: { processMs: 0 } })
  expect(await verifier.runStateProbe({ runId: input.runId, snapshotId, probedTestFile: "" })).toMatchObject({ outcome: "unavailable", stateDeltas: [] })
  const disabled = createReviewedFoundryVerification({ enabled: false, snapshot: source, approvedFixture })
  expect(await disabled.runSingleShot(input)).toMatchObject({ outcome: "unavailable", trace: "" })
})

const forgePath = Bun.env.HARNESS_TEST_FORGE
const forgeDigest = Bun.env.HARNESS_TEST_FORGE_SHA256
const solcPath = Bun.env.HARNESS_TEST_SOLC
const solcDigest = Bun.env.HARNESS_TEST_SOLC_SHA256
const toolchain = async () => ({
  platform: process.platform, architecture: process.arch,
  forge: { version: "1.5.1", path: await realpath(forgePath!), digest: forgeDigest! },
  solc: { version: "0.8.30", path: await realpath(solcPath!), digest: solcDigest! },
})

test.skipIf(!forgePath || !forgeDigest || !solcPath || !solcDigest)("runs reviewed native Forge pass, assertion failure and empty-test fixtures", async () => {
  const pinned = await toolchain()
  const run = (code: string, test = "testValue") =>
    createReviewedFoundryVerification({ enabled: true, snapshot: source, approvedFixture: { ...manifest(code, pinned), test } })
      .runSingleShot({ ...input, testFile: code })
  const pass = await run(testFile())
  expect(pass).toMatchObject({ outcome: "passed", exitCode: 0, telemetry: { permissionDecision: "allowed" } })
  expect(pass.trace).not.toContain(forgePath!)
  const failure = await run(testFile(9))
  expect(failure).toMatchObject({ outcome: "assertion_failed", telemetry: { permissionDecision: "allowed" } })
  expect(failure.trace).not.toContain("fixture value mismatch")
  expect(await run(testFile(), "testNotPresent")).toMatchObject({ outcome: "setup_failed", trace: "" })
}, 60_000)

test.skipIf(Bun.env.HARNESS_TEST_NATIVE_BENCHMARK !== "1")("measures first invocation and ten subsequent reviewed fixtures", async () => {
  const approvedFixture = manifest(testFile(), await toolchain())
  const verification = createReviewedFoundryVerification({ enabled: true, snapshot: source, approvedFixture })
  const samples = []
  for (let i = 0; i < 11; i++) {
    const result = await verification.runSingleShot(input)
    expect(result.outcome).toBe("passed")
    samples.push(result.telemetry)
  }
  console.log(JSON.stringify({ benchmark: "reviewed-foundry", profile: verification.executionProfile, samples }))
}, 60_000)
