import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit } from 'yaml'
import type { Document, Node, YAMLMap, YAMLSeq } from 'yaml'
import { CLAUDE_PROVIDER_SETTINGS_NS, CLAUDE_PROVIDER_TYPE, readConfigPatch } from './config.ts'
import type { ProviderTypes } from './config.ts'

const JS_TAG = 'tag:yaml.org,2002:js'
const PI_AI_SETTINGS_NS = 'llm-pi-ai'

function parseYaml(text: string, filename: string): Document.Parsed {
  const document = parseDocument(text.replace(/^\uFEFF/, ''), {
    customTags: [{ tag: JS_TAG, resolve: (value: string) => value }],
  })
  if (document.errors.length > 0) {
    throw new Error(`Claude 配置迁移无法解析 ${filename}`, { cause: document.errors[0] })
  }
  return document
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function markerEntries(value: unknown): [string, typeof CLAUDE_PROVIDER_TYPE][] {
  return Object.entries(record(value) ?? {}).filter(
    (entry): entry is [string, typeof CLAUDE_PROVIDER_TYPE] => entry[1] === CLAUDE_PROVIDER_TYPE,
  )
}

function isEmpty(node: unknown): boolean {
  return node == null || (isScalar(node) && node.value === null)
}

function resolveAlias(document: Document.Parsed, node: unknown): unknown {
  if (isAlias(node)) {
    return node.resolve(document)
  }
  return node
}

function isClaudeEntry(row: YAMLMap): boolean {
  const name = row.get('name')
  return row.get('id') === CLAUDE_PROVIDER_SETTINGS_NS && (
    name == null || name === '@dsh-plugin/dsh-claude-provider' || name === '@mofeng2223/dsh-claude-provider'
  )
}

function sharedNodes(document: Document.Parsed): Set<Node> {
  const shared = new Set<Node>()
  visit(document, {
    Alias(_key, alias) {
      const source = alias.resolve(document)
      if (source && !shared.has(source)) {
        visit(source, { Node(_key, node) { shared.add(node) } })
      }
    },
  })
  return shared
}

function containsNode(root: unknown, predicate: (node: Node) => boolean): boolean {
  let found = false
  if (isNode(root)) {
    visit(root, {
      Node(_key, node) {
        if (predicate(node)) {
          found = true
          return visit.BREAK
        }
      },
    })
  }
  return found
}

/** 读取 Profile 补丁中生效的类型标记和提供方，并生成移除旧标记后的补丁。 */
export function readPatchMarkers(text: string): { providerTypes: ProviderTypes, providers?: unknown, cleaned?: string } {
  const document = parseYaml(text, 'cordis.patch.yml')
  if (isEmpty(document.contents)) {
    return { providerTypes: {} }
  }
  if (!isSeq(document.contents)) {
    throw new Error('Claude 配置迁移要求 cordis.patch.yml 为补丁列表')
  }

  let providerTypes: ProviderTypes = {}
  let providerDirectory: unknown
  let changed = false
  let shared: Set<Node> | undefined
  const sharedNode = (node: Node): boolean => (shared ??= sharedNodes(document)).has(node)
  const cleanRows = (rows: YAMLSeq, inserted: boolean): void => {
    const emptyRows: number[] = []
    for (const [index, row] of rows.items.entries()) {
      if (!isMap(row)) {
        continue
      }
      const insert = row.get('insert')
      const rawConfig: unknown = row.get('config', true)
      if (!inserted && isSeq(insert)) {
        cleanRows(insert, true)
        continue
      }
      if (inserted && row.get('group') && isSeq(rawConfig)) {
        cleanRows(rawConfig, true)
      }
      if (row.get('id') === PI_AI_SETTINGS_NS && row.has('config')) {
        const config = resolveAlias(document, rawConfig)
        providerDirectory = isMap(config) ? config.get('providers', true) : undefined
      }
      if (!isClaudeEntry(row) || !row.has('config')) {
        continue
      }
      providerTypes = {}
      const config = resolveAlias(document, rawConfig)
      if (!isMap(config)) {
        continue
      }
      const marker = config.items.find(pair => isScalar(pair.key) && pair.key.value === 'providerTypes')
      if (!marker) {
        continue
      }
      const markers = resolveAlias(document, marker.value)
      if (!isEmpty(markers) && !isMap(markers)) {
        throw new Error('Claude 配置迁移要求旧 providerTypes 为映射')
      }
      const stored: unknown = isMap(markers) ? markers.toJS(document) : {}
      providerTypes = readConfigPatch({ providerTypes: stored }).providerTypes ?? {}
      if (sharedNode(row) || (config === rawConfig && (
        sharedNode(config) || containsNode(marker.key, sharedNode) || containsNode(marker.value, sharedNode)
      ))) {
        throw new Error('Claude 配置迁移无法移除其他 YAML 节点共享的旧配置')
      }
      const next = config === rawConfig ? config : config.clone()
      next.delete('providerTypes')
      if (next.items.length === 0) {
        row.delete('config')
      } else if (next !== config) {
        delete next.anchor
        if (containsNode(next, node => isAlias(node) || ('anchor' in node && Boolean(node.anchor)))) {
          throw new Error('Claude 配置迁移无法拆分包含嵌套锚点或引用的共享配置')
        }
        row.set('config', next)
      }
      if (!inserted && row.items.length === 1 && row.has('id')
        && !row.anchor && !containsNode(row, node => Boolean(node.comment || node.commentBefore) || sharedNode(node))) {
        emptyRows.push(index)
      }
      changed = true
    }
    for (const index of emptyRows.reverse()) {
      rows.delete(index)
    }
  }
  cleanRows(document.contents, false)
  const directory = resolveAlias(document, providerDirectory)
  const providers: unknown = isMap(directory) ? directory.toJS(document) : undefined
  const result = providers === undefined ? { providerTypes } : { providerTypes, providers }
  if (!changed) {
    return result
  }
  const cleaned = document.toString({ lineWidth: 0 })
  const newline = text.match(/\r?\n/)?.[0]
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  return { ...result, cleaned: bom + (newline === '\r\n' ? cleaned.replaceAll('\n', '\r\n') : cleaned) }
}

/** 从 DSH 历史设置中恢复属于当前 Profile 的 Claude 类型标记。 */
export function readLegacySettingsMarkers(text: string, providers: unknown, useLegacyProviders = false): ProviderTypes {
  const document = parseYaml(text, 'settings.yaml')
  if (isEmpty(document.contents)) {
    return {}
  }
  if (!isMap(document.contents)) {
    throw new Error('Claude 配置迁移要求 settings.yaml 为设置映射')
  }
  const section = resolveAlias(document, document.contents.get(CLAUDE_PROVIDER_SETTINGS_NS, true))
  const field = isMap(section) ? resolveAlias(document, section.get('providerTypes', true)) : undefined
  const entries = markerEntries(isMap(field) ? field.toJS(document) : undefined)
  let directory = record(providers) ?? {}
  if (useLegacyProviders) {
    const llm = resolveAlias(document, document.contents.get(PI_AI_SETTINGS_NS, true))
    const stored = isMap(llm) ? resolveAlias(document, llm.get('providers', true)) : undefined
    if (isMap(stored)) {
      directory = { ...record(stored.toJS(document)), ...directory }
    }
  }
  return Object.fromEntries(entries.filter(([id]) => (
    Object.hasOwn(directory, id) && record(directory[id])?.['api'] === 'anthropic-messages'
  )))
}
