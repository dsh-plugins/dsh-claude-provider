import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMessagesRequest,
  mixedPlanFailure,
  providerForUrl,
  retimeCacheTtl,
} from '../src/cache.ts'
import { cachePlanOf, cacheTtlOf, createCacheTemplate, describePlan } from '../src/cache-config.ts'

/** A breakpoint the adapter would stamp on a cacheable block. */
const SHORT = { type: 'ephemeral' }

/** The same breakpoint after this plugin asked for a one-hour lifetime. */
const LONG = { type: 'ephemeral', ttl: '1h' }

/** One request body shaped the way the adapter sends it. */
function body(): Record<string, unknown> {
  return {
    model: 'claude-opus-5',
    max_tokens: 4096,
    tools: [{ name: 'read' }, { name: 'write', cache_control: SHORT }],
    system: [{ type: 'text', text: 'system', cache_control: SHORT }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: SHORT }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ],
  }
}

test('一小时条目排在五分钟条目之前才可用', () => {
  assert.equal(mixedPlanFailure({ tools: 'long', system: 'long', messages: 'short' }), undefined)
  assert.equal(mixedPlanFailure({ tools: 'long', system: 'short', messages: 'short' }), undefined)
  assert.equal(mixedPlanFailure({ tools: 'short', system: 'short', messages: 'short' }), undefined)
  assert.equal(mixedPlanFailure({ tools: 'long', system: 'long', messages: 'long' }), undefined)
  assert.match(String(mixedPlanFailure({ tools: 'short', system: 'long', messages: 'short' })), /system.*排在 tools/)
  assert.match(String(mixedPlanFailure({ tools: 'short', system: 'short', messages: 'long' })), /messages.*排在 tools/)
  assert.match(String(mixedPlanFailure({ tools: 'long', system: 'short', messages: 'long' })), /messages.*排在 system/)
  assert.match(String(mixedPlanFailure({ tools: 'long', system: 'long', messages: 'medium' as never })), /messages 的取值无效/)
})

test('改写按段设置 TTL 并保留其余字段', () => {
  const source = body()
  const { body: next, changed } = retimeCacheTtl(source, { tools: 'long', system: 'long', messages: 'short' })
  assert.equal(changed, true)
  const written = next as Record<string, unknown>
  assert.equal(written['model'], 'claude-opus-5')
  assert.equal(written['max_tokens'], 4096)
  assert.deepEqual((written['tools'] as { cache_control?: unknown }[])[1]?.cache_control, LONG)
  assert.deepEqual((written['system'] as { cache_control?: unknown }[])[0]?.cache_control, LONG)
  const messages = written['messages'] as { content: { cache_control?: unknown, text: string }[] }[]
  assert.deepEqual(messages[0]?.content[0]?.cache_control, SHORT)
  assert.equal(messages[0]?.content[0]?.text, 'hi')
  assert.equal(messages[1]?.content[0]?.cache_control, undefined)
  assert.deepEqual(source, body())
})

test('关闭长 TTL 时移除已有的 ttl 键', () => {
  const source = body()
  source['system'] = [{ type: 'text', text: 'system', cache_control: LONG }]
  const { body: next } = retimeCacheTtl(source, { tools: 'short', system: 'short', messages: 'short' })
  const system = (next as Record<string, unknown>)['system'] as { cache_control?: Record<string, unknown> }[]
  assert.deepEqual(system[0]?.cache_control, SHORT)
  assert.equal(Object.hasOwn(system[0]?.cache_control ?? {}, 'ttl'), false)
})

test('改写不新增断点，也不改动已无断点的块', () => {
  const source = { model: 'claude-opus-5', tools: [{ name: 'read' }], system: [{ type: 'text', text: 'sys' }], messages: [] }
  const { body: next, changed } = retimeCacheTtl(source, { tools: 'long', system: 'long', messages: 'long' })
  assert.equal(changed, false)
  assert.equal(next, source)
  assert.equal(Object.hasOwn((source.tools[0] as Record<string, unknown>), 'cache_control'), false)
})

test('非对象请求体与缺失的段直接原样返回', () => {
  assert.deepEqual(retimeCacheTtl(null, { tools: 'long', system: 'long', messages: 'long' }), { body: null, changed: false })
  const onlyMessage = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: SHORT }] }] }
  const { body: next, changed } = retimeCacheTtl(onlyMessage, { tools: 'long', system: 'long', messages: 'long' })
  assert.equal(changed, true)
  const content = ((next as Record<string, unknown>)['messages'] as { content: { cache_control?: unknown }[] }[])[0]?.content
  assert.deepEqual(content?.[0]?.cache_control, LONG)
})

