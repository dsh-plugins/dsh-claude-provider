/**
 * Constants shared by the patched settings cards.
 *
 * The settings page reaches this module through the staged source tree, so it
 * imports the Claude capability table by relative path from the host sources
 * rather than keeping its own copy. The build rewrites that import to the
 * staged copy, so a Claude model's capabilities are maintained in one place.
 */

/** Settings namespace this plugin stores provider type markers under. */
export const CLAUDE_PROVIDER_SETTINGS_NS = 'dsh-claude-provider'

/** Provider type id a dedicated Claude provider is marked with. */
export const CLAUDE_PROVIDER_TYPE = 'claude-adaptive'

/** Discovery protocol id that routes a probe to the Anthropic catalogue. */
export const CLAUDE_DISCOVERY_API = 'mofeng-anthropic-models'

export { CLAUDE_KNOWN_MODELS, claudeThinkingProfile, matchClaudeThinkingProfile, parseClaudeModelVersion } from '../src/known-models.ts'
export type {
  ClaudeKnownModel,
  ClaudeModelFamily,
  ClaudeModelVersion,
  ClaudeThinkingLevel,
  ClaudeThinkingMode,
  ClaudeThinkingProfile,
} from '../src/known-models.ts'
