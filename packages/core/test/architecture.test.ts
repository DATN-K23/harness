import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "../../..")
const packagesDir = join(root, "packages")
const openCodeCommit = "3f393d78bf"

type Dependencies = Record<string, string>
type Manifest = {
  name?: string
  private?: boolean
  type?: string
  license?: string
  packageManager?: string
  scripts?: Record<string, string>
  exports?: Record<string, string>
  dependencies?: Dependencies
  devDependencies?: Dependencies
  peerDependencies?: Dependencies
  optionalDependencies?: Dependencies
  workspaces?: { packages?: string[]; catalog?: Dependencies }
}

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const importPattern =
  /(?:^|[\s;])(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g

const slash = (path: string) => path.replaceAll("\\", "/")
const readJson = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8"))
const importsOf = (source: string) =>
  [...source.matchAll(importPattern)].map((match) => match.slice(1).find((group) => group !== undefined) ?? "")
const dependenciesOf = (manifest: Manifest) =>
  dependencyFields.flatMap((field) => Object.entries(manifest[field] ?? {}))

const sourceFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((entry) => /\.tsx?$/.test(entry) && !entry.includes("node_modules"))
        .map((entry) => join(dir, entry))
        .filter((file) => file !== import.meta.path)
    : []

const importsInFiles = (files: string[]) =>
  files.flatMap((file) => importsOf(readFileSync(file, "utf8")).map((specifier) => ({ file, specifier })))

const isForbiddenInProtocol = (specifier: string) =>
  specifier.startsWith("node:") ||
  specifier.startsWith("bun:") ||
  specifier === "bun" ||
  specifier.startsWith("@harness/") ||
  builtinModules.includes(specifier)

const forbiddenProtocolImports = (sources: Record<string, string>) =>
  Object.entries(sources).flatMap(([file, source]) =>
    importsOf(source)
      .filter(isForbiddenInProtocol)
      .map((specifier) => `${file} imports ${specifier}`),
  )

const versionViolations = (packageName: string, manifest: Manifest, catalog: Dependencies) =>
  dependenciesOf(manifest).flatMap(([dependency, version]) => {
    if (exactVersion.test(version)) return []
    if (version === "workspace:*" && dependency.startsWith("@harness/")) return []
    if (version === "catalog:" && dependency in catalog) return []
    return [`${packageName}: ${dependency}@${version}`]
  })

const parseNotice = (notice: string) =>
  [...notice.matchAll(/^- file: (.+?) \| source: (.+?) \| attribution: (\S+)$/gm)].map((match) => ({
    file: match[1],
    source: match[2],
    attribution: match[3],
  }))

const attributionViolations = (notice: string, read: (file: string) => string | undefined) =>
  parseNotice(notice).flatMap(({ file, source, attribution }) => {
    const content = read(file)
    if (content === undefined) return [`${file}: listed in NOTICE but missing`]
    if (attribution === "notice-only") return file.endsWith(".json") ? [] : [`${file}: notice-only is for JSON files`]
    if (attribution !== "header") return [`${file}: unknown attribution ${attribution}`]
    const header = content.split("\n").slice(0, 5).join("\n")
    const complete = header.includes(source) && header.includes(openCodeCommit) && header.includes("MIT License")
    return complete ? [] : [`${file}: header does not name ${source}, ${openCodeCommit} and the MIT license`]
  })

const workspaceManifests = () => {
  const members = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json")))
    .map((entry) => ({ name: `packages/${entry.name}`, path: join(packagesDir, entry.name, "package.json") }))
  return [{ name: "root", path: join(root, "package.json") }, ...members].map((member) => ({
    name: member.name,
    manifest: readJson(member.path),
  }))
}

const protocolDir = join(packagesDir, "protocol")
const coreDir = join(packagesDir, "core")
const protocol = readJson(join(protocolDir, "package.json"))
const core = readJson(join(coreDir, "package.json"))
const rootManifest = readJson(join(root, "package.json"))
const catalog = rootManifest.workspaces?.catalog ?? {}

describe("workspace root", () => {
  test("declares packages/*, an exact package manager, a catalog and delegating scripts", () => {
    expect(rootManifest.workspaces?.packages).toEqual(["packages/*"])
    expect(rootManifest.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/)
    expect(Object.keys(catalog)).toEqual(expect.arrayContaining(["zod", "typescript", "@types/bun", "@tsconfig/bun"]))
    expect(Object.keys(rootManifest.scripts ?? {})).toEqual(expect.arrayContaining(["typecheck", "test", "demo"]))
    expect(rootManifest.scripts?.test).toContain("turbo")
    expect(rootManifest.scripts?.test).not.toMatch(/bun test/)
  })

  test("rejects a dependency that is neither exact nor in the catalog", () => {
    const drifted: Manifest = { dependencies: { zod: "^4.0.0", left: "catalog:", exact: "1.2.3" } }
    expect(versionViolations("packages/drifted", drifted, catalog)).toEqual([
      "packages/drifted: zod@^4.0.0",
      "packages/drifted: left@catalog:",
    ])
  })

  test("every workspace manifest uses exact, catalog or workspace versions", () => {
    const violations = workspaceManifests().flatMap(({ name, manifest }) => versionViolations(name, manifest, catalog))
    expect(violations).toEqual([])
  })
})

describe("package manifests", () => {
  test("protocol and core are private ESM MIT packages exposing their sources", () => {
    for (const manifest of [protocol, core]) {
      expect(manifest.private).toBe(true)
      expect(manifest.type).toBe("module")
      expect(manifest.license).toBe("MIT")
      expect(manifest.scripts?.typecheck).toBeDefined()
      expect(manifest.scripts?.test).toBeDefined()
    }
    expect(protocol.name).toBe("@harness/protocol")
    expect(core.name).toBe("@harness/core")
    expect(protocol.exports).toEqual({ ".": "./src/index.ts" })
    expect(core.exports).toEqual({ ".": "./src/index.ts", "./testing": "./src/testing/index.ts" })
  })

  test("public import paths resolve inside the owning package", () => {
    const resolved = (specifier: string) => slash(Bun.resolveSync(specifier, coreDir))
    expect(resolved("@harness/protocol")).toBe(slash(join(protocolDir, "src/index.ts")))
    expect(resolved("@harness/core")).toBe(slash(join(coreDir, "src/index.ts")))
    expect(resolved("@harness/core/testing")).toBe(slash(join(coreDir, "src/testing/index.ts")))
  })
})

describe("dependency direction", () => {
  test("flags a protocol source importing node:crypto and names the file and import", () => {
    const sources = {
      "packages/protocol/src/hash.ts": 'import { createHash } from "node:crypto"\nexport const hash = createHash\n',
      "packages/protocol/src/multiline.ts": 'import {\n  readFileSync,\n} from "fs"\n',
      "packages/protocol/src/dynamic.ts": 'export const load = () => import("bun:sqlite")\n',
      "packages/protocol/src/reexport.ts": 'export * from "@harness/core"\n',
      "packages/protocol/src/fine.ts": 'import { z } from "zod"\nexport type Id = string\n',
    }
    expect(forbiddenProtocolImports(sources)).toEqual([
      "packages/protocol/src/hash.ts imports node:crypto",
      "packages/protocol/src/multiline.ts imports fs",
      "packages/protocol/src/dynamic.ts imports bun:sqlite",
      "packages/protocol/src/reexport.ts imports @harness/core",
    ])
  })

  test("protocol sources import no node, bun or @harness module", () => {
    const sources = Object.fromEntries(
      sourceFiles(join(protocolDir, "src")).map((file) => [file, readFileSync(file, "utf8")]),
    )
    expect(forbiddenProtocolImports(sources)).toEqual([])
  })

  test("protocol manifest has no @harness dependency", () => {
    const internal = dependenciesOf(protocol).filter(([name]) => name.startsWith("@harness/"))
    expect(internal).toEqual([])
  })

  test("core depends on protocol and nothing else internal", () => {
    const internalNames = new Set([
      ...dependenciesOf(core).map(([name]) => name),
      ...importsInFiles(sourceFiles(join(coreDir, "src"))).map(({ specifier }) => specifier),
    ])
    const internal = [...internalNames]
      .filter((name) => name.startsWith("@harness/"))
      .map((name) => name.split("/").slice(0, 2).join("/"))
    expect(new Set(internal)).toEqual(new Set(["@harness/protocol"]))
  })

  test("no package imports another package's non-exported internals", () => {
    const violations = [protocolDir, coreDir].flatMap((packageDir) =>
      importsInFiles([...sourceFiles(join(packageDir, "src")), ...sourceFiles(join(packageDir, "test"))]).flatMap(
        ({ file, specifier }) => {
          if (specifier.startsWith(".")) {
            const target = resolve(dirname(file), specifier)
            if (target.startsWith(packageDir + sep)) return []
            return [`${slash(file)} imports ${specifier} outside its package`]
          }
          if (!specifier.startsWith("@harness/")) return []
          const [scope, name, ...subpath] = specifier.split("/")
          const manifestPath = join(packagesDir, name, "package.json")
          if (!existsSync(manifestPath)) return [`${slash(file)} imports unknown package ${scope}/${name}`]
          const key = subpath.length === 0 ? "." : `./${subpath.join("/")}`
          return key in (readJson(manifestPath).exports ?? {}) ? [] : [`${slash(file)} imports unexported ${specifier}`]
        },
      ),
    )
    expect(violations).toEqual([])
  })
})

describe("no dependency on the OpenCode checkout", () => {
  test("manifests, tsconfig files and imports reference no @opencode-ai package or OpenCode path", () => {
    const manifestHits = workspaceManifests().flatMap(({ name, manifest }) =>
      dependenciesOf(manifest)
        .filter(([dependency, version]) => /opencode/i.test(dependency) || /opencode/i.test(version))
        .map(([dependency]) => `${name}: ${dependency}`),
    )
    const tsconfigHits = [root, protocolDir, coreDir].flatMap((dir) => {
      const text = readFileSync(join(dir, "tsconfig.json"), "utf8")
      return /opencode/i.test(text) ? [`${slash(dir)}/tsconfig.json`] : []
    })
    const importHits = importsInFiles([
      ...sourceFiles(join(protocolDir, "src")),
      ...sourceFiles(join(protocolDir, "test")),
      ...sourceFiles(join(coreDir, "src")),
      ...sourceFiles(join(coreDir, "test")),
    ])
      .filter(({ specifier }) => /opencode/i.test(specifier))
      .map(({ file, specifier }) => `${slash(file)} imports ${specifier}`)
    expect([...manifestHits, ...tsconfigHits, ...importHits]).toEqual([])
  })
})

describe("NOTICE attribution", () => {
  const header = `# Adapted from OpenCode packages/x/y.toml @ ${openCodeCommit} (MIT License, Copyright (c) 2025)\n`
  const entry = (file: string, attribution: string) =>
    `- file: ${file} | source: packages/x/y.toml | attribution: ${attribution}\n`

  test("passes when no file is listed", () => {
    expect(attributionViolations("MIT License\n", () => undefined)).toEqual([])
  })

  test("names a listed file whose header does not name its OpenCode source", () => {
    const files: Record<string, string> = {
      "good.toml": header,
      "bad.toml": "# no attribution here\nkey = 1\n",
      "late.toml": `${"x\n".repeat(6)}${header}`,
    }
    const notice = entry("good.toml", "header") + entry("bad.toml", "header") + entry("late.toml", "header")
    expect(attributionViolations(notice, (file) => files[file])).toEqual([
      `bad.toml: header does not name packages/x/y.toml, ${openCodeCommit} and the MIT license`,
      `late.toml: header does not name packages/x/y.toml, ${openCodeCommit} and the MIT license`,
    ])
  })

  test("reports a missing file and a notice-only entry for a non-JSON file", () => {
    const notice = entry("gone.toml", "header") + entry("note.toml", "notice-only")
    expect(attributionViolations(notice, (file) => (file === "note.toml" ? "x" : undefined))).toEqual([
      "gone.toml: listed in NOTICE but missing",
      "note.toml: notice-only is for JSON files",
    ])
  })

  test("carries the OpenCode MIT notice and every listed file is attributed", () => {
    const notice = readFileSync(join(root, "NOTICE"), "utf8")
    expect(notice).toContain("Copyright (c) 2025 opencode")
    expect(notice).toContain("Permission is hereby granted")
    const violations = attributionViolations(notice, (file) => {
      const path = join(root, file)
      return existsSync(path) ? readFileSync(path, "utf8") : undefined
    })
    expect(violations).toEqual([])
  })
})
