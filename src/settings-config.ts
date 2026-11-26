import z from '@deepseek-ai/schemastery'
import type { SettingsForms, SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { describePlan } from './cache-config.ts'
import {
  CLAUDE_PROVIDER_SETTINGS_NS,
  CLAUDE_PROVIDER_TYPE,
  DEFAULT_CONFIG,
  readConfig,
  readConfigPatch,
  type PluginConfig,
} from './config.ts'

/** 配置存储在串行写入队列内提供当前值和修订号。 */
export interface SettingsConfigStore {
  get(): { value: PluginConfig, revision: number } | undefined
  change(edit: (value: PluginConfig, revision: number) => PluginConfig): Promise<{ value: PluginConfig, revision: number }>
}

/** 设置桥接通过插件作用域管理生命周期，复用宿主的配置变更事件。 */
export interface SettingsConfigContext {
  effect(factory: () => () => void): unknown
  emit(event: 'settings/document-updated', ns: SettingsNamespace, revision: number): void
}

type SettingsMethods = Pick<SettingsForms, 'describe' | 'update' | 'replace' | 'mutate'>

const namespace = CLAUDE_PROVIDER_SETTINGS_NS as SettingsNamespace
const cacheTtl = z.union([z.const('short'), z.const('long')])
const schema = z.object({
  providerTypes: z.dict(z.const(CLAUDE_PROVIDER_TYPE)).default(DEFAULT_CONFIG.providerTypes),
  mixedEnabled: z.boolean().default(DEFAULT_CONFIG.mixedEnabled),
  toolsTtl: cacheTtl.default(DEFAULT_CONFIG.toolsTtl),
  systemTtl: cacheTtl.default(DEFAULT_CONFIG.systemTtl),
  messagesTtl: cacheTtl.default(DEFAULT_CONFIG.messagesTtl),
  cachePlan: z.string(),
}).toJSON()

function applyEdits(current: PluginConfig, operations: readonly SettingsPathOp[]): PluginConfig {
  if (!Array.isArray(operations)) {
    throw new TypeError('配置操作必须是数组')
  }
  let next: Record<string, unknown> = { ...current }
  for (const operation of operations) {
    if (!operation || (operation.op !== 'set' && operation.op !== 'unset')
      || !Array.isArray(operation.path) || operation.path.some((key: unknown) => typeof key !== 'string')) {
      throw new TypeError('配置操作必须指定 set 或 unset 以及字段路径')
    }
    const [field, provider, ...rest] = operation.path
    if (field === undefined) {
      next = operation.op === 'set' ? { ...readConfigPatch(operation.value) } : {}
    } else if (!Object.hasOwn(DEFAULT_CONFIG, field) || rest.length > 0 || (provider !== undefined && field !== 'providerTypes')) {
      throw new TypeError(`配置路径不可写入 ${operation.path.join('.')}`)
    } else if (provider === undefined) {
      if (operation.op === 'set' && operation.value !== undefined) {
        next[field] = operation.value
      } else {
        delete next[field]
      }
    } else {
      const value = next['providerTypes']
      if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        throw new TypeError('providerTypes 必须是提供商类型映射')
      }
      const markers: Record<string, unknown> = { ...value }
      if (operation.op === 'set' && operation.value !== undefined) {
        next['providerTypes'] = { ...markers, [provider]: operation.value }
      } else {
        delete markers[provider]
        next['providerTypes'] = markers
      }
    }
  }
  return readConfig(next)
}

function wrapMethod<K extends keyof SettingsMethods>(
  settings: SettingsMethods,
  key: K,
  wrap: (upstream: SettingsMethods[K]) => SettingsMethods[K],
): () => void {
  const previous = Object.getOwnPropertyDescriptor(settings, key)
  const wrapped = wrap(settings[key])
  settings[key] = wrapped
  return () => {
    // Cordis 每次读取服务方法都会构建代理，属性描述符保留包装函数的身份。
    if (Object.getOwnPropertyDescriptor(settings, key)?.value === wrapped) {
      if (previous === undefined) {
        Reflect.deleteProperty(settings, key)
      } else {
        Object.defineProperty(settings, key, previous)
      }
    }
  }
}

/** 将 Claude 设置接到现有的 DSH 设置接口，供模型页和缓存表单共用。 */
export function installSettingsConfig(ctx: SettingsConfigContext, settings: unknown, store: SettingsConfigStore): void {
  const host = settings as SettingsMethods
  ctx.effect(() => {
    let active = true
    const write = async (change: (value: PluginConfig) => PluginConfig, expected?: number): Promise<void> => {
      const previous = store.get()?.revision
      try {
        await store.change((value, revision) => {
          if (expected !== undefined && expected !== revision) {
            throw Object.assign(new Error(`Claude 配置已更新，预期修订号 ${expected}，当前修订号 ${revision}`), {
              code: 'SETTINGS_CONFLICT', expected, actual: revision,
            })
          }
          return change(value)
        })
      } finally {
        const revision = store.get()?.revision
        if (active && revision !== undefined && revision !== previous) {
          ctx.emit('settings/document-updated', namespace, revision)
        }
      }
    }
    const restore = [
      wrapMethod(host, 'describe', upstream => function (this: SettingsForms, options) {
        const entries = upstream.call(this, options)
        if (!active) {
          return entries
        }
        const other = entries.filter(entry => entry.ns !== namespace)
        const snapshot = store.get()
        if (snapshot !== undefined) {
          other.push({
            ns: namespace,
            autoGenerate: false,
            schema,
            value: { ...snapshot.value, cachePlan: describePlan(snapshot.value) },
            base: DEFAULT_CONFIG,
            user: snapshot.value,
            applies: 'live',
            revision: snapshot.revision,
          })
        }
        return other
      }),
      wrapMethod(host, 'update', upstream => {
        const update: SettingsMethods['update'] = async function (this: SettingsForms, ns, patch, expected) {
          if (!active || ns !== namespace) {
            return upstream.call(this, ns, patch, expected)
          }
          // 宿主在服务实例上直接导入 settings.yaml，插件根据当前 profile 自行恢复该段。
          if (this.update === update) {
            return
          }
          await write(value => {
            const { providerTypes, ...cache } = readConfigPatch(patch)
            return { ...value, ...cache, providerTypes: { ...value.providerTypes, ...providerTypes } }
          }, expected)
        }
        return update
      }),
      wrapMethod(host, 'replace', upstream => function (this: SettingsForms, ns, section, expected) {
        return active && ns === namespace ? write(() => readConfig(section), expected) : upstream.call(this, ns, section, expected)
      }),
      wrapMethod(host, 'mutate', upstream => function (this: SettingsForms, ns, operations, expected) {
        return active && ns === namespace
          ? write(value => applyEdits(value, operations), expected)
          : upstream.call(this, ns, operations, expected)
      }),
    ]
    return () => {
      active = false
      for (const dispose of restore) {
        dispose()
      }
    }
  })
}
