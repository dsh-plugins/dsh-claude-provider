/**
 * Build the browser half of the plugin from the installed
 * `@deepseek-ai/dsh-client-ui-settings-models` sources.
 *
 * The settings page ships no extension point for a dedicated Claude tab or a
 * per-model adaptive-thinking switch, so this build stages the upstream
 * TypeScript sources, applies the patches in `client-patches.ts`, and bundles
 * the result into the `window.__ModuleLoader__.load({ id, factory })` closure
 * the DSH web shell serves. Patching sources rather than the published bundle
 * keeps every edit readable, type-checked, and attributable to one anchor.
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { transform } from 'lightningcss'
import { applyClientPatches } from './client-patches.ts'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const packageDir = dirname(require.resolve('@deepseek-ai/dsh-client-ui-settings-models/package.json'))
const upstreamSrc = join(packageDir, 'src')
const stagingDir = join(here, '../.client-build')
const outputPath = join(here, '../lib/client.js')

/** Plugin id the web shell registers the client bundle under. */
const PLUGIN_ID = '@dsh-plugin/dsh-claude-provider'

/** Module specifiers the web shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/**
 * Host-only modules the browser bundle must never pull in. `schemastery` is
 * deliberately absent: the staged sources import it for the onboarding config,
 * and the web shell does not expose it, so it is inlined like the upstream
 * bundle does.
 */
const HOST_MODULES = ['@deepseek-ai/dsh-host-webserver'] as const

/** Source files this plugin adds to the staged tree. */
const ADDED_SOURCES = [
  ['claude-types.ts', 'client/claude-types.ts'],
  ['claude-models.ts', 'client/claude-models.ts'],
  ['claude-adaptive-thinking.tsx', 'client/claude-adaptive-thinking.tsx'],
  ['claude-empty-signature.tsx', 'client/claude-empty-signature.tsx'],
  ['claude-cache-mode.tsx', 'client/claude-cache-mode.tsx'],
  ['../src/known-models.ts', 'client/known-models.ts'],
] as const

/**
 * Rewrite the staged constant module's host import to the staged copy of the
 * recorded model table, so the browser bundle carries its own instance instead
 * of reaching outside the staged tree.
 * @param stagingDir - staged source root.
 */
async function linkKnownModels(stagingDir: string): Promise<void> {
  const tablePath = join(stagingDir, 'client', 'claude-types.ts')
  const constants = await readFile(tablePath, 'utf8')
  const hostImport = "from '../src/known-models.ts'"
  const occurrences = constants.split(hostImport).length - 1
  if (occurrences === 0) throw new Error('build-client: recorded model import not found')
  await writeFile(tablePath, constants.replaceAll(hostImport, "from './known-models.ts'"))
}

/**
 * An esbuild plugin compiling `*.module.css` into a hashed class map plus its
 * injected stylesheet, matching the artifact the DSH client builder emits.
 */
function cssModulesPlugin(): esbuild.Plugin {
  return {
    name: 'dsh-css-modules',
    setup(build) {
      build.onLoad({ filter: /\.module\.css$/ }, async (args) => {
        const code = await readFile(args.path)
        const result = transform({ filename: args.path, code, cssModules: { pattern: '[hash]_[local]' }, minify: true })
        const classes: Record<string, string> = {}
        for (const [local, exported] of Object.entries(result.exports ?? {})) classes[local] = exported.name
        const tagId = `${PLUGIN_ID}/${relative(upstreamSrc, args.path).split(sep).join('/')}`
        return {
          loader: 'js',
          contents: `const classes = ${JSON.stringify(classes)}
const tagId = ${JSON.stringify(tagId)}
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)}
  tag.dataset.pluginCss = tagId
  tag.textContent = ${JSON.stringify(result.code.toString())}
  document.head.appendChild(tag)
}
export default classes
`,
        }
      })
    },
  }
}

/**
 * Stage the upstream sources, add this plugin's modules, apply the patches, and
 * bundle the client half into `lib/client.js`.
 */
async function build(): Promise<void> {
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  await cp(upstreamSrc, stagingDir, { recursive: true })
  for (const [source, target] of ADDED_SOURCES) {
    await cp(new URL(`./${source}`, import.meta.url), join(stagingDir, target))
  }
  await linkKnownModels(stagingDir)

  const patched = await applyClientPatches(stagingDir)
  const checked = spawnSync(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--project', join(here, '../tsconfig.client.json'),
  ], { stdio: 'inherit' })
  if (checked.error !== undefined) {
    throw new Error('build-client: 无法启动客户端类型检查', { cause: checked.error })
  }
  if (checked.status !== 0) {
    throw new Error(`build-client: 客户端类型检查失败，退出码 ${checked.status}，信号 ${checked.signal}`)
  }
  if (process.argv.includes('--check')) {
    process.stderr.write(`build-client: checked ${patched.patches} anchors across ${patched.files} files\n`)
    return
  }
  const result = await esbuild.build({
    entryPoints: [join(stagingDir, 'client', 'index.ts')],
    // 共用 JSX 配置，避免打包器生成页面未导入的全局 React 引用。
    tsconfig: join(here, '../tsconfig.client.json'),
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    legalComments: 'none',
    external: [...PLATFORM_MODULES, ...HOST_MODULES],
    plugins: [cssModulesPlugin()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
  })
  const code = result.outputFiles[0]?.text
  if (code === undefined) throw new Error('build-client: esbuild produced no bundle')
  const bundle = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${code}
\t\treturn module.exports;
\t} });
`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, bundle)
  process.stderr.write(`build-client: patched ${patched.patches} anchors across ${patched.files} files\n`)
}

await build()
