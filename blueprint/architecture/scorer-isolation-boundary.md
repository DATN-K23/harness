# Scorer Isolation Boundary

Normative: yes  
Version: `scorer-isolation-v1`  
Owners: TV5/TV4; reviewers: TV1, TV6

## Composition and process identity

`scoring` is a top-level capability in the Python modular monolith, but only `runtime/src/harness/entrypoints/scorer/` may import or compose it. The scorer runs as a separate process identity with a scorer-only database role/schema or equivalent credential boundary.

| Composition root | May import `scoring` | May possess label/scorer credential | May read scorer-only generated schemas |
|---|---:|---:|---:|
| daemon | no | no | no |
| worker | no | no | no |
| evaluator | no | no | no |
| scorer | yes | yes | yes |
| desktop/shell | no | no | no |

`scoring` may import only `evaluation.public` plus shared-kernel primitives. `evaluation` cannot import `scoring`, scorer adapters or scorer-only types. This one-way edge avoids a cycle and prevents the evaluator from constructing a label query path.

## Post-terminal input

The scorer accepts a canonical identifier-only `ScoreTerminalRun` command containing `experiment_cell_id`, `run_id`, expected terminal-state/version, case ID and accepted scorer/normalizer contract references. It accepts no embedded prediction/label, free-form source path, workspace, provider/tool handle or model context.

Before resolving a label, `scoring` calls `evaluation.public.GetTerminalScoreSubject` with those IDs; evaluation owns the allowed query composition and returns a versioned terminal safe-prediction projection after proving cell/run/state/digest membership. `scoring` never imports `run_control`. It then resolves `case_id` inside the scorer-only label adapter. Ground truth never enters the command, queue payload or shared public type.

## Persistence and grants

- Scorer process role: invoke the minimal `evaluation.public` terminal-subject query, read ground-truth/adjudication, write scorer-owned `score_join` and invoke the narrow approved-score acceptance adapter. Any database projection behind the public query is owned by evaluation/run-control composition, not queried by `scoring`.
- Scorer role cannot update run/config/event/attempt/tool/verdict, enqueue Judge work or call provider/source tools.
- Daemon/worker/evaluator roles have no usage/select/reference grants on scorer schema, label tables/views/functions or scorer-only generated contracts.
- Research exporter gets a separately reviewed projection; it does not grant the evaluator or desktop label access.

## Versioned output

The only crossing is `ApprovedScoreV1` through `evaluation.public.AcceptApprovedScore`. Fields are: schema/version/digest, score record ID, experiment cell ID, run ID, scorer/normalizer versions, completion class, prediction class, optional gate-ready numeric/boolean aggregates and scored timestamp. It contains no label value, adjudication, official report, scorer query detail or ground-truth-derived free text.

`evaluation` validates experiment/cell/run identity, version and idempotency before storing the approved result. This is not a run event and is never returned by Judge run/event endpoints. A future output-field change versions the contract and repeats the disclosure review.

## Generated contract sets

`contracts/schemas/scorer-only/v1/` is reachable only by the scorer Python generation target. The local-runtime OpenAPI and desktop generator traverse only the explicit `desktop_public` allowlist; any reachable scorer-only `$ref`, generated filename/type or transitive import fails generation/drift validation.

## Future architecture/security checks

| ID | Failure condition |
|---|---|
| `ARCH-SCORER-IMPORT-01` | daemon/worker/evaluator/desktop closure imports `harness.modules.scoring` or scorer-only generated package |
| `ARCH-SCORER-REVERSE-01` | `evaluation` imports `scoring` or a label adapter/type |
| `ARCH-SCORER-COMPOSE-01` | non-scorer composition root can instantiate label repository/query/credential |
| `ARCH-SCORER-SCHEMA-01` | scorer-only schema is reachable from local OpenAPI or desktop generation |
| `DB-SCORER-GRANT-01` | non-scorer role can select label/adjudication/score-join detail |
| `DB-SCORER-MUTATE-01` | scorer can mutate run trajectory/lifecycle or execute work |
| `FLOW-SCORER-01` | label/adjudication/scorer free text appears in run/provider/tool/log/desktop/export fixtures |

Static import/dependency inspection plus composition graph construction must prove absence, not merely rely on runtime denial. Database grant introspection and negative queries prove credential separation. These are future implementation acceptance obligations; this blueprint contains no application code.
