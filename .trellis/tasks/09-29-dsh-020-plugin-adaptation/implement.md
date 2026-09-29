# 实施计划：自建插件适配 dsh 0.2.0-rc.1

> 配套 `prd.md`（需求/验收）与 `design.md`（技术设计）。
> 平台为 **DeepSeek Harness（inline 工作流）**：Phase 2 由主会话直接改代码、经 `trellis-before-dev` 载入上下文，
> 因此**不需要** `implement.jsonl` / `check.jsonl` 清单门。

## 0. 任务结构（D6）

本任务转为**父任务**，下挂 5 个可独立验收/独立归档的子任务：

| 子任务 slug | 交付物 | 依赖 |
|---|---|---|
| `dsh-020-config-migration` | 手工配置迁移落地（`~/.dsh`，不进仓库）+ 迁移脚本（可选） | 无（**最先做**） |
| `dsh-020-web-search` | `dsh-plugin-web-search` 适配 | 配置迁移 |
| `dsh-020-ollama-usage` | `dsh-plugin-ollama-usage` 适配 | 配置迁移 |
| `dsh-020-ptc-bash` | `dsh-plugin-ptc-bash` 交付机制重做 + 守卫恢复 | 无 |
| `dsh-020-trellis-statusline` | `dsh-plugin-trellis-statusline` 加固 | 无 |
| `dsh-020-suite-hub` | 新增 `dsh-plugin-suite` | 两个配置插件先行（需要它们的 Panel 与状态端点） |

父任务本身**不写产品代码**，只负责：需求集、跨子任务契约（座位名/entryId/panel 契约）、
端到端集成验收（AC1–AC8）、spec 回写（R12）。

## 1. 前置检查（编码前必做，任一失败则先调整设计）

- **P1 peer 与 `link:` 安装的兼容性**（design 风险 1）
  ```powershell
  # 在任一插件 package.json 临时加入 "@deepseek-ai/dsh": "^0.2.0-rc.1" 后，观察 profile 启动是否报错
  dsh --profile web --dump-config   # 需要 dsh 在 PATH；失败即回退为只声明 @deepseek-ai/dsh
  ```
  关注输出里是否出现 `incompatible-version` / peer 解析失败。
- **P2 确认 entryId 可被 `configForms` 寻址**：`web-search` 与 `ollama-usage` 的 row id 是否等于
  `configForms.describe()` 中的 namespace 键（结构性对照官方 `web-search-deepseek`：其 namespace = row id）。
- **P3 记录当前基线**：四个插件的 `npm test` 断言数（ollama 93 / ptc `34+4skip` / trellis 97 / web-search 194），
  作为"断言数不得下降"的基线。
- **P4 备份**：`~/.dsh/profiles/web/cordis.patch.yml` → `.bak-<date>`；确认 `settings.yaml.imported` 未被动过。

## 2. 子任务 A：配置迁移（`dsh-020-config-migration`）

1. 从 `~/.dsh/settings.yaml.imported` 读取 `web-search` 与 `ollama-usage` 两段。
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加两行 patch 条目：
   ```yaml
   - id: web-search
     config:
       provider: searxng
       fetchProvider: jina
       providers:
         searxng: { endpoint: https://searx.747497.xyz/search, headers: '{"X-API-Key":"…"}' }
         jina:    { endpoint: https://fetch.747497.xyz/,          headers: '{"X-API-Key":"…"}' }
   - id: ollama-usage
     config: { baseURL: https://ollama.com, apiKeyEnv: OLLAMA_API_KEY, credentialMode: reference }
   ```
   > 注意：此步依赖子任务 B/C 先声明 `Config`，否则 `config:` 会被 schema 校验拒绝或忽略。
   > 因此**实际操作顺序**为：先在 B/C 中声明 `Config` → 再写入 config → 再重启验证。子任务 A 与 B/C 需交错进行。
3. **key 安全**：真实 API key 只写 `$DSH_HOME`，绝不进入任何仓库文件；提交前 grep 校验。
4. 重启 dsh（或依赖 HMR 重载 patch）后验证：`web_search` / `web_fetch` 从"unavailable"变为可用。

**验证**
```powershell
# 真机：本会话内直接调用 web_fetch / web_search 工具（无法用只读检查替代）
```

