# Implement: Ollama Cloud 用量条目（动态插件原型，自带配置卡片）

## 前置

- 在 Web 新建会话并选择「创造模式」preset（带 `cordis_*` 工具与 `cordis-plugin-development` skill）。
- 全程不落盘：`cordis_define`（新 Package 不可变）→ `cordis_run`（run/update/rollback）→ `cordis_stop`/`cordis_undefine`。settings 与凭据是运行期持久数据，停插件不清除。

## 顺序清单

1. **契约核实（只读，Host + Client）**
   - Host：`settings`（`register` / owner `update|replace|mutate` / `expectedRevision` / descriptor 列表）、`credentials`（`resolve/describe/set/unset`）、Builtins 是否含 `fetch`（否则 `dsh-web-fetch-http`）。
   - Client：`settings.plugin.item`（精确 props 与 `key` 语义）、`conversation.composer.dock`（props/占用者）、Builtins `react`/`react-dom`。
2. **P0 Host 命名空间**：`settings.register('ollama-usage', {baseURL, apiKeyEnv})` + `harness.handle('config/read'|'config/save')`（含 revision 冲突回传）→ run → 在 Settings 的 Plugin configuration 页签确认出现一个空卡片位（尚未注册卡片组件时为占位/空）。
3. **P1 配置卡片（Client）**：`settings.plugin.item`（`key: 'ollama-usage'`）渲染表单（baseURL / apiKeyEnv / 保存 / 丢弃 / 错误提示）→ update → 验证 AC1：保存生效、无重启、校验失败有提示、草稿不丢。
4. **P2 凭据接入**：卡片密钥输入 → `credentials.set`，"清除" → `unset`，状态来自 `describe`（不回显）→ update → 验证：保存后状态为"已配置"；清空后为未配置。
5. **P3 取数（Host）**：`GET {baseURL}/usage` + 解码（形状参照 PRD 事实 6）+ R5 空态规则 + 脱敏 → 先用 `host.call('usage/read')` 在控制台/卡片里核对三窗口数值与 ollama.com/settings 一致。
6. **P4 dock 条目**：pill（最紧窗口）+ 挂载/面板/轮询节奏 → update → 验证 AC2、AC4。
7. **P5 面板**：三窗口百分比条 + 重置时间 + 各模型请求数，Esc 关闭与焦点回还 → update → 验证 AC5。
8. **P6 hero 浮层**：以"dock 占位者未挂载"为信号渲染 portal（共用 pill + 面板）→ update → 验证 AC3（可见、不闪、不拦截交互、resize 正确）。
9. **P7 清理与安全复核**：`cordis_stop` → 三处 UI 消失、无孤儿 DOM/样式/定时器；检查网络面板与日志无密钥；`settings.yaml` 无明文；再 run 可恢复；`cordis_undefine` 彻底移除（settings/凭据保留，作为已知行为记录）。
10. **P8 记录**：把原型结论（槽与 settings 契约实况、Builtins 可用性、卡片保存/凭据交互细节、定位方案、坑）追加到任务目录（`research.md` 或 PRD Technical Notes），作为常驻包任务的输入。

## 验证手段

- Web UI 观察 + 插件 Run 卡片状态（Host/Client 是否激活、有无报错）；无 CLI 断言。
- 数据比对：ollama.com/settings 的窗口百分比与模型请求数（或 providers「云端用量」卡片）应一致。
- 配置两态：未配置 → 无条目；保存配置+密钥 → 条目出现；清除密钥 → 条目消失（AC4）。
- 安全复核：DevTools 网络面板无 key（key 只在 Host 出站请求头）、日志无密钥、`~/.dsh/settings.yaml` 无明文。
- 内置回归：内置「会话统计 / Token 用量」可点开各自对话框；hero 鱼标/工作区/预设控件行为不变。

## 风险点与回滚

- 设置/凭据 API 与预期不符 → 回步骤 1 用 Inspect 核实后再写；不猜测。
- 卡片保存被 revision 拒绝 → 保留草稿并提示重试（与官方卡片语义一致）。
- 取数异常 → 保持 `none` 静默；先停插件再排查。
- 浮层影响输入框 → `cordis_stop` 后修定位/`pointer-events`。
- Package 不可变：出错用新 Package update，必要时 rollback。

## 完成前复查（对应 AC）

- AC1 卡片可用且即时生效；AC2 数值一致 + 内置不回归；AC3 hero 浮层行为；AC4 四类空态静默；AC5 面板齐备一致；AC6 无残留、可重启恢复；AC7 密钥不外泄、settings 无明文；AC8 刷新后配置仍在且可重新 run。
