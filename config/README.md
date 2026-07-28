# Configuration Boundary

Runtime configuration files will live in this directory from WP5 onward.

Boundary fixed in WP1:

1. Only the future configuration adapter may read YAML files from this directory.
2. The adapter validates and resolves defaults, mode policy, experiment overrides and explicit run overrides.
3. Application receives a validated immutable `RunConfigSnapshot`.
4. Domain and agent runtime never read root config files or environment variables directly.
5. Credentials are resolved outside the snapshot; the snapshot stores only a redacted credential reference.

The dependency rule `core-does-not-read-root-config` enforces this boundary. WP1 does not create provisional
runtime YAML values before the Zod contract and merge semantics are implemented in WP2/WP5.
