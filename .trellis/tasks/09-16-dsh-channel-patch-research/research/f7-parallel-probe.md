# F7 实测：并行实例 + `--patch` 覆盖（2026-09-16）

> 由并行探针会话执行并记录；原始 boot log 见 `research/evidence/f7-narrow-boot.log`。

## 结论（一句话）

`connection` 行的 `inject` **必须**包含 `webServer`。把它还原成出厂值 `[webRuntime]` 后，同一实例里
三条第三方通道（`/trellis-statusline`、`/ollama-usage`、`/ollama-cloud`）**全部 404**，
两个有 try/catch 的插件各留一行 `RPC channel unavailable: cannot get property "webServer" without inject`；
出厂共享路由 `/api` 不受影响（仍 401）。

## 方法：为什么不重启

"覆盖是否必需"是**进程内 patch merge 的结果**问题 —— 只要有一个新进程按出厂窄值组装，就能观测，
不必动正在使用的那个实例（重启会杀掉 agent 自身）。

- `--patch <path>` 是"应用在 profile 层之后的额外 patch 叠加层"（顶层 YAML 数组），
  而 patch 是**按字段整块覆盖** → 用它把 `connection.inject` 写回 `[webRuntime]`；
  仓库文件、插件文件都不用改。
- **离线预验（不启动进程）**：`dsh --profile web --patch .scratch/f7-narrow.yml --dump-config`
  → `- id: connection` 显示 `inject: [webRuntime]`，同时 `- id: trellis-statusline` 行仍在
  （覆盖只动被写的字段）。

## 命令（完整可复现）

```bash
cd <repo>
cat > .scratch/f7-narrow.yml <<'EOF'
# F7 probe overlay: restate the shipped connection row's inject list.
- id: connection
  inject:
    - webRuntime
EOF

# 预验（无需启动）
dsh --profile web --patch .scratch/f7-narrow.yml --dump-config | grep -A4 'id: connection'

# 实验实例（不用 --port 0，固定端口便于 curl；--no-open 避免弹浏览器）
dsh --profile web --patch .scratch/f7-narrow.yml --no-open --port 8791 > .scratch/f7-narrow-boot.log 2>&1 &
for i in $(seq 1 60); do sleep 1
  c=$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:8791/no-such-route)
  [ "$c" != "000" ] && break
done
for p in /trellis-statusline /ollama-usage /ollama-cloud /api /no-such-route; do
  printf '%-22s %s\n' "$p" "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8791$p)"
done
cat .scratch/f7-narrow-boot.log
# 收尾（按端口 PID 杀，复查 000）
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8791 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
```

## 观测结果

| 路由 | 对照：活实例 3080（行= `[webRuntime, webServer]`） | 实验：新实例 8791（行= `[webRuntime]`） |
| --- | --- | --- |
| `/trellis-statusline` | 401 | **404** |
| `/ollama-usage` | 401 | **404** |
| `/ollama-cloud` | 401 | **404** |
| `/api`（出厂共享路由） | 401 | 401 |
| `/no-such-route`（无路由基准） | 404 | 404 |

`401` = 路由存在、被鉴权栅栏拦下；`404` = 路由不存在（回退处理器）。

boot log 原文（全 4 行）：

```
[opencode-session-id] mounted: providers=[opencode, opencode-go] ...
[ollama-usage] RPC channel unavailable: cannot get property "webServer" without inject
[trellis-statusline] RPC channel unavailable: cannot get property "webServer" without inject
dsh web: http://127.0.0.1:8791/?token=...
```

`dsh-llm-ollama` 的通道同样死了，但**一行日志都没有** —— 它没有 try/catch（比另外两个更彻底的静默）。

## 由此确认的机制

- route 注册用的那个 `owner` 是 **connection 行自己的 ctx**，不是"读服务那一方"的 ctx：
  两个插件都在自己行里声明了 `webServer`（`lib/index.js` 的 `export const inject`），
  窄化 connection 行后仍然抛同一个错 → **插件行自己的 `webServer` 声明对通道注册不起作用**。
- 于是"第三方插件能不能注册通道"这个变量，完全落在 **`connection` 那一行**上；
  这也解释了 F2 那个探针（当时行是宽的）为什么"自己读不到 webServer 却注册成功"。

## 更正（相对 `prd.md` 的旧记录）

| 旧记录 | 实测更正 |
| --- | --- |
| F6「25 个 `cordis.patch.yml` 里只有 1 个碰 `connection`」 | **47 个文件里 2 个**：`dsh-plugin-ollama-usage` 与 `dsh-plugin-trellis-statusline`，写的值**完全相同**（`[webRuntime, webServer]`） |
| F6「卸载本插件会让那一行退回 `[webRuntime]`」 | 只有**两个都卸载**才会退回；只卸载其一，另一方的 patch 仍写宽值 |
| F6「llm-ollama 的依赖未实测」 | 已实测：窄值下 404，且无日志 |

## 局限

- 只验证了**通道层**（HTTP 状态码 + boot 日志），未做浏览器目视。但 pill 依赖该通道，通道死则 pill 必然不显示。
- 并行实例与在用实例共享 `~/.dsh` 存储（会话目录、settings 等），本次共存约 10 秒；实例已杀（`/api` 复查 000）。
- 结论只覆盖"当前这一版 loader 的 merge 语义"；语义改变时需要重跑。
