import type { CacheTtl } from './cache.ts'

export const CLAUDE_PROVIDER_TYPE = 'claude-adaptive'
export const CLAUDE_PROVIDER_SETTINGS_NS = 'dsh-claude-provider'

/** 各提供方路由对应的 Claude 类型标记。 */
export type ProviderTypes = Record<string, typeof CLAUDE_PROVIDER_TYPE>

/** 当前 profile 持久化的 Claude 提供方设置。 */
export interface PluginConfig {
  providerTypes: ProviderTypes
  mixedEnabled: boolean
  toolsTtl: CacheTtl
  systemTtl: CacheTtl
  messagesTtl: CacheTtl
}

export const DEFAULT_CONFIG: Readonly<PluginConfig> = {
  providerTypes: {},
  mixedEnabled: true,
  toolsTtl: 'long',
  systemTtl: 'long',
  messagesTtl: 'short',
}

/** 校验已提供的字段，保留缺省字段以便合并不同配置来源。 */
export function readConfigPatch(value: unknown): Partial<PluginConfig> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Claude 配置必须是对象')
  }
  const patch: Partial<PluginConfig> = {}
  for (const [key, field] of Object.entries(value)) {
    switch (key) {
      case 'providerTypes': {
        if (field === null || typeof field !== 'object' || Array.isArray(field)) {
          throw new Error('Claude 配置中的 providerTypes 必须是对象')
        }
        const markers = Object.entries(field)
        if (!markers.every((entry): entry is [string, typeof CLAUDE_PROVIDER_TYPE] => entry[1] === CLAUDE_PROVIDER_TYPE)) {
          throw new Error('Claude 配置中的 providerTypes 包含无效类型')
        }
        patch.providerTypes = Object.fromEntries(markers)
        break
      }
      case 'mixedEnabled': {
        if (typeof field !== 'boolean') {
          throw new Error('Claude 配置中的 mixedEnabled 必须是布尔值')
        }
        patch.mixedEnabled = field
        break
      }
      case 'toolsTtl':
      case 'systemTtl':
      case 'messagesTtl': {
        if (field !== 'short' && field !== 'long') {
          throw new Error(`Claude 配置中的 ${key} 必须是 short 或 long`)
        }
        patch[key] = field
        break
      }
      default:
        throw new Error(`未知的 Claude 配置项 ${key}`)
    }
  }
  return patch
}

/** 校验配置并补齐缺省值。 */
export function readConfig(value: unknown): PluginConfig {
  return { ...DEFAULT_CONFIG, providerTypes: {}, ...readConfigPatch(value) }
}
