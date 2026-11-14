/** Capacities and thinking capabilities recorded for known Claude model ids. */

/** One reasoning level an Anthropic model offers. */
export type ClaudeThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** How an Anthropic model reasons: a token budget, or an effort the model scales itself. */
export type ClaudeThinkingMode = 'budget' | 'adaptive'

/** What one Anthropic model offers for reasoning. */
export interface ClaudeThinkingProfile {
  /** Whether thinking is driven by `budget_tokens` or by `output_config.effort`. */
  readonly mode: ClaudeThinkingMode
  /** The levels this model offers, in escalation order. */
  readonly efforts: readonly ClaudeThinkingLevel[]
  /**
   * Whether the model accepts `thinking: { type: 'disabled' }`. A profile that
   * omits `off` is how the adapter reads "cannot turn thinking off", as opposed
   * to "send no effort".
   */
  readonly canDisable: boolean
}

/** Recorded capacities and thinking capability of one Claude model. */
export interface ClaudeKnownModel {
  readonly contextWindow: number
  readonly maxTokens: number
  readonly thinking: ClaudeThinkingProfile
}

/** Budget thinking with a disable switch: Claude 4.5 and older. */
const BUDGET_DISABLE: ClaudeThinkingProfile = Object.freeze({
  mode: 'budget',
  efforts: Object.freeze(['low', 'medium', 'high'] as const),
  canDisable: true,
})

/** Adaptive thinking over four levels: Claude 4.6. */
const ADAPTIVE_FOUR: ClaudeThinkingProfile = Object.freeze({
  mode: 'adaptive',
  efforts: Object.freeze(['low', 'medium', 'high', 'max'] as const),
  canDisable: true,
})

/** Adaptive thinking over five levels: Claude 4.7 and newer. */
const ADAPTIVE_FIVE: ClaudeThinkingProfile = Object.freeze({
  mode: 'adaptive',
  efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'] as const),
  canDisable: true,
})

/** Adaptive thinking a model cannot turn off: the Fable and Mythos families. */
const ADAPTIVE_FIVE_ALWAYS: ClaudeThinkingProfile = Object.freeze({
  mode: 'adaptive',
  efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'] as const),
  canDisable: false,
})

/**
 * Recorded capacities and thinking capabilities for known Claude model ids.
 *
 * Every entry reproduces the installed Anthropic catalogue: its offered levels,
 * whether `off` is available, and whether thinking is effort- or budget-driven.
 * The browser half reads this same table through the build's inline copy, so a
 * Claude model's capabilities are maintained here only.
 */
export const CLAUDE_KNOWN_MODELS: Readonly<Record<string, ClaudeKnownModel>> = Object.freeze({
  'claude-fable-5-1': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE_ALWAYS },
  'claude-fable-5': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE_ALWAYS },
  'claude-haiku-5-5': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
  'claude-haiku-4-5-20251001': { contextWindow: 200000, maxTokens: 64000, thinking: BUDGET_DISABLE },
  'claude-haiku-4-5': { contextWindow: 200000, maxTokens: 64000, thinking: BUDGET_DISABLE },
  'claude-opus-4-5-20251101': { contextWindow: 200000, maxTokens: 64000, thinking: BUDGET_DISABLE },
  'claude-opus-4-5': { contextWindow: 200000, maxTokens: 64000, thinking: BUDGET_DISABLE },
  'claude-opus-4-6': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FOUR },
  'claude-opus-4-7': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
  'claude-opus-4-8': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
  'claude-opus-5': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
  'claude-opus-5-5': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
  'claude-sonnet-4-5-20250929': { contextWindow: 200000, maxTokens: 64000, thinking: BUDGET_DISABLE },
  'claude-sonnet-4-5': { contextWindow: 200000, maxTokens: 64000, thinking: BUDGET_DISABLE },
  'claude-sonnet-4-6': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FOUR },
  'claude-sonnet-5-5': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
  'claude-sonnet-5': { contextWindow: 1000000, maxTokens: 128000, thinking: ADAPTIVE_FIVE },
} as const)

/** A model family an Anthropic id names. */
export type ClaudeModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'mythos'

