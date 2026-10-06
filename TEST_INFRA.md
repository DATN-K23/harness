# AI Security Audit Cockpit: 4-Tier Test Infrastructure Specification

**Document Identifier**: `TEST_INFRA.md`  
**Version**: `1.0.0`  
**Owner**: E2E Testing Specialist (`teamwork_preview_test_writer`)  
**Target Application**: AI Security Audit Cockpit (`@audit-harness/web`)  
**Authority**: `ORIGINAL_REQUEST.md`, `PROJECT.md`, `explorer_survey_qa/analysis.md`

---

## 1. Executive Summary & Testing Philosophy

The AI Security Audit Cockpit is a high-density, mission-critical desktop instrument designed to monitor, audit, and verify autonomous AI security agents evaluating smart contracts. The user experience demands the visual craftsmanship, density, and resilience of tools such as Linear, Datadog, and Sentry.

### 1.1 Testing Principles

1. **Zero-Trust Verification (The Iron Law)**: No completion claim without fresh, verifiable empirical evidence. Facade tests, mock shortcuts that bypass real logic, and hardcoded test results are strictly prohibited.
2. **4-Tier Progressive Test Architecture**: Testing escalates from isolated happy paths to complex cross-feature state interactions and real-world adversarial stress.
3. **Viewport Geometry & Dead Void Elimination**: On widescreen 1920x1080 displays, horizontal dead void must remain strictly below 5% ($\le 96\text{px}$ total horizontal margin across the 1920px screen).
4. **Adversarial Input & Resilient Streaming**: The interface must defend against malicious inputs (SQLi, XSS, directory traversal) and handle 1,000+ high-frequency SSE event bursts without frame drops or memory leaks.

---

## 2. The 4-Tier Test Architecture

```
+-------------------------------------------------------------------------------+
| TIER 4: Real-World Adversarial & Stress Scenarios                             |
| - Daemon Drop & Reconnection Resilience (3-state connection badge)            |
| - 1,000-Event SSE Ingestion Storm (O(1) Deduplication & Virtual Windowing)     |
| - Malformed SSE Defensive Deserialization (Broken JSON, Missing Fields)       |
| - 1920x1080 Viewport Geometry & Dead Void Elimination (< 5% void)             |
+-------------------------------------------------------------------------------+
                                       ^
+-------------------------------------------------------------------------------+
| TIER 3: Cross-Feature Combinations & Interactive State Resiliency             |
| - Mid-Stream Mode Interruption (Live Stream -> Dashboard / Demo Mode)         |
| - Replay Scrubbing with Drift Compensation (seekToStep vs jumpToStep)         |
| - Dashboard Run Drilldown to Trace Hydration                                  |
| - Event Filter Tabs (All / Tool Calls / Thoughts / Errors)                    |
| - Dual-Pane Parameter Synchronization (Form -> Active Run Store)              |
+-------------------------------------------------------------------------------+
                                       ^
+-------------------------------------------------------------------------------+
| TIER 2: Boundary & Corner-Case Matrices                                       |
| - Empty Form Submission & Required Field Blocking                             |
| - Whitespace-Only String Sanitization & Rejection                             |
| - Strict URL Protocol Validation (HTTP/HTTPS/SSH Git vs FTP/File/Script)      |
| - Adversarial Finding ID Injection Defense (SQLi, XSS, Traversal Escaping)    |
| - Token Quota Slider Boundaries (10k min, 150k max, 5k step increments)       |
| - Zero-State Dashboard Telemetry & Safe CSV/JSON Export Generation            |
| - Extreme Text Length & Viewport Overflow Containment                         |
+-------------------------------------------------------------------------------+
                                       ^
+-------------------------------------------------------------------------------+
| TIER 1: Feature Coverage (Core Functional Happy Paths)                        |
| - Full-Viewport Cockpit Navigation & View Switching                           |
| - 1-Click Test Preset Ingestion (Vault Reentrancy, OpenZeppelin, Uniswap-v3)   |
| - Real-Time Execution Lifecycle (Start -> Stream -> Deduplication -> Verdict) |
| - Docked Bottom Replay Controller (Play, Pause, Step Scrub, Multipliers)      |
| - Historical Analytics Dashboard & Telemetry Aggregation                      |
+-------------------------------------------------------------------------------+
```

