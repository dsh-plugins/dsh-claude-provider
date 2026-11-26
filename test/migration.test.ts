import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDocument } from 'yaml'
import { readLegacySettingsMarkers, readPatchMarkers } from '../src/legacy-yaml.ts'
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

test('仅清理 Claude 补丁的旧标记，保留其他配置与表达式', () => {
  const source = [
    '# profile',
    '- id: llm-pi-ai',
    '  config:',
    '    providers: { claude: { api: anthropic-messages } }',
    '- id: dsh-claude-provider',
    '  disabled: false',
    '  config: { providerTypes: { claude: claude-adaptive }, custom: keep }',
    '- id: another-plugin',
    '  config: !!js process.env.EXAMPLE',
    '',
  ].join('\r\n')
  const { providerTypes, providers, cleaned } = readPatchMarkers(source)
  assert.deepEqual(providerTypes, { claude: 'claude-adaptive' })
  assert.deepEqual(providers, { claude: { api: 'anthropic-messages' } })
  assert.ok(cleaned)
  assert.match(cleaned, /^# profile\r\n/)
  assert.match(cleaned, /!!js process\.env\.EXAMPLE/)
  const rows = parseDocument(cleaned).toJS()
  assert.deepEqual(rows[1].config, { custom: 'keep' })
  assert.equal(rows[1].disabled, false)
  assert.equal(readPatchMarkers(cleaned).cleaned, undefined)
})

test('首次导入允许匹配同一份设置中的路由，归档恢复仅匹配当前 profile', () => {
  const source = `
llm-pi-ai:
  providers:
    new: { api: anthropic-messages }
    switched: { api: anthropic-messages }
dsh-claude-provider:
  providerTypes:
    new: claude-adaptive
    switched: claude-adaptive
    removed: claude-adaptive
`
  const current = { switched: { api: 'openai-responses' } }
  assert.deepEqual(readLegacySettingsMarkers(source, current), {})
  assert.deepEqual(readLegacySettingsMarkers(source, current, true), { new: 'claude-adaptive' })
})
