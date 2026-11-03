# dsh-experience-gates · 骨架版（三只 DSH 本机插件·去个人信息发布版）

这是三只 DSH（DeepSeek Harness）Cordis 宿主插件的**骨架版**：从个人机上在用的版本抽掉所有本机路径、私有篇名出处、代理端口等机器特征，全部改成 config 配置项；默认值为空＝通用兜底文案。装好、按各自 README 的配置表填上，就与原版同效。

| 插件 | 干什么 | 拦还是递 |
|---|---|---|
| `dsh-experience-context` | 每条用户消息第一步注入「经验库检索卡」，可追加回话格式／看图／先找现成方案／沉淀／收尾自检／追因六张提醒卡与回复体检 | 只递不拦 |
| `dsh-experience-gate` | 经验库窄闸门：写东西前这一轮必须先真查过库；派活闸、沉淀闸、长活计时反馈 | 硬拦（带断路器） |
| `dsh-web-local-gate` | 本机网络口径硬闸：官方联网工具一律拒，文案给 curl＋可配置代理的可执行一步 | 硬拦 |

## 与原版的差别（一句话）

原版把库根、分卷、篇名出处、代理端口、脚本与日志路径全部写死在一台机器上；骨架版把这些全部抽成 config 配置项（见各插件 README 的配置表），默认留空＝通用兜底文案、对应功能自停用，**绝不锁死系统**。

## 装法（每只插件三步）

1. **复制**：把插件文件夹复制到你的 `~/.dsh/local-plugins/<插件名>/`；
2. **建链接**：在 `~/.dsh/profiles/desktop/node_modules/@local/` 下给每个插件建一个 Junction 指向 `local-plugins\<同名>`（管理员命令行：`mklink /J "<...>\node_modules\@local\<插件名>" "<...>\local-plugins\<插件名>"`）；
3. **登记**：`profiles\desktop\package.json` 两处——`dependencies` 加 `"@local/<插件名>": "link:../../local-plugins/<插件名>"`，`dsh.profile.bundles` 数组加 `"@local/<插件名>"`，然后重启 DSH。

只改插件源码要重启才生效；只改 `cordis.patch.yml` 里的 config，重载 bundle 即可。想临时关掉哪只：对应 `cordis.patch.yml` 里 `enabled: false`。

## 必配清单（其余键见各插件 README 配置表）

| 插件 | 必配 | 不配的后果 |
|---|---|---|
| `dsh-experience-context` | `libraryRoot`（库根） | 卡片照发，但命令示例与出处是占位提示 |
| `dsh-experience-gate` | `gateRoot`（库根） | 整道闸自停用（全部放行），绝不误拦 |
| `dsh-web-local-gate` | 无硬性必配；建议填 `proxyDoc`/`errDoc`/`proxyUrl` | 文案只剩「curl 直连优先＋去配置里填代理」 |

## 自检

```
node --check <各插件>/index.js <各插件>/policy.js
node <各插件>/test.mjs        # 末行 ALL_PASS 即全绿
```

三套测试均为骨架版口径：不依赖任何本机路径（假库用临时目录），并各自带一组「源码内零本机特征」自扫。

## 痕迹自检（发布前照做）

骨架版验收判据：对整个目录按特征清单复扫，**零命中**。特征清单（不区分大小写）共十项：来源库目录名、盘符路径形状、内网地址、本机代理端口、机器用户名、会话用户名、本机临时目录名、私有篇名样例三条。清单正本随交付单走——本 README 刻意不落这些串：落了任何一处，复扫就永远不绿。

复扫命令（任一装了 rg 的环境；把 <特征> 逐项换成清单里的串）：

```
rg -i --hidden --no-ignore --count-matches -g '!**/.git/**' -e "<特征>" .
```

每个特征都应报「文件=0 处=0」；源码里出现盘符形状（连测试里的占位根也不许带盘符）一律算红。

## 备注

- 追因卡（「怎么办／为什么不行／给个方案」时递「三问递进」卡）为三卡批次后的第七张注入卡，骨架版已一并带上，出处篇名走 `causeCard` 相关四个配置键。
- 本仓只依赖 node 内置模块，无 npm 依赖、无构建步骤；仓库仅本地存在，是否发布、发布到哪由发布方决定。
