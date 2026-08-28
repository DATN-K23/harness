import React, { useEffect, useState } from "react";
import { RunsService } from "../../generated/api";
import type { RunSchema } from "../../generated/api";
import { exportRunsToCSV, exportRunsToJSON } from "../../utils/export";

interface DashboardViewProps {
  onSelectRun: (runId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onSelectRun,
}) => {
  const [runs, setRuns] = useState<RunSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = () => {
    setLoading(true);
    RunsService.getRunsApiV1RunsGet()
      .then((data: RunSchema[]) => {
        setRuns(data);
        setError(null);
      })
      .catch((err: Error) => {
        setError("Failed to fetch runs: " + err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleExportCSV = () => {
    exportRunsToCSV(runs);
  };

  const handleExportJSON = () => {
    exportRunsToJSON(runs);
  };

  return (
    <div className="flex flex-col h-full w-full max-w-6xl mx-auto py-8 px-4 animate-in fade-in zoom-in-95 duration-500">
      <div className="flex flex-row justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">
            Compare Runs
          </h2>
          <p className="text-gray-400 mt-2">
            Analytics dashboard for evaluation and ablation study.
          </p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={fetchRuns}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors border border-gray-700 shadow-sm"
          >
            Refresh
          </button>
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all shadow-md shadow-indigo-500/20"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJSON}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-all shadow-md shadow-purple-500/20"
          >
            Export JSON
          </button>
        </div>
      </div>

      <div className="flex-1 bg-gray-900/50 backdrop-blur-md rounded-2xl border border-gray-800 shadow-2xl overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-indigo-400">Loading runs...</div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-red-400 p-8 text-center">
            {error}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            No audit runs found.
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-gray-950/80 backdrop-blur-xl border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wider">
                <tr>
                  <th className="py-4 px-6 font-medium">Run ID / Repo</th>
                  <th className="py-4 px-6 font-medium">Status</th>
                  <th className="py-4 px-6 font-medium">Verdict</th>
                  <th className="py-4 px-6 font-medium">Severity</th>
                  <th className="py-4 px-6 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    className="group hover:bg-gray-800/40 cursor-pointer transition-colors"
                  >
                    <td className="py-4 px-6">
                      <div className="font-mono text-sm text-indigo-300 group-hover:text-indigo-200 transition-colors">
                        {run.id}
                      </div>
                      <div
                        className="text-sm text-gray-400 mt-1 truncate max-w-[250px]"
                        title={run.targetRepository}
                      >
                        {run.targetRepository}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium border ${
                          run.status === "COMPLETED"
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : run.status === "FAILED"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      {run.verdict ? (
                        <span
                          className={`text-sm font-medium ${
                            run.verdict.validity === "valid"
                              ? "text-green-400"
                              : "text-gray-400"
                          }`}
                        >
                          {run.verdict.validity.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      {run.verdict ? (
                        <span className="text-sm text-gray-300 capitalize">
                          {run.verdict.severity}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      <span className="text-sm text-gray-400 font-mono">
                        {(run.totalDurationMs / 1000).toFixed(1)}s
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
