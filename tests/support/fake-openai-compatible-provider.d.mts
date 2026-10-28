export function startFakeOpenAiProvider(options?: {
  apiKey?: string;
  mode?: string;
  delayMs?: number;
}): Promise<{
  apiKey: string;
  baseUrl: string;
  requests: Array<{
    at: string;
    model: unknown;
    authorization?: string;
    messages: unknown[];
    toolNames: string[];
    stream: boolean;
    responseToolCallId?: string;
  }>;
  close(): Promise<void>;
}>;
