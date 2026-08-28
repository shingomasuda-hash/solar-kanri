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
/**
 * Their stop reasons to ours. `refusal` is carried through rather than folded
 * into `other`: a safety decline is a different thing from a truncation, and
 * the operator deserves to be told which one happened.
 */
const STOP_REASONS: Record<string, AiResponse['stopReason']> = {
  end_turn: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
};

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly modelId: string;
  private readonly client: Anthropic | null;

  constructor(options: { apiKey?: string; model?: string; baseURL?: string } = {}) {
    // Configuration is resolved by the caller (src/server/services/copilot.ts),
    // so this class has no opinion about where credentials come from.
    const apiKey = options.apiKey;
    // `||`, not `??`: AI_MODEL registered with an empty value is not a choice.
    this.modelId = options.model || 'claude-opus-5';
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
      // Generous because it is a ceiling, not a spend: only tokens actually
      // produced are billed. A tight cap truncates an answer mid-sentence and
      // costs a whole retry.
      max_tokens: request.maxTokens ?? 16000,
      // Temperature is sent only when a caller asks for one. Current Claude
      // models reject the parameter with a 400, so the previous default of 0.2
      // would have failed every request the moment a key was configured.
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
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
      stopReason: STOP_REASONS[response.stop_reason ?? ''] ?? 'other',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
