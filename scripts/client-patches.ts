/**
 * Source-level patches applied to the staged
 * `@deepseek-ai/dsh-client-ui-settings-models` client sources.
 *
 * The settings page offers no extension point for a dedicated Claude tab or a
 * per-model adaptive-thinking switch, so the plugin forks the cards that need
 * them. Every patch names an exact anchor in the upstream source and
 * `applyClientPatches` fails loudly when one moves, so a DSH release that
 * changes the page shape breaks the build instead of shipping a bundle whose
 * Claude controls silently vanished.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One anchored source replacement. */
export interface Patch {
  /** Upstream file, relative to the staged source root. */
  file: string
  /** Human-readable name reported when the anchor is missing. */
  label: string
  /** Exact upstream text to replace. */
  before: string
  /** Replacement text. */
  after: string
  /** Number of occurrences the patch expects; defaults to exactly one. */
  count?: number
}

/** The settings namespace this plugin writes provider type markers into. */
const SETTINGS_NS = 'dsh-claude-provider'

/**
 * Claude provider copy appended to every dictionary. The English keys extend
 * `ModelsKey`; every other dictionary must carry the same keys because each
 * one is checked against them.
 */
const CLAUDE_COPY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en: {
    claudeTab: 'Claude provider',
    claudeTypeTag: 'Claude provider',
    claudeAdaptiveThinking: 'Adaptive thinking',
    claudeAdaptiveHelpLabel: 'Adaptive thinking help',
    claudeAdaptiveHelp: 'For Anthropic-compatible models that support adaptive thinking. When enabled, the model adjusts its thinking based on task complexity and your selected reasoning level. When disabled, it uses the thinking token limit associated with that level.',
  },
  zh: {
    claudeTab: 'Claude 提供商',
    claudeTypeTag: 'Claude 提供商',
    claudeAdaptiveThinking: '自适应思考',
    claudeAdaptiveHelpLabel: '自适应思考说明',
    claudeAdaptiveHelp: '适用于支持自适应思考的 Anthropic 兼容模型。开启后，模型根据任务难度和你选择的推理等级自动调整思考量；关闭后，改用该等级对应的思考 token 数量上限。',
  },
  ja: {
    claudeTab: 'Claudeプロバイダー',
    claudeTypeTag: 'Claudeプロバイダー',
    claudeAdaptiveThinking: '適応型思考',
    claudeAdaptiveHelpLabel: '適応型思考の説明',
    claudeAdaptiveHelp: '適応型思考に対応するAnthropic互換モデル向けです。有効にすると、タスクの複雑さと選択した推論レベルに応じて思考量を自動調整します。無効にすると、そのレベルに対応する思考トークン上限を使用します。',
  },
  es: {
    claudeTab: 'Proveedor Claude',
    claudeTypeTag: 'Proveedor Claude',
    claudeAdaptiveThinking: 'Pensamiento adaptativo',
    claudeAdaptiveHelpLabel: 'Ayuda sobre el pensamiento adaptativo',
    claudeAdaptiveHelp: 'Para modelos compatibles con Anthropic que admiten pensamiento adaptativo. Al activarlo, el modelo ajusta su pensamiento según la complejidad de la tarea y el nivel de razonamiento elegido. Al desactivarlo, usa el límite de tokens de pensamiento asociado a ese nivel.',
  },
  fr: {
    claudeTab: 'Fournisseur Claude',
    claudeTypeTag: 'Fournisseur Claude',
    claudeAdaptiveThinking: 'Réflexion adaptative',
    claudeAdaptiveHelpLabel: 'Aide sur la réflexion adaptative',
    claudeAdaptiveHelp: 'Pour les modèles compatibles Anthropic qui prennent en charge la réflexion adaptative. Une fois activée, le modèle ajuste sa réflexion selon la complexité de la tâche et le niveau de raisonnement choisi. Une fois désactivée, il utilise la limite de jetons de réflexion associée à ce niveau.',
  },
  de: {
    claudeTab: 'Claude-Anbieter',
    claudeTypeTag: 'Claude-Anbieter',
    claudeAdaptiveThinking: 'Adaptives Denken',
    claudeAdaptiveHelpLabel: 'Hilfe zum adaptiven Denken',
    claudeAdaptiveHelp: 'Für Anthropic-kompatible Modelle, die adaptives Denken unterstützen. Aktiviert passt das Modell sein Denken an die Aufgabenkomplexität und die gewählte Denkstufe an. Deaktiviert verwendet es das Denk-Token-Limit der jeweiligen Stufe.',
  },
  ru: {
    claudeTab: 'Провайдер Claude',
    claudeTypeTag: 'Провайдер Claude',
    claudeAdaptiveThinking: 'Адаптивное мышление',
    claudeAdaptiveHelpLabel: 'Справка об адаптивном мышлении',
    claudeAdaptiveHelp: 'Для Anthropic-совместимых моделей с поддержкой адаптивного мышления. Когда включено, модель подстраивает объём мышления под сложность задачи и выбранный уровень рассуждений. Когда выключено, используется лимит токенов мышления этого уровня.',
  },
  pt: {
    claudeTab: 'Provedor Claude',
    claudeTypeTag: 'Provedor Claude',
    claudeAdaptiveThinking: 'Pensamento adaptativo',
    claudeAdaptiveHelpLabel: 'Ajuda sobre pensamento adaptativo',
    claudeAdaptiveHelp: 'Para modelos compatíveis com Anthropic que oferecem pensamento adaptativo. Quando ativado, o modelo ajusta o pensamento conforme a complexidade da tarefa e o nível de raciocínio escolhido. Quando desativado, usa o limite de tokens de pensamento associado a esse nível.',
  },
}

