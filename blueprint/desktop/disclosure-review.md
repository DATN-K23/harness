# Desktop Disclosure Review

Normative: yes  
Version: `desktop-disclosure-review-v3`  
Owner: TV6; collaborator: TV4

> Blueprint review only; runtime rendering/security tests remain future evidence.

## Review matrix

| Surface | Label/adjudication | Credential | Raw host path | Prohibited original | Result |
|---|---:|---:|---:|---:|---|
| runtime connection | absent | shell/OS custody only; never rendered | absent | bounded safe diagnostic | PASS |
| Tauri command bridge | absent | raw local credential/signing key unavailable | picker path short-lived only | undeclared command/arguments withheld | PASS |
| repository picker | absent | absent | transient native control only | not persisted/logged | PASS |
| registered snapshot/run submission | absent | absent | opaque ID/digest only | bounded fields | PASS |
| provider/tool/security cards | absent | structurally excluded | authorized relative evidence only | redacted/withheld | PASS |
| verdict/evidence | no official label | absent | source-relative evidence only | bounded | PASS |
| evaluation view/export | approved safe aggregate only | absent | absent | scorer schema absent | PASS |
| reconnect/cache | absent | absent from renderer persistence | absent | committed safe projection only | PASS |

## Rendering requirements

- Escape candidate/model/provider/tool/rationale/error text; execute no untrusted HTML/Markdown/URL.
- Never reconstruct source/host paths from text; use snapshot-bound evidence ordinal.
- No direct scorer, DB, provider or tool client exists in renderer/shell.
- No `show original` for redaction/truncation/security events.
- Copy/download uses the same generated-client safe projection.
- Local credential never enters renderer storage, URL, trace, log or export.
- Release signing/notarization keys and arbitrary update artifact URLs never enter renderer or runtime processes.
- Effective main-window capabilities exclude generic filesystem, shell, process, environment, opener/URL, raw credential and direct updater authority.

Blueprint result: `PASS — no planned desktop surface exposes prohibited data; runtime proof pending`.
