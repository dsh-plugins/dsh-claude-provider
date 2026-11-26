import z from '@deepseek-ai/schemastery'
import {
  isMessagesRequest,
  mixedPlanFailure,
  providerForUrl,
  retimeCacheTtl,
} from './cache.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { cachePlanOf } from './cache-config.ts'
import { CLAUDE_PROVIDER_SETTINGS_NS, CLAUDE_PROVIDER_TYPE } from './config.ts'
import type { PluginConfig, ProviderTypes } from './config.ts'
import { CLAUDE_KNOWN_MODELS } from './known-models.ts'
import type { ClaudeKnownModel } from './known-models.ts'
import { openProfileConfig } from './profile-config.ts'
import type { ProfilePaths } from './profile-config.ts'
import { installSettingsConfig } from './settings-config.ts'

export { CLAUDE_KNOWN_MODELS, CLAUDE_PROVIDER_SETTINGS_NS, CLAUDE_PROVIDER_TYPE }
export type { ClaudeKnownModel }

export const name = 'claude-provider'
export const inject = ['llm', 'settings', 'profileContext', 'loader']

/** 允许宿主加载仍含旧类型标记的 profile 补丁。 */
export const Config = z.object({
  providerTypes: z.dict(z.const(CLAUDE_PROVIDER_TYPE)).default({}),
})

export type Config = ReturnType<typeof Config>

export const CLAUDE_DISCOVERY_API = 'mofeng-anthropic-models'

const PI_AI_SETTINGS_NS = 'llm-pi-ai'
const MAX_DISCOVERY_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_DISCOVERY_PAGES = 100

/** One model candidate a provider endpoint disclosed. */
export interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

/** One endpoint interrogation the settings page asks for. */
export interface DiscoveryRequest {
  /** Route the draft would occupy, when the page edits one. */
  provider?: string
  /** Wire protocol the draft names. */
  api?: string
  /** Endpoint the draft names. */
  baseURL?: string
  /** Key typed into the form and not yet stored. */
  apiKey?: string
}

/** The interrogation one page performs, including caller cancellation. */
export type DiscoverModels = (
  settingsNs: string,
  request: DiscoveryRequest,
  signal?: AbortSignal,
) => Promise<readonly DiscoveredModel[]>

/** Resolved value of one settings namespace, as the settings service reports it. */
interface SettingsDescriptor {
  readonly ns: string
  readonly value?: unknown
}

/** Settings service face this plugin reads provider types from. */
interface SettingsFace {
  describe(): readonly SettingsDescriptor[]
}

/** Credential service face this plugin resolves stored keys through. */
interface CredentialsFace {
  resolve(ref: string): Promise<{ readonly value?: string } | undefined>
}

/** The LLM service face this plugin wraps. */
export interface LlmFace {
  discoverModels: DiscoverModels
}

/**
 * Context surface `apply` touches. DSH services are declared here rather than
 * imported so the plugin keeps a single runtime dependency and absorbs host
 * service-shape changes at one boundary.
 */
export interface PluginContext {
  readonly llm: LlmFace
  readonly profileContext: ProfilePaths
  readonly loader: { await(): Promise<void> }
  get(name: 'settings'): SettingsFace
  get(name: 'credentials'): CredentialsFace | undefined
  emit(event: 'settings/document-updated', ns: SettingsNamespace, revision: number): void
  effect(factory: () => () => void): unknown
  /**
   * Mount a sub-context once the named services exist; a service the profile
   * does not provide leaves the factory unmounted instead of failing `apply`.
   * The type parameter is the caller's own view of the services it waits for.
   */
  inject<T extends PluginContext>(names: readonly string[], factory: (ctx: T) => void): unknown
  logger?: {
    warn(message: string, error?: unknown): void
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`claude-provider: ${field} must be a non-empty string`)
  }
  return value
}

function positiveInteger(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  }
  return undefined
}

function nonEmptyString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Build the Anthropic Models API endpoint from the same base used by Messages. */
export function anthropicModelsUrl(baseURL: string): URL {
  const raw = requireNonEmptyString(baseURL, 'baseURL').trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new Error('Claude 模型目录：API 地址不是有效 URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Claude 模型目录：API 地址只能使用 http 或 https')
  }
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = /\/v1$/i.test(path) ? `${path}/models` : `${path}/v1/models`
  url.search = ''
  url.hash = ''
  return url
}

