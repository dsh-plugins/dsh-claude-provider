# DSH Claude Provider

English | [简体中文](./README.zh-CN.md)

DSH Claude Provider adds a dedicated Claude configuration interface to DeepSeek Harness. You can add multiple Claude providers, choose reasoning levels for each model, and automatically fetch model lists and fill in capacity settings and reasoning presets for common Claude models, without editing configuration files manually.

Compared with the official generic custom provider form, the plugin adds a dedicated Claude entry, a per-model adaptive thinking toggle, and automatic defaults for known Claude models. DeepSeek Harness handles the saved reasoning configuration natively.

This release targets DeepSeek Harness 0.2.2-rc.2 and 0.2.2-rc.3. Those versions rewrote the Models settings page — retry policies, the Gemini protocol, and the `settings.models.provider-card` / `settings.models.footer` extension slots — so the plugin now builds its browser half from the upstream page sources: `npm run build` stages the installed `@deepseek-ai/dsh-client-ui-settings-models` sources, applies the anchored patches in `scripts/client-patches.ts`, and bundles the result. A DSH release that moves an anchor fails the build instead of silently dropping the Claude controls.

## What this plugin does

1. **Adds a dedicated Claude provider type**

   Open **Settings → Models → Add model provider → Claude provider** to use the dedicated Anthropic Messages form.

<p align="center">
  <img src="./docs/images/claude-provider-tabs.en.png" alt="Claude provider tab and configuration form" width="580">
</p>

2. **Adds a per-model adaptive thinking toggle**

   Adds an Adaptive thinking toggle for each model alongside DSH's existing reasoning-level settings. Reasoning levels and their corresponding API parameter values remain customizable.

   For Anthropic-compatible models that support adaptive thinking. When enabled, the model adjusts its thinking based on task complexity and your selected reasoning level. When disabled, it uses the thinking token limit associated with that level. A model that always reasons keeps the toggle on and locked.

   Each recorded Claude model carries its own reasoning levels and mode; a model ID outside the recorded table is classified by its family and version, and an ID naming no Claude family falls back to budget thinking. A route holding at least one budget-thinking model also records the thinking token budgets those models spend (1024 for low, 4096 for medium, 32000 for high).

   On save, the plugin writes each model's reasoning levels and adaptive thinking settings to DeepSeek Harness's native configuration.

<p align="center">
  <img src="./docs/images/model-options.en.png" alt="Claude model capacity defaults and reasoning modes" width="580">
</p>

2b. **Accepts empty thinking signatures for gateways that need them**

   Some Anthropic-compatible endpoints emit and accept a thinking block whose signature is empty. The **Accept empty thinking signatures** switch records that preference on the route, so such a block is replayed as thinking instead of being converted to plain text. It is off by default because the official Anthropic API rejects an empty signature.

3. **Supports paginated Anthropic model discovery**

   The plugin fetches model lists through an Anthropic-compatible `GET /v1/models` endpoint, follows the returned cursors to retrieve subsequent pages, and deduplicates the results.

4. **Fills known Claude model defaults after discovery**

   When a discovered model matches a recorded Claude model ID, the plugin automatically fills its context window, maximum output length, and reasoning-mode set. Models entered manually remain fully editable and are not overwritten by this lookup.

5. **Leaves every other provider unchanged**

   Discovery, defaults, and reasoning controls are limited to Provider IDs explicitly created as **Claude Providers**. DeepSeek Harness's built-in providers and ordinary custom providers keep their original behavior, even when they use `anthropic-messages` or expose a `claude-*` model ID.

## Install

### Published package

For the browser interface, install the plugin into the Web profile:

```sh
npx @deepseek-ai/dsh plugin --profile web add @dsh-plugin/dsh-claude-provider
```

Restart the corresponding DeepSeek Harness process after installation.

### From source

Clone, build, and package the repository first:

```sh
git clone https://github.com/dsh-plugins/dsh-claude-provider.git
cd dsh-claude-provider
npm ci
npm run build
mkdir -p dist
npm pack --pack-destination dist
```

The build compiles the host half with `tsc` and patches the browser half from the installed `@deepseek-ai/dsh-client-ui-settings-models` sources, so the DSH version in `devDependencies` decides which page the client half targets. `npm run typecheck` and `npm test` verify both halves.

Install the generated package into the Web profile:

```sh
npx @deepseek-ai/dsh plugin --profile web add ./dist/dsh-plugin-dsh-claude-provider-*.tgz
```

## Uninstall

```sh
npx @deepseek-ai/dsh plugin --profile web remove @dsh-plugin/dsh-claude-provider
```

Uninstalling the plugin does not delete official model settings or stored credentials. Existing Claude providers remain ordinary custom `anthropic-messages` providers, and their saved reasoning levels and adaptive thinking settings remain effective. The dedicated Claude add/edit interface, paginated model discovery, and automatic defaults are no longer available; the official model discovery feature remains available.

## Settings migration

This plugin stores its Claude provider type markers in its own profile patch entry, so a DSH upgrade that migrates `settings.yaml` can leave them behind. `src/migrate-legacy-types.ts` recovers only those markers, and only for providers whose profile still declares `anthropic-messages`.

### 1. The new DSH version is not installed yet

Stop DSH, update DSH and the Claude plugin, then start DSH. On its first launch, the new DSH version attempts to migrate the old `settings.yaml` into the current Profile.

### 2. The new DSH version is installed but has not been run

Migration has not started yet. Update the Claude plugin and any other plugins requiring compatibility updates before starting DSH. DSH attempts to migrate the old Settings configuration on its first launch.

### 3. The new DSH version has already been run

DSH has already attempted automatic Settings migration, and some settings may have migration issues.

Run the recovery once against the affected profile, which writes the missing markers back and leaves a timestamped backup beside the patch file:

```sh
npx @deepseek-ai/dsh-plugin/dsh-claude-provider/migrate-legacy-types
```

For this plugin, the possible impact is limited to missing Claude provider type markers. **Model configuration and operation are unaffected by the missing markers.**

## License

[MIT](./LICENSE)
