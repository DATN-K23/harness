# Task 10 decision — observed macOS Docker Desktop sandbox controls

## Decision

The observed target is a macOS ARM64 client using Docker Desktop 4.81.0, context `desktop-linux`, with Docker Engine 29.6.1 in a Linux ARM64 (`aarch64`) VM. This is target-platform Docker Desktop evidence, not a native macOS container claim.

On this exact daemon, a disposable sanitized fixture demonstrated the required Docker enforcement controls: `network=none`; read-only root and `/workspace` bind; UID/GID `10001:10001`; zero effective capabilities and `no-new-privileges`; `64 MiB` memory, `0.5` CPU, and `16` PID limits; and a `256 MiB` `/scratch` tmpfs quota. Timeout and abort paths killed and removed uniquely named containers, and bounded output stopped at its configured limit and cleaned up. The pinned Foundry fixture also ran offline through the real adapter with a benign passing test and controlled failing assertion.

This does **not** enable production PoC execution. The production policy is deny-only, Task 9 has no reviewed claim-bound state-delta protocol, and this single Docker Desktop version is not evidence for every supported macOS Docker Desktop version. `enablePocExecution` remains forced false in production.

## Exact artifacts

| Artifact | Pin / observed value |
|---|---|
| Foundry image | `ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c` |
| Image platform | `linux/arm64`; image config user `foundry` |
| Node executable | SHA-256 `f15053488b3c49d16eb4b0da25593b459a79839248381f6aa61a876bcce54966` |
| solc shim | SHA-256 `d3f4cc1e6aaf6c86be665fa4ff2fd33e2804935dbe1331d6db9f7032dae20dec` |
| solc 0.8.30 tree | SHA-256 `1b8e4c0c72651ec32f148263d6b88acde090e9dcfc5ae4b8b0c6309e8a7365ee` (39 files) |
| Node dependency tree | SHA-256 `576cdcad9fd44eaef7af62055f9a5eaebb8ddbe70116d50726f4bb150a94acfe` (61 files) |

The adapter independently accepts its pinned tree hashes (`91e0…ea546` for solc and `6c23…548b` for dependencies), which are hashes of path-plus-file-hash manifests rather than the raw concatenation hashes above.

## Evidence and limits

The full observed command results are recorded below; the private SDD ledger remains supplemental. Re-run the controlled verification after a Docker Desktop upgrade or any image/compiler artifact change.

## Reproduction record

The observed probes used disposable inputs and the exact image digest above. All workload containers used:

```sh
IMAGE='ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c'
docker run --rm --network=none --read-only --user 10001:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges --memory=64m --cpus=0.5 --pids-limit=16 \
  --mount type=bind,src="$PWD/probe-input",dst=/workspace,readonly \
  --tmpfs /scratch:rw,nosuid,size=256m "$IMAGE" sh -c 'id; grep CapEff /proc/self/status; grep NoNewPrivs /proc/self/status; cat /proc/net/route; touch /workspace/should-fail'
```

The probe recorded uid/gid `10001:10001`, `CapEff=0000000000000000`, `NoNewPrivs=1`; the route table had no default route; writing the bind mount failed; Docker inspect reported `ReadonlyRootfs=true`, `NanoCpus=500000000`, `Memory=67108864`, `PidsLimit=16`. `df -B1 /scratch` reported `268435456` bytes; a 257 MiB write failed. These commands were run with a newly created disposable `probe-input` containing only `input.txt`; no repository tree, credentials, or host secrets were mounted:

```sh
IMAGE='ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c'
mkdir -p probe-input && printf 'sanitized probe\n' > probe-input/input.txt
CONTAINER_ID="harness-probe-$(uuidgen | tr '[:upper:]' '[:lower:]')"
docker run --rm --network=none --read-only --user 10001:10001 --cap-drop=ALL \
  --name "$CONTAINER_ID" \
  --security-opt=no-new-privileges --memory=64m --cpus=0.5 --pids-limit=16 \
  --mount type=bind,src="$PWD/probe-input",dst=/workspace,readonly \
  --tmpfs /scratch:rw,nosuid,size=256m "$IMAGE" sh -c 'id; grep CapEff /proc/self/status; grep NoNewPrivs /proc/self/status; cat /proc/net/route; touch /workspace/should-fail || true'
docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}} {{json .Mounts}}' "$CONTAINER_ID"
docker run --rm --network=none --read-only --user 10001:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges --memory=64m --cpus=0.5 --pids-limit=16 \
  --tmpfs /scratch:rw,nosuid,size=256m "$IMAGE" sh -c 'df -B1 /scratch; dd if=/dev/zero of=/scratch/probe bs=1M count=257'
```

For subprocess controls, `spawnDocker` was invoked with a uniquely named disposable container and either a `750 ms` timeout or an already-started abort; both returned exit `137`. After each, `docker ps -a --filter name=harness-<unique-id>` returned no rows. Output bounding used the adapter with `maxOutputBytes=1024` and a child producing 8192 bytes; it returned 1024 stdout bytes, marked output-limit termination, and removed the named container.

The actual isolated Foundry fixture command and assertions were:

```sh
TASK5_DOCKER_INTEGRATION=1 \
TASK5_ARTIFACT_ROOT="$HOME/Library/Caches/harness-task5/artifacts" \
bun test packages/server/test/docker-foundry-sandbox.test.ts
```

It passed 14 tests on the observed Docker Desktop configuration, including one benign test and a bounded `assert(false)` fixture classified `assertion_failed`. These are records from one observed host/configuration, not a reusable certification; repeat them after platform/image/compiler changes and on each supported Docker Desktop version.
