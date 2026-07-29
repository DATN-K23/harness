# Domain

Pure domain behavior for Run and ToolCall invariants. This package depends only on `contracts` and must not
import filesystem, clocks, providers, databases or adapters.

- Transitions return new state objects; the input state is not mutated.
- Time values are supplied by the caller and validated against the contract.
- Terminal ToolCall states cannot settle again.
- A Run can complete only with a structured `JudgeVerdict`.
- Failed and cancelled Runs retain a typed `StopReason`.