---

## 3. Tier Specifications & Test Matrices

### Tier 1: Feature Coverage (Core Functional Happy Paths)

Tier 1 establishes baseline behavioral conformance for all core user journeys under nominal conditions.

| Test Case ID | Test Title                    | Scope                                                         | Expected Observable Output                                                                                                                                  |
| :----------- | :---------------------------- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-T1-01** | View Mode Navigation          | Switch between Live, Demo, and Dashboard                      | Active mode and view update synchronously in store; header reflects correct breadcrumb; zero layout shifting.                                               |
| **TC-T1-02** | 1-Click Preset Ingestion      | Click preset buttons (Vault Reentrancy, OZ ERC20, Uniswap-v3) | Target repo, finding ID, and default parameters populate instantaneously; any validation errors cleared.                                                    |
| **TC-T1-03** | Real-Time Execution Lifecycle | Form submission to SSE stream and final verdict               | State transitions `IDLE` -> `RUNNING` -> `COMPLETED`; thought events and tool call cards render sequentially; `judge-verdict-v1` schema validated.          |
| **TC-T1-04** | Docked Replay Transport       | Play, Pause, Speed Multiplier, Step advancement               | Demo event playback increments `currentStep` sequentially; speed multipliers (`0.5x`, `1x`, `2x`, `5x`, `10x`) scale nominal delay; reset resets to step 0. |
| **TC-T1-05** | Dashboard Telemetry & Export  | Aggregate telemetry metrics and export generation             | Total runs, completed count, verified count, and average duration calculated correctly; RFC 4180 CSV and valid JSON generated.                              |

---

### Tier 2: Boundary & Corner-Case Matrices

Tier 2 subjects all input boundaries, parameter limits, and empty states to rigorous boundary-value analysis.

| Test Case ID | Input Condition           | Edge Condition Trigger                                     | Expected System Behavior & Validation                                                                                                          |
| :----------- | :------------------------ | :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-T2-01** | Empty Form Submission     | Repo = `""`, FindingID = `""`                              | Inline errors displayed under both inputs; form submission blocked; 0 network/backend requests dispatched.                                     |
| **TC-T2-02** | Whitespace Inputs         | Repo = `"   "`, FindingID = `"  \t  "`                     | Inputs trimmed prior to evaluation; treated as empty; validation alerts raised.                                                                |
| **TC-T2-03** | Invalid Protocol Prefixes | `ftp://repo`, `file:///etc/passwd`, `javascript:alert(1)`  | Rejected with message: `"Repository URL must be a valid HTTP(S) or Git address."` Only `http://`, `https://`, `git@` accepted.                 |
| **TC-T2-04** | Adversarial Finding IDs   | `' OR 1=1 --`, `<script>alert(1)</script>`, `../../secret` | Strings safely escaped; no DOM execution or SQL injection; correctly stored as raw string in payload.                                          |
| **TC-T2-05** | Token Quota Slider Limits | Minimum (10,000), Maximum (150,000), Step (5,000)          | Clamped strictly to $[10000, 150000]$; step increments in multiples of 5,000; label formatted with `toLocaleString()`.                         |
| **TC-T2-06** | Zero-State Analytics      | Empty runs list `[]`                                       | Total runs = 0; completed rate = 0%; verified = 0; avg latency = 0s; CSV/JSON export returns empty string or empty array safely without crash. |
| **TC-T2-07** | Extreme Text Overflow     | 2,000-char repository URL, 500-char finding ID             | Form container retains fixed dimensions; text wraps or truncates with ellipsis; zero horizontal scrollbar on viewport.                         |

---

### Tier 3: Cross-Feature & Interactive State Resiliency

Tier 3 validates state machine robustness when multiple features interact concurrently.

