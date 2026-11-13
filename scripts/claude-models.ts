/**
 * Claude-only model rules shared by the patched settings cards.
 *
 * The cards receive raw drafted rows, so these helpers answer three questions:
 * which reasoning levels a recorded Claude model offers, whether a row's
 * thinking is adaptive, and what an adopted or saved row must carry. Every
 * helper returns new objects and never mutates its input.
 */
import { CLAUDE_KNOWN_MODELS } from './claude-types.ts'
import type { ClaudeKnownModel } from './claude-types.ts'

/** One model row as the settings page drafts it. */
export interface ClaudeModel {
  id: string
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  reasoningEfforts?: Record<string, unknown>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

/** The provider profile shape these helpers read and rebuild. */
export interface ClaudeProfile {
  compat?: Record<string, unknown>
  models?: ClaudeModel[]
  reasoning?: string
  [key: string]: unknown
}

const CLAUDE_FIVE_EFFORTS = Object.freeze({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
const CLAUDE_FOUR_EFFORTS = Object.freeze({ low: 'low', medium: 'medium', high: 'high', max: 'max' })
const CLAUDE_TOGGLE_EFFORTS = Object.freeze({ off: null, high: 'high' })

/** Rows created by the add button that have no model id yet. */
const PENDING_MODELS = new WeakSet<ClaudeModel>()

/**
 * The reasoning levels a recorded preset declares.
 * @param preset - the model's recorded preset name.
 * @returns a fresh level-to-wire-value map.
 */
export function reasoningEffortsForPreset(preset: string): Record<string, unknown> {
  if (preset === 'toggle') return { ...CLAUDE_TOGGLE_EFFORTS }
  if (preset === 'four') return { ...CLAUDE_FOUR_EFFORTS }
  return { ...CLAUDE_FIVE_EFFORTS }
}

/**
 * Whether one model sends adaptive thinking. A model the table records as a
 * toggle model never adapts; otherwise an explicit choice wins, then the
 * provider-wide inheritance, then the recorded preset.
 * @param model - the drafted row.
 * @param inherited - the provider-wide `forceAdaptiveThinking` value, if any.
 * @returns whether the row should force adaptive thinking.
 */
export function claudeAdaptiveEnabled(model: ClaudeModel, inherited?: unknown): boolean {
  const known: ClaudeKnownModel | undefined = CLAUDE_KNOWN_MODELS[model.id]
  if (known?.preset === 'toggle') return false
  const explicit = model.compat?.['forceAdaptiveThinking']
  if (typeof explicit === 'boolean') return explicit
  if (typeof inherited === 'boolean') return inherited
  return known !== undefined
}

/**
 * Set one row's adaptive-thinking flag without touching its other fields.
 * @param model - the drafted row.
 * @param enabled - the flag to record.
 * @returns the replacement row.
 */
export function withClaudeAdaptive(model: ClaudeModel, enabled: boolean): ClaudeModel {
  return { ...model, compat: { ...model.compat, forceAdaptiveThinking: enabled } }
}

/**
 * Fill a row's thinking defaults when it is adopted, never when it is saved.
 * @param model - the drafted row.
 * @returns the row with recorded reasoning levels and an adaptive default.
 */
export function withDefaultClaudeReasoning(model: ClaudeModel): ClaudeModel {
  const known = CLAUDE_KNOWN_MODELS[model.id]
  const next: ClaudeModel = Object.hasOwn(model, 'reasoningEfforts') ? { ...model } : {
    ...model,
    reasoningEfforts: reasoningEffortsForPreset(known?.preset ?? 'five'),
  }
  return typeof next.compat?.['forceAdaptiveThinking'] === 'boolean'
    ? next
    : withClaudeAdaptive(next, known?.preset !== 'toggle')
}

/**
 * Give a recorded Claude model its vision input types unless the row already
 * declares its own.
 * @param model - the drafted row.
 * @returns the replacement row.
 */
export function withKnownClaudeInput(model: ClaudeModel): ClaudeModel {
  if (CLAUDE_KNOWN_MODELS[model.id] === undefined || Array.isArray(model.input)) return { ...model }
  return { ...model, input: ['text', 'image'] }
}

/**
 * Fill every recorded default for a discovered row, keeping disclosed values.
 * @param model - the row adopted from a discovery reply.
 * @returns the row with capacities, input types and reasoning defaults.
 */
export function withFetchedClaudeMetadata(model: ClaudeModel): ClaudeModel {
  const known = CLAUDE_KNOWN_MODELS[model.id]
  return withDefaultClaudeReasoning(withKnownClaudeInput({
    ...model,
    ...known === undefined ? {} : {
      contextWindow: model.contextWindow ?? known.contextWindow,
      maxTokens: model.maxTokens ?? known.maxTokens,
    },
  }))
}

/**
 * Create the empty row the add button appends to a Claude model list.
 * @returns a row whose defaults are filled once an id is typed.
 */
export function newClaudeModel(): ClaudeModel {
  const model: ClaudeModel = { id: '' }
  PENDING_MODELS.add(model)
  return model
}

/**
 * Keep a pending row pending when an edit replaces its object.
 * @param model - the row before the edit.
 * @param next - the replacement row.
 * @returns the replacement row, unchanged.
 */
export function carryClaudeDraft(model: ClaudeModel, next: ClaudeModel): ClaudeModel {
  if (PENDING_MODELS.has(model)) PENDING_MODELS.add(next)
  return next
}

/**
 * Apply the pending row's defaults once it has a model id.
 * @param model - the row being edited.
 * @returns the row with its defaults filled, or the row itself while unnamed.
 */
export function finishClaudeDraft(model: ClaudeModel): ClaudeModel {
  return PENDING_MODELS.has(model) && model.id.trim().length > 0
    ? withFetchedClaudeMetadata(model)
    : model
}

/**
 * Resolve one row's adaptive flag for a native Claude profile.
 * @param model - the drafted row.
 * @param inherited - the provider-wide `forceAdaptiveThinking` value.
 * @returns the row carrying both its defaults and its adaptive flag.
 */
export function withNativeClaudeModel(model: ClaudeModel, inherited?: unknown): ClaudeModel {
  const next = finishClaudeDraft(model)
  return withClaudeAdaptive(next, claudeAdaptiveEnabled(next, inherited))
}

/**
 * Fold a saved provider profile into the native Claude shape: the provider-wide
 * flag moves onto each model, and a default level the edited models no longer
 * offer is dropped.
 * @param profile - the profile as the card holds it.
 * @returns the replacement profile.
 */
export function withNativeClaudeProfile(profile: ClaudeProfile): ClaudeProfile {
  const { compat: currentCompat, ...rest } = profile
  const compat: Record<string, unknown> = { ...currentCompat }
  Reflect.deleteProperty(compat, 'forceAdaptiveThinking')
  const inherited = currentCompat?.['forceAdaptiveThinking']
  const models = Array.isArray(profile.models)
    ? profile.models.map(model => withNativeClaudeModel(model, inherited))
    : profile.models
  const next: ClaudeProfile = {
    ...rest,
    ...Object.keys(compat).length ? { compat } : {},
    ...models === undefined ? {} : { models },
  }
  if (typeof next.reasoning === 'string' && Array.isArray(models)
      && models.some(model => !Object.hasOwn(model.reasoningEfforts ?? {}, next.reasoning as string))) {
    Reflect.deleteProperty(next, 'reasoning')
  }
  return next
}
