# dsh-experience-context —— 经验库检索卡注入（骨架版）

一句话：每条用户消息的**第一步**，往上下文里自动塞一张「经验库检索卡」，告诉模型「经验库在哪、怎么搜、查完要报什么」；再按配置追加提醒卡。**只提醒，不拦。**

## 卡一览（全部可单独开关）

| 卡 | 什么时候递 | 开关（config） |
|---|---|---|
| 经验库检索卡 | 每条用户消息第一步，一轮一张 | `enabled` |
| 回话格式卡 | 每轮都带，无词判断 | `replyFormatCard` |
| 看图卡 | 带图附件／文字含图字／本轮用过看图工具 | `imageCard` |
| 先找现成方案卡 | 消息是可行性问句（只能…吗／行不行…？） | `solutionCard` |
| 沉淀卡 | 消息提到沉淀／偏好／习惯／规则（窄口） | `settleCard` |
| 收尾自检卡 | 消息命中收尾形状（收尾/收工/还有什么要做的…） | `wrapupCard` |
| 追因卡 | 消息命中追因形状（怎么办/为什么不行/给个方案…） | `causeCard` |
| 回复体检 | 上一条助手回复命中排期话／自设预算时贴提醒 | `lint` |

检索卡里常驻一行「长活先派」：预计超 30 秒或超 50 条/50 个文件的活先派同事再做。

## 装法（三步）

1. **复制**：把本文件夹复制到你的 `~/.dsh/local-plugins/dsh-experience-context/`；
2. **建链接**：在 `~/.dsh/profiles/desktop/node_modules/@local/` 下给每个插件建一个 Junction 指向 `local-plugins\<同名>`（管理员命令行：`mklink /J "<...>\node_modules\@local\dsh-experience-context" "<...>\local-plugins\dsh-experience-context"`）；
3. **登记**：`profiles\desktop\package.json` 两处——`dependencies` 加 `"@local/dsh-experience-context": "link:../../local-plugins/dsh-experience-context"`，`dsh.profile.bundles` 数组加 `"@local/dsh-experience-context"`，然后重启 DSH。

## 配置项表（cordis.patch.yml 的 config）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；`false`＝整个插件不挂 |
| `libraryRoot` | `''` | **必配**。经验/规则库根目录；检索卡命令示例与各卡出处都拼它；空＝卡上显示占位提示 |
| `volumes` | `[]` | 库内分卷名列表；检索卡列一行「分卷（N 个）」；空＝不列 |
| `rgPath` | `''` | rg 可执行文件路径；空＝用 PATH 上的 rg，没有 rg 退回 PowerShell 检索 |
| `autoSearch` | `false` | 发卡前自动检索并把命中文件路径带进卡（每轮多几百 token） |
| `autoSearchMaxHits` | `5` | 自动检索最多带几条命中 |
| `autoSearchTimeoutMs` | `4000` | 自动检索单次超时；超时当没搜到 |
| `autoSearchKeywordsMax` | `6` | 从用户消息最多取几个关键词 |
| `lint` | `true` | 回复体检开关 |
| `lintLog` | `''` | 体检日志文件（按天切份）；空＝不记 |
| `lintDebug` | `false` | 体检诊断行；定位用，用完关 |
| `settleCard` / `settleDocRel` | `true` / `''` | 沉淀卡开关 / 出处篇名（相对 `libraryRoot`） |
| `replyFormatCard` / `replyFormatDocRel` | `true` / `''` | 回话格式卡开关 / 细则正本 |
| `imageCard` / `imageDocRel` | `true` / `''` | 看图卡开关 / 看图办法篇 |
| `solutionCard` / `solutionDocRel` | `true` / `''` | 方案卡开关 / 「答能不能先查三层」细则篇 |
| `networkDocRel` | `''` | 方案卡第③条的本机网络口径篇 |
| `proxyUrl` | `''` | 联网备用代理地址（如 `http://127.0.0.1:端口`）；空＝文案提示去配置里填 |
| `wrapupCard` / `wrapupDocRel` / `wrapupTempDocRel` / `wrapupOrderDoc` | `true` / `''` ×3 | 收尾卡开关 / ①②③桶出处 / ④桶出处 / ⑤桶出处（绝对路径） |
| `causeCard` / `causeBirthDocRel` / `causeDisciplineDocRel` / `causeRootfixDocRel` / `causeMetaDocRel` | `true` / `''` ×4 | 追因卡开关 / 三问正本 / 倒推三层篇 / 治标挂根治点篇 / 前提探针篇 |
| `longTaskDocRel` | `''` | 「长活先派」常驻行的出处篇名 |

出处类键（`*DocRel`）填**相对 `libraryRoot` 的路径**，也可以填绝对路径（盘符／斜杠开头原样用）。**留空＝该处只出通用文案、不带任何路径**——这是骨架版与原版的核心差别。

## 与原版的差别（一句话）

原版把库根、分卷、篇名出处、代理端口、日志路径全部写死成本机值；骨架版全部改为 config 配置项，默认留空＝通用兜底文案，按上表填上即与本机版同效。

## 自检

```
node --check index.js
node test.mjs
```

测试为骨架版口径新写（不依赖任何本机路径）：卡片渲染、触发形状正反例、注入去重、字数预算、回复体检、以及「源码内零本机特征」自扫。期望输出末行 `ALL_PASS`。
