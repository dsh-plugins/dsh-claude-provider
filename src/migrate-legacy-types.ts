import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLAUDE_PROVIDER_TYPE } from './config.ts'
import { migrateProfileConfig } from './profile-config.ts'

/** Provider type markers recovered from a pre-migration settings document. */
type ProviderTypes = Record<string, string>

/** Provider profile facts the recovery rule reads. */
type ProviderProfiles = Record<string, { api?: unknown } | undefined>

/** What one migration run changed. */
export interface MigrationResult {
  /** Number of provider type markers recovered. */
  recovered: number
  /** 旧调用方可读取的补丁备份路径。 */
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

/** 将旧类型标记恢复到指定 profile 的插件 JSON 配置。 */
export async function migrateLegacyTypes(home: string, profile = 'web'): Promise<MigrationResult> {
  const dir = join(home, 'profiles', profile)
  const { recovered } = await migrateProfileConfig({ home, dir, patchPath: join(dir, 'cordis.patch.yml') }, {
    restoreArchived: true,
  })
  return { recovered }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await migrateLegacyTypes(
    process.env['DSH_HOME'] ?? join(homedir(), '.dsh'),
    process.argv[2] ?? 'web',
  )))
}
