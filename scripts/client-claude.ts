/**
 * Claude-only helpers injected into the upstream models-settings client module.
 *
 * The build splices this fragment into the upstream bundle, so it declares the
 * bindings that bundle already provides instead of importing them. Keep the
 * injected runtime behavior in step with `CLAUDE_KNOWN_MODELS` in
 * `src/index.ts`: both sides record the same Claude model capacities.
 */

/** Capacities and thinking preset recorded for one Claude model id. */
interface ClaudeKnownModelMeta {
  contextWindow: number
  maxTokens: number
  preset: string
}

/** One model row as the settings page drafts it. */
interface ClaudeModel {
  id: string
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  reasoningEfforts?: Record<string, unknown>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

/** Values a provider profile carries around its models. */
interface ClaudeProfile {
  compat?: Record<string, unknown>
  models?: ClaudeModel[]
  reasoning?: string
  [key: string]: unknown
}

/** Copy translated section text. */
type ClaudeTranslate = (key: string) => string

declare const CLAUDE_KNOWN_MODELS: Readonly<Record<string, ClaudeKnownModelMeta | undefined>>
declare const react_jsx_runtime: {
  jsx(type: unknown, props: unknown): unknown
  jsxs(type: unknown, props: unknown): unknown
}
declare const _deepseek_ai_dsh_client_ui_primitives: {
  Tooltip: unknown
  Switch: unknown
}
declare const ModelsSection_module_css_default: Readonly<Record<string, string | undefined>>

const CLAUDE_DISCOVERY_API = 'mofeng-anthropic-models'
const CLAUDE_PROVIDER_SETTINGS_NS = 'dsh-claude-provider'
const CLAUDE_PROVIDER_TYPE = 'claude-adaptive'
const CLAUDE_FIVE_EFFORTS = Object.freeze({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
const CLAUDE_FOUR_EFFORTS = Object.freeze({ low: 'low', medium: 'medium', high: 'high', max: 'max' })
const CLAUDE_TOGGLE_EFFORTS = Object.freeze({ off: null, high: 'high' })
const CLAUDE_PENDING_MODELS = new WeakSet<ClaudeModel>()

// CLAUDE_KNOWN_MODELS 由构建脚本从 src/index.ts 的记录表注入到此处。

function reasoningEffortsForPreset(preset: string): Record<string, unknown> {
  if (preset === 'toggle') return { ...CLAUDE_TOGGLE_EFFORTS }
  if (preset === 'four') return { ...CLAUDE_FOUR_EFFORTS }
  return { ...CLAUDE_FIVE_EFFORTS }
}

function claudeAdaptiveEnabled(model: ClaudeModel, inherited: unknown): boolean {
  const known = CLAUDE_KNOWN_MODELS[model?.id]
  if (known?.preset === 'toggle') return false
  const explicit = model?.compat?.['forceAdaptiveThinking']
  if (typeof explicit === 'boolean') return explicit
  if (typeof inherited === 'boolean') return inherited
  return known !== undefined && known.preset !== 'toggle'
}

function withClaudeAdaptive(model: ClaudeModel, enabled: boolean): ClaudeModel {
  return { ...model, compat: { ...model.compat, forceAdaptiveThinking: enabled } }
}

// Defaults are applied only when adopting a new model, never when saving an edit.
function withDefaultClaudeReasoning(model: ClaudeModel): ClaudeModel {
  const known = CLAUDE_KNOWN_MODELS[model.id]
  const next: ClaudeModel = Object.hasOwn(model, 'reasoningEfforts') ? { ...model } : {
    ...model, reasoningEfforts: reasoningEffortsForPreset(known?.preset ?? 'five'),
  }
  return typeof next.compat?.['forceAdaptiveThinking'] === 'boolean'
    ? next
    : withClaudeAdaptive(next, known?.preset !== 'toggle')
}

function withKnownClaudeInput(model: ClaudeModel): ClaudeModel {
  if (!CLAUDE_KNOWN_MODELS[model?.id] || Array.isArray(model.input)) return { ...model }
  return { ...model, input: ['text', 'image'] }
}

function withFetchedClaudeMetadata(model: ClaudeModel): ClaudeModel {
  const known = CLAUDE_KNOWN_MODELS[model?.id]
  return withDefaultClaudeReasoning(withKnownClaudeInput({
    ...model,
    ...known === undefined ? {} : {
      contextWindow: model.contextWindow ?? known.contextWindow,
      maxTokens: model.maxTokens ?? known.maxTokens,
    },
  }))
}

function newClaudeModel(): ClaudeModel {
  const model: ClaudeModel = { id: '' }
  CLAUDE_PENDING_MODELS.add(model)
  return model
}

function carryClaudeDraft(model: ClaudeModel, next: ClaudeModel): ClaudeModel {
  if (CLAUDE_PENDING_MODELS.has(model)) CLAUDE_PENDING_MODELS.add(next)
  return next
}

function finishClaudeDraft(model: ClaudeModel): ClaudeModel {
  return CLAUDE_PENDING_MODELS.has(model) && model.id.trim().length > 0
    ? withFetchedClaudeMetadata(model) : model
}

function withNativeClaudeModel(model: ClaudeModel, inherited?: unknown): ClaudeModel {
  const next = finishClaudeDraft(model)
  return withClaudeAdaptive(next, claudeAdaptiveEnabled(next, inherited))
}

function withNativeClaudeProfile(profile: ClaudeProfile): ClaudeProfile {
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
  // A provider-wide default must not refer to a level the edited models no longer offer.
  if (typeof next.reasoning === 'string' && Array.isArray(models)
      && models.some(model => !Object.hasOwn(model.reasoningEfforts ?? {}, next.reasoning as string))) {
    Reflect.deleteProperty(next, 'reasoning')
  }
  return next
}

function isClaudeProvider(
  row: { entry: { provider: string } },
  state: { namespaces: Map<string, { value?: { providerTypes?: Record<string, string> } }> },
): boolean {
  const namespace = state.namespaces.get(CLAUDE_PROVIDER_SETTINGS_NS)
  return namespace?.value?.providerTypes?.[row.entry.provider] === CLAUDE_PROVIDER_TYPE
}

interface ClaudeAdaptiveThinkingProps {
  model: ClaudeModel
  inherited?: unknown
  position: number
  disabled: boolean
  t: ClaudeTranslate
  onChange: (model: ClaudeModel) => void
}

function ClaudeAdaptiveThinking(props: ClaudeAdaptiveThinkingProps): unknown {
  const { model, inherited, position, disabled, t, onChange } = props
  const label = `${t('claudeAdaptiveThinking')} ${position}`
  return react_jsx_runtime.jsxs('div', {
    className: ModelsSection_module_css_default['modelReasoningHead'],
    style: { marginTop: 4, marginBottom: 12 },
    children: [react_jsx_runtime.jsxs('span', {
      className: `${ModelsSection_module_css_default['modelFieldLabel']} ${ModelsSection_module_css_default['modelReasoningLabel']}`,
      children: [t('claudeAdaptiveThinking'), react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
        label: t('claudeAdaptiveHelp'), side: 'right', delayMs: 0, focusDelayMs: 0, portal: true, openOnClick: true,
        children: react_jsx_runtime.jsx('button', {
          type: 'button', className: ModelsSection_module_css_default['helpButton'],
          'aria-label': t('claudeAdaptiveHelpLabel'), children: '?',
        }),
      })],
    }), react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Switch, {
      checked: claudeAdaptiveEnabled(model, inherited), label,
      disabled: disabled || CLAUDE_KNOWN_MODELS[model.id]?.preset === 'toggle',
      onChange: (enabled: boolean) => onChange(withClaudeAdaptive(model, enabled)),
    })],
  })
}