test('路由按分隔符边界与最长前缀匹配请求 URL', () => {
  const bases = new Map([
    ['gateway', 'https://api.example.com'],
    ['versioned', 'https://api.example.com/v1/'],
    ['other', 'https://other.example.com'],
  ])
  assert.equal(providerForUrl('https://api.example.com/v1/messages', bases), 'versioned')
  assert.equal(providerForUrl('https://api.example.com/messages', bases), 'gateway')
  assert.equal(providerForUrl('https://api.example.com.evil.test/v1/messages', bases), undefined)
  assert.equal(providerForUrl('https://api.example.com/x/v1/messages', bases), 'gateway')
  assert.equal(providerForUrl('https://other.example.com/v1/messages', bases), 'other')
  assert.equal(providerForUrl('https://api.example.com/v1/messages', new Map()), undefined)
})

test('配置的大小写与默认端口不影响路由匹配', () => {
  const typed = new Map([['typed', 'HTTPS://API.Example.com:443/']])
  assert.equal(providerForUrl('https://api.example.com/v1/messages', typed), 'typed')
  assert.equal(providerForUrl('https://API.example.com/v1/messages', typed), 'typed')
  assert.equal(providerForUrl('http://api.example.com/v1/messages', typed), undefined)
  assert.equal(providerForUrl('not a url', typed), undefined)

  const ported = new Map([['gateway', 'https://api.example.com:8443']])
  assert.equal(providerForUrl('https://api.example.com:8443/v1/messages', ported), 'gateway')
  assert.equal(providerForUrl('https://api.example.com/v1/messages', ported), undefined)
})

test('已符合目标时长的断点不被重写', () => {
  const body = (control: Record<string, unknown>) => ({
    system: [{ type: 'text', text: 'rule', cache_control: control }],
  })
  const long = retimeCacheTtl(body({ type: 'ephemeral', ttl: '1h' }), { tools: 'short', system: 'long', messages: 'short' })
  assert.equal(long.changed, false)

  const short = retimeCacheTtl(body({ type: 'ephemeral' }), { tools: 'short', system: 'short', messages: 'short' })
  assert.equal(short.changed, false)

  const retimed = retimeCacheTtl(body({ type: 'ephemeral', ttl: '1h' }), { tools: 'short', system: 'short', messages: 'short' })
  assert.equal(retimed.changed, true)
  const control = (retimed.body as { system: { cache_control: Record<string, unknown> }[] }).system[0].cache_control
  assert.equal('ttl' in control, false)
})

test('只有带 anthropic-version 头的 POST messages 请求会被改写', () => {
  const versioned = new Headers({ 'anthropic-version': '2023-06-01' })
  const openai = new Headers({ authorization: 'Bearer sk-test' })
  assert.equal(isMessagesRequest('https://api.example.com/v1/messages', 'POST', versioned), true)
  assert.equal(isMessagesRequest('https://api.example.com/v1/messages/', 'post', versioned), true)
  assert.equal(isMessagesRequest('https://api.example.com/v1/messages', 'POST', openai), false)
  assert.equal(isMessagesRequest('https://api.example.com/v1/messages', 'GET', versioned), false)
  assert.equal(isMessagesRequest('https://api.example.com/v1/chat/completions', 'POST', versioned), false)
  assert.equal(isMessagesRequest('/v1/messages', 'POST', versioned), false, '相对 URL 不能抛异常，只能跳过改写')
})

test('配置默认值与当前生效方案可读', () => {
  assert.equal(cacheTtlOf('long'), 'long')
  assert.equal(cacheTtlOf(undefined), 'short')
  assert.equal(cacheTtlOf('bogus'), 'short')

  const defaults = { mixedEnabled: true, toolsTtl: 'long', systemTtl: 'long', messagesTtl: 'short' }
  assert.deepEqual(cachePlanOf(defaults), { tools: 'long', system: 'long', messages: 'short' })
  assert.match(describePlan(defaults), /当前组合生效/)
  assert.match(describePlan(defaults), /工具定义一小时/)

  const invalid = { ...defaults, toolsTtl: 'short', systemTtl: 'long' }
  assert.match(describePlan(invalid), /不会生效/)

  const off = { ...defaults, mixedEnabled: false }
  assert.match(describePlan(off), /已关闭/)
})

test('模板通过 loader 的真实校验', async (t) => {
  // dsh-loader is an optional peer: a checkout without it (CI, or a user who
  // never installed the loader) still runs every other test. When it is present,
  // the template is checked against the real contract instead of the shape this
  // package declares locally.
  let validateTemplate: ((template: unknown) => void) | undefined
  try {
    ({ validateTemplate } = await import('../../dsh-loader/dist/config.js'))
  } catch {
    validateTemplate = undefined
  }
  if (validateTemplate === undefined) {
    t.skip('同级目录没有构建好的 dsh-loader')
    return
  }
  validateTemplate(createCacheTemplate())
})