async function readBoundedResponse(response: Response, url: string): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_DISCOVERY_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error(`Claude 模型目录：${url} 返回内容超过 4 MiB`)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DISCOVERY_RESPONSE_BYTES) {
        throw new Error(`Claude 模型目录：${url} 返回内容超过 4 MiB`)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** One parsed Anthropic `/v1/models` page. */
export interface AnthropicModelPage {
  models: DiscoveredModel[]
  hasMore: boolean
  lastId: string | undefined
}

/** Parse one Anthropic `/v1/models` page into DSH discovery rows. */
export function readAnthropicModelPage(body: unknown): AnthropicModelPage {
  const page = body as { data?: unknown, has_more?: unknown, last_id?: unknown } | null
  const data = page?.data
  if (!Array.isArray(data)) {
    throw new Error('Claude 模型目录：接口返回中没有 data 数组')
  }
  const models: DiscoveredModel[] = []
  for (const raw of data) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const id = nonEmptyString(entry['id'])
    if (id === undefined) continue
    const name = nonEmptyString(entry['display_name'], entry['name'])
    const contextWindow = positiveInteger(entry['max_input_tokens'], entry['context_window'], entry['context_length'])
    const maxTokens = positiveInteger(entry['max_tokens'], entry['max_output_tokens'])
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return {
    models,
    hasMore: page?.has_more === true,
    lastId: nonEmptyString(page?.last_id),
  }
}

/** Fill a discovered row's capacities from the recorded Claude model table. */
export function withKnownModelMetadata(model: DiscoveredModel): DiscoveredModel {
  const known = CLAUDE_KNOWN_MODELS[model.id]
  if (known === undefined) return model
  return { ...model, contextWindow: known.contextWindow, maxTokens: known.maxTokens }
}

function discoveryHeaders(apiKey: string): Headers {
  const value = requireNonEmptyString(apiKey, 'apiKey').trim()
  if (value.length === 0) throw new Error('Claude 模型目录：请先填写 API 密钥')
  try {
    return new Headers({
      accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': value,
    })
  } catch (error) {
    throw new Error('Claude 模型目录：API 密钥包含无法用于 HTTP 请求头的字符', { cause: error })
  }
}

function responseErrorMessage(body: unknown): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === 'string' && message.length > 0 ? message.slice(0, 500) : undefined
}

/** Inputs of one Anthropic catalogue interrogation. */
export interface AnthropicDiscoveryOptions {
  baseURL: string
  apiKey: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Query only the native Anthropic Models API, including cursor pagination. */
export async function discoverAnthropicModels(
  { baseURL, apiKey, signal, fetchImpl = globalThis.fetch }: AnthropicDiscoveryOptions,
): Promise<DiscoveredModel[]> {
  if (typeof fetchImpl !== 'function') throw new Error('Claude 模型目录：当前运行环境没有 fetch')
  const endpoint = anthropicModelsUrl(baseURL)
  const headers = discoveryHeaders(apiKey)
  const models: DiscoveredModel[] = []
  const seen = new Set<string>()
  let afterId: string | undefined
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    if (signal?.aborted) throw new Error('Claude 模型目录：获取已取消')
    const url = new URL(endpoint)
    if (afterId !== undefined) url.searchParams.set('after_id', afterId)
    let response: Response
    try {
      response = await fetchImpl(url, { method: 'GET', headers, signal })
    } catch (error) {
      if (signal?.aborted) throw new Error('Claude 模型目录：获取已取消', { cause: error })
      throw new Error(`Claude 模型目录：无法连接 ${url.origin}`, { cause: error })
    }
    const text = await readBoundedResponse(response, url.href)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (error) {
      throw new Error(`Claude 模型目录：${url.href} 未返回 JSON`, { cause: error })
    }
    if (!response.ok) {
      const detail = responseErrorMessage(body)
      throw new Error(
        `Claude 模型目录：${url.href} 返回 ${response.status}`
        + `${response.status === 401 || response.status === 403 ? '，请检查 API 密钥' : ''}`
        + `${detail === undefined ? '' : `：${detail}`}`,
      )
    }
    const parsed = readAnthropicModelPage(body)
    for (const model of parsed.models) {
      if (seen.has(model.id)) continue
      seen.add(model.id)
      models.push(withKnownModelMetadata(model))
    }
    if (!parsed.hasMore) return models
    if (parsed.lastId === undefined || parsed.lastId === afterId) {
      throw new Error('Claude 模型目录：分页响应缺少有效的 last_id')
    }
    afterId = parsed.lastId
  }
  throw new Error(`Claude 模型目录：分页超过 ${MAX_DISCOVERY_PAGES} 页`)
}

