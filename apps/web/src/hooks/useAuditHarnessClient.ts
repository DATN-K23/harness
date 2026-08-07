import { useMemo } from "react";
import { AuditHarnessClient } from "@audit-harness/sdk";

export function useAuditHarnessClient() {
  return useMemo(() => {
    return new AuditHarnessClient({
      baseUrl: window.location.origin,
    });
  }, []);
}
