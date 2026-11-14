import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLAUDE_KNOWN_MODELS,
  claudeThinkingProfile,
  matchClaudeThinkingProfile,
  parseClaudeModelVersion,
} from '../src/known-models.ts'
import {
  carryClaudeDraft,
  claudeAdaptiveEnabled,
  claudeCanDisableThinking,
  claudeRouteThinkingBudgets,
  finishClaudeDraft,
  newClaudeModel,
  reasoningEffortsForModel,
  withFetchedClaudeMetadata,
  withNativeClaudeModel,
  withNativeClaudeProfile,
} from '../scripts/claude-models.ts'

test('an Anthropic model id parses in every spelling a provider sends', () => {
  assert.deepEqual(parseClaudeModelVersion('claude-opus-4-5-20251101'), { family: 'opus', major: 4, minor: 5 })
  assert.deepEqual(parseClaudeModelVersion('claude-sonnet-4-5'), { family: 'sonnet', major: 4, minor: 5 })
  assert.deepEqual(parseClaudeModelVersion('4-6-opus'), { family: 'opus', major: 4, minor: 6 })
  assert.deepEqual(parseClaudeModelVersion('sonnet-3-7'), { family: 'sonnet', major: 3, minor: 7 })
  assert.deepEqual(parseClaudeModelVersion('my-proxy/claude-haiku-5-5'), { family: 'haiku', major: 5, minor: 5 })
  assert.deepEqual(parseClaudeModelVersion('claude-opus-5'), { family: 'opus', major: 5, minor: null })
  assert.equal(parseClaudeModelVersion('gpt-4o'), undefined)
  assert.equal(parseClaudeModelVersion('proxy-claude-model'), undefined)
})

test('a Claude id outside the recorded table takes the profile its generation introduced', () => {
  assert.deepEqual(matchClaudeThinkingProfile('claude-opus-4-5-20251101'), CLAUDE_KNOWN_MODELS['claude-opus-4-5']?.thinking)
  assert.deepEqual(matchClaudeThinkingProfile('claude-opus-4-9'), {
    mode: 'adaptive',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    canDisable: true,
  })
  // 4.6 is the four-level generation: 4.7 is what added `xhigh`.
  assert.deepEqual(matchClaudeThinkingProfile('claude-sonnet-4-6'), CLAUDE_KNOWN_MODELS['claude-sonnet-4-6']?.thinking)
  assert.deepEqual(matchClaudeThinkingProfile('claude-opus-4-6-20990101'), {
    mode: 'adaptive',
    efforts: ['low', 'medium', 'high', 'max'],
    canDisable: true,
  })
  assert.deepEqual(matchClaudeThinkingProfile('claude-mythos-5-preview'), {
    mode: 'adaptive',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    canDisable: false,
  })
})

test('an id naming no Claude family falls back to budget thinking with a disable switch', () => {
  assert.deepEqual(matchClaudeThinkingProfile('proxy-claude-model'), {
    mode: 'budget',
    efforts: ['low', 'medium', 'high'],
    canDisable: true,
  })
  assert.deepEqual(claudeThinkingProfile('unknown-model'), matchClaudeThinkingProfile('unknown-model'))
  assert.deepEqual(claudeThinkingProfile('claude-opus-4-7'), CLAUDE_KNOWN_MODELS['claude-opus-4-7']?.thinking)
})

