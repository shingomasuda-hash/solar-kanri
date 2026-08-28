/**
 * AI provider abstraction.
 *
 * No model identifier appears in business logic (brief rule 29) — it lives in
 * configuration, so changing model is an administrator action rather than a
 * deployment. Swapping vendor means writing one adapter, not touching the
 * Copilot.
 */

export interface AiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AiToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments. */
  readonly inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface AiToolResult {
  readonly toolCallId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export interface AiRequest {
  readonly system: string;
  readonly messages: readonly AiMessage[];
  readonly tools?: readonly AiToolDefinition[];
  readonly maxTokens?: number;
  /**
   * Sampling temperature.
   *
   * Optional and normally unset: current Claude models reject it outright, and
   * a default sent on every request would fail every request. Present for a
   * provider or a pinned older model that still accepts one.
   */
  readonly temperature?: number;
}

export interface AiResponse {
  readonly text: string;
  readonly toolCalls: readonly AiToolCall[];
  readonly stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface AiProvider {
  readonly id: string;
  readonly modelId: string;
  isAvailable(): boolean;
  complete(request: AiRequest): Promise<AiResponse>;
  /** Continue a conversation after tool results are known. */
  continueWithToolResults(
    request: AiRequest,
    priorToolCalls: readonly AiToolCall[],
    results: readonly AiToolResult[],
  ): Promise<AiResponse>;
}

export class AiUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `AIコパイロットは利用できません: ${reason} / AI Copilot unavailable: ${reason}. ` +
        'docs/setup/ai-provider.md を参照してください。',
    );
    this.name = 'AiUnavailableError';
  }
}

/**
 * A provider that is never configured. Returned instead of null so callers
 * always have an object, and the "disabled" path is exercised by the same code
 * as the live one.
 */
export const disabledProvider: AiProvider = {
  id: 'disabled',
  modelId: 'none',
  isAvailable: () => false,
  complete: () => {
    throw new AiUnavailableError('APIキーが未設定です');
  },
  continueWithToolResults: () => {
    throw new AiUnavailableError('APIキーが未設定です');
  },
};