| Test Case ID | Interacting Features                  | Interaction Sequence                                                 | Resiliency Guarantee                                                                                                                             |
| :----------- | :------------------------------------ | :------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-T3-01** | Live Stream ↔ Mode Switching          | User switches to Dashboard while live SSE stream is receiving events | SSE connection and store remain uncorrupted; no memory leaks or duplicate event listeners; returning to Trace resumes view.                      |
| **TC-T3-02** | Replay Playback ↔ Slider Scrubbing    | User scrubs progress slider during active 10x playback               | `seekToStep` preserves active playback state without halting; `jumpToStep` halts playback (reset button behavior); drift accumulator reset to 0. |
| **TC-T3-03** | Dashboard ↔ Trace Hydration           | User clicks historical run row in Dashboard                          | Active run set in store; view switches to `trace`; tool calls and model events hydrate correctly for target run ID.                              |
| **TC-T3-04** | Trajectory Filter Tabs ↔ High Density | User switches tabs between All, Tool Calls, Thoughts, Errors         | Event list filters accurately; tab badges reflect exact counts; zero layout shift.                                                               |
| **TC-T3-05** | Dual-Pane Parameter Sync              | User adjusts parameters in operational pane                          | `useRunStore` maintains synchronization between input configuration and active run telemetry.                                                    |

---

### Tier 4: Real-World Scenarios & Adversarial Stress

Tier 4 verifies system integrity under simulated hostile environments, backend failures, high-throughput event storms, and strict widescreen geometry constraints.

| Test Case ID | Stress Vector                                  | Simulation Mechanism                                                                | Acceptance Threshold                                                                                                                                         |
| :----------- | :--------------------------------------------- | :---------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-T4-01** | Daemon Connection Drop                         | Abrupt REST/SSE failure (`ECONNREFUSED` / 503)                                      | SSE status transitions to `reconnecting` then `offline`; top nav badge indicates offline; high-density alert banner with Retry button; zero unhandled crash. |
| **TC-T4-02** | High-Frequency Event Storm                     | Burst of 1,000 SSE events (alternating thoughts and tool calls)                     | Store deduplicates overlapping steps in $O(1)$ time; store memory remains linear; virtualized list renders only visible items; zero UI lockup.               |
| **TC-T4-03** | Malformed SSE Payloads                         | Tool call with invalid JSON syntax; thought with null content; missing step indices | Defensive JSON parsing falls back to raw string; missing fields default to safe placeholders; execution pipeline continues uninterrupted.                    |
| **TC-T4-04** | 1920x1080 Viewport Geometry & Void Elimination | Browser window initialized at 1920x1080; element bounding boxes measured            | **Dead Void Ratio < 5%**: Cockpit content width $\ge 1888\text{px}$; side margins $\le 16\text{px}$; zero horizontal scrollbar.                              |

---

## 4. Viewport Geometry & Dead Void Mathematical Verification

### 4.1 Dead Void Mathematical Definition

For a standard desktop monitor at $1920 \times 1080$ resolution ($100\text{vw} \times 100\text{vh}$):

$$\text{Content Width} = X_{\text{right}} - X_{\text{left}}$$

$$\text{Horizontal Dead Void Ratio} = \frac{W_{\text{viewport}} - \text{Content Width}}{W_{\text{viewport}}} = \frac{1920 - \text{Content Width}}{1920}$$

### 4.2 Benchmark Comparison

- **Legacy Flawed Architecture**:
  - `maxWidth: "1200px"`, `margin: "0 auto"`
  - Content Width = $1200\text{px}$
  - Left Margin = $360\text{px}$, Right Margin = $360\text{px}$
  - Dead Void Ratio = $(1920 - 1200) / 1920 = 0.375$ (**37.5% wasted void** $\implies$ **FAIL**)
