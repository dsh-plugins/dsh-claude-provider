/**
 * Request-body rewriting for Anthropic prompt-cache TTLs and cache pre-warming.
 *
 * `pi-ai` stamps one `cache_control` object onto every breakpoint it creates, so
 * a route can only ask for a single TTL. The Claude API accepts mixed TTLs as
 * long as every one-hour breakpoint precedes every five-minute one, and its
 * cache prefix order (tools, system, messages) makes that ordering expressible
 * per section. These helpers rewrite a serialized request body without mutating
 * the caller's value, so the fetch patch can send a request the adapter itself
 * cannot express.
 *
 * Pre-warming follows the same shape: replay a remembered body with
 * `max_tokens: 0`, keep an explicit breakpoint on the shared tools and system
 * blocks, and replace the conversation with a placeholder so the written entry
 * is keyed to the prefix the next real request reuses.
 */

/** Section of a Messages request that carries cache breakpoints, in prefix order. */
export const CACHE_POSITIONS = ['tools', 'system', 'messages'] as const

/** One section of the request whose breakpoints can carry their own TTL. */
export type CachePosition = (typeof CACHE_POSITIONS)[number]

/** Cache lifetime one section asks for. */
export type CacheTtl = 'short' | 'long'

/** TTL assignment for a mixed request. */
export type MixedTtlPlan = Readonly<Record<CachePosition, CacheTtl>>

/** TTL the wire protocol spells for a one-hour breakpoint. */
const LONG_TTL = '1h'

/** Placeholder user turn a pre-warm request must carry. */
export const PREWARM_PLACEHOLDER = 'warmup'

/**
 * Whether one section assignment can be sent at all.
 *
 * The API bills a request by position and refuses one whose five-minute entry
 * precedes a one-hour entry, so a plan is usable only while every long section
 * comes before the first short one.
 * @param plan - the per-section assignment to check.
 * @returns the reason the plan cannot be sent, or `undefined` when it can.
 */
