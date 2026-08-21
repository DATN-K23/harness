# Ordered Desktop Trace View

Normative: yes  
Version: `desktop-trace-view-v3`  
Owner: TV6; collaborators: TV1, TV2, TV3, TV4  
Requirements: UI-02, UI-04–UI-06, DATA-06

## Layout

```text
Connection READY | seq cursor 6 | [All] [Model] [Provider] [Tools] [Security]
  2 CONTEXT ALLOCATED 4 ms   system 900 · candidate 600 · tools 1,200
  3 PROVIDER ATTEMPT ✓ 412 ms · 2,735 tokens · USD 0.01
  5 TOOL read_file BLOCKED 1 ms · PATH-TRAVERSAL · arguments withheld
  6 TRANSFORMED · redaction-v1 → truncate-v1 · safe digest sha256:…
```

## Event components

| Family | Always visible | Safe expandable detail | Never visible |
|---|---|---|---|
| lifecycle | sequence/type/time/state/version | terminal reason/observed limits | stack/SQL/internal exception |
| context | buckets/reserve/estimator/outcome | transformation IDs/digests | prohibited pre-redaction content |
| provider | profile/model/attempt/latency/usage/cost/status | safe request ID/region/native usage/error | credential/header/raw unsafe error |
| model | step/finish/schema/tokens | exact sanitized bounded model-visible response | unredacted provider payload |
| tool | name/version/status/duration | bounded sanitized argument/result/error | host root, escaped target, prohibited original |
| security | blocked/redacted/truncated/rule/category | safe explanation and transformation order | matched secret/raw blocked argument |
| scoring | approved aggregate/reference only in authorized evaluation view | no label in run trace | ground truth/adjudication/scorer schema |

## Ordering, partial data and reconnect

Render by integer sequence, never timestamp. Cursor pages must continue the same `run_id`. Running traces are partial and committed events are immutable. On disconnect retain the last view as stale, resume after compatible handshake, de-duplicate `(run_id, sequence)`, and require full refresh/integrity state for a gap. Never fabricate progress.

## Security rendering

- Escape all untrusted text; no HTML/Markdown/script execution or URL fetching.
- Evidence links use run-bound ordinal, never event/path text.
- Renderer-side length/virtualization limits do not change stored evidence.
- No `view original`, direct file open, DB/provider/scorer inspection or raw-path display.
- Untrusted trace content never becomes a Tauri command name, argument, URL, notification action or update input.
- A denied renderer-to-native attempt is a safe local desktop diagnostic, not a fabricated Judge trajectory event; it shows command family/rule only and withholds arguments/secrets.

## Component state matrix

| Component | Loading/empty | Success | Error/security/reconnect |
|---|---|---|---|
| runtime banner | starting skeleton | compatible identity/digest | unavailable, unauthorized, incompatible, reconnecting |
| event page | skeleton/no committed events | ordered cards/next cursor | preserve prior page; safe error; gap requires refresh |
| tool card | requested/empty result | bounded result/duration | failed and blocked are distinct |
| provider card | attempt started/unknown usage | usage/cost/identity | transient/permanent and explicit retry decision |
| context card | preflight pending | buckets/reserve/decision | `context_budget`; no provider call |
| native bridge diagnostic | absent by default | approved command family/state only | undeclared command denied; no raw argument, credential or Judge-state mutation |
