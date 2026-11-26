import type { CachePosition, CacheTtl, MixedTtlPlan } from './cache.ts'
import { CACHE_POSITIONS, mixedPlanFailure } from './cache.ts'

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
