import { mkdir, readFile, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { CLAUDE_PROVIDER_SETTINGS_NS, readConfig, readConfigPatch } from './config.ts'
import type { PluginConfig } from './config.ts'
import { readLegacySettingsMarkers, readPatchMarkers } from './legacy-yaml.ts'

/** DSH 提供的当前 profile 路径。 */
export interface ProfilePaths {
  readonly dir: string
  readonly home: string
  readonly patchPath: string
}

/** 已保存的设置及其修订号。 */
export interface ConfigSnapshot {
  value: PluginConfig
  revision: number
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function configFile(profile: ProfilePaths): string {
  return join(profile.dir, 'config', CLAUDE_PROVIDER_SETTINGS_NS, 'config.json')
}

function parseConfigFile(path: string, text: string, legacyCache = false): { value: Partial<PluginConfig>, revision: number } {
  try {
    const disk = JSON.parse(text) as { formatVersion?: unknown, revision: number, value?: unknown } | null
    if (disk?.formatVersion !== 1 || !Number.isSafeInteger(disk.revision) || disk.revision < 0) {
      throw new Error('配置文件版本或修订号无效')
    }
    let value = disk.value
    if (legacyCache && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // 旧 loader 读取缓存配置时忽略已移除的预热字段。
      value = Object.fromEntries(Object.entries(value).filter(([key]) => (
        key === 'mixedEnabled' || key === 'toolsTtl' || key === 'systemTtl' || key === 'messagesTtl'
      )))
    }
    return { value: readConfigPatch(value), revision: disk.revision }
  } catch (error) {
    throw new Error(`无法读取 Claude 配置文件 ${path}`, { cause: error })
  }
}

async function readConfigFile(path: string): Promise<{ value: Partial<PluginConfig>, revision: number } | undefined> {
  const text = await readOptionalFile(path)
  return text === undefined ? undefined : parseConfigFile(path, text)
}

async function writeConfigFile(path: string, snapshot: ConfigSnapshot): Promise<void> {
  await writeFileAtomic(path, JSON.stringify({ formatVersion: 1, ...snapshot }, null, 2) + '\n', { mode: 0o600 })
}

interface MigrationOptions {
  providers?: () => unknown
  activeSettings?: string
  restoreArchived?: boolean
  signal?: AbortSignal
  warn?: (message: string, error: unknown) => void
}

/** 合并已保存的配置，提交目标文件后清理当前 profile 的旧配置。 */
export async function migrateProfileConfig(
  profile: ProfilePaths,
  options: MigrationOptions,
): Promise<{ snapshot: ConfigSnapshot, recovered: number }> {
  const path = configFile(profile)
  const cache = join(profile.dir, 'config', 'claude-cache', 'config.json')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lock = { signal: options.signal, waitMs: 10_000 }
  // 与宿主设置保存使用同一把 profile 锁，避免改写同一份 YAML 时丢失配置。
  return withFileLock(join(profile.dir, 'package.json'), async () => withFileLock(path, async () => {
    const disk = await readConfigFile(path)
    const patchText = await readOptionalFile(profile.patchPath)
    const patch = patchText === undefined ? undefined : readPatchMarkers(patchText)
    const cacheText = await readOptionalFile(cache)
    const legacyCache = cacheText === undefined ? undefined : parseConfigFile(cache, cacheText, true)
    const previous = disk?.value ?? {}
    let providerTypes = previous.providerTypes
    if (providerTypes === undefined || options.restoreArchived) {
      const activeSettings = options.activeSettings ?? await readOptionalFile(join(profile.home, 'settings.yaml'))
      const historical = activeSettings ?? await readOptionalFile(join(profile.home, 'settings.yaml.imported'))
      const restored = historical === undefined ? {} : readLegacySettingsMarkers(
        historical, options.providers?.() ?? patch?.providers, activeSettings !== undefined,
      )
      providerTypes = { ...restored, ...patch?.providerTypes, ...previous.providerTypes }
    }
    const value = readConfig({ ...legacyCache?.value, ...previous, providerTypes })
    const recovered = Object.keys(providerTypes).length - Object.keys(previous.providerTypes ?? {}).length
    const revision = disk?.revision ?? 0
    const hasLegacy = patch?.cleaned !== undefined || legacyCache !== undefined || recovered > 0
    const changed = (disk !== undefined || hasLegacy) && !isDeepStrictEqual(value, disk?.value)
    const snapshot = { value, revision: revision + Number(changed) }
    options.signal?.throwIfAborted()
    if (changed) {
      await writeConfigFile(path, snapshot)
    }

    const cleanedPatch = patch?.cleaned
    if (cleanedPatch !== undefined) {
      await cleanLegacy(profile.patchPath, async () => {
        if (await readOptionalFile(profile.patchPath) !== patchText) {
          throw new Error('迁移期间 profile 补丁已更改')
        }
        await writeFileAtomic(profile.patchPath, cleanedPatch, { mode: 0o600 })
      })
    }
    if (legacyCache !== undefined) {
      await cleanLegacy(cache, async () => {
        if (await readOptionalFile(cache) !== cacheText) {
          throw new Error('迁移期间旧缓存配置已更改')
        }
        await unlink(cache)
        try {
          await rmdir(dirname(cache))
        } catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            throw error
          }
        }
      })
    }
    return { snapshot, recovered }
  }, lock), lock)

  async function cleanLegacy(source: string, clean: () => Promise<void>): Promise<void> {
    try {
      options.signal?.throwIfAborted()
      await clean()
    } catch (error) {
      if (options.warn === undefined || options.signal?.aborted) {
        throw error
      }
      options.warn(`已保存 Claude 配置，清理旧配置 ${source} 失败`, error)
    }
  }
}

/** 为运行中的插件提供配置快照，并串行提交来自设置页面的变更。 */
export function openProfileConfig(profile: ProfilePaths, options: MigrationOptions, settled: Promise<void>) {
  const path = configFile(profile)
  let current: ConfigSnapshot | undefined
  // 宿主在 Loader 就绪后会将 settings.yaml 改名，先读取仍待导入的版本。
  const activeSettings = readOptionalFile(join(profile.home, 'settings.yaml'))
  const ready = Promise.all([settled, activeSettings]).then(async ([, legacy]) => {
    current = (await migrateProfileConfig(profile, { ...options, activeSettings: legacy })).snapshot
    return current
  })
  return {
    ready,
    get: (): ConfigSnapshot | undefined => current,
    async change(change: (value: PluginConfig, revision: number) => PluginConfig): Promise<ConfigSnapshot> {
      await ready
      return withFileLock(path, async () => {
        const disk = await readConfigFile(path)
        const value = readConfig(disk?.value ?? {})
        const revision = disk?.revision ?? 0
        current = { value, revision }
        const next = change(value, revision)
        if (isDeepStrictEqual(value, next)) {
          return current
        }
        const snapshot = { value: next, revision: revision + 1 }
        options.signal?.throwIfAborted()
        await writeConfigFile(path, snapshot)
        current = snapshot
        return snapshot
      }, { signal: options.signal })
    },
  }
}
