import type { BceSlice, DeconstructedClaim, IngestionPort, IngestionResult, SourceSnapshotPort } from "@harness/protocol"
import solc from "solc"
import { draftClaim, missingFields, withExtracted, type ClaimDraft } from "./report-normalizer"
import { MaxResolutionLines, resolveTarget, type ResolvedTarget } from "./target-resolver"

const MaxReportBytes = 64_000
const MaxSourceLines = 120
const MaxProjectBytes = 512_000
const MaxBceSlices = 16
const MaxSourceFiles = 128
const SolcVersion = "0.8.30+commit.73712a01"
const prohibitedKey = /(?:ground.?truth|adjudication|scor(?:e|ing)|label)/i
// A metadata key in prose: one key token (no spaces, except "ground truth") right before a colon. Prose such as
// "Labeled Roles from _rolesSet ...: " or "guards label processing ...:" is report content, not metadata.
const prohibitedProseKey = /(?:^|[\s"'`{,])["'`]?[\w-]*(?:ground.?truth|adjudication|scor(?:e|ing)|label)[\w-]*["'`]?\s*:/im
const hasProhibitedKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasProhibitedKey)
  if (typeof value !== "object" || value === null) return false
  return Object.entries(value).some(([key, child]) => prohibitedKey.test(key) || hasProhibitedKey(child))
}

const toClaim = (draft: ClaimDraft, target: ResolvedTarget): DeconstructedClaim => ({
  targetContracts: [target.contract],
  targetFunctions: [target.functionName],
  rootCause: draft.rootCause ?? "",
  attackScenario: draft.attackScenario ?? "",
  callerAssumptions: draft.callerAssumptions,
  claimedImpact: draft.impact ?? "",
  claimedState: draft.state ?? "",
})

export class SnapshotIngestion implements IngestionPort {
  constructor(private readonly options: { source: SourceSnapshotPort; maxReportBytes?: number }) {}

  /** The first `MaxResolutionLines` lines of one file the report points to, to confirm a target named in it. */
  private async readForResolution(snapshotId: string, path: string, signal?: AbortSignal) {
    const read = await this.options.source.readLines({ snapshotId, path, startLine: 1, endLine: MaxResolutionLines }, signal)
    if (read.kind === "ok") return read.lines.join("\n")
    if (read.kind !== "out_of_range" || read.lineCount === 0) return undefined
    const whole = await this.options.source.readLines({ snapshotId, path, startLine: 1, endLine: read.lineCount }, signal)
    return whole.kind === "ok" ? whole.lines.join("\n") : undefined
  }

  async ingest(input: Parameters<IngestionPort["ingest"]>[0], signal?: AbortSignal): Promise<IngestionResult> {
    const { reportMarkdown } = input.finding
    if (new TextEncoder().encode(reportMarkdown).byteLength > (this.options.maxReportBytes ?? MaxReportBytes)) return { kind: "invalid_report" }
    try {
      const jsonBlocks = [...reportMarkdown.matchAll(/```json\s*\n([\s\S]*?)```/gi)].map((match) => match[1]!)
      if (jsonBlocks.some((block) => hasProhibitedKey(JSON.parse(block)))) return { kind: "invalid_report" }
      const prose = reportMarkdown.replace(/```(?:json|solidity|sol|forge)?[^\n]*\n[\s\S]*?```/gi, "")
      if (prohibitedProseKey.test(prose)) return { kind: "invalid_report" }
    } catch { return { kind: "invalid_report" } }
    // matchAll consumes fences pairwise; a single search could open at one block's closing fence and capture prose.
    const pocCode = [...reportMarkdown.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)]
      .find((fence) => /^(?:solidity|sol|forge)?\s*$/i.test(fence[1]!))?.[2]
      ?.trim()
    // Any platform's layout is mapped onto the claim fields by excerpt; the report itself is never rewritten.
    const draft = withExtracted(draftClaim(reportMarkdown), input.extracted, reportMarkdown)

    const paths = (await this.options.source.listFiles({ snapshotId: input.snapshotId }, signal))
      .filter((path) => !/(?:ground.?truth|adjudication|scor(?:e|ing))/i.test(path))
      .filter((path) => path.endsWith(".sol"))
      .sort()
    const target = await resolveTarget(draft.targets, paths, (path) => this.readForResolution(input.snapshotId, path, signal))
    const missing = missingFields(draft, target !== undefined)
    if (target === undefined || missing.length > 0) {
      const unresolvedTarget = target === undefined && draft.targets.length > 0 && missing.length === 1
      return { kind: "incomplete", reason: unresolvedTarget ? "target_not_found" : "unsupported_report", missingFields: missing }
    }
    const parsed = { claim: toClaim(draft, target), ...(pocCode ? { pocCode } : {}) }
    if (paths.length > MaxSourceFiles) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
    let exceededSourceBound = false
    let omittedSolidityFile = false
    const sourceFiles: Record<string, { content: string }> = {}
    let projectBytes = 0
    for (const path of paths) {
      let read = await this.options.source.readLines({ snapshotId: input.snapshotId, path, startLine: 1, endLine: MaxSourceLines + 1 }, signal)
      if (read.kind === "out_of_range") {
        if (read.lineCount > MaxSourceLines) { exceededSourceBound = true; omittedSolidityFile = true; continue }
        read = await this.options.source.readLines({ snapshotId: input.snapshotId, path, startLine: 1, endLine: read.lineCount }, signal)
      } else if (read.kind === "ok") { exceededSourceBound = true; omittedSolidityFile = true; continue }
      if (read.kind !== "ok") continue
      const content = read.lines.join("\n")
      projectBytes += new TextEncoder().encode(content).byteLength
      if (projectBytes > MaxProjectBytes) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      sourceFiles[path] = { content }
    }
    if (omittedSolidityFile) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
    if (Object.keys(sourceFiles).length === 0) return { kind: "incomplete", reason: exceededSourceBound ? "bce_unavailable" : "target_not_found" }
    try {
      if (!solc.version().startsWith(SolcVersion)) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      const input = { language: "Solidity", sources: sourceFiles, settings: { outputSelection: { "*": { "*": [], "": ["ast"] } } } }
      const output = JSON.parse(solc.compile(JSON.stringify(input))) as { errors?: { severity: string }[]; sources?: Record<string, { id: number; ast: AstNode }> }
      if (output.errors?.some((error) => error.severity === "error")) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      for (const [sourcePath, content] of Object.entries(sourceFiles)) {
        if (/\bimport\s+(?![^"']*["'])/.test(content.content)) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
        const imports = [...content.content.matchAll(/\bimport\s+(?:[^"']*?from\s*)?["']([^"']+)["']/g)].map((match) => match[1]!)
        if (imports.length && imports.some((specifier) => !resolveSnapshotImport(sourcePath, specifier, paths).some((resolved) => resolved in sourceFiles)))
          return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      }
      const target = parsed.claim.targetContracts[0]!
      const targetFunction = parsed.claim.targetFunctions[0]!
      const contractNodes = Object.entries(output.sources ?? {}).flatMap(([filePath, source]) => findNodes(source.ast, "ContractDefinition")
        .filter((node) => node.name === target).map((node) => ({ filePath, sourceId: source.id, node })))
      if (contractNodes.length === 0) return { kind: "incomplete", reason: "target_not_found" }
      if (contractNodes.length !== 1) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      const [{ filePath, node: contract }] = contractNodes
      const contractChildren = (contract.nodes ?? []) as AstNode[]
      const functions = contractChildren.filter((node: AstNode) => node.nodeType === "FunctionDefinition")
      const targetNodes = functions.filter((node) => node.name === targetFunction)
      if (targetNodes.length === 0) return { kind: "incomplete", reason: "target_not_found" }
      if (targetNodes.length !== 1 || !sourceFiles[filePath]) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      const selected = new Set<number>([targetNodes[0]!.id])
      const declarations = new Map<number, AstNode>()
      for (const source of Object.values(output.sources ?? {})) for (const declaration of findNodes(source.ast, "FunctionDefinition")) declarations.set(declaration.id, declaration)
      for (const fn of functions) if (fn.id !== targetNodes[0]!.id && callsId(fn, targetNodes[0]!.id)) selected.add(fn.id)
      const scanCalls = (fn: AstNode) => {
        for (const call of findNodes(fn, "FunctionCall")) {
          const id = findNodes(call.expression, "MemberAccess")[0]?.referencedDeclaration ?? call.expression?.referencedDeclaration
          if (typeof id === "number" && declarations.has(id)) selected.add(id)
        }
      }
      let pending = [...selected]
      const visited = new Set<number>()
      while (pending.length) {
        const id = pending.pop()!
        if (visited.has(id)) continue
        visited.add(id)
        const fn = declarations.get(id)
        if (!fn) continue
        const before = selected.size
        scanCalls(fn)
        if (selected.size > before) pending.push(...[...selected].filter((candidate) => !visited.has(candidate)))
      }
      for (const fn of functions) if (fn.id !== targetNodes[0]!.id && callsId(fn, targetNodes[0]!.id)) selected.add(fn.id)
      for (const modifier of targetNodes[0]!.modifiers ?? []) if (typeof modifier.modifierName?.referencedDeclaration === "number") selected.add(modifier.modifierName.referencedDeclaration)
      const stateIds = new Set<number>(contractChildren.filter((entry: AstNode) => entry.nodeType === "VariableDeclaration" && entry.stateVariable).map((entry: AstNode) => entry.id))
      const stateAccess = new Map<number, string>()
      const evidenceIds = new Set(selected)
      for (const id of selected) {
        const fn = declarations.get(id)
        if (!fn) continue
        for (const assignment of findNodes(fn, "Assignment")) {
          const stateId = findNodes(assignment.leftHandSide, "Identifier").find((reference) => reference.referencedDeclaration !== undefined && stateIds.has(reference.referencedDeclaration))?.referencedDeclaration
          if (stateId !== undefined) { evidenceIds.add(stateId); stateAccess.set(stateId, "write") }
        }
        for (const reference of findNodes(fn, "Identifier")) if (reference.referencedDeclaration !== undefined && stateIds.has(reference.referencedDeclaration)) {
          evidenceIds.add(reference.referencedDeclaration)
          if (!stateAccess.has(reference.referencedDeclaration)) stateAccess.set(reference.referencedDeclaration, "read")
        }
      }
      const modifiers = new Map<number, AstNode>()
      for (const source of Object.values(output.sources ?? {})) for (const modifier of findNodes(source.ast, "ModifierDefinition")) modifiers.set(modifier.id, modifier)
      for (const id of selected) {
        const modifier = modifiers.get(id)
        if (modifier) for (const reference of findNodes(modifier, "Identifier")) if (reference.referencedDeclaration !== undefined && stateIds.has(reference.referencedDeclaration)) evidenceIds.add(reference.referencedDeclaration)
      }
      for (const id of evidenceIds) { const declaration = contractChildren.find((entry: AstNode) => entry.id === id); if (declaration) selected.add(id) }
      selected.add(contract.id)
      const bceSlices = astSlices(sourceFiles, output.sources ?? {}, selected, MaxBceSlices)
      if (bceSlices.length === 0) return { kind: "incomplete", reason: "bce_unavailable", ...parsed }
      return { kind: "incomplete", reason: "bce_unavailable", ...parsed, bceSlices }
    } catch { return { kind: "incomplete", reason: "bce_unavailable", ...parsed } }
  }
}

type AstNode = { id: number; nodeType: string; name?: string; src?: string; referencedDeclaration?: number; stateVariable?: boolean; [key: string]: any }
const findNodes = (node: AstNode, kind: string): AstNode[] => [ ...(node.nodeType === kind ? [node] : []), ...Object.values(node).flatMap((value) => Array.isArray(value) ? value.flatMap((child) => child && typeof child === "object" && "nodeType" in child ? findNodes(child as AstNode, kind) : []) : value && typeof value === "object" && "nodeType" in value ? findNodes(value as AstNode, kind) : []) ]
const callsId = (fn: AstNode, id: number) => findNodes(fn, "Identifier").concat(findNodes(fn, "MemberAccess")).some((node) => node.referencedDeclaration === id)
const resolveSnapshotImport = (from: string, specifier: string, paths: string[]) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return []
  const segments = from.split("/").slice(0, -1)
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") { if (segments.length === 0) return []; segments.pop() }
    else segments.push(segment)
  }
  const resolved = segments.join("/")
  return paths.includes(resolved) ? [resolved] : []
}
const astSlices = (files: Record<string, { content: string }>, sources: Record<string, { id: number; ast: AstNode }>, ids: Set<number>, max: number): BceSlice[] => {
  const byId = new Map(Object.entries(sources).flatMap(([path, source]) => findNodes(source.ast, "ContractDefinition").concat(findNodes(source.ast, "FunctionDefinition"), findNodes(source.ast, "ModifierDefinition"), findNodes(source.ast, "VariableDeclaration")).filter((node) => ids.has(node.id)).map((node) => [node.id, { path, src: node.src } as const])))
  const slices: BceSlice[] = []
  for (const id of ids) {
    const entry = byId.get(id)
    if (!entry?.src || slices.length >= max) continue
    const [start, length, sourceId] = entry.src.split(":").map(Number)
    const filePath = Object.entries(sources).find(([, source]) => source.id === sourceId)?.[0]
    const content = filePath && files[filePath]?.content
    if (content === undefined || !Number.isInteger(start) || !Number.isInteger(length)) continue
    const bytes = new TextEncoder().encode(content)
    if (start < 0 || length < 0 || start + length > bytes.length) continue
    const before = new TextDecoder().decode(bytes.slice(0, start)).split("\n").length
    const text = new TextDecoder().decode(bytes.slice(start, start + length))
    const lineCount = text.split("\n").length
    slices.push({ filePath: filePath!, content: text, lineRange: [before, before + lineCount - 1] })
  }
  return slices
}
