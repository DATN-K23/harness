# Configuration Boundary

Runtime configuration files live in this directory from WP5 onward.

Boundary fixed in WP1:

1. Only `YamlRunConfigSource` in the adapters package may read YAML files from this directory.
2. The adapter validates and resolves defaults, mode policy, experiment overrides and explicit run overrides.
3. Application receives a validated immutable `RunConfigSnapshot`.
4. Domain and agent runtime never read root config files or environment variables directly.
5. Credentials are resolved outside the snapshot; the snapshot stores only a redacted credential reference.

The dependency rule `core-does-not-read-root-config` enforces this boundary. WP5 validates each YAML source,
then application code resolves baseline files, mode policy, experiment override and explicit run override in
that order. Slice 1 configuration contains no credential or host path.