## 3. 子任务 B：`dsh-plugin-web-search`

**改动点**（锚点为当前 HEAD）
1. `lib/index.js:1088-1102`：删除 `ctx.inject(['settings'], …)` + `installSection` 整块；
   `read()` thunk 改为直接用 `apply(ctx, config)` 的 `config`。
2. `lib/index.js:34`：`inject` 去掉 `'settings'`。
3. `lib/index.js:600-607`：`Config` 每个叶子字段加 `.volatile()`；`providers` **dict 节点本身**也加。
4. `lib/client.js:29, :667-669`：座位 `settings.plugin.item` → `settings.section`（独立 navList），
   并实现 design §2.3 的 hub 让位（`plugin-suite.panel`）。
5. 卡片读改写值改走 `ctx.configForms.get('web-search')`。
6. `package.json`：补 `peerDependencies`、`meta`、`icon`、`locale/*.json`；`dsh.client.inject` 复核。
7. `cordis.patch.yml`：行注释更正（不再说"配置都在 settings 卡片里"）。

**风险文件 / 回滚点**：`lib/index.js`（`applyTakeover` 写 home patch 的受管块，`:695-704`、`:835-839`）——
该设计**未坏**，不要顺手改；若要动，先确认 `<U>/dsh-app-boot/lib/index.js:1025-1030` 仍加载 home patch。

**验证**
```powershell
cd dsh-plugin-web-search; npm test          # 基线 194，不得下降
```
- 必须**改造假 settings 服务**（`test/host.test.mjs:23-45` 自实现 `register`）与假 `slots.inject`
  （`test/client.test.mjs:61-62`、`test/card.test.mjs:71` 的"立即回调"）。
- 新增反假绿断言：**在去注释后的源码上断言不存在 `installSection`**（伪证检验：加回即变红）。
- 新增断言：`Config` 的 volatile 覆盖（含 `providers` dict 节点）。

## 4. 子任务 C：`dsh-plugin-ollama-usage`

**改动点**
1. `lib/index.js:586`：删除 `ctx.settings.register(NS, settingsSchema)`；改为 `export const Config`（volatile）。
2. `lib/index.js:454`：`inject` 去掉 `'settings'`（`credentials` / `connection` / `webServer` 保留）。
3. `lib/index.js:103-115`（手搓 callable + `toJSON`）与 `:133-137`（`describeOwn` 按 `entry.ns` 找）：
   改为直接读 `config` / `configForms`。
4. `lib/client.js:950-951`（`settings.plugin.item`）→ `settings.section` + hub 让位。
5. `README.md:21, :34, :104` 与 `lib/client.js:14` 的过时描述更正（座位名、`settings.yaml`、版本）。

**风险文件**：`lib/index.js` 的 `apply()`（`：583-602`）——原注释声称"apply 抛错会失败整棵插件树"，
实测只失败该 row；注释与新事实对齐。

**验证**：`npm test`（基线 93）+ 真机确认用量 pill 有值（此前 `phase` 恒非 `ok`）。

## 5. 子任务 D：`dsh-plugin-ptc-bash`

**改动点**
1. `lib/index.js`：删除 `$DSH_HOME/.agent-presets` 同步路径与 `validateComposition` 的同步职责；
   激活时读自身 `presets/ptc-bash/{preset.yml,agent.cordis.yml}` → `ctx.agentPresets.register({...})`；
   相对行输出 **file URL**。
2. `test/composition-health.test.mjs:47-53, :56, :66-97, :166`：重写 `harness()`——
   改为定位 `<U>/dsh-agent-preset-registry` 与 `<U>/dsh-agent-preset`，
   离线部分用 `entryListProblem`，并新增**一条真实会话级验收**（AC4）。
   删除 `:216-217` 指向死字符串（`names a plugin that cannot be resolved` / `not valid YAML`）的正则。
3. `tools/derive-preset.mjs:23, :93`：锚点换成 `<U>/dsh-web-app/presets/ptc.patch.yml`
   （`insert[0].config.plugins`）；`:179-180` 拒绝写入时 **exit 非零**；`:175-176` 两处写盘原子化
   （复用 `@deepseek-ai/dsh-atomic-write` 或先写临时文件再 rename）。
