# AI Copilot setup

Optional. With no key the Copilot is disabled and **every other feature works
normally** — it assists the sales process, it is never a dependency of it.

Tracked as **OI-005** in `docs/open-issues.md`.

## Anthropic (default)

1. Create an API key at <https://console.anthropic.com/>.
2. Configure:
   ```bash
   AI_PROVIDER="anthropic"
   ANTHROPIC_API_KEY="sk-ant-..."
   AI_MODEL="claude-sonnet-5"
   ```

## OpenAI

```bash
AI_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
AI_MODEL="gpt-5"
```

The model identifier lives in configuration, never in business logic
(ADR-006), so changing model is an administrator action rather than a
deployment.

## What the Copilot may and may not do

It **retrieves**; it does not calculate. Every figure it states comes from the
database or from a deterministic engine, through a fixed set of **read-only**
tools. It has no tool that can send an email, change a price, or alter a
quotation, so a prompt-injection payload hidden in a supplier PDF cannot take an
action — only produce text a human reads, with source traces attached.

Knowledge-base documents are treated as untrusted data throughout. See
`docs/adr/ADR-006-ai-architecture.md`.

## Cost control

- Retrieved context is capped per request.
- The project summary is cached.
- The Copilot is per-project, not a general chat surface.

Set a spend limit in your provider's console.

## Verifying

管理 → システム状態 shows the AI provider as 未設定 or 正常. When 未設定, the
Copilot panel on a project screen explains that it is disabled and which
variable to set.
