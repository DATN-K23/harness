import { readFileSync } from "node:fs"
import OpenAI, { APIError } from "openai"

export interface RecordingErrorSpec {
  status: number
  message: string
  headers?: Record<string, string>
}

export type RecordingEntry =
  | OpenAI.Chat.ChatCompletion
  | { kind: "error"; status: number; message: string; headers?: Record<string, string> }
  | { kind: "delay"; delayMs: number; completion?: OpenAI.Chat.ChatCompletion }

export interface RecordingSequence {
  responses: RecordingEntry[]
}

export class RecordingClient {
  readonly requests: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = []
  readonly client: OpenAI
  private readonly responses: RecordingEntry[]
  private cursor = 0

  constructor(fixture: RecordingEntry | RecordingSequence | RecordingEntry[]) {
    this.responses = Array.isArray(fixture)
      ? [...fixture]
      : "responses" in fixture
        ? [...fixture.responses]
        : [fixture]

    this.client = {
      chat: {
        completions: {
          create: async (
            params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
            options?: { signal?: AbortSignal },
          ) => {
            this.requests.push(structuredClone(params))
            const response = this.responses[this.cursor]
            this.cursor += 1
            if (!response) throw new Error("RecordingClient has no response for this request.")

            if ("kind" in response && response.kind === "error") {
              throw new APIError(
                response.status,
                { message: response.message },
                response.message,
                response.headers ?? {},
              )
            }

            if ("kind" in response && response.kind === "delay") {
              await waitForDelay(response.delayMs, options?.signal)
              if (!response.completion) throw new Error("Delayed recording has no completion.")
              return response.completion
            }

            return response as OpenAI.Chat.ChatCompletion
          },
        },
      },
    } as unknown as OpenAI
  }

  get callCount() {
    return this.requests.length
  }
}

const waitForDelay = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    const timer = setTimeout(finish, delayMs)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      reject(signal?.reason ?? new Error("Recording delay aborted"))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
  })

export function readRecordingFixture(name: string): RecordingEntry | RecordingSequence {
  const path = new URL(`../fixtures/recordings/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(path, "utf8")) as RecordingEntry | RecordingSequence
}
