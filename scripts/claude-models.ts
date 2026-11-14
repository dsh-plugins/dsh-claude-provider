/**
 * Claude-only model rules shared by the patched settings cards.
 *
 * The cards receive raw drafted rows, so these helpers answer three questions:
 * which reasoning levels a Claude model offers, whether a row's thinking is
 * adaptive, and what an adopted or saved row must carry. Every helper returns
 * new objects and never mutates its input.
 */
import { CLAUDE_KNOWN_MODELS, claudeThinkingProfile } from './claude-types.ts'
import type { ClaudeThinkingLevel, ClaudeThinkingProfile } from './claude-types.ts'

/** 设置页的开放草稿，模型 ID 在输入和校验完成前可以缺失。 */
export interface ClaudeModel {
  id?: unknown
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
  thinkingBudgets?: Record<string, number>
  [key: string]: unknown
}

/**
 * Token budgets a budget-thinking Claude model spends per level, matching the
 * escalation kimi-code sends. Adaptive models read their level from
 * `output_config.effort` instead and never consult these numbers.
 */
const CLAUDE_THINKING_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
  minimal: 1024,
  low: 1024,
  medium: 4096,
  high: 32000,
})

/** Rows created by the add button that have no model id yet. */
const PENDING_MODELS = new WeakSet<ClaudeModel>()

/**
 * The reasoning levels one model declares.
 *
 * `off` is declared only for a model that accepts disabled thinking: an absent
 * key is how the adapter reads "this model always reasons", while a `null`
 * value is the Off entry that sends nothing.
 * @param model - the model's id.
 * @returns a fresh level-to-wire-value map.
 */
export function reasoningEffortsForModel(model: unknown): Record<string, unknown> {
  const profile: ClaudeThinkingProfile = claudeThinkingProfile(typeof model === 'string' ? model : '')
  const efforts: Record<string, unknown> = profile.canDisable ? { off: null } : {}
  for (const level of profile.efforts) efforts[level] = level
  return efforts
}

/**
 * Whether one model sends adaptive thinking.
 *
 * A budget-thinking model never adapts: the flag has no meaning there, and
 * sending `adaptive` to a model driven by `budget_tokens` is refused. For an
 * adaptive model a row's explicit choice wins, then the provider-wide choice.
 * @param model - the drafted row.
 * @param inherited - the provider-wide `forceAdaptiveThinking` value, if any.
 * @returns whether the row should force adaptive thinking.
 */
export function claudeAdaptiveEnabled(model: ClaudeModel, inherited?: unknown): boolean {
  if (claudeThinkingProfile(typeof model.id === 'string' ? model.id : '').mode === 'budget') return false
  const explicit = model.compat?.['forceAdaptiveThinking']
  if (typeof explicit === 'boolean') return explicit
  if (typeof inherited === 'boolean') return inherited
  return true
}

/**
 * Whether a model accepts disabled thinking, which is what makes the
 * adaptive-thinking switch meaningful for it.
 * @param model - the model's id.
 * @returns whether the model can stop thinking.
 */
export function claudeCanDisableThinking(model: unknown): boolean {
  return claudeThinkingProfile(typeof model === 'string' ? model : '').canDisable
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
 * @returns the row with its reasoning levels and an adaptive default.
 */
export function withDefaultClaudeReasoning(model: ClaudeModel): ClaudeModel {
  const next: ClaudeModel = Object.hasOwn(model, 'reasoningEfforts') ? { ...model } : {
    ...model,
    reasoningEfforts: reasoningEffortsForModel(model.id),
  }
  return typeof next.compat?.['forceAdaptiveThinking'] === 'boolean'
    ? next
    : withClaudeAdaptive(next, claudeAdaptiveEnabled(next))
}

/**
 * Give a recorded Claude model its vision input types unless the row already
 * declares its own.
 * @param model - the drafted row.
 * @returns the replacement row.
 */
export function withKnownClaudeInput(model: ClaudeModel): ClaudeModel {
  if (typeof model.id !== 'string' || CLAUDE_KNOWN_MODELS[model.id] === undefined || Array.isArray(model.input)) {
    return { ...model }
  }
  return { ...model, input: ['text', 'image'] }
}

/**
 * Fill every recorded default for a discovered row, keeping disclosed values.
 * @param model - the row adopted from a discovery reply.
 * @returns the row with capacities, input types and reasoning defaults.
 */
export function withFetchedClaudeMetadata(model: ClaudeModel): ClaudeModel {
  const known = typeof model.id === 'string' ? CLAUDE_KNOWN_MODELS[model.id] : undefined
  return withDefaultClaudeReasoning(withKnownClaudeInput({
    ...model,
    ...known === undefined ? {} : {
      contextWindow: model.contextWindow ?? known.contextWindow,
      maxTokens: model.maxTokens ?? known.maxTokens,
    },
  }))
}

/**
 * The thinking budgets a route needs: a route holding at least one
 * budget-thinking model declares the level-to-token map those models spend,
 * while an all-adaptive route declares nothing because it never reads them.
 * @param models - the route's drafted rows.
 * @returns the budget map, or `undefined` when no model uses budget thinking.
 */
export function claudeRouteThinkingBudgets(
  models: readonly ClaudeModel[],
): Readonly<Record<string, number>> | undefined {
  return models.some(model => claudeThinkingProfile(typeof model.id === 'string' ? model.id : '').mode === 'budget')
    ? CLAUDE_THINKING_BUDGETS
    : undefined
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
  return PENDING_MODELS.has(model) && typeof model.id === 'string' && model.id.trim().length > 0
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
 * flag moves onto each model, the route declares the budgets its models spend,
 * and a default level the edited models no longer offer is dropped.
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
  const budgets = Array.isArray(models) ? claudeRouteThinkingBudgets(models) : undefined
  const next: ClaudeProfile = {
    ...rest,
    ...Object.keys(compat).length ? { compat } : {},
    ...models === undefined ? {} : { models },
    ...budgets === undefined ? {} : { thinkingBudgets: { ...budgets } },
  }
  if (typeof next.reasoning === 'string' && Array.isArray(models)
      && models.some(model => !Object.hasOwn(model.reasoningEfforts ?? {}, next.reasoning as string))) {
    Reflect.deleteProperty(next, 'reasoning')
  }
  return next
}
