/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Package dependencies must remain acyclic.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "contracts-have-no-internal-dependencies",
      severity: "error",
      comment: "The contracts package is the dependency root.",
      from: {
        path: "^packages/contracts(?:/|$)",
      },
      to: {
        path: "^packages/(?!contracts(?:/|$))",
      },
    },
    {
      name: "domain-only-depends-on-contracts",
      severity: "error",
      comment:
        "Domain may import itself and contracts, but no adapter or runtime module.",
      from: {
        path: "^packages/domain(?:/|$)",
      },
      to: {
        path: "^packages/(?!domain(?:/|$)|contracts(?:/|$))",
      },
    },
    {
      name: "protocol-only-depends-on-contracts",
      severity: "error",
      comment:
        "Protocol stays independent from application and runtime implementation.",
      from: {
        path: "^packages/protocol(?:/|$)",
      },
      to: {
        path: "^packages/(?!protocol(?:/|$)|contracts(?:/|$))",
      },
    },
    {
      name: "core-does-not-import-adapters",
      severity: "error",
      comment:
        "Ports point inward; concrete adapters are wired only at composition roots.",
      from: {
        path: "^packages/(?:contracts|domain|application|agent-runtime)(?:/|$)",
      },
      to: {
        path: "^packages/adapters(?:/|$)",
      },
    },
    {
      name: "application-only-depends-inward",
      severity: "error",
      comment:
        "Application ports may depend only on domain and frozen contracts.",
      from: {
        path: "^packages/application(?:/|$)",
      },
      to: {
        path: "^packages/(?!application(?:/|$)|domain(?:/|$)|contracts(?:/|$))",
      },
    },
    {
      name: "core-does-not-read-root-config",
      severity: "error",
      comment:
        "Config files are resolved by a config adapter before entering application or domain.",
      from: {
        path: "^packages/(?:contracts|domain|application|agent-runtime)(?:/|$)",
      },
      to: {
        path: "^config(?:/|$)",
      },
    },
    {
      name: "web-does-not-import-runtime",
      severity: "error",
      comment: "Web consumes protocol/client contracts only.",
      from: {
        path: "^apps/web(?:/|$)",
      },
      to: {
        path: "^packages/(?:domain|application|agent-runtime|adapters)(?:/|$)",
      },
    },
    {
      name: "tools-do-not-import-agent-loop",
      severity: "error",
      comment: "Concrete tools cannot depend on the orchestration loop.",
      from: {
        path: "^packages/tools-skills(?:/|$)",
      },
      to: {
        path: "^packages/agent-runtime(?:/|$)",
      },
    },
    {
      name: "tools-only-depend-on-ports-and-contracts",
      severity: "error",
      comment:
        "Concrete tools use application ports and frozen contracts, never adapters or domain internals.",
      from: {
        path: "^packages/tools-skills(?:/|$)",
      },
      to: {
        path: "^packages/(?!tools-skills(?:/|$)|application(?:/|$)|contracts(?:/|$))",
      },
    },
    {
      name: "worker-does-not-import-ground-truth",
      severity: "error",
      comment: "Runtime workers must not access evaluation ground truth.",
      from: {
        path: "^apps/worker(?:/|$)",
      },
      to: {
        path: "(?:^|/)(?:ground-truth|expected)(?:/|$)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(?:^|/)(?:node_modules|dist|coverage|docs)(?:/|$)",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "default"],
      exportsFields: ["exports"],
    },
  },
};