/** Family and version parsed out of a model id. */
export interface ClaudeModelVersion {
  readonly family: ClaudeModelFamily
  readonly major: number
  /** Minor version, or `null` when the id names only a major. */
  readonly minor: number | null
}

const FAMILY_FIRST = /(opus|sonnet|haiku|fable|mythos)[-._](\d{1,2})(?!\d)(?:[-._](\d{1,2})(?!\d))?/
const VERSION_FIRST = /(\d{1,2})[-._](\d{1,2})[-._](opus|sonnet|haiku)/
const BARE_FAMILY = /(\d{1,2})[-._](opus|sonnet|haiku)/

/**
 * Parse the family and version an Anthropic model id names.
 *
 * Ids arrive in three spellings — `claude-opus-4-5`, `4-6-opus`,
 * `sonnet-3-7` — and a proxied id prefixes or suffixes a vendor segment, so
 * the patterns search rather than anchor.
 * @param model - a model id from a provider profile or a discovery reply.
 * @returns the parsed version, or `undefined` for an id naming no Claude family.
 */
export function parseClaudeModelVersion(model: string): ClaudeModelVersion | undefined {
  const normalized = model.toLowerCase()
  const familyFirst = FAMILY_FIRST.exec(normalized)
  if (familyFirst !== null) {
    return {
      family: familyFirst[1] as ClaudeModelFamily,
      major: Number.parseInt(familyFirst[2] as string, 10),
      minor: familyFirst[3] === undefined ? null : Number.parseInt(familyFirst[3], 10),
    }
  }
  const versionFirst = VERSION_FIRST.exec(normalized)
  if (versionFirst !== null) {
    return {
      family: versionFirst[3] as ClaudeModelFamily,
      major: Number.parseInt(versionFirst[1] as string, 10),
      minor: Number.parseInt(versionFirst[2] as string, 10),
    }
  }
  const bare = BARE_FAMILY.exec(normalized)
  if (bare !== null) {
    return { family: bare[2] as ClaudeModelFamily, major: Number.parseInt(bare[1] as string, 10), minor: null }
  }
  return undefined
}

/**
 * Infer the thinking profile of a Claude id the recorded table does not name.
 *
 * The version rule follows the generations that introduced each capability:
 * Claude 4.5 and older think on a token budget, 4.6 moved to effort-driven
 * adaptive thinking over four levels, and 4.7 onward add `xhigh`. An id naming
 * no Claude family falls back to budget thinking with a disable switch, because
 * an endpoint that does not implement adaptive thinking refuses it outright,
 * while budget thinking is what every Anthropic-compatible endpoint accepts.
 * @param model - a model id from a provider profile or a discovery reply.
 * @returns the inferred profile.
 */
export function matchClaudeThinkingProfile(model: string): ClaudeThinkingProfile {
  const version = parseClaudeModelVersion(model)
  if (version === undefined) return BUDGET_DISABLE
  const { family, major, minor } = version
  const atLeast = (targetMajor: number, targetMinor: number): boolean =>
    major > targetMajor || (major === targetMajor && (minor ?? 0) >= targetMinor)
  if (family === 'fable' || family === 'mythos') {
    return major >= 5 ? ADAPTIVE_FIVE_ALWAYS : BUDGET_DISABLE
  }
  if (!atLeast(4, 6)) return BUDGET_DISABLE
  // Claude 4.6 introduced effort-driven adaptive thinking over four levels;
  // 4.7 added `xhigh`. The window is generation-wide, so Opus and Sonnet share
  // it while Haiku, which no 4.6 model exists for, reaches it at 5.0 instead.
  if (!atLeast(4, 7)) return ADAPTIVE_FOUR
  return ADAPTIVE_FIVE
}

/**
 * The thinking profile of one model id: its recorded entry, else the
 * version-derived inference, so a proxied id gains the same controls a
 * first-party one has.
 * @param model - a model id from a provider profile or a discovery reply.
 * @returns the recorded or inferred profile.
 */
export function claudeThinkingProfile(model: string): ClaudeThinkingProfile {
  return CLAUDE_KNOWN_MODELS[model]?.thinking ?? matchClaudeThinkingProfile(model)
}
