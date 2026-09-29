class TrajectoryStorePort:
    """
    Port for trajectory persistence and telemetry capture.
    Stores prompt history, compiler/execution logs, and differential verdicts.
    """
    def save_trajectory(self, run_id: str, data: dict):
        raise NotImplementedError