function configuredCredentialRef(ctx: PluginContext, provider: string | undefined): string | undefined {
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  const section = ctx.get('settings')?.describe().find(entry => entry.ns === PI_AI_SETTINGS_NS)?.value
  const profile = (section as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined)?.providers?.[provider]
  const ref = profile?.apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

async function discoveryApiKey(ctx: PluginContext, request: DiscoveryRequest): Promise<string> {
  if (typeof request.apiKey === 'string' && request.apiKey.trim().length > 0) return request.apiKey
  const ref = configuredCredentialRef(ctx, request.provider)
  if (ref === undefined) throw new Error('Claude 模型目录：请先填写 API 密钥')
  const value = (await ctx.get('credentials')?.resolve(ref))?.value ?? process.env[ref]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Claude 模型目录：未找到已保存的凭据 ${ref}`)
  }
  return value
}

/** Whether an explicitly registered provider belongs to this plugin's Claude type. */
export function isClaudeProviderType(settings: unknown, provider: string | undefined): boolean {
  if (typeof provider !== 'string' || provider.length === 0) return false
  const types = (settings as { providerTypes?: Record<string, unknown> } | undefined)?.providerTypes
  return types?.[provider] === CLAUDE_PROVIDER_TYPE
}

function installClaudeModelDiscovery(ctx: PluginContext): void {
  const llm = ctx.llm
  const upstream = llm.discoverModels
  // DSH 0.1.2-alpha moved caller cancellation to a third positional
  // parameter; `request.signal` no longer exists. Forward it verbatim.
  // Only the plugin's own Claude surfaces send CLAUDE_DISCOVERY_API, so every
  // other provider — generic anthropic-messages routes included — keeps the
  // stock discovery behavior.
  const wrapped: DiscoverModels = async function (this: unknown, settingsNs, request, signal) {
    if (settingsNs !== PI_AI_SETTINGS_NS || request?.api !== CLAUDE_DISCOVERY_API) {
      return upstream.call(this, settingsNs, request, signal)
    }
    // The built-in Anthropic route already has pi-ai's catalog and should keep
    // using it. The plugin extension is only for hand-declared Claude routes.
    if (request.provider === 'anthropic') {
      return upstream.call(this, settingsNs, { ...request, api: 'anthropic-messages' }, signal)
    }
    if (typeof request.baseURL !== 'string' || request.baseURL.length === 0) {
      throw new Error('Claude 模型目录：请先填写 API 地址')
    }
    const apiKey = await discoveryApiKey(ctx, request)
    return discoverAnthropicModels({ baseURL: request.baseURL, apiKey, signal })
  }
  llm.discoverModels = wrapped
  ctx.effect(() => () => {
    if (llm.discoverModels === wrapped) llm.discoverModels = upstream
  })
}

/** 分段缓存使用的 dsh-loader 补丁接口。 */
interface CacheLoaderFace {
  patch: {
    global<T>(key: PropertyKey, wrap: (original: T) => T, options?: { id?: string, owner?: unknown }): { dispose(): void }
  }
}

function settingsValue(ctx: PluginContext, ns: string): Record<string, unknown> | undefined {
  const entry = ctx.get('settings')?.describe().find(candidate => candidate.ns === ns)?.value
  return typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined
}

function cacheTargets(ctx: PluginContext, markers: ProviderTypes): Map<string, string> {
  const bases = new Map<string, string>()
  const profiles = settingsValue(ctx, PI_AI_SETTINGS_NS)?.['providers']
  if (profiles === null || typeof profiles !== 'object') {
    return bases
  }
  const directory = profiles as Record<string, { cacheRetention?: unknown, baseURL?: unknown } | undefined>
  for (const provider of Object.keys(markers)) {
    const profile = directory[provider]
    if (profile?.cacheRetention !== 'long') {
      continue
    }
    const baseURL = profile.baseURL
    if (typeof baseURL === 'string' && baseURL.trim().length > 0) {
      bases.set(provider, baseURL)
    }
  }
  return bases
}

function requestUrlOf(input: RequestInfo | URL): string | undefined {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url
}

function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (typeof init?.method === 'string') return init.method
  return input instanceof Request ? input.method : 'GET'
}

function headersOf(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init?.headers !== undefined) {
    new Headers(init.headers).forEach((value, key) => { headers.set(key, value) })
  }
  return headers
}

function installCacheControl(ctx: PluginContext, currentConfig: () => PluginConfig | undefined): void {
  ctx.inject(['dshLoader'], (sub: PluginContext & { dshLoader: CacheLoaderFace }) => {
    const loader = sub.dshLoader
    if (typeof globalThis.fetch !== 'function') {
      sub.logger?.warn('[claude-provider] 全局 fetch 不可用；混合缓存失效')
      return
    }
    loader.patch.global<typeof fetch>('fetch', upstream => async function (this: unknown, input, init) {
      // The cheapest test first: this wrapper sits on every fetch call in the
      // process, so a method and URL check must not build Headers or read
      // settings for requests that cannot be Anthropic Messages calls.
      if (methodOf(input, init).toUpperCase() !== 'POST') return upstream.call(this, input, init)
      const url = requestUrlOf(input)
      if (url === undefined || !url.includes('/messages')) return upstream.call(this, input, init)
      const headers = headersOf(input, init)
      if (!isMessagesRequest(url, methodOf(input, init), headers)) {
        return upstream.call(this, input, init)
      }
      const config = currentConfig()
      if (!config?.mixedEnabled) {
        return upstream.call(this, input, init)
      }
      const plan = cachePlanOf(config)
      if (mixedPlanFailure(plan) !== undefined) {
        return upstream.call(this, input, init)
      }
      const provider = providerForUrl(url, cacheTargets(sub, config.providerTypes))
      if (provider === undefined) return upstream.call(this, input, init)
      const text = typeof init?.body === 'string' ? init.body : undefined
      if (text === undefined) return upstream.call(this, input, init)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        sub.logger?.warn(`[claude-provider] ${provider} 的请求体不是 JSON，跳过缓存改写`, error)
        return upstream.call(this, input, init)
      }
      const { body, changed } = retimeCacheTtl(parsed, plan)
      if (!changed) return upstream.call(this, input, init)
      return upstream.call(this, input, { ...init, body: JSON.stringify(body) })
    }, { id: 'claude-provider:cache-ttl', owner: sub })
  })
}

export function apply(ctx: PluginContext): void {
  installClaudeModelDiscovery(ctx)
  const lifecycle = new AbortController()
  ctx.effect(() => () => lifecycle.abort())
  // 宿主重载配置时可能持有 profile 锁，迁移要等宿主完成插件加载。
  const config = openProfileConfig(ctx.profileContext, {
    providers: () => settingsValue(ctx, PI_AI_SETTINGS_NS)?.['providers'],
    signal: lifecycle.signal,
    warn: (message, error) => ctx.logger?.warn(message, error),
  }, ctx.loader.await())
  installSettingsConfig(ctx, ctx.get('settings'), config)
  installCacheControl(ctx, () => config.get()?.value)
  void config.ready.then(({ revision }) => {
    if (!lifecycle.signal.aborted) {
      ctx.emit('settings/document-updated', CLAUDE_PROVIDER_SETTINGS_NS as SettingsNamespace, revision)
    }
  }).catch((error: unknown) => {
    if (!lifecycle.signal.aborted) {
      ctx.logger?.warn('[claude-provider] 加载或迁移 profile 配置失败', error)
    }
  })
}