4. `package.json`：补 `peerDependencies`（含 `dsh-agent-preset-registry`）、`meta`、`locale`、`icon`。
5. `README.md:7-8, :40, :57, :60-61, :67` 的失效声明全部更正；`NOTICE:7` 与
   `LICENSES/deepseek-dsh-agent-presets-MIT.txt` 的归属目标改为
   `@deepseek-ai/dsh-web-app` 的 `presets/ptc.patch.yml`。

**风险文件**：`presets/ptc-bash/agent.cordis.yml` 内容**零漂移**（35 行 deep-equal 已验证），
**不要重跑派生覆盖它**；本子任务的改动只在交付机制与测试。

**验证**
```powershell
cd dsh-plugin-ptc-bash; npm run derive-preset; node --test   # 期望：skip 数 = 0
```
- 负向用例：构造一行引用 `@deepseek-ai/dsh-agent-presets`（已删）⇒ 守卫必须**失败**。
- 真机：新会话预设选择器出现 `ptc-bash`（AC4）。

## 6. 子任务 E：`dsh-plugin-trellis-statusline`

真机已验证健康（`conversation.session.header.actions` 活占位者，
`id: trellis-statusline, order: 10, active: true`）。本子任务**只做加固**：
1. 补 `peerDependencies`、`meta`、`locale/*.json`、`icon`。
2. 假 `slots.inject`（立即回调）改造为真实语义。
3. 新增反假绿断言：**header 座位被删除时，插件不得静默通过**。
4. 为 hub 状态区提供只读端点（活动任务）。

**验证**：`npm test`（基线 97）。

## 7. 子任务 F：`dsh-plugin-suite`（hub）

**新建包**，最小实现：
```
dsh-plugin-suite/
  package.json          # dsh.bundle.patch + dsh.client.{platform,inject}; meta/icon/locale; peerDependencies
  cordis.patch.yml      # - insert: - id: plugin-suite / name: 'dsh-plugin-suite'
  lib/index.js          # host 半边：只读状态聚合端点；无 Config
  lib/client.js         # settings.section(id 'my-plugins') + 子座位 'plugin-suite.panel'(list) + 状态区
  test/*.test.mjs
  README.md
```
- **先例参照**：`@linxin666/dsh-client-ui-market` 已在 `settings.section` 下自建子座位 `dsh-workshop.panel`。
- 状态区五项：row 是否激活 / peer 是否兼容 / `ptc-bash` 预设是否已声明 / `searxng`·`jina` 的 `available()` /
  trellis 是否解析到活动任务。**只读**。
- hub **不得**认识具体插件：面板由插件 push 进 `plugin-suite.panel`。

**验证**
```powershell
cd dsh-plugin-suite; npm test
```
- AC7 真机：navList 出现 `my-plugins`，内含两个配置面板 + 四项状态。
- AC8 真机：禁用 hub ⇒ 两个插件各自的 navList 条目**重新出现**且可读写；重新启用 ⇒ 独立条目消失。

## 8. 端到端验收（父任务）

按 `prd.md` AC1–AC10 逐条执行。**不可用只读检查替代的**：
- AC1（真机 web_search / web_fetch）
- AC4（新会话选择并挂载 `ptc-bash`）
- AC7 / AC8（hub 聚合与让位双向性）
- AC6（门禁确实拒绝不兼容 range）

## 9. 收尾

1. **spec 回写（R12）**：`.trellis/spec/` 新增/更新：
   - `guides/dsh-upgrade-derived-assets.md`：更新为 0.2.0 的声明式预设注册；
   - 新增 0.2.0 契约页：settings 迁移、`Config` + volatile、`configForms`、`settings.section`/`plugins.row.config`、
     peer 门禁、legacy `settings.yaml` 导入规则、"以装机 `<U>` 为唯一权威"的复检清单。
2. **旧任务处置（D7）**：
   - `09-21-web-search-fetch-422`：结论迁入本父任务后 `task.py archive`；
   - `09-20-dock-seats-difference`：其 AC7 真机复核改基准到 0.2.0 并在此完成，然后 `task.py archive`。
3. **提交**：按 AGENTS.md **必须获得用户明确同意**后才 commit / push（子模块需各自提交并更新父仓库指针）。
4. **清理**：`.scratch/` 下的迁移脚本与探针用完即删或明确告知用户位置。
