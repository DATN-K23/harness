import type { VerdictStatus, SeverityLevel } from "./enums.js";

export interface Verdict {
  id: string;
  runId: string;
  status: VerdictStatus;
  severity: SeverityLevel;
  confidenceScore: number;
  explanation: string;
  pocSourceCode?: string | null;
  pocResult?: string | null;
  timestamp: string | Date;
}
