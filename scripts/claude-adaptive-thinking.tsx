/**
 * The per-model Adaptive thinking switch the Claude form adds beside the
 * reasoning-level editor.
 *
 * The upstream reasoning editor owns a single row of controls: its switch
 * turns reasoning on and its rows list levels. Adaptive thinking is a separate
 * axis, so this component renders its own labelled switch and delegates the
 * write to the caller's `onChange`.
 */
import type { ReactNode } from 'react'
import { Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsKey } from './locales.ts'
import type { ClaudeModel } from './claude-models.ts'
import { claudeAdaptiveEnabled, claudeCanDisableThinking, withClaudeAdaptive } from './claude-models.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ClaudeAdaptiveThinking}. */
export interface ClaudeAdaptiveThinkingProps {
  /** The drafted model row. */
  model: ClaudeModel
  /** The provider-wide `forceAdaptiveThinking` value this row inherits. */
  inherited?: unknown
  /** One-based position used in the control's accessible label. */
  position: number
  /** Disable the control while a write is pending. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace the drafted row. */
  onChange: (model: ClaudeModel) => void
}

/**
 * Render the adaptive-thinking toggle for one Claude model.
 * @param props - the row, its inherited posture, and the write path.
 * @returns the labelled toggle, locked open for a model that always reasons.
 */
export function ClaudeAdaptiveThinking(props: ClaudeAdaptiveThinkingProps): ReactNode {
  const { model, inherited, position, disabled, t, onChange } = props
  const label = `${t('claudeAdaptiveThinking')} ${String(position)}`
  // A model that always reasons cannot be switched off, so the control states
  // that instead of offering a choice the endpoint would refuse.
  const locked = !claudeCanDisableThinking(model.id)
  return (
    <div className={styles['modelReasoningHead']} style={{ marginTop: 4, marginBottom: 12 }}>
      <span className={`${styles['modelFieldLabel']} ${styles['modelReasoningLabel']}`}>
        {t('claudeAdaptiveThinking')}
        <Tooltip label={t('claudeAdaptiveHelp')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
          <button type="button" className={styles['helpButton']} aria-label={t('claudeAdaptiveHelpLabel')}>?</button>
        </Tooltip>
      </span>
      <Switch
        checked={locked ? true : claudeAdaptiveEnabled(model, inherited)}
        label={label}
        disabled={disabled || locked}
        onChange={(enabled) => { onChange(withClaudeAdaptive(model, enabled)) }}
      />
    </div>
  )
}
