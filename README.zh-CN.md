# DSH Claude Provider

[English](./README.md) | 简体中文

DSH Claude Provider 为 DeepSeek Harness 提供专用的 Claude 配置界面。你可以添加多个 Claude 提供方，为每个模型选择推理档位，并自动获取模型列表、填写常用 Claude 模型的容量和推理预设，无需手动编辑配置文件。

相比官方的通用自定义提供方配置，插件增加了独立的 Claude 入口、按模型设置的自适应思考开关，以及按已知 Claude 模型自动填写参数的功能。保存后的推理配置由 DeepSeek Harness 原生处理。

本版本适配 DeepSeek Harness 0.2.2-rc.2 与 0.2.2-rc.3。这两个版本重写了模型设置页（新增重试策略、Gemini 协议，以及 `settings.models.provider-card` 与 `settings.models.footer` 扩展槽），因此插件改为基于上游设置页源码构建浏览器半区：`npm run build` 会暂存已安装的 `@deepseek-ai/dsh-client-ui-settings-models` 源码，套用 `scripts/client-patches.ts` 中的锚点补丁，再打包成客户端 bundle。上游挪动锚点时构建直接失败，而不是静默丢失 Claude 控件。

## 插件功能

1. **增加独立的 Claude 提供方类型**

   在「设置 → 模型 → 添加模型提供商」中选择「Claude 提供方」，即可打开专用的 Anthropic Messages 配置表单。

<p align="center">
  <img src="./docs/images/claude-provider-tabs.png" alt="Claude 提供方选项与配置表单" width="580">
</p>

2. **增加按模型设置的自适应思考开关**

   在 DSH 原有的推理等级设置中，为每个模型增加“自适应思考”开关。推理档位及对应的 API 参数值仍可自定义。

   适用于支持自适应思考的 Anthropic 兼容模型。开启后，模型根据任务难度和你选择的推理等级自动调整思考量；关闭后，改用该等级对应的思考 token 数量上限。必须思考的模型会保持开启且不可更改。

   每个已记录的 Claude 模型都带有自己的推理档位与模式；不在记录表中的模型 ID 按族与版本推断，无法识别为 Claude 型号时回退到预算思考。当路由中存在使用预算思考的模型时，插件还会写入这些模型对应的思考 token 预算（low 1024、medium 4096、high 32000）。

   插件会在保存时将模型的推理档位和自适应思考设置写入 DeepSeek Harness 原生配置。

<p align="center">
  <img src="./docs/images/model-options.png" alt="Claude 模型容量预填与思考模式设置" width="580">
</p>

2b. **为需要的中转端点接受空思考签名**

   部分 Anthropic 兼容端点会发出并接受签名为空的思考块。“接受空思考签名”开关会把这一偏好记录在路由上，这类块会按思考块回传，而不是被转换成正文。默认关闭，因为官方 Anthropic API 会拒绝空签名。

2c. **可分段设置提示缓存时长**

   Claude 表单新增“提示缓存时长”下拉：提供商默认、关闭（不启用缓存）、五分钟、一小时。“提供商默认”不写该字段，由适配器自行决定（通常是五分钟）；“关闭”写入 `cacheRetention: none`，这条路由此完全不发缓存断点；五分钟与一小时会写入对应取值。一小时路由还需适配器允许长缓存，否则仍按五分钟发送。

   Claude 表单选定一小时之后，可在「插件」页展开「Claude 提供商」打开「Claude 提示缓存」配置卡片，为工具定义、系统提示、消息三段分别选择五分钟或一小时。Anthropic API 要求一小时缓存全部排在五分钟缓存之前，插件据此校验分段组合：组合非法时，面板顶部会显示“当前组合不会生效”及原因，相关请求沿用提供商自身的时长，不会发出会被接口拒绝的请求。

   一小时缓存写入按基础输入价的 2 倍计费，只有前缀稳定复用时才更划算，因此默认只有工具定义与系统提示使用一小时，消息保持五分钟。

   配置卡片底部只读显示保存后实际发送的分段时长。这个读数有必要，因为非法组合不会明显失败：相关请求会静默沿用它自己声明的缓存时长。

   分段缓存依赖 `@dsh-plugin/dsh-loader`。未安装 loader 的 Profile 保持原有行为，路由只会带上 `cacheRetention`，请求体不被改写。

