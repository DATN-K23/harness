# Asynchronous Run API Delta

## MODIFIED Requirements

### Requirement: Non-public access-controlled local-runtime boundary
The blueprint SHALL define the MVP control plane as a single-user local daemon reachable only through a loopback-bound endpoint or OS-equivalent local IPC. Endpoint discovery MUST use an installation-scoped protected rendezvous mechanism, and requests MUST use an installation-scoped access credential or equivalent OS access control. The credential MUST remain under native-shell/OS-protected custody, MUST NOT appear in URLs, renderer persistence, ordinary logs, trajectories or exports, and MUST be rotatable without changing run identity. Desktop integrations SHALL use an approved protected credential backend and fail closed if it cannot be established. Operator-started `cli:serve --foreground` SHALL require HTTP Basic authentication with username `harness` and an explicit operator-configured `HARNESS_SERVER_PASSWORD`. Missing or invalid configuration SHALL prevent startup. The server SHALL NOT pass credentials to the renderer. Real CLI commands SHALL discover or start one shared loopback daemon, authenticate over HTTP, and reuse it until an authenticated shutdown. Concurrent startup SHALL produce at most one listening managed daemon. The managed process SHALL publish its credential in a protected user endpoint record. Mock commands MAY run offline without a daemon. An explicitly supplied loopback Judge endpoint MAY use operator credentials. Public-interface binding, remote access and multi-tenancy MUST be disabled and marked as future work; local process access control MUST NOT be presented as production multi-user authorization.

#### Scenario: Deployment assumptions are checked
- **GIVEN** the API security and desktop/runtime connection sections
- **WHEN** a reviewer evaluates endpoint binding, discovery, local credential handling and whether the contract can be exposed publicly
- **THEN** the blueprint requires a protected local-only path, rejects public exposure and credential logging, and records a separate future remote-authorization extension point

#### Scenario: Protected credential storage is unavailable
- **GIVEN** the desktop starts on a host where no approved protected credential backend can be established
- **WHEN** it attempts to discover or authenticate to the local runtime
- **THEN** the connection remains unauthorized with an actionable safe error, no plaintext credential is created or exposed to the renderer, and no anonymous or direct-access fallback is attempted

#### Scenario: Standalone CLI server restarts
- **GIVEN** the server has an operator-configured password
- **WHEN** the server restarts and receives a request with the same configured Basic credential
- **THEN** the configured credential remains valid on loopback and unauthenticated requests are rejected

#### Scenario: Commands reuse a shared local daemon
- **GIVEN** no managed server is running and multiple real CLI commands start
- **WHEN** they discover or launch the shared endpoint
- **THEN** one authenticated daemon serves the commands and remains available after the clients exit
