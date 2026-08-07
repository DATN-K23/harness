export class HarnessSDKError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(`[${code}] ${message}`);
    this.name = "HarnessSDKError";
  }
}

export class NetworkDisconnectedError extends HarnessSDKError {
  constructor(
    message = "Mất kết nối HTTP hoặc SSE stream rớt",
    details?: unknown,
  ) {
    super("ERR_NETWORK_DISCONNECTED", message, details);
    this.name = "NetworkDisconnectedError";
  }
}

export class RunNotFoundError extends HarnessSDKError {
  constructor(runId: string) {
    super(
      "ERR_RUN_NOT_FOUND",
      `Run với ID '${runId}' không tồn tại trong hệ thống`,
    );
    this.name = "RunNotFoundError";
  }
}

export class StreamTimeoutError extends HarnessSDKError {
  constructor(
    message = "Mất tín hiệu heartbeat từ SSE stream quá thời gian chờ",
  ) {
    super("ERR_STREAM_TIMEOUT", message);
    this.name = "StreamTimeoutError";
  }
}

export class InvalidPayloadError extends HarnessSDKError {
  constructor(message: string, details?: unknown) {
    super("ERR_INVALID_PAYLOAD", message, details);
    this.name = "InvalidPayloadError";
  }
}
