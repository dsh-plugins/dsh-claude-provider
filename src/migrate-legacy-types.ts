import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { CLAUDE_PROVIDER_TYPE } from './index.ts'

/** Provider type markers recovered from a pre-migration settings document. */
type ProviderTypes = Record<string, string>

/** One profile patch entry, only the fields this migration reads or writes. */
interface PatchEntry {
  id?: string
  config?: { providerTypes?: ProviderTypes, [key: string]: unknown }
  [key: string]: unknown
}

/** Provider profile facts the recovery rule reads. */
type ProviderProfiles = Record<string, { api?: unknown } | undefined>

/** What one migration run changed. */
export interface MigrationResult {
  /** Number of provider type markers recovered. */
  recovered: number
  /** Backup written alongside the patched profile file, when anything changed. */
  backup?: string
}

/**
 * Recover only UI type markers skipped when DSH was upgraded before this
 * plugin. Model settings and credential references remain owned by llm-pi-ai.
 * @param legacy - markers the old settings document recorded.
 * @param current - markers the profile patch already carries.
 * @param providers - provider profiles the profile patch declares.
 * @returns the merged markers, with existing entries winning.
 */
export function recoverProviderTypes(
  legacy: unknown,
  current: unknown,
  providers: unknown,
): ProviderTypes {
  const result: ProviderTypes = { ...(current as ProviderTypes | undefined) }
  for (const [id, type] of Object.entries((legacy ?? {}) as ProviderTypes)) {
    const profile = (providers as ProviderProfiles | undefined)?.[id]
    if (type === CLAUDE_PROVIDER_TYPE && profile?.api === 'anthropic-messages'
      && !Object.hasOwn(result, id)) {
      result[id] = type
    }
  }
  return result
}

/**
 * Recover Claude provider type markers from a settings document that DSH
 * already migrated away.
 * @param home - DSH home directory holding the profile patches.
 * @param profile - profile whose patch file receives the recovered markers.
 * @returns what the run changed; `recovered: 0` when there was nothing to do.
 */
export async function migrateLegacyTypes(home: string, profile = 'web'): Promise<MigrationResult> {
  const target = join(home, 'profiles', profile, 'cordis.patch.yml')
  let legacy: unknown
  try {
    legacy = yaml.load(await readFile(join(home, 'settings.yaml.imported'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { recovered: 0 }
    throw error
  }
  const text = await readFile(target, 'utf8')
  const patches = (yaml.load(text) ?? []) as PatchEntry[]
  if (!Array.isArray(patches)) throw new Error('Expected a profile patch list')
  const providerEntry = patches.find(entry => entry.id === 'llm-pi-ai')
  const markerEntry = patches.find(entry => entry.id === 'dsh-claude-provider')
  const current = markerEntry?.config?.providerTypes ?? {}
  const legacyTypes = (legacy as Record<string, { providerTypes?: unknown }> | null)?.['dsh-claude-provider']?.providerTypes
  const merged = recoverProviderTypes(legacyTypes, current, providerEntry?.config?.['providers'])
  const recovered = Object.keys(merged).length - Object.keys(current).length
  if (!recovered) return { recovered: 0 }
  const backup = `${target}.before-claude-migration-${Date.now()}`
  await copyFile(target, backup)
  if (markerEntry) markerEntry.config = { ...markerEntry.config, providerTypes: merged }
  else patches.push({ id: 'dsh-claude-provider', config: { providerTypes: merged } })
  await writeFile(target, yaml.dump(patches, { lineWidth: -1, noRefs: true }), { mode: 0o600 })
  return { recovered, backup }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await migrateLegacyTypes(
    process.env['DSH_HOME'] ?? join(homedir(), '.dsh'),
    process.argv[2] ?? 'web',
  )))
}
