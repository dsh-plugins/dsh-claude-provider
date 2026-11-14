/**
 * The route-level "accept empty thinking signatures" switch the Claude form
 * adds below the model list.
 *
 * Anthropic refuses a replayed thinking block whose signature is empty, so the
 * adapter converts such a block to text. Some Anthropic-compatible gateways
 * emit and accept empty signatures; for those the conversion destroys history
 * the endpoint would have accepted. The switch is off by default because the
 * first-party catalogue marks no model as accepting one.
 */
import type { ReactNode } from 'react'
import { Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ClaudeEmptySignature}. */
export interface ClaudeEmptySignatureProps {
  /** Whether the route currently declares the switch. */
  checked: boolean
  /** Disable the control while a write is pending. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Record (`true`) or clear (`false`) the switch. */
  onChange: (enabled: boolean) => void
}

/**
 * Render the empty-signature switch for one Claude route.
 * @param props - the current value and the write path.
 * @returns the labelled switch.
 */
export function ClaudeEmptySignature(props: ClaudeEmptySignatureProps): ReactNode {
  const { checked, disabled, t, onChange } = props
  return (
    <div className={styles['modelReasoningHead']} style={{ marginBottom: 12 }}>
      <span className={`${styles['modelFieldLabel']} ${styles['modelReasoningLabel']}`}>
        {t('claudeEmptySignature')}
        <Tooltip label={t('claudeEmptySignatureHelp')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
          <button type="button" className={styles['helpButton']} aria-label={t('claudeEmptySignatureHelpLabel')}>?</button>
        </Tooltip>
      </span>
      <Switch
        checked={checked}
        label={t('claudeEmptySignature')}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  )
}