test('a reasoning level map declares Off only for a model that accepts disabled thinking', () => {
  assert.deepEqual(reasoningEffortsForModel('claude-opus-4-6'), {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'max',
  })
  const always = reasoningEffortsForModel('claude-fable-5')
  assert.equal(Object.hasOwn(always, 'off'), false)
  assert.deepEqual(Object.keys(always), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(reasoningEffortsForModel('claude-haiku-4-5'), {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
  })
})

test('adaptive thinking follows the model mode unless a row or the provider overrides it', () => {
  assert.equal(claudeAdaptiveEnabled({ id: 'claude-opus-4-7' }), true)
  assert.equal(claudeAdaptiveEnabled({ id: 'claude-haiku-4-5' }), false)
  assert.equal(claudeAdaptiveEnabled({ id: 'claude-haiku-4-5' }, true), false)
  assert.equal(claudeAdaptiveEnabled({ id: 'claude-opus-4-7', compat: { forceAdaptiveThinking: false } }, true), false)
  assert.equal(claudeCanDisableThinking('claude-fable-5'), false)
  assert.equal(claudeCanDisableThinking('claude-opus-4-6'), true)
})

test('adopting a known Claude row fills vision, capacities and thinking defaults once', () => {
  const adaptive = withFetchedClaudeMetadata({ id: 'claude-opus-5' })
  assert.equal(adaptive.contextWindow, 1000000)
  assert.equal(adaptive.maxTokens, 128000)
  assert.deepEqual(adaptive.input, ['text', 'image'])
  assert.deepEqual(adaptive.reasoningEfforts, reasoningEffortsForModel('claude-opus-5'))
  assert.equal(adaptive.compat?.['forceAdaptiveThinking'], true)

  const budget = withFetchedClaudeMetadata({ id: 'claude-haiku-4-5' })
  assert.equal(budget.contextWindow, 200000)
  assert.equal(budget.compat?.['forceAdaptiveThinking'], false)
  assert.equal(withFetchedClaudeMetadata({ id: 'proxy-claude-model' }).input, undefined)
})

test('a row keeps the capacities a discovery reply disclosed', () => {
  const model = withFetchedClaudeMetadata({ id: 'claude-opus-5', contextWindow: 32000, maxTokens: 4096 })
  assert.equal(model.contextWindow, 32000)
  assert.equal(model.maxTokens, 4096)
})

test('a newly named row takes its defaults only after the id is typed', () => {
  const pending = newClaudeModel()
  assert.deepEqual(pending, { id: '' })
  assert.equal(finishClaudeDraft(pending), pending)
  const typed = carryClaudeDraft(pending, { ...pending, id: 'claude-opus-5' })
  const named = finishClaudeDraft(typed)
  assert.equal(named.contextWindow, 1000000)
  assert.deepEqual(named.input, ['text', 'image'])
  assert.deepEqual(finishClaudeDraft({ id: 'typed-by-hand' }), { id: 'typed-by-hand' })
})

test('a route declares thinking budgets only when one of its models spends them', () => {
  assert.equal(claudeRouteThinkingBudgets([{ id: 'claude-opus-4-7' }, { id: 'claude-sonnet-5' }]), undefined)
  const budgets = claudeRouteThinkingBudgets([{ id: 'claude-opus-4-7' }, { id: 'claude-haiku-4-5' }])
  assert.deepEqual(budgets, { minimal: 1024, low: 1024, medium: 4096, high: 32000 })
})

test('a saved Claude profile moves the provider flag onto each model and declares budgets', () => {
  const profile = {
    api: 'anthropic-messages',
    reasoning: 'high',
    compat: { forceAdaptiveThinking: true, retained: true },
    models: [
      { id: 'claude-haiku-4-5', reasoningEfforts: { high: 'custom' } },
      { id: 'claude-opus-4-7', reasoningEfforts: { high: 'high' }, compat: { forceAdaptiveThinking: false } },
    ],
  }
  const saved = withNativeClaudeProfile(profile)
  assert.deepEqual(saved.models?.[0]?.compat, { forceAdaptiveThinking: false })
  assert.deepEqual(saved.models?.[1]?.compat, { forceAdaptiveThinking: false })
  assert.deepEqual(saved.compat, { retained: true })
  assert.equal(saved.reasoning, 'high')
  assert.deepEqual(saved.thinkingBudgets, { minimal: 1024, low: 1024, medium: 4096, high: 32000 })
  assert.equal(profile.models[0]?.compat, undefined)
})

test('an all-adaptive profile declares no budgets', () => {
  const saved = withNativeClaudeProfile({ models: [{ id: 'claude-opus-4-7' }] })
  assert.equal(Object.hasOwn(saved, 'thinkingBudgets'), false)
})

test('a profile default level the edited models no longer offer is dropped', () => {
  const saved = withNativeClaudeProfile({
    reasoning: 'max',
    models: [{ id: 'proxy-a', reasoningEfforts: { high: 'high' } }],
  })
  assert.equal(Object.hasOwn(saved, 'reasoning'), false)
})

test('the recorded table names Claude model ids and every profile is consistent', () => {
  for (const [id, model] of Object.entries(CLAUDE_KNOWN_MODELS)) {
    assert.match(id, /^claude-/)
    assert.ok(model.thinking.efforts.length > 0)
    if (model.thinking.mode === 'budget') {
      assert.deepEqual(model.thinking.efforts, ['low', 'medium', 'high'])
    }
  }
  assert.equal(withNativeClaudeModel({ id: 'claude-haiku-4-5' }).compat?.['forceAdaptiveThinking'], false)
  assert.equal(withNativeClaudeModel({ id: 'proxy' }, true).compat?.['forceAdaptiveThinking'], false)
  assert.equal(withNativeClaudeModel({ id: 'claude-opus-4-7' }, false).compat?.['forceAdaptiveThinking'], false)
})
