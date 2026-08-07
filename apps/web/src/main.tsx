import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { AuditHarnessClientProvider } from "./hooks/useAuditHarnessClient.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuditHarnessClientProvider>
      <App />
    </AuditHarnessClientProvider>
  </React.StrictMode>,
);

