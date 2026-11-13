import assert from 'node:assert/strict'
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
  assert.deepEqual(
    withKnownModelMetadata({ id: 'unknown-model', maxTokens: 5 }),
    { id: 'unknown-model', maxTokens: 5 },
  )
})

test('discovery follows cursor pagination, dedupes, and applies recorded metadata', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = input as URL
    calls.push(url.href)
    if (url.searchParams.get('after_id') === null) {
      return jsonResponse({
        data: [{ id: 'claude-opus-5' }, { id: 'other-model' }],
        has_more: true,
        last_id: 'other-model',
      })
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
