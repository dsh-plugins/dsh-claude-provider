import { useCallback, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CLAUDE_PROVIDER_SETTINGS_NS } from './claude-types.ts'
import styles from './ModelsSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' }
  }
}

type CacheTtl = 'short' | 'long'

interface CacheOptions {
  mixedEnabled: boolean
  toolsTtl: CacheTtl
  systemTtl: CacheTtl
  messagesTtl: CacheTtl
}

interface CacheSettings extends CacheOptions {
  cachePlan: string
}

const TTL_FIELDS = [
  { key: 'toolsTtl', label: '工具定义缓存时长' },
  { key: 'systemTtl', label: '系统提示缓存时长' },
  { key: 'messagesTtl', label: '消息缓存时长' },
] as const

const CACHE_FIELDS = ['mixedEnabled', ...TTL_FIELDS.map(field => field.key)] as const

function ClaudeCacheSettings({ form }: { form: ConfigForm<CacheSettings> }): ReactNode {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const { status, value, base, revision, writable } = useSyncExternalStore(subscribe, getSnapshot)
  const [draft, setDraft] = useState<{ value: CacheOptions, revision: number }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (status !== 'ready' || value === undefined || revision === undefined) {
    return <p role="status">{status === 'loading' ? '正在读取 Claude 提示缓存配置。' : 'Claude 提示缓存配置不可用。'}</p>
  }

  const options = draft?.value ?? value
  const changed = CACHE_FIELDS.filter(key => options[key] !== value[key])
  const stale = draft !== undefined && draft.revision !== revision
  const defaults = base as CacheOptions | undefined

  const edit = (next: CacheOptions): void => {
    setDraft({ value: next, revision: draft?.revision ?? revision })
    setError('')
  }

  async function save(): Promise<void> {
    if (draft === undefined || busy || !writable || stale || changed.length === 0) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await form.mutate(
        changed.map(key => ({ op: 'set', path: [key], value: draft.value[key] })),
        draft.revision,
      )
      if (saved) {
        setDraft(undefined)
      } else {
        setError('保存缓存配置失败，请取消修改后重试。')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存缓存配置失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className={styles['rowCard']}
      onSubmit={event => { event.preventDefault(); void save() }}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }}
    >
      <h3 className={styles['rowName']}>Claude 提示缓存</h3>
      <p>分段时长适用于缓存时长设为一小时的 Claude 提供方，由 dsh-loader 应用。<br />一小时缓存需排在五分钟缓存之前，写入按基础输入价的 2 倍计费。</p>
      <label className={styles['fieldLabel']}>
        <input type="checkbox" checked={options.mixedEnabled} disabled={busy || !writable}
          onChange={event => { edit({ ...options, mixedEnabled: event.currentTarget.checked }) }}
        />
        启用分段缓存时长
      </label>
      {options.mixedEnabled && TTL_FIELDS.map(({ key, label }) => (
        <label key={key} className={styles['field']}>
          <span className={styles['fieldLabel']}>{label}</span>
          <select className={`${styles['input']} ${styles['selectInput']}`} value={options[key]} disabled={busy || !writable}
            onChange={event => { edit({ ...options, [key]: event.currentTarget.value as CacheTtl }) }}
          >
            <option value="short">五分钟</option>
            <option value="long">一小时</option>
          </select>
        </label>
      ))}
      <p>{value.cachePlan}</p>
      {stale && <p role="status">缓存配置已有更新，取消修改后可载入最新值。</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles['rowActions']}>
        <button type="submit" className={styles['primaryButton']} disabled={busy || !writable || stale || changed.length === 0}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className={styles['secondaryButton']} disabled={busy || draft === undefined}
          onClick={() => { setDraft(undefined); setError('') }}
        >取消修改</button>
        <button type="button" className={styles['secondaryButton']} disabled={busy || !writable || defaults === undefined}
          onClick={() => { if (defaults !== undefined) { edit(defaults) } }}
        >恢复默认值</button>
      </div>
    </form>
  )
}

/** 注册插件详情中的分段缓存编辑器，使用 DSH 设置服务提交。 */
export function registerClaudeCacheSettings(ctx: Context): void {
  const form = ctx.configForms.get<CacheSettings>(CLAUDE_PROVIDER_SETTINGS_NS)
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@dsh-plugin/dsh-claude-provider',
    inject: () => ({ form }),
  }, ClaudeCacheSettings))
}
