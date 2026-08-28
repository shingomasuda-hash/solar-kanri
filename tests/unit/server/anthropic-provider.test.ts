import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '@server/ai/anthropic';

/**
 * The request this adapter actually sends.
 *
 * Worth testing at this level because the failure mode is invisible until a
 * key exists: the adapter sent `temperature` on every call, and current Claude
 * models reject that parameter outright. Everything would have looked
 * configured and every single question would have returned a 400.
 */
function captureRequest(provider: AnthropicProvider): { last: Record<string, unknown> | null } {
  const captured: { last: Record<string, unknown> | null } = { last: null };
  // Reach past the constructor's client: this asserts the request shape, which
  // is the part that was wrong, without a network call or a key.
  (provider as unknown as { client: unknown }).client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        captured.last = params;
        return {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  };
  return captured;
}

const request = { system: 's', messages: [{ role: 'user' as const, content: 'q' }] };

describe('AnthropicProvider request shape', () => {
  it('omits temperature unless a caller asks for one', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' });
    const captured = captureRequest(provider);
    await provider.complete(request);
    expect(captured.last).not.toBeNull();
    expect(captured.last).not.toHaveProperty('temperature');
  });

  it('sends temperature when one is explicitly given', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' });
    const captured = captureRequest(provider);
    await provider.complete({ ...request, temperature: 0.5 });
    expect(captured.last?.temperature).toBe(0.5);
  });

  it('leaves room for a full answer by default', async () => {
    // A tight cap truncates mid-sentence and costs a retry; max_tokens is a
    // ceiling, not a spend.
    const provider = new AnthropicProvider({ apiKey: 'test' });
    const captured = captureRequest(provider);
    await provider.complete(request);
    expect(captured.last?.max_tokens as number).toBeGreaterThanOrEqual(8000);
  });

  it('treats an empty AI_MODEL as unset rather than as a model name', async () => {
    expect(new AnthropicProvider({ apiKey: 'k', model: '' }).modelId).toBe('claude-opus-5');
    expect(new AnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5' }).modelId).toBe(
      'claude-sonnet-5',
    );
  });

  it('is unavailable without a key, rather than failing at the first question', async () => {
    expect(new AnthropicProvider({}).isAvailable()).toBe(false);
    expect(new AnthropicProvider({ apiKey: 'k' }).isAvailable()).toBe(true);
  });
});

describe('AnthropicProvider stop reasons', () => {
  const cases: [string, string][] = [
    ['end_turn', 'end'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ];

  for (const [wire, expected] of cases) {
    it(`maps ${wire} to ${expected}`, async () => {
      const provider = new AnthropicProvider({ apiKey: 'test' });
      (provider as unknown as { client: unknown }).client = {
        messages: {
          create: async () => ({
            content: [{ type: 'text', text: 'x' }],
            stop_reason: wire,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        },
      };
      const response = await provider.complete(request);
      // A refusal is not a truncation and neither is a pause. Folding them
      // together would tell the operator the wrong thing to do next.
      expect(response.stopReason).toBe(expected);
    });
  }
});
