import assert from 'node:assert/strict'
import test from 'node:test'
import { CLAUDE_KNOWN_MODELS } from '../src/known-models.ts'
import {
  carryClaudeDraft,
  claudeAdaptiveEnabled,
  finishClaudeDraft,
  newClaudeModel,
  reasoningEffortsForPreset,
  withFetchedClaudeMetadata,
  withNativeClaudeModel,
  withNativeClaudeProfile,
} from '../scripts/claude-models.ts'

test('recorded Claude presets select the reasoning levels that model offers', () => {
  assert.deepEqual(reasoningEffortsForPreset('toggle'), { off: null, high: 'high' })
  assert.deepEqual(reasoningEffortsForPreset('four'), { low: 'low', medium: 'medium', high: 'high', max: 'max' })
  assert.deepEqual(reasoningEffortsForPreset('five'), {
    low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
  })
  assert.deepEqual(reasoningEffortsForPreset('unknown-preset'), reasoningEffortsForPreset('five'))
})

test('adopting a known Claude row fills vision, capacities and adaptive thinking once', () => {
  const adaptive = withFetchedClaudeMetadata({ id: 'claude-opus-5' })
  assert.equal(adaptive.contextWindow, 1000000)
  assert.equal(adaptive.maxTokens, 128000)
  assert.deepEqual(adaptive.input, ['text', 'image'])
  assert.deepEqual(adaptive.reasoningEfforts, reasoningEffortsForPreset('five'))
  assert.equal(adaptive.compat?.['forceAdaptiveThinking'], true)

  const toggle = withFetchedClaudeMetadata({ id: 'claude-haiku-4-5' })
  assert.equal(toggle.contextWindow, 200000)
  assert.deepEqual(toggle.reasoningEfforts, reasoningEffortsForPreset('toggle'))
  assert.equal(toggle.compat?.['forceAdaptiveThinking'], false)

  assert.equal(withFetchedClaudeMetadata({ id: 'proxy-claude-model' }).input, undefined)
})

test('a row keeps the capacities a discovery reply disclosed', () => {
  const model = withFetchedClaudeMetadata({ id: 'claude-opus-5', contextWindow: 32000, maxTokens: 4096 })
  assert.equal(model.contextWindow, 32000)
  assert.equal(model.maxTokens, 4096)
})

test('an explicit per-model choice outranks the provider-wide adaptive default', () => {
  assert.equal(claudeAdaptiveEnabled({ id: 'proxy', compat: { forceAdaptiveThinking: false } }, true), false)
  assert.equal(claudeAdaptiveEnabled({ id: 'proxy' }, true), true)
  assert.equal(claudeAdaptiveEnabled({ id: 'proxy' }, undefined), false)
  assert.equal(claudeAdaptiveEnabled({ id: 'claude-haiku-4-5' }, true), false)
  assert.equal(withNativeClaudeModel({ id: 'claude-haiku-4-5' }).compat?.['forceAdaptiveThinking'], false)
  assert.equal(withNativeClaudeModel({ id: 'proxy' }, true).compat?.['forceAdaptiveThinking'], true)
})

test('a newly named row takes its defaults only after the id is typed', () => {
  const pending = newClaudeModel()
  assert.deepEqual(pending, { id: '' })
  assert.equal(finishClaudeDraft(pending), pending)
  // The editor replaces the row on every keystroke, so the pending mark must
  // travel with the replacement or the defaults would never apply.
  const typed = carryClaudeDraft(pending, { ...pending, id: 'claude-opus-5' })
  const named = finishClaudeDraft(typed)
  assert.equal(named.contextWindow, 1000000)
  assert.deepEqual(named.input, ['text', 'image'])
  assert.deepEqual(finishClaudeDraft({ id: 'typed-by-hand' }), { id: 'typed-by-hand' })
})

test('a saved Claude profile moves the provider flag onto each model', () => {
  const profile = {
    api: 'anthropic-messages',
    reasoning: 'high',
    compat: { forceAdaptiveThinking: true, retained: true },
    models: [
      { id: 'proxy-a', reasoningEfforts: { high: 'custom' } },
      { id: 'proxy-b', reasoningEfforts: { high: 'high' }, compat: { forceAdaptiveThinking: false } },
    ],
  }
  const saved = withNativeClaudeProfile(profile)
  assert.deepEqual(saved.models?.[0]?.compat, { forceAdaptiveThinking: true })
  assert.deepEqual(saved.models?.[1]?.compat, { forceAdaptiveThinking: false })
  assert.deepEqual(saved.compat, { retained: true })
  assert.equal(saved.reasoning, 'high')
  assert.equal(profile.models[0]?.compat, undefined)
})

test('a profile default level the edited models no longer offer is dropped', () => {
  const saved = withNativeClaudeProfile({
    reasoning: 'max',
    models: [{ id: 'proxy-a', reasoningEfforts: { high: 'high' } }],
  })
  assert.equal(Object.hasOwn(saved, 'reasoning'), false)
})

test('the recorded table names Claude model ids only', () => {
  for (const id of Object.keys(CLAUDE_KNOWN_MODELS)) assert.match(id, /^claude-/)
})
