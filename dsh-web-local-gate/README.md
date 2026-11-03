# dsh-web-local-gate —— 本机网络口径硬闸（骨架版）

一句话：`web_search`／`web_fetch` 一律拒（本机口径：网页搜索与网页抓取一律走本机网络），拒绝文案给**可执行的一步**（curl 直连优先，不通挂配置里的代理）与两篇自定义出处篇名。总开关 `enabled` 默认开；`enabled: false` 时两个工具都放行、且不注册任何守卫。

## 形态与分桶

- 拦截点 `ctx.tools.guard()`：返回字符串＝拒绝，放行严格返回 `undefined`。
- 「本轮」状态按代理分桶：`agentKeyOf`／`bucketOf`／`state.agents` 三件套。
- 轮推进口径：真人消息（source.rpcId 非空，哪怕无代理号）开新轮清全部桶；无代理号的工单事件**不清桶、不写状态**。
- 同轮同一代理第 2 次撞门给短文案（防刷屏）；新真人消息开新轮后重新给全文案。
- 审计日志：每次拒绝记一行 `web-local-gate-YYYYMMDD.log`（按天切份，旧份不删）；`logDir` 留空＝不记。

## 装法（三步）

1. **复制**：把本文件夹复制到你的 `~/.dsh/local-plugins/dsh-web-local-gate/`；
2. **建链接**：在 `~/.dsh/profiles/desktop/node_modules/@local/` 下建 Junction 指向 `local-plugins\dsh-web-local-gate`（管理员命令行：`mklink /J`）；
3. **登记**：`profiles\desktop\package.json` 两处——`dependencies` 加 `"@local/dsh-web-local-gate": "link:../../local-plugins/dsh-web-local-gate"`，`dsh.profile.bundles` 数组加 `"@local/dsh-web-local-gate"`，然后重启 DSH。

## 配置项表（cordis.patch.yml 的 config）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `tools` | `web_search`、`web_fetch` | 要拦的工具清单 |
| `gateRoot` | `''` | 你的库根；出处路径拼它；空＝出处只裸给篇名 |
| `proxyDoc` | `''` | 出处一：本机网络口径篇（相对 `gateRoot`）；空＝这条出处不展示 |
| `errDoc` | `''` | 出处二：代理报错先查本机代理的排查篇；空＝不展示 |
| `scriptPath` | `''` | 固化抓取脚本绝对路径；空＝文案不提脚本 |
| `proxyUrl` | `''` | 备用代理地址（如 `http://127.0.0.1:端口`）；空＝文案提示去配置里填 |
| `logDir` | `''` | 审计日志目录；空＝不记 |

## 与原版的差别（一句话）

原版把库根、两篇出处篇名、固化脚本路径、代理端口、日志目录全部写死成本机值；骨架版全部改为 config 配置项，默认留空＝文案只剩通用兜底，按上表填上即与本机版同效。

## 自检

```
node --check index.js
node --check policy.js
node test.mjs
```

测试为骨架版口径新写（不依赖任何本机路径）：两个工具各拦一次、文案带可执行一步与配置化出处、总开关关掉放行、短文案与分桶互不污染、轮口径三条、以及「源码内零本机特征」自扫。期望输出末行 `ALL_PASS`。