3. **支持 Anthropic 模型列表分页获取**

   插件通过 Anthropic 兼容的 `GET /v1/models` 接口获取模型列表，并根据接口返回的游标继续读取后续页面、合并重复模型。

4. **探测后自动填写常用 Claude 模型参数**

   探测到的模型 ID 如果与插件已经记录的 Claude 模型匹配，插件会自动填写上下文窗口、最大输出长度和推理模式。用户手动添加的模型仍然可以自由编辑，不会被这项自动匹配覆盖。

5. **不影响其他提供方**

   模型探测、参数预填和推理档位配置只对明确创建为“Claude 提供方”的 Provider ID 生效。DeepSeek Harness 的内置提供方和普通自定义提供方会保持原有行为，即使它们同样使用 `anthropic-messages` 协议，或者包含 `claude-*` 模型 ID，也不会被插件修改。

## 安装

### 安装已发布的版本

浏览器界面使用 Web Profile：

```sh
npx @deepseek-ai/dsh plugin --profile web add @dsh-plugin/dsh-claude-provider
```

安装后需要重启对应的 DeepSeek Harness 进程。

### 从源码安装

先克隆、构建并打包项目：

```sh
git clone https://github.com/dsh-plugins/dsh-claude-provider.git
cd dsh-claude-provider
npm ci
npm run build
mkdir -p dist
npm pack --pack-destination dist
```

构建会用 `tsc` 编译宿主半区，并从已安装的 `@deepseek-ai/dsh-client-ui-settings-models` 源码生成浏览器半区，因此 `devDependencies` 中的 DSH 版本决定客户端半区适配的设置页。`npm run typecheck` 会重新暂存上游源码、应用补丁，并对实际页面、Claude 控件和辅助规则执行类型检查；`npm run build` 也会在打包前执行这项检查，并与检查器共用 `react-jsx` 配置，从宿主加载 `react/jsx-runtime`，不依赖全局 `React`。`npm test` 验证模型规则与配置解析。

如果「设置 → 模型」完全空白，先检查安装的包名与版本。旧作用域包 `@mofeng2223/dsh-claude-provider@0.6.6` 声明适配 DSH `0.2.2-rc.1`；本仓库使用 `@dsh-plugin/dsh-claude-provider`，两者是不同的 npm 包，安装新包不会自动移除旧包。切换时须先移除旧包，再安装与宿主匹配的新包并重启，避免两个插件同时替换模型页面。

将生成的包安装到 Web Profile：

```sh
npx @deepseek-ai/dsh plugin --profile web add ./dist/dsh-plugin-dsh-claude-provider-*.tgz
```

## 卸载

```sh
npx @deepseek-ai/dsh plugin --profile web remove @dsh-plugin/dsh-claude-provider
```

卸载插件不会删除官方模型配置或已经保存的凭据。已有的 Claude 提供方会继续作为普通的 `anthropic-messages` 自定义提供方保留，已保存的推理档位和自适应思考配置仍然有效。卸载后将不再提供 Claude 专用的添加／编辑界面、分页模型探测和参数预填；官方的模型探测功能仍然可用。

## 配置迁移

Claude 提供方类型标记和分段缓存选项统一保存在 `<DSH_HOME>/profiles/<profile>/config/dsh-claude-provider/config.json`。

升级后首次启动时，插件会自动导入当前 profile 的 `cordis.patch.yml` 中的 `providerTypes`，以及 `config/claude-cache/config.json` 中的分段缓存选项。目标 JSON 保存成功后，插件会从补丁中移除旧标记并删除旧缓存配置文件。目标 JSON 已有的设置优先。

从更早的 DSH 版本升级时，插件还会从 `settings.yaml` 或 DSH 生成的 `settings.yaml.imported` 恢复与当前 profile 中 `anthropic-messages` 路由匹配的 Claude 类型标记。

## 许可证

[MIT](./LICENSE)
