import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface FindingFixture {
  finding_id: string;
  locations: Array<{
    path: string;
    start_line: number;
    end_line: number;
  }>;
  classification?: never;
}

interface VerdictFixture {
  classification: "valid" | "invalid" | "uncertain";
  evidence_refs: string[];
}

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/slice1/", import.meta.url),
);
const sourceRoot = resolve(fixtureRoot, "source");
const expectedRoot = resolve(fixtureRoot, "expected");

async function readJson<T>(relativePath: string): Promise<T> {
  const content = await readFile(resolve(fixtureRoot, relativePath), "utf8");
  return JSON.parse(content) as T;
}

describe("Slice 1 fixture preflight", () => {
  it("keeps expected verdicts outside the runtime source root", () => {
    const relativeExpectedPath = relative(sourceRoot, expectedRoot);

    expect(relativeExpectedPath.startsWith("..")).toBe(true);
  });

  it.each([
    ["valid-reentrancy.json", 24, 32],
    ["invalid-access-control.json", 34, 37],
  ])(
    "keeps %s free of official classification",
    async (filename, startLine, endLine) => {
      const finding = await readJson<FindingFixture>(`inputs/${filename}`);

      expect(finding.finding_id).toBeTruthy();
      expect(finding).not.toHaveProperty("classification");
      expect(finding.locations[0]).toMatchObject({
        path: "contracts/Vault.sol",
        start_line: startLine,
        end_line: endLine,
      });
    },
  );

  it.each([
    ["valid-reentrancy-verdict.json", "valid"],
    ["invalid-access-control-verdict.json", "invalid"],
  ] as const)(
    "keeps %s as test-only oracle data",
    async (filename, classification) => {
      const verdict = await readJson<VerdictFixture>(`expected/${filename}`);

      expect(verdict.classification).toBe(classification);
      expect(verdict.evidence_refs.length).toBeGreaterThan(0);
    },
  );

  it("pins source lines used by the acceptance contract", async () => {
    const source = await readFile(
      resolve(sourceRoot, "contracts/Vault.sol"),
      "utf8",
    );
    const lines = source.split(/\r?\n/u);

    expect(lines[27]).toContain("msg.sender.call");
    expect(lines[30]).toContain("balances[msg.sender] = 0");
    expect(lines[33]).toContain("external onlyOwner");
  });
});
