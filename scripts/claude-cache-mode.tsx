/**
 * The route-level prompt-cache lifetime picker the Claude form adds below the
 * model list.
 *
 * The control names one of the three lifetimes the provider profile already
 * accepts. Splitting a request into per-section lifetimes is not a route choice:
 * it belongs to the plugin settings page and applies to every route left on one
 * hour, so this picker stays a single select with no plugin-wide option.
 * "Provider default" clears the field rather than recording a value, because an
 * absent `cacheRetention` is what lets the adapter keep its own decision.
 */
import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Selection this control stores on the route, as the profile's own value. */
export type ClaudeCacheChoice = 'none' | 'short' | 'long'

/** Props of {@link ClaudeCacheMode}. */
export interface ClaudeCacheModeProps {
  /** The route's stored lifetime; `undefined` means it names none. */
  value: ClaudeCacheChoice | undefined
  /** Disable the control while a write is pending. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Record the new selection, or `undefined` to clear the field. */
  onChange: (choice: ClaudeCacheChoice | undefined) => void
}

/** Choices in the order they are offered, each with its own copy key. */
const CHOICES: readonly { value: ClaudeCacheChoice | undefined, key: ModelsKey }[] = [
  { value: undefined, key: 'claudeCacheProvider' },
  { value: 'none', key: 'claudeCacheOff' },
  { value: 'short', key: 'claudeCacheShort' },
  { value: 'long', key: 'claudeCacheLong' },
]

/**
 * Render the cache-lifetime picker for one Claude route.
 * @param props - the current selection and the write path.
 * @returns the labelled select.
 */
export function ClaudeCacheMode(props: ClaudeCacheModeProps): ReactNode {
  const { value, disabled, t, onChange } = props
  return (
    <div className={styles['field']} style={{ marginBottom: 12 }}>
      <span className={styles['modelFieldLabel']}>
        {t('claudeCacheMode')}
        <Tooltip label={t('claudeCacheModeHelp')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
          <button type="button" className={styles['helpButton']} aria-label={t('claudeCacheModeHelpLabel')}>?</button>
        </Tooltip>
      </span>
      <select
        className={`${styles['input']} ${styles['selectInput']}`}
        value={value ?? ''}
        aria-label={t('claudeCacheMode')}
        disabled={disabled}
        onChange={(event) => {
          const choice = event.target.value
          onChange(choice === '' ? undefined : choice as ClaudeCacheChoice)
        }}
      >
        {CHOICES.map(choice => (
          <option key={choice.key} value={choice.value ?? ''}>{t(choice.key)}</option>
        ))}
      </select>
    </div>
  )
}
