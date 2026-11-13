import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import {
  anthropicModelsUrl,
  CLAUDE_KNOWN_MODELS,
  discoverAnthropicModels,
  readAnthropicModelPage,
  withKnownModelMetadata,
} from '../src/index.ts'

/** A response the discovery loop can read as a stream. */
function jsonResponse(body: unknown): Response {
  const text = JSON.stringify(body)
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(text.length) }),
    body: new Blob([text]).stream(),
  } as unknown as Response
}

test('builds the Anthropic models endpoint from the Messages base URL', () => {
  assert.equal(anthropicModelsUrl('https://api.anthropic.com').href, 'https://api.anthropic.com/v1/models')
  assert.equal(anthropicModelsUrl('https://proxy.example.com/v1').href, 'https://proxy.example.com/v1/models')
  assert.equal(anthropicModelsUrl('https://proxy.example.com/v1/?x=1#y').href, 'https://proxy.example.com/v1/models')
  assert.throws(() => anthropicModelsUrl('ftp://api.anthropic.com'), /http 或 https/)
  assert.throws(() => anthropicModelsUrl('not a url'), /有效 URL/)
})

test('parses Anthropic model pages and skips malformed rows', () => {
  const page = readAnthropicModelPage({
    data: [
      { id: 'claude-opus-5', display_name: 'Claude Opus 5', context_window: 1000000, max_output_tokens: 128000 },
      { id: '' },
      null,
      { name: 'no id' },
      { id: 'claude-sonnet-5' },
    ],
    has_more: true,
    last_id: 'claude-sonnet-5',
  })
  assert.deepEqual(page.models, [
    { id: 'claude-opus-5', name: 'Claude Opus 5', contextWindow: 1000000, maxTokens: 128000 },
    { id: 'claude-sonnet-5' },
  ])
  assert.equal(page.hasMore, true)
  assert.equal(page.lastId, 'claude-sonnet-5')
  assert.throws(() => readAnthropicModelPage({}), /data 数组/)
})

test('fills recorded capacities for known Claude model ids only', () => {
  const known = withKnownModelMetadata({ id: 'claude-opus-5' })
  assert.equal(known.contextWindow, 1000000)
  assert.equal(known.maxTokens, 128000)
  assert.deepEqual(withKnownModelMetadata({ id: 'unknown-model', maxTokens: 5 }), { id: 'unknown-model', maxTokens: 5 })
})

test('discovery follows cursor pagination, dedupes, and applies recorded metadata', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = input as URL
    calls.push(url.href)
    if (url.searchParams.get('after_id') === null) {
      return jsonResponse({ data: [{ id: 'claude-opus-5' }, { id: 'other-model' }], has_more: true, last_id: 'other-model' })
    }
    return jsonResponse({ data: [{ id: 'other-model' }, { id: 'claude-haiku-4-5' }], has_more: false })
  }) as typeof fetch
  const models = await discoverAnthropicModels({ baseURL: 'https://api.anthropic.com', apiKey: 'sk-test', fetchImpl })
  assert.deepEqual(models.map(model => model.id), ['claude-opus-5', 'other-model', 'claude-haiku-4-5'])
  assert.equal(models[0]?.contextWindow, 1000000)
  assert.equal(models[1]?.contextWindow, undefined)
  assert.deepEqual(calls, [
    'https://api.anthropic.com/v1/models',
    'https://api.anthropic.com/v1/models?after_id=other-model',
  ])
})

test('discovery honors the caller signal', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    discoverAnthropicModels({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      signal: controller.signal,
      fetchImpl: async () => { throw new Error('unreachable') },
    }),
    /已取消/,
  )
})

test('discovery refuses a page whose cursor never advances', async () => {
  const fetchImpl = (async () => jsonResponse({
    data: [{ id: 'stuck-model' }],
    has_more: true,
    last_id: 'stuck-model',
  })) as unknown as typeof fetch
  await assert.rejects(
    discoverAnthropicModels({ baseURL: 'https://api.anthropic.com', apiKey: 'sk-test', fetchImpl }),
    /缺少有效的 last_id/,
  )
})

test('discovery surfaces the endpoint status and its own message', async () => {
  const text = JSON.stringify({ error: { message: 'invalid x-api-key' } })
  const fetchImpl = (async () => ({
    ok: false,
    status: 401,
    headers: new Headers({ 'content-length': String(text.length) }),
    body: new Blob([text]).stream(),
  })) as unknown as typeof fetch
  await assert.rejects(
    discoverAnthropicModels({ baseURL: 'https://api.anthropic.com', apiKey: 'bad', fetchImpl }),
    /返回 401，请检查 API 密钥：invalid x-api-key/,
  )
})

