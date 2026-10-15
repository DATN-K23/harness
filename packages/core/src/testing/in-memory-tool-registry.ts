// Adapted from OpenCode packages/core/src/testing/in-memory-tool-registry.ts @ 3f393d78bf (MIT License). See NOTICE.
// Backward compatibility re-export shim. Canonical implementation is at ../tool/registry.
export { ToolRegistry as InMemoryToolRegistry } from "../tool/registry"
export type { ToolRegistryOptions as InMemoryToolRegistryOptions } from "../tool/registry"
export {
  GlobDefinition,
  GrepDefinition,
  ListDirDefinition,
  ReadFileDefinition,
  toolDefinitions,
} from "../tool/definitions"
