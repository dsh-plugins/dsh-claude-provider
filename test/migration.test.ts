import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../src/index.ts'
import { recoverProviderTypes } from '../src/migrate-legacy-types.ts'

test('legacy marker recovery keeps existing markers and skips removed or non-Anthropic providers', () => {
  const providers = {
    keep: { api: 'anthropic-messages' },
    recover: { api: 'anthropic-messages' },
    generic: { api: 'openai-responses' },
  }
  const before = structuredClone(providers)
  const legacy = Object.fromEntries(['keep', 'recover', 'generic', 'deleted'].map(id => [id, 'claude-adaptive']))
  const result = recoverProviderTypes(legacy, { keep: 'existing' }, providers)
  assert.deepEqual(result, { keep: 'existing', recover: 'claude-adaptive' })
  assert.deepEqual(recoverProviderTypes(legacy, result, providers), result)
  assert.deepEqual(providers, before)
})

test('the profile config defaults provider types to an empty map', () => {
  assert.deepEqual(Config({}).providerTypes.get(), {})
  assert.deepEqual(Config({ providerTypes: { claude: 'claude-adaptive' } }).providerTypes.get(), { claude: 'claude-adaptive' })
})