/** The last key each dictionary declares, used to append the Claude copy. */
const LOCALE_TERMINATORS: Readonly<Record<string, string>> = {
  en: "  keyRequired: 'Enter an API key to continue.',",
  zh: "  keyRequired: '请输入 API 密钥后继续。',",
  ja: "  'keyRequired': '続けるにはAPIキーを入力してください。',",
  es: "  keyRequired: 'Ingrese una clave API para continuar.',",
  fr: "  keyRequired: 'Entrez une clé API pour continuer.',",
  de: "  keyRequired: 'Geben Sie einen API-Schlüssel ein, um fortzufahren.',",
  ru: "  keyRequired: 'Введите ключ API, чтобы продолжить.',",
  pt: "  keyRequired: 'Insira uma chave de API para continuar.',",
}

/** Render one dictionary's Claude copy as source lines. */
function claudeCopyLines(locale: string): string {
  const copy = CLAUDE_COPY[locale]
  if (copy === undefined) throw new Error(`client-patches: no Claude copy for locale ${locale}`)
  return Object.entries(copy)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value).replace(/^"|"$/g, "'")},`)
    .join('\n')
}

/** The patches, applied in order. */
export const PATCHES: readonly Patch[] = [
  // ---- locales: the Claude tab, tag, and adaptive-thinking copy ----
  ...Object.entries(LOCALE_TERMINATORS).map(([locale, terminator]) => ({
    file: 'client/locales.ts',
    label: `${locale} Claude copy`,
    before: terminator,
    after: `${terminator}\n${claudeCopyLines(locale)}`,
  })),

  // ---- index: expose the marker namespace to the section ----
  {
    file: 'client/index.ts',
    label: 'Claude marker namespace descriptor',
    before: '  const controller = new ModelsSettingsStore(ctx, schema, ctx.configForms.describe())',
    after: `  const controller = new ModelsSettingsStore(ctx, schema, ctx.configForms.describe())
  // The Claude markers live in this plugin's own settings namespace, so the
  // page offers the Claude tab only once that namespace resolves.
  const providerTypeState = ${JSON.stringify(SETTINGS_NS)}`,
  },
  {
    file: 'client/index.ts',
    label: 'Claude section injected face',
    before: `  const injected = (): ModelsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },`,
    after: `  const injected = (): ModelsSectionInjected => ({
    controller,
    providerTypeState,
    hooks: { snapshot: controller.store },`,
  },

  // ---- store: name the marker namespace once ----
  {
    file: 'client/store.ts',
    label: 'Claude marker namespace constant',
    before: '/** One provider row after joining the configurable directory with live routes. */',
    after: `/** Marker namespace this plugin stores provider type ids under. */
export const CLAUDE_MARKER_NS = ${JSON.stringify(SETTINGS_NS)}

/** One provider row after joining the configurable directory with live routes. */`,
  },

  // ---- ModelsSection: the Claude tab, its card, and the row tag ----
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude marker imports',
    before: "import { CustomProviderCard } from './CustomProviderCard.tsx'",
    after: `import { CustomProviderCard } from './CustomProviderCard.tsx'
import { CLAUDE_PROVIDER_TYPE } from './claude-types.ts'`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude marker namespace import',
    before: "import { deriveKeyRef, protocolChoices, providerUsable, reasoningLevelChoices } from './store.ts'",
    after: "import { CLAUDE_MARKER_NS, deriveKeyRef, protocolChoices, providerUsable, reasoningLevelChoices } from './store.ts'",
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude section injected face',
    before: `export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore`,
    after: `export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  /** Settings namespace holding the provider ids this plugin renders as Claude. */
  providerTypeState: string`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude add mode',
    before: "type AddMode = 'catalog' | 'custom'",
    after: "type AddMode = 'catalog' | 'custom' | 'claude'",
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude busy state',
    before: '  const [customBusy, setCustomBusy] = useState(false)',
    after: '  const [customBusy, setCustomBusy] = useState(false)\n  const [claudeBusy, setClaudeBusy] = useState(false)',
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude busy reset',
    before: '    setCustomBusy(false)\n  }',
    after: '    setCustomBusy(false)\n    setClaudeBusy(false)\n  }',
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude tab gating',
    before: `  const bothOffered = catalogOffered && customOffered
  const mode: AddMode = bothOffered ? addMode : customOffered ? 'custom' : 'catalog'
  const mounted = (candidate: AddMode): boolean => mode === candidate || visited.has(candidate)
  const switchLocked = catalogBusy || customBusy`,
    after: `  const claudeOffered = customOffered && state.namespaces.has(CLAUDE_MARKER_NS)
  const bothOffered = customOffered
  const mode: AddMode = bothOffered ? addMode : customOffered ? 'custom' : 'catalog'
  const mounted = (candidate: AddMode): boolean => mode === candidate || visited.has(candidate)
  const switchLocked = catalogBusy || customBusy || claudeBusy`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude row fact',
    before: '          const open = !addOpen && editing?.provider === row.entry.provider\n          const credentialConfigured = row.credential?.configured === true',
    after: `          const open = !addOpen && editing?.provider === row.entry.provider
          const adaptiveClaude = isClaudeProvider(row, state.namespaces, providerTypeState)
          const credentialConfigured = row.credential?.configured === true`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude row tag',
    before: `                  {row.entry.declared === true
                    ? <span className={styles['rowTag']}>{t('customTag')}</span>
                    : null}`,
    after: `                  {adaptiveClaude
                    ? <span className={styles['rowTag']}>{t('claudeTypeTag')}</span>
                    : null}
                  {row.entry.declared === true
                    ? <span className={styles['rowTag']}>{t('customTag')}</span>
                    : null}`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude setup card flag',
    before: `              {renderProviderEditor({
                  target,
                  row,
                  namespace,`,
    after: `              {renderProviderEditor({
                  target,
                  row,
                  thinkingPresets: isClaudeProvider(row, state.namespaces, providerTypeState),
                  namespace,`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude editor card flag',
    before: `                ? renderProviderEditor({
                  target,
                  row,
                  namespace,`,
    after: `                ? renderProviderEditor({
                  target,
                  row,
                  thinkingPresets: isClaudeProvider(row, state.namespaces, providerTypeState),
                  namespace,`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude type helper',
    before: 'function renderProviderEditor({ target, row, ...props }: ProviderEditorRenderProps): ReactNode {',
    after: `/**
 * Whether one provider row carries this plugin's Claude marker.
 * @param row - the joined provider row.
 * @param namespaces - the page snapshot's settings namespaces.
 * @param providerTypeState - namespace the Claude markers are stored in.
 * @returns whether the row renders the dedicated Claude form.
 */
function isClaudeProvider(
  row: ProviderRow,
  namespaces: ReadonlyMap<string, SettingsNamespaceView>,
  providerTypeState: string,
): boolean {
  const markers = namespaces.get(providerTypeState)?.value
  const types = (markers as { providerTypes?: Record<string, string> } | undefined)?.providerTypes
  return types?.[row.entry.provider] === CLAUDE_PROVIDER_TYPE
}

function renderProviderEditor({ target, row, ...props }: ProviderEditorRenderProps): ReactNode {`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude tab option',
    before: `                        {
                          value: 'custom',
                          label: t('addCustom'),
                          disabled: !customEnabled,
                          ...customEnabled ? {} : { title: t('addCustomUnavailable') },
                        },
                      ]}`,
    after: `                        {
                          value: 'custom',
                          label: t('addCustom'),
                          disabled: !customEnabled,
                          ...customEnabled ? {} : { title: t('addCustomUnavailable') },
                        },
                        {
                          value: 'claude',
                          label: t('claudeTab'),
                          disabled: !claudeOffered,
                          ...claudeOffered ? {} : { title: t('addCustomUnavailable') },
                        },
                      ]}`,
  },
  {
    file: 'client/ModelsSection.tsx',
    label: 'Claude add card',
    before: `                : null}
            </div>
          )
          : catalogOffered || customOffered`,
    after: `                : null}
              {mounted('claude') && claudeOffered
                ? (
                  <div
                    id={\`\${addId}-claude-panel\`}
                    {...bothOffered ? { role: 'tabpanel', 'aria-labelledby': \`\${addId}-claude\` } : {}}
                    hidden={mode !== 'claude'}
                    className={styles['addPanel']}
                  >
                    <CustomProviderCard
                      providerType={CLAUDE_PROVIDER_TYPE}
                      taken={state.rows.map(row => row.entry.provider)}
                      protocols={protocols}
                      reasoningLevels={reasoningLevels}
                      revision={piAi.revision}
                      operations={operations}
                      t={t}
                      readOnly={!state.writable}
                      onClose={(changed) => {
                        closeAdd()
                        if (changed) void controller.load()
                      }}
                      onBusyChange={setClaudeBusy}
                    />
                  </div>
                )
                : null}
            </div>
          )
          : catalogOffered || customOffered`,
  },

  // ---- CustomProviderCard: the dedicated Claude create form ----
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude card imports',
    before: "import { protocolNeedsKey, protocolReasoningLevels } from './protocol-rules.ts'",
    after: `import { protocolNeedsKey, protocolReasoningLevels } from './protocol-rules.ts'
import { CLAUDE_DISCOVERY_API, CLAUDE_PROVIDER_SETTINGS_NS, CLAUDE_PROVIDER_TYPE } from './claude-types.ts'
import { withNativeClaudeModel, withNativeClaudeProfile } from './claude-models.ts'`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude card prop',
    before: 'interface CustomProviderCardProps {\n  /** Route ids already declared, so the card refuses to shadow one. */',
    after: `interface CustomProviderCardProps {
  /**
   * Provider type the card creates. \`claude-adaptive\` records the Claude marker
   * beside the profile, locks the wire protocol to Anthropic Messages, and
   * fills the recorded Claude model defaults.
   */
  providerType?: string
  /** Route ids already declared, so the card refuses to shadow one. */`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude card state',
    before: "  const [protocol, setProtocol] = useState(protocols[0] ?? '')",
    after: `  const isAdaptiveClaude = props.providerType === CLAUDE_PROVIDER_TYPE
  const [protocol, setProtocol] = useState(isAdaptiveClaude ? 'anthropic-messages' : protocols[0] ?? '')`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude profile serialization',
    before: '        api: protocol,\n        baseURL: normalizedBaseURL,\n        models: models.map(model => ({ ...model })),',
    after: `        api: isAdaptiveClaude ? 'anthropic-messages' : protocol,
        baseURL: normalizedBaseURL,
        models: models.map(model => isAdaptiveClaude ? withNativeClaudeModel(model) : { ...model }),
        ...isAdaptiveClaude ? { reasoning: 'high' } : {},`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude profile uses the native shape',
    before: "        [{ op: 'set', path: ['providers', route], value: profile as JsonValue }],",
    after: `        [{
          op: 'set',
          path: ['providers', route],
          value: (isAdaptiveClaude ? withNativeClaudeProfile(profile) : profile) as JsonValue,
        }],`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude type marker write',
    before: '    if (storesKey) {\n      const stored = await operations.storeCredential(keyRef, keyValue)',
    after: `    // The marker commits before the key: a marker without its profile would
    // leave a row the page cannot render, while a profile without its marker is
    // an ordinary custom route the user can still edit.
    if (isAdaptiveClaude) {
      const typed = await operations.writeSettings(
        CLAUDE_PROVIDER_SETTINGS_NS,
        [{ op: 'set', path: ['providerTypes', route], value: CLAUDE_PROVIDER_TYPE as JsonValue }],
        undefined,
      )
      if (typed.kind !== 'written') return typed.kind === 'conflict' ? t('conflict') : typed.message
    }
    if (storesKey) {
      const stored = await operations.storeCredential(keyRef, keyValue)`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude protocol locked in the create form',
    before: "          aria-label={t('customApi')}\n          disabled={profileDisabled}",
    after: "          aria-label={t('customApi')}\n          disabled={profileDisabled || isAdaptiveClaude}",
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude card probes the Anthropic catalogue',
    before: '          api: protocol,\n          ...keyValue.length === 0 ? {} : { apiKey: keyValue },',
    after: `          api: isAdaptiveClaude ? CLAUDE_DISCOVERY_API : protocol,
          ...keyValue.length === 0 ? {} : { apiKey: keyValue },`,
  },
  {
    file: 'client/CustomProviderCard.tsx',
    label: 'Claude card model list',
    before: "        probeBlocked={baseUrlInvalid\n          ? 'customBaseUrlInvalid'\n          : keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure}\n        operations={operations}",
    after: `        probeBlocked={baseUrlInvalid
          ? 'customBaseUrlInvalid'
          : keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure}
        thinkingPresets={isAdaptiveClaude}
        operations={operations}`,
  },

  // ---- ProviderEditor: saving a Claude profile keeps its native shape ----
  {
    file: 'client/ProviderEditor.tsx',
    label: 'Claude editor prop',
    before: '  autoFocusCredential?: boolean',
    after: `  /**
   * Whether this card edits a provider marked with the Claude type. Such a
   * profile locks its wire protocol and moves the adaptive-thinking flag onto
   * each model when it is saved.
   */
  thinkingPresets?: boolean
  autoFocusCredential?: boolean`,
  },
  {
    file: 'client/ProviderEditor.tsx',
    label: 'Claude editor imports',
    before: "import { RetryPolicyEditor, retryPolicyDefaults, retryPolicyFailure } from './RetryPolicyEditor.tsx'",
    after: `import { RetryPolicyEditor, retryPolicyDefaults, retryPolicyFailure } from './RetryPolicyEditor.tsx'
import { CLAUDE_DISCOVERY_API, CLAUDE_PROVIDER_TYPE } from './claude-types.ts'
import { withNativeClaudeProfile } from './claude-models.ts'`,
  },
  {
    file: 'client/ProviderEditor.tsx',
    label: 'Claude editor profile shape',
    before: "    const next = layout === 'pi-ai' && stringAt(profileDraft, 'apiKeyEnv') === undefined\n      && stringAt(schema.getPath(namespace.base, settingsPath), 'apiKeyEnv') === undefined && keyValue.length > 0\n      ? schema.setPath(profileDraft, ['apiKeyEnv'], keyRef)\n      : profileDraft",
    after: `    const credentialDraft = layout === 'pi-ai' && stringAt(profileDraft, 'apiKeyEnv') === undefined
      && stringAt(schema.getPath(namespace.base, settingsPath), 'apiKeyEnv') === undefined && keyValue.length > 0
      ? schema.setPath(profileDraft, ['apiKeyEnv'], keyRef)
      : profileDraft
    // A Claude route keeps the flag the adapter reads: the provider-wide
    // default moves onto every model, so a per-model choice survives the save.
    const next: Record<string, unknown> = props.thinkingPresets === true
      ? withNativeClaudeProfile(credentialDraft as Record<string, unknown>)
      : credentialDraft`,
  },
  {
    file: 'client/ProviderEditor.tsx',
    label: 'Claude editor protocol lock',
    before: "                    aria-label={t('customApi')}\n                    disabled={disabled}",
    after: "                    aria-label={t('customApi')}\n                    disabled={disabled || props.thinkingPresets === true}",
  },
  {
    file: 'client/ProviderEditor.tsx',
    label: 'Claude editor probes the Anthropic catalogue',
    before: "    ...probeApi === undefined ? {} : { api: probeApi },",
    after: "    ...probeApi === undefined ? {} : { api: props.thinkingPresets === true ? CLAUDE_DISCOVERY_API : probeApi },",
  },
  {
    file: 'client/ProviderEditor.tsx',
    label: 'Claude editor model list',
    before: '                  reasoningLevels={reasoning.levels}\n                  reasoningLevelsOnly={reasoning.levelsOnly}',
    after: `                  reasoningLevels={reasoning.levels}
                  reasoningLevelsOnly={reasoning.levelsOnly}
                  thinkingPresets={props.thinkingPresets === true}
                  adaptiveFallback={schema.getPath(draft, ['compat', 'forceAdaptiveThinking'])}`,
  },

  // ---- ModelListEditor: Claude defaults for adopted and edited rows ----
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude list prop',
    before: '  /** Route input types for models absent from the installed catalog. */',
    after: `  /**
   * Whether the rows belong to a Claude route. Adopted and newly named rows
   * then take the recorded Claude capacities, vision input, and reasoning
   * presets instead of the generic defaults.
   */
  thinkingPresets?: boolean | undefined
  /** The provider-wide adaptive-thinking value every row inherits. */
  adaptiveFallback?: unknown
  /** Route input types for models absent from the installed catalog. */`,
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude list imports',
    before: "import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'",
    after: `import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import { carryClaudeDraft, finishClaudeDraft, newClaudeModel, withFetchedClaudeMetadata } from './claude-models.ts'`,
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude adopted rows',
    before: `  const addedRows = activeCandidates
    .filter(candidate => isPicked(candidate.id) && !keptIds.has(candidate.id))
    .map(adopt)`,
    after: `  const addedRows = activeCandidates
    .filter(candidate => isPicked(candidate.id) && !keptIds.has(candidate.id))
    .map(candidate => props.thinkingPresets === true ? withFetchedClaudeMetadata(adopt(candidate)) : adopt(candidate))`,
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude row defaults',
    before: "            inputFallback={inputDefaults.get(textOf(model, 'id')) ?? props.defaultInput}",
    after: `            inputFallback={props.thinkingPresets === true && CLAUDE_KNOWN_MODELS[textOf(model, 'id')] !== undefined
              ? ['text', 'image']
              : inputDefaults.get(textOf(model, 'id')) ?? props.defaultInput}`,
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude row flag',
    before: '            reasoningLevels={props.reasoningLevels}\n            reasoningLevelsOnly={props.reasoningLevelsOnly}',
    after: `            reasoningLevels={props.reasoningLevels}
            reasoningLevelsOnly={props.reasoningLevelsOnly}
            thinkingPresets={props.thinkingPresets === true}
            adaptiveFallback={props.adaptiveFallback}`,
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude row identity commit',
    before: '            onFieldChange={(field, value) => { patch(index, { [field]: value }) }}',
    after: `            onFieldChange={(field, value) => { patch(index, { [field]: value }) }}
            onIdBlur={props.thinkingPresets === true
              ? (value) => {
                // A pending row's defaults are filled on the commit that names
                // it, so the whole row is replaced instead of one field.
                const next = finishClaudeDraft(carryClaudeDraft(model, { ...model, id: value }))
                onChange(models.map((row, at) => at === index ? next : row))
              }
              : undefined}`,
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude pending row',
    before: "        onClick={() => { onChange([...models, { id: '' }]) }}",
    after: "        onClick={() => { onChange([...models, props.thinkingPresets === true ? newClaudeModel() : { id: '' }]) }}",
  },
  {
    file: 'client/ModelListEditor.tsx',
    label: 'Claude known model import',
    before: "import { carryClaudeDraft, finishClaudeDraft, newClaudeModel, withFetchedClaudeMetadata } from './claude-models.ts'",
    after: `import { carryClaudeDraft, finishClaudeDraft, newClaudeModel, withFetchedClaudeMetadata } from './claude-models.ts'
import { CLAUDE_KNOWN_MODELS } from './claude-types.ts'`,
  },

  // ---- ModelRow + ModelReasoningEfforts: the adaptive switch ----
  {
    file: 'client/ModelRow.tsx',
    label: 'Claude row props',
    before: '  /** Whether the route\'s protocol accepts only {@link reasoningLevels}, each sent under its own name. */\n  reasoningLevelsOnly?: boolean | undefined',
    after: `  /** Whether the route's protocol accepts only {@link reasoningLevels}, each sent under its own name. */
  reasoningLevelsOnly?: boolean | undefined
  /** Whether this row belongs to a Claude route and shows the adaptive switch. */
  thinkingPresets?: boolean | undefined
  /** The provider-wide adaptive-thinking value this row inherits. */
  adaptiveFallback?: unknown`,
  },
  {
    file: 'client/ModelRow.tsx',
    label: 'Claude reasoning editor wiring',
    before: `                  <ModelReasoningEfforts
                    model={model} levels={props.reasoningLevels} levelsOnly={props.reasoningLevelsOnly === true}
                    position={position} disabled={disabled} t={t} onChange={props.onChange}
                  />`,
    after: `                  <ModelReasoningEfforts
                    model={model} levels={props.reasoningLevels} levelsOnly={props.reasoningLevelsOnly === true}
                    claude={props.thinkingPresets === true} adaptiveFallback={props.adaptiveFallback}
                    position={position} disabled={disabled} t={t} onChange={props.onChange}
                  />`,
  },
  {
    file: 'client/ModelReasoningEfforts.tsx',
    label: 'Claude reasoning defaults',
    before: "  const initialEntries = INITIAL_LEVELS.filter(level => levels.includes(level)).map(level => [level, defaultValue(level)] as const)",
    after: `  const initialEntries = props.claude === true
    ? Object.entries(reasoningEffortsForPreset(CLAUDE_KNOWN_MODELS[model.id]?.preset ?? 'five'))
    : INITIAL_LEVELS.filter(level => levels.includes(level)).map(level => [level, defaultValue(level)] as const)`,
  },
  {
    file: 'client/ModelReasoningEfforts.tsx',
    label: 'Claude reasoning component import',
    before: "import { modelDrafts } from './DeepSeekModelsEditor.tsx'",
    after: `import { modelDrafts } from './DeepSeekModelsEditor.tsx'
import { ClaudeAdaptiveThinking } from './claude-adaptive-thinking.tsx'
import { reasoningEffortsForPreset } from './claude-models.ts'
import { CLAUDE_KNOWN_MODELS } from './claude-types.ts'`,
  },
  {
    file: 'client/ModelReasoningEfforts.tsx',
    label: 'Claude reasoning props',
    before: '/** Props of {@link ModelReasoningEfforts}. */',
    after: `/** Props of {@link ModelReasoningEfforts}. */
interface ClaudeReasoningProps {
  /** Whether this row belongs to a Claude route. */
  claude?: boolean
  /** The provider-wide adaptive-thinking value this row inherits. */
  adaptiveFallback?: unknown
}

/** Props of {@link ModelReasoningEfforts}. */`,
  },
]

export { PATCHES as CLIENT_PATCHES }

/** Result of one staged patch run. */
export interface PatchResult {
  /** Files that received at least one patch. */
  files: number
  /** Patches applied. */
  patches: number
}

/**
 * Apply every patch to the staged upstream sources.
 * @param stagingDir - copy of the upstream `src` directory.
 * @returns how many files and patches changed.
 */
export async function applyClientPatches(stagingDir: string): Promise<PatchResult> {
  const files = new Map<string, string>()
  for (const patch of PATCHES) {
    const path = join(stagingDir, patch.file)
    const source = files.get(path) ?? await readFile(path, 'utf8')
    const expected = patch.count ?? 1
    const occurrences = source.split(patch.before).length - 1
    if (occurrences !== expected) {
      throw new Error(`client-patches: ${patch.label} expected ${expected} anchor(s) in ${patch.file}, found ${occurrences}`)
    }
    files.set(path, source.replaceAll(patch.before, patch.after))
  }
  for (const [path, source] of files) await writeFile(path, source)
  return { files: files.size, patches: PATCHES.length }
}
