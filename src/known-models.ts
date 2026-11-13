/** Capacities and thinking presets recorded for known Claude model ids. */

/** Reasoning preset a recorded Claude model starts with. */
export type ClaudeThinkingPreset = 'toggle' | 'four' | 'five'

/** Recorded capacities and thinking preset of one Claude model. */
export interface ClaudeKnownModel {
  readonly contextWindow: number
  readonly maxTokens: number
  readonly preset: ClaudeThinkingPreset
}

/**
 * Recorded capacities and thinking presets for known Claude model ids.
 *
 * The browser half reads the same table through the build's inline copy, so
 * this module is the only place a Claude model's capacities are maintained.
 */
export const CLAUDE_KNOWN_MODELS: Readonly<Record<string, ClaudeKnownModel>> = Object.freeze({
  'claude-fable-5-1': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-fable-5': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-haiku-5-5': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-haiku-4-5-20251001': Object.freeze({ contextWindow: 200000, maxTokens: 64000, preset: 'toggle' }),
  'claude-haiku-4-5': Object.freeze({ contextWindow: 200000, maxTokens: 64000, preset: 'toggle' }),
  'claude-opus-4-5-20251101': Object.freeze({ contextWindow: 200000, maxTokens: 64000, preset: 'toggle' }),
  'claude-opus-4-5': Object.freeze({ contextWindow: 200000, maxTokens: 64000, preset: 'toggle' }),
  'claude-opus-4-6': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'four' }),
  'claude-opus-4-7': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-opus-4-8': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-opus-5': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-opus-5-5': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-sonnet-4-5-20250929': Object.freeze({ contextWindow: 200000, maxTokens: 64000, preset: 'toggle' }),
  'claude-sonnet-4-5': Object.freeze({ contextWindow: 200000, maxTokens: 64000, preset: 'toggle' }),
  'claude-sonnet-4-6': Object.freeze({ contextWindow: 1000000, maxTokens: 64000, preset: 'four' }),
  'claude-sonnet-5-5': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
  'claude-sonnet-5': Object.freeze({ contextWindow: 1000000, maxTokens: 128000, preset: 'five' }),
} as const)