export function mixedPlanFailure(plan: MixedTtlPlan): string | undefined {
  let firstShort: CachePosition | undefined
  for (const position of CACHE_POSITIONS) {
    const ttl = plan[position]
    if (ttl !== 'short' && ttl !== 'long') {
      return `${position} 的取值无效`
    }
    if (ttl === 'short') {
      firstShort ??= position
      continue
    }
    if (firstShort !== undefined) {
      return `${position} 使用一小时缓存，却排在 ${firstShort} 的五分钟缓存之后`
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Copy one breakpoint with the requested lifetime, leaving every other key.
 * @param control - the existing `cache_control` value.
 * @param ttl - lifetime this section asks for.
 * @returns the replacement value, or the input when it is not a breakpoint.
 */
function withTtl(control: unknown, ttl: CacheTtl): unknown {
  if (!isRecord(control)) return control
  const current = control['ttl']
  if (ttl === 'long') {
    if (current === LONG_TTL) return control
    return { ...control, ttl: LONG_TTL }
  }
  if (!('ttl' in control)) return control
  const next: Record<string, unknown> = { ...control }
  delete next['ttl']
  return next
}

/**
 * Apply one section's lifetime to the blocks that already carry a breakpoint.
 *
 * Only existing breakpoints are retimed: this never adds a breakpoint the
 * adapter did not place, so the four-slot limit and the adapter's choice of
 * cacheable blocks both stay intact.
 * @param blocks - array of block objects to retime.
 * @param ttl - lifetime this section asks for.
 * @returns the replacement array, or the input when nothing changed.
 */
function retimeBlocks(blocks: unknown, ttl: CacheTtl): unknown {
  if (!Array.isArray(blocks)) return blocks
  let changed = false
  const next = blocks.map((block) => {
    if (!isRecord(block) || !('cache_control' in block)) return block
    const control = withTtl(block['cache_control'], ttl)
    if (control === block['cache_control']) return block
    changed = true
    return { ...block, cache_control: control }
  })
  return changed ? next : blocks
}

/**
 * Retime every breakpoint in one message's content.
 * @param messages - the request's message array.
 * @param ttl - lifetime the messages section asks for.
 * @returns the replacement array, or the input when nothing changed.
 */
function retimeMessages(messages: unknown, ttl: CacheTtl): unknown {
  if (!Array.isArray(messages)) return messages
  let changed = false
  const next = messages.map((message) => {
    if (!isRecord(message)) return message
    const content = retimeBlocks(message['content'], ttl)
    if (content === message['content']) return message
    changed = true
    return { ...message, content }
  })
  return changed ? next : messages
}

/**
 * Retime a request's breakpoints to a per-section TTL assignment.
 * @param body - the parsed Messages request body.
 * @param plan - TTL each section asks for; must satisfy {@link mixedPlanFailure}.
 * @returns the replacement body and whether anything changed.
 */
export function retimeCacheTtl(body: unknown, plan: MixedTtlPlan): { body: unknown, changed: boolean } {
  if (!isRecord(body)) return { body, changed: false }
  const tools = retimeBlocks(body['tools'], plan.tools)
  const system = retimeBlocks(body['system'], plan.system)
  const messages = retimeMessages(body['messages'], plan.messages)
  const changed = tools !== body['tools'] || system !== body['system'] || messages !== body['messages']
  if (!changed) return { body, changed: false }
  return {
    body: {
      ...body,
      ...tools === body['tools'] ? {} : { tools },
      ...system === body['system'] ? {} : { system },
      ...messages === body['messages'] ? {} : { messages },
    },
    changed: true,
  }
}

/**
 * Whether one body carries any breakpoint outside the conversation.
 *
 * A pre-warm writes cache entries only where a breakpoint already exists, and
 * the conversation is replaced, so a body whose only breakpoint sits on the last
 * message would write an entry keyed to the placeholder.
 * @param body - the parsed Messages request body.
 * @returns whether a tools or system breakpoint exists.
 */
export function hasPrefixBreakpoint(body: unknown): boolean {
  if (!isRecord(body)) return false
  for (const section of ['tools', 'system'] as const) {
    const blocks = body[section]
    if (!Array.isArray(blocks)) continue
    if (blocks.some(block => isRecord(block) && 'cache_control' in block)) return true
  }
  return false
}

/**
 * Outcome of planning a pre-warm request.
 *
 * The API accepts `max_tokens: 0` only for a request that produces no output, so
 * a body asking for something the zero budget cannot express has to be reported
 * instead of replayed: sending it earns a 400, and rewriting the field would
 * write a cache entry the real request never hits.
 */
export type PrewarmPlan = { body: unknown } | { reason: string }

/**
 * Narrow a captured request body to the fields a pre-warm replays.
 *
 * A replay resends tools and system unchanged and replaces the conversation, so
 * the conversation is the one thing worth dropping: in a long session it is
 * where the images and tool results live, and holding them per provider would
 * pin tens of megabytes for a request that never reads them again.
 * @param body - the parsed body of a real request.
 * @returns the same body without its conversation, or the input when it is not a record.
 */
export function prewarmShape(body: unknown): unknown {
  if (!isRecord(body)) return body
  const rest = { ...body }
  delete rest['messages']
  return rest
}

/**
 * Build the pre-warm request for a remembered body.
 *
 * The conversation is replaced rather than trimmed: a pre-warm is meant to
 * write the prefix the next real request reuses, and keeping the old turns
 * would key the entry to content the next request no longer sends first.
 *
 * `thinking` and `output_config.effort` are copied untouched because the API
 * renders them into the prompt, so a pre-warm that changed them would write an
 * entry the follow-up request never matches. Budget thinking therefore refuses
 * the replay instead: its `budget_tokens` derives from `max_tokens`, so a
 * zero-output cap would either spend the budget or write a differently keyed
 * entry. `stream` is the one field this function may safely lower, because it
 * describes the response rather than the cached prefix.
 * @param body - the parsed body of a previous real request.
 * @returns the pre-warm body, or why this request cannot be pre-warmed.
 */
export function buildPrewarmBody(body: unknown): PrewarmPlan {
  if (!isRecord(body)) return { reason: '最近的请求体不是 JSON 对象，无法重放' }
  if (!hasPrefixBreakpoint(body)) {
    return { reason: '请求没有工具或系统提示断点，预热不会命中后续请求' }
  }
  const thinking = body['thinking']
  if (isRecord(thinking) && thinking['type'] === 'enabled') {
    return {
      reason: '该请求使用预算思考，思考预算由 max_tokens 推导，零输出重放会写入真实请求无法命中的缓存条目',
    }
  }
  const output = body['output_config']
  if (isRecord(output) && output['format'] !== undefined) {
    return { reason: '该请求要求结构化输出，而 max_tokens: 0 不接受结构化输出' }
  }
  const next: Record<string, unknown> = {
    ...body,
    max_tokens: 0,
    stream: false,
    messages: [{ role: 'user', content: PREWARM_PLACEHOLDER }],
  }
  // `tool_choice` only affects message blocks, and the messages are replaced,
  // so dropping it keeps the cached prefix identical while avoiding the
  // `tool` and `any` variants a zero budget rejects.
  delete next['tool_choice']
  return { body: next }
}

/**
 * Resolve the provider whose configured base URL owns one request URL.
 *
 * A route's base URL may itself carry a path (a gateway serving `/v1`), so the
 * match is a separator-bounded prefix and the longest base wins: two routes on
 * the same host resolve to the more specific one. Both sides are normalized
 * first, because a base URL typed as `https://API.example.com:443` describes the
 * same endpoint a request spells `https://api.example.com`.
 * @param target - absolute request URL.
 * @param bases - provider id to its configured base URL.
 * @returns the owning provider id, or `undefined` when no base covers the URL.
 */
export function providerForUrl(
  target: string,
  bases: ReadonlyMap<string, string>,
): string | undefined {
  const normalized = normalizeUrl(target)
  if (normalized === undefined) return undefined
  let best: { provider: string, length: number } | undefined
  for (const [provider, base] of bases) {
    const candidate = normalizeUrl(base)
    if (candidate === undefined || candidate.length === 0) continue
    if (normalized !== candidate && !normalized.startsWith(`${candidate}/`)) continue
    if (best === undefined || candidate.length > best.length) {
      best = { provider, length: candidate.length }
    }
  }
  return best?.provider
}

/**
 * Spell a URL the way another spelling of the same endpoint would.
 *
 * The default port is dropped and host case folded, so a configured base URL and
 * a request URL describing one endpoint compare equal. A path keeps its trailing
 * slash removed, since the caller treats the base as a prefix.
 * @param value - absolute URL.
 * @returns the normalized string, or `undefined` when it is not an absolute URL.
 */
function normalizeUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  const path = url.pathname.replace(/\/+$/, '')
  // `url.origin` already drops the default port for the protocol.
  return `${url.origin}${path}`
}

/**
 * Whether one request is an Anthropic Messages call this plugin may rewrite.
 *
 * The `anthropic-version` header is required because other protocols reuse a
 * `/v1/messages` path, and rewriting their body would corrupt the request.
 * @param target - absolute request URL.
 * @param method - request method.
 * @param headers - request headers, already normalized or not.
 * @returns whether the request is an Anthropic Messages call.
 */
export function isMessagesRequest(target: string, method: string, headers: Headers): boolean {
  if (method.toUpperCase() !== 'POST') return false
  if (!headers.has('anthropic-version')) return false
  let path: string
  try {
    path = new URL(target).pathname
  } catch {
    // The patch wraps the global fetch, so a caller passing a relative URL must
    // get its request back untouched instead of an exception from this check.
    return false
  }
  return path.replace(/\/+$/, '').endsWith('/messages')
}
