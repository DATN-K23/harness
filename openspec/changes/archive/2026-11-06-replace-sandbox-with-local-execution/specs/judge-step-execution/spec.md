# Judge Step Execution Delta

## MODIFIED Requirements

### Requirement: Tier selection and state probe
When the sanitizer result reports that the submitter's PoC has assertions, the loop SHALL run Tier 1 adjudication using the trace and snapshot tools only. In an execution-enabled verification composition, when it reports none and a claim-bound state-probe capability is available, the loop SHALL additionally expose the loop-owned `run_state_probe` tool, which injects probes through the sanitizer operation, executes them through the verification-domain operation in an admitted internal composition, and returns the state-delta table, limited to `maxProbeRuns` executions per run. A probe execution SHALL NOT be counted as a model attempt and SHALL NOT be offered in Tier 1. Disabled production Judge or unavailable real probes SHALL NOT advertise executable probes; any attempted invocation SHALL return an explicit unavailable error without fabricated state deltas.

#### Scenario: Probe offered only in Tier 2
- **GIVEN** an execution-enabled composition with claim-bound probe capability and a PoC without assertions and one with assertions
- **WHEN** tool definitions for each run are listed
- **THEN** `run_state_probe` appears only for the first

#### Scenario: Probe budget enforced
- **GIVEN** `maxProbeRuns = 2` and a model requesting a third probe
- **WHEN** the call is processed
- **THEN** the verification operation is not invoked and the model receives an error result stating the limit

#### Scenario: Probe capability unavailable
- **GIVEN** production execution is disabled or a reviewed claim-bound probe implementation is unavailable
- **WHEN** a probe invocation is attempted
- **THEN** no command is launched and the model receives an unavailable result rather than an empty successful measurement