/**
 * Evaluate the injected Claude helper fragment with the bindings the upstream
 * bundle provides, so its pure model rules are testable without a browser.
 * @returns the helper functions the fragment exports to the splice site.
 */
async function claudeHelpers(): Promise<Record<string, (...args: never[]) => unknown>> {
  const typescript = readFileSync(new URL('../scripts/client-claude.ts', import.meta.url), 'utf8')
  const table = `const CLAUDE_KNOWN_MODELS = ${JSON.stringify(CLAUDE_KNOWN_MODELS)}`
  const source = stripTypeScriptTypes(typescript, { mode: 'strip' })
  const names = ['reasoningEffortsForPreset', 'withDefaultClaudeReasoning', 'withKnownClaudeInput',
    'withFetchedClaudeMetadata', 'withNativeClaudeModel', 'withNativeClaudeProfile', 'claudeAdaptiveEnabled']
  const factory = new Function(`${table}\n${source}\nreturn { ${names.join(', ')} }`)
  return factory() as Record<string, (...args: never[]) => unknown>
}

test('recorded Claude presets select the reasoning levels that model offers', async () => {
  const { reasoningEffortsForPreset } = await claudeHelpers()
  const preset = reasoningEffortsForPreset as (name: string) => Record<string, unknown>
  assert.deepEqual(preset('toggle'), { off: null, high: 'high' })
  assert.deepEqual(preset('four'), { low: 'low', medium: 'medium', high: 'high', max: 'max' })
  assert.deepEqual(preset('five'), { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  assert.deepEqual(preset('unknown-preset'), preset('five'))
})

test('adopting a known Claude row fills vision, capacities and adaptive thinking once', async () => {
  const { withFetchedClaudeMetadata, withNativeClaudeModel } = await claudeHelpers()
  const fetchMetadata = withFetchedClaudeMetadata as (model: Record<string, unknown>) => Record<string, unknown>
  const native = withNativeClaudeModel as (model: Record<string, unknown>, inherited?: unknown) => Record<string, unknown>

  const adaptive = fetchMetadata({ id: 'claude-opus-5' })
  assert.equal(adaptive['contextWindow'], 1000000)
  assert.equal(adaptive['maxTokens'], 128000)
  assert.deepEqual(adaptive['input'], ['text', 'image'])
  assert.deepEqual(adaptive['reasoningEfforts'], { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  assert.equal((adaptive['compat'] as Record<string, unknown>)['forceAdaptiveThinking'], true)

  const toggle = fetchMetadata({ id: 'claude-haiku-4-5' })
  assert.equal(toggle['contextWindow'], 200000)
  assert.deepEqual(toggle['reasoningEfforts'], { off: null, high: 'high' })
  assert.equal((toggle['compat'] as Record<string, unknown>)['forceAdaptiveThinking'], false)

  assert.deepEqual(fetchMetadata({ id: 'proxy-claude-model' })['input'], undefined)
  assert.deepEqual(
    (fetchMetadata({ id: 'proxy-claude-model' })['compat'] as Record<string, unknown>)['forceAdaptiveThinking'],
    true,
  )
  assert.deepEqual(native({ id: 'proxy-claude-model' })['compat'], { forceAdaptiveThinking: false })
})

test('a saved Claude profile migrates its adaptive default without overwriting per-model choices', async () => {
  const { withNativeClaudeProfile } = await claudeHelpers()
  const migrate = withNativeClaudeProfile as (profile: Record<string, unknown>) => Record<string, unknown>
  const profile = {
    api: 'anthropic-messages',
    reasoning: 'high',
    compat: { forceAdaptiveThinking: true, retained: true },
    models: [
      { id: 'proxy-a', reasoningEfforts: { high: 'custom' } },
      { id: 'proxy-b', reasoningEfforts: { high: 'high' }, compat: { forceAdaptiveThinking: false } },
    ],
  }
  const saved = migrate(profile)
  const models = saved['models'] as Record<string, unknown>[]
  assert.deepEqual((models[0]?.['compat'] as Record<string, unknown>), { forceAdaptiveThinking: true })
  assert.deepEqual((models[1]?.['compat'] as Record<string, unknown>), { forceAdaptiveThinking: false })
  assert.deepEqual(saved['compat'], { retained: true })
  assert.equal(saved['reasoning'], 'high')
  assert.equal((profile.models[0] as Record<string, unknown>)['compat'], undefined)
})

test('a profile default level the edited models no longer offer is dropped', async () => {
  const { withNativeClaudeProfile } = await claudeHelpers()
  const migrate = withNativeClaudeProfile as (profile: Record<string, unknown>) => Record<string, unknown>
  const saved = migrate({
    reasoning: 'max',
    models: [{ id: 'proxy-a', reasoningEfforts: { high: 'high' } }],
  })
  assert.equal(Object.hasOwn(saved, 'reasoning'), false)
})
