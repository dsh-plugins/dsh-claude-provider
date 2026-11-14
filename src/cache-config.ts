/**
 * Plugin configuration template for mixed prompt-cache TTLs and cache pre-warming.
 *
 * The plan lives here rather than on each route because it applies to every
 * Claude route that already asked for a one-hour lifetime: changing a section's
 * duration must not rewrite the profile. `defineConfig` is deliberately not
 * imported so the plugin still loads in profiles without `@dsh-plugin/dsh-loader`;
 * the field shape below is that loader's own template contract.
 */
import type { CachePosition, CacheTtl, MixedTtlPlan } from './cache.ts'
import { CACHE_POSITIONS, mixedPlanFailure } from './cache.ts'

/** Template identity the loader registers the settings page under. */
export const CACHE_CONFIG_ID = 'claude-cache'

/** Package the settings page attributes this template to. */
export const CACHE_CONFIG_PACKAGE = '@dsh-plugin/dsh-claude-provider'

/** One `select` choice offered for a section's lifetime. */
interface SelectChoice {
  label: string
  value: string
}

/** The subset of the loader's field contract this template uses. */
export interface TemplateField {
  type: 'select' | 'boolean' | 'text'
  key: string
  label: string
  description?: string
  default: string | boolean
  options?: SelectChoice[]
  visibleWhen?: { path: string[], equals: boolean }
}

/** The subset of the loader's template contract this template uses. */
export interface Template {
  id: string
  packageName: string
  title: string
  description: string
  fields: TemplateField[]
  panels?: {
    id: string
    title: string
    description?: string
    fields: TemplateField[]
    operations: {
      id: string
      button?: { label: string, success?: string }
      input?: string[]
      /** A read operation may run on mount and on every configuration change. */
      readOnly?: boolean
      autoRun?: boolean
      result?: { type: 'text', title?: string, path?: string[] }[]
    }[]
  }[]
}

/** Lifetime choices shared by every section, spelled once. */
const TTL_CHOICES: readonly SelectChoice[] = [
  { label: '5 分钟', value: 'short' },
  { label: '1 小时（写入按 2 倍输入计费）', value: 'long' },
]

/** Section labels in cache-prefix order. */
const SECTION_LABELS: Readonly<Record<CachePosition, string>> = {
  tools: '工具定义',
  system: '系统提示',
  messages: '消息',
}

/** Plugin configuration the cache plan reads. */
export interface CacheConfig {
  mixedEnabled: boolean
  toolsTtl: string
  systemTtl: string
  messagesTtl: string
}

/**
 * Resolve a stored value to a usable lifetime.
 * @param value - stored selection.
 * @returns the lifetime, defaulting to the five-minute one.
 */
export function cacheTtlOf(value: unknown): CacheTtl {
  return value === 'long' ? 'long' : 'short'
}

/**
 * Read the section assignment the configuration asks for.
 * @param config - stored plugin configuration.
 * @returns the per-section assignment; callers must still validate its order.
 */
export function cachePlanOf(config: CacheConfig): MixedTtlPlan {
  return {
    tools: cacheTtlOf(config.toolsTtl),
    system: cacheTtlOf(config.systemTtl),
    messages: cacheTtlOf(config.messagesTtl),
  }
}

/** Report what the saved assignment currently does, in cache-prefix order. */
export function describePlan(config: CacheConfig): string {
  if (!config.mixedEnabled) {
    return '分段缓存时长已关闭：每条路由按自己声明的缓存时长发送，各分段沿用提供商自身的时长。'
  }
  const plan = cachePlanOf(config)
  const failure = mixedPlanFailure(plan)
  if (failure !== undefined) {
    return `当前组合不会生效：${failure}。保存后相关请求会沿用提供商自身的时长。`
  }
  const parts = CACHE_POSITIONS.map((position) => {
    const ttl = plan[position]
    return `${SECTION_LABELS[position]}${ttl === 'long' ? '一小时' : '五分钟'}`
  })
  return `当前组合生效：${parts.join('、')}。`
}

/**
 * Build the settings template the loader registers.
 * @returns the template, defaulting to a one-hour prefix and a five-minute conversation.
 */
export function createCacheTemplate(): Template {
  return {
    id: CACHE_CONFIG_ID,
    packageName: CACHE_CONFIG_PACKAGE,
    title: 'Claude 提示缓存',
    description:
      '为已选择「一小时」缓存时长的 Claude 提供商分段设置缓存存活时间。'
      + '一小时缓存必须排在五分钟缓存之前，工具与系统提示属于前缀，消息属于后段。'
      + '一小时写入按基础输入价的 2 倍计费。',
    fields: [
      {
        type: 'boolean',
        key: 'mixedEnabled',
        label: '启用分段缓存时长',
        description: '关闭后，一小时缓存覆盖整个请求，各分段沿用提供商自身的时长。',
        default: true,
      },
      {
        type: 'select',
        key: 'toolsTtl',
        label: `${SECTION_LABELS.tools}缓存时长`,
        description: '工具定义很少变化，适合一小时缓存。',
        default: 'long',
        options: [...TTL_CHOICES],
        visibleWhen: { path: ['mixedEnabled'], equals: true },
      },
      {
        type: 'select',
        key: 'systemTtl',
        label: `${SECTION_LABELS.system}缓存时长`,
        description: '系统提示同样稳定，适合一小时缓存。',
        default: 'long',
        options: [...TTL_CHOICES],
        visibleWhen: { path: ['mixedEnabled'], equals: true },
      },
      {
        type: 'select',
        key: 'messagesTtl',
        label: `${SECTION_LABELS.messages}缓存时长`,
        description: '对话内容持续增长，五分钟缓存通常更划算。选了一小时的段必须排在选了五分钟的段之前。',
        default: 'short',
        options: [...TTL_CHOICES],
        visibleWhen: { path: ['mixedEnabled'], equals: true },
      },
    ],
    panels: [
      {
        id: 'plan',
        title: '当前生效的分段时长',
        description:
          '显示保存后实际发送的分段时长。一段的取值导致一小时缓存排在五分钟缓存之后时，'
          + '相关请求不会改写，沿用它自己声明的缓存时长。',
        // The loader requires an array here; this panel only reports, so it has
        // nothing to edit.
        fields: [],
        operations: [
          {
            id: 'plan',
            readOnly: true,
            autoRun: true,
            result: [{ type: 'text', title: '当前生效的分段时长' }],
          },
        ],
      },
    ],
  }
}
