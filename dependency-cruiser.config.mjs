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
