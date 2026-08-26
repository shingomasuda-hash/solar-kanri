import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  AiRequest,
  AiResponse,
  AiToolCall,
  AiToolResult,
} from '@core/ai/provider';

/**
 * Anthropic adapter.
 *
 * The model id comes from configuration and is never hard-coded in business
 * logic (ADR-006). Everything crosses this boundary as our own types, so the
 * Copilot has no idea which vendor is behind it.
 *
 * Lives in src/server rather than src/core because it holds a network client
 * and credentials. src/core stays pure: the AiProvider interface, the safety
 * helpers and the task prompts are all there and testable without a key.
 */
export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly modelId: string;
  private readonly client: Anthropic | null;

  constructor(options: { apiKey?: string; model?: string; baseURL?: string } = {}) {
    // Configuration is resolved by the caller (src/server/services/copilot.ts),
    // so this class has no opinion about where credentials come from.
    const apiKey = options.apiKey;
    this.modelId = options.model ?? 'claude-sonnet-5';
    this.client = apiKey
      ? new Anthropic({ apiKey, ...(options.baseURL ? { baseURL: options.baseURL } : {}) })
      : null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    return this.send(request, [
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ]);
  }

  async continueWithToolResults(
    request: AiRequest,
    priorToolCalls: readonly AiToolCall[],
    results: readonly AiToolResult[],
  ): Promise<AiResponse> {
    const history: Anthropic.MessageParam[] = [
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'assistant',
        content: priorToolCalls.map((call) => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      },
      {
        role: 'user',
        content: results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError ?? false,
        })),
      },
    ];
    return this.send(request, history);
  }

  private async send(request: AiRequest, messages: Anthropic.MessageParam[]): Promise<AiResponse> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.2,
      system: request.system,
      messages,
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const toolCalls: AiToolCall[] = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      }));

    return {
      text,
      toolCalls,
      stopReason:
        response.stop_reason === 'tool_use'
          ? 'tool_use'
          : response.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : response.stop_reason === 'end_turn'
              ? 'end'
              : 'other',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