- **Cockpit Specification**:
  - Full-bleed dual-pane layout (`w-full` or $100\text{vw}$ with $16\text{px}$ gutter)
  - Left Pane = $420\text{px}$, Right Pane = $1468\text{px}$, Total Content Width = $1888\text{px}$
  - Left Margin = $16\text{px}$, Right Margin = $16\text{px}$
  - Dead Void Ratio = $(1920 - 1888) / 1920 = 0.0167$ (**1.67% wasted void** $\implies$ **PASS**, threshold $< 5\%$)

---

## 5. Test Runners, Tooling & Automation Harness

### 5.1 Test Suite Organization

```
tests/
├── e2e/
│   ├── cockpit.e2e.spec.ts        # Comprehensive 4-Tier E2E automated test suite
│   └── slice1.spec.ts             # Slice 1 contract verification
scripts/
├── verify_cockpit_browser.ts      # Native TypeScript CDP browser verification engine
├── capture_screenshots.py         # Python CDP screenshot engine
├── annotate_screenshot.py         # PIL geometry bounding box annotator
└── run_ui_suite.sh                # Edge headless launcher and supervisor
docs/
└── 050-testing/
    ├── screenshots/               # Captured 1920x1080 empirical image artifacts
    └── metrics/                   # Generated DOM geometry and test metric reports
```

### 5.2 Test Runner Command Matrix

| Execution Target             | Command                                                       | Verification Scope                                                                                                          |
| :--------------------------- | :------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| **All E2E Tests**            | `corepack pnpm exec vitest run --config vitest.e2e.config.ts` | Executes 4-Tier E2E test suite (`cockpit.e2e.spec.ts` + `slice1.spec.ts`).                                                  |
| **Slice 1 Integration**      | `corepack pnpm run test:e2e:slice1`                           | Contract verification of Verdict schema and client initialization.                                                          |
| **Browser CDP Verification** | `corepack pnpm exec jiti scripts/verify_cockpit_browser.ts`   | Connects via CDP at 1920x1080, measures DOM bounding boxes, captures screenshots, and writes `test-metrics-1920x1080.json`. |
| **Unit & Store Safety Net**  | `corepack pnpm test`                                          | Executes store unit tests and export utility tests.                                                                         |
| **Full Build Verification**  | `corepack pnpm --filter @audit-harness/web run build`         | Verifies TypeScript compilation and bundle production with exit code 0.                                                     |

---

## 6. Empirical Verification Artifact Requirements

Automated verification must generate the following verifiable artifacts:

1. `docs/050-testing/screenshots/cockpit_1920x1080_dualpane.png`: Full widescreen dual-pane cockpit loaded with test preset.
2. `docs/050-testing/screenshots/cockpit_1920x1080_stream.png`: Active execution stream displaying virtualized cards and token gauge.
3. `docs/050-testing/screenshots/cockpit_1920x1080_error_states.png`: Form validation alert states and boundary feedback.
4. `docs/050-testing/screenshots/cockpit_1920x1080_dashboard.png`: Historical analytics table and telemetry cards.
5. `docs/050-testing/metrics/test-metrics-1920x1080.json`:
   ```json
   {
     "timestamp": "2026-09-14T08:45:00.000Z",
     "viewport": { "width": 1920, "height": 1080 },
     "cockpit_container_width": 1888,
     "left_margin_px": 16,
     "right_margin_px": 16,
     "horizontal_dead_void_ratio": 0.0167,
     "dead_void_pass": true,
     "cls_score": 0.0,
     "build_exit_code": 0,
     "e2e_total_tests": 21,
     "e2e_pass_count": 21,
     "e2e_fail_count": 0
   }
   ```

---

## 7. Definition of Done & Quality Gate

- [x] 4-Tier Test Architecture fully specified with formal test case matrices.
- [x] Mathematical viewport void calculation formulated with strict $< 5\%$ pass threshold.
- [x] `tests/e2e/cockpit.e2e.spec.ts` implemented and passing with 100% test success.
- [x] Automated CDP runner `scripts/verify_cockpit_browser.ts` authored with geometry calculation and artifact generation.
- [x] `TEST_READY.md` published detailing execution commands and results.
