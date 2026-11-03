# dsh-experience-gate —— 经验库窄闸门（骨架版）

一句话：本轮没**有效查过库**就不许动「会改东西」的工具（write/edit/pwsh/bash/terminal_send/subagent/run_code）；读、搜、列目录一律不拦——窄闸门，不是全闸门。拦截点 `ctx.tools.guard()`：返回字符串＝拒绝，放行严格返回 `undefined`。

## 四道子闸

| 子闸 | 拦什么 | 开关（config） |
|---|---|---|
| 主闸 no-search | 写东西前这一轮必须先真查过库：命中要落在配置的分卷里；0 命中时检索词要与这条消息有共同词；超过行数上限判「太泛」＝无效并收回放行权 | `enabled` / `gateRoot` |
| 派活闸 | 开新的一路（subagent 类）之前必须先读过「派活那篇」；给已有同事发消息不挡 | `requireDispatchDoc` / `dispatchDoc` |
| 沉淀闸 | 消息提到沉淀/偏好/习惯/规则时，写**库里**的文件前先读「沉淀清单」那篇 | `requireSettleDoc` / `settleDoc` |
| 长活反馈 | 同轮第 2 笔超阈值命令起，对下一笔命令类调用拦一次（带实测秒数），拦完自动放开防锁死 | `longTaskGate.enabled` / `longTaskGate.thresholdSeconds` |

两条硬规矩：检索调用本身**无条件放行**（否则闸门把自己要的检索也拦住，死锁）；断路器保底——库不在（含 `gateRoot` 未配置）＝整道闸自停用全部放行，同一代理连拦 2 次也自动放开，绝不锁死系统。

## 装法（三步）

1. **复制**：把本文件夹复制到你的 `~/.dsh/local-plugins/dsh-experience-gate/`；
2. **建链接**：在 `~/.dsh/profiles/desktop/node_modules/@local/` 下建 Junction 指向 `local-plugins\dsh-experience-gate`（管理员命令行：`mklink /J`）;
3. **登记**：`profiles\desktop\package.json` 两处——`dependencies` 加 `"@local/dsh-experience-gate": "link:../../local-plugins/dsh-experience-gate"`，`dsh.profile.bundles` 数组加 `"@local/dsh-experience-gate"`，然后重启 DSH。

## 配置项表（cordis.patch.yml 的 config）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `tools` | 写类七个 | 要拦的工具清单 |
| `gateRoot` | `''` | **必配**。库根；留空＝整道闸自停用（全部放行） |
| `volumes` | `[]` | 命中只认这些分卷目录；空＝命中落在库根下即算（宽口径） |
| `requiredVolumes` | `[]` | 「库还在不在」自检目录；空＝只查库根本身存在 |
| `maxHits` | `120` | 命中行数上限；超过判「太泛」＝无效 |
| `excludeFiles` | `['README.md']` | 命中这些文件名不算「查过」 |
| `requireDispatchDoc` / `dispatchTools` / `dispatchDoc` | `true` / subagent 三个 / `''` | 派活闸开关 / 盯的工具 / 必读篇名（相对 `gateRoot`）；**篇名留空＝子闸不生效** |
| `requireSettleDoc` / `settleDoc` | `true` / `''` | 沉淀闸开关 / 必读篇名；**篇名留空＝子闸不生效** |
| `longTaskGate.enabled` / `longTaskGate.thresholdSeconds` | `true` / `30` | 长活反馈开关 / 阈值秒数（按实测秒数判） |
| `longTaskDoc` | `''` | 长活文案出处篇名；空＝不带出处路径 |
| `logDir` | `''` | 审计日志目录（按天切份，旧份不删）；空＝不记 |

## 与原版的差别（一句话）

原版把库根、分卷、必读篇名、日志目录全部写死成本机值；骨架版全部改为 config 配置项，默认留空＝对应功能自停用（绝不锁死系统），按上表填上即与本机版同效。

## 自检

```
node --check index.js
node --check policy.js
node test.mjs
```

测试为骨架版口径新写（临时目录当假库，不碰任何本机路径）：主闸红绿（拦/放/检索放行）、相关性兜底、太泛收回、排除件不算、断路器、派活闸、沉淀闸、长活反馈（假钟计时）、分桶与轮口径、以及「源码内零本机特征」自扫。期望输出末行 `ALL_PASS`。
