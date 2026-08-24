import { createContext, useContext, useMemo } from "react";
import { AuditHarnessClient } from "@audit-harness/sdk";

/**
 * NI3 Fix: Chuyển từ per-mount instance sang React Context singleton.
 * Tránh tạo nhiều client instance khi component mount/unmount.
 */
const AuditHarnessClientContext = createContext<AuditHarnessClient | null>(
  null,
);

export function AuditHarnessClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useMemo(
    () => new AuditHarnessClient({ baseUrl: window.location.origin }),
    [],
  );

  return (
    <AuditHarnessClientContext.Provider value={client}>
      {children}
    </AuditHarnessClientContext.Provider>
  );
}

export function useAuditHarnessClient(): AuditHarnessClient {
  const client = useContext(AuditHarnessClientContext);
  if (!client) {
    throw new Error(
      "useAuditHarnessClient phải được dùng bên trong <AuditHarnessClientProvider>",
    );
  }
  return client;
}
