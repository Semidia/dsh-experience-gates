/**
 * dsh-web-local-gate —— 本机网络口径硬闸（骨架版）。
 *
 * 口径：网页搜索与网页抓取一律走本机网络，不用 DSH 官方联网工具（web_search / web_fetch）。
 *   · 总开关 enabled 默认开；false ＝ 两个工具都放行、且不注册任何守卫；
 *   · 拒绝文案给可执行一步（curl 直连优先，不通挂配置里的代理 proxyUrl）＋两篇自定义出处；
 *   · 出处篇名、固化脚本路径、代理地址、日志目录全部走 config（骨架版口径），见同目录 README.md。
 *
 * 形态依据（DSH 自带文档 cordis-plugin-development/references/）：
 *   · 拦截点 ctx.tools.guard()——返回字符串即拒绝，后续监听器无法把拒绝翻回允许；
 *     放行必须严格返回 undefined。
 *   · 「本轮」状态按代理分桶（agentKeyOf / bucketOf / state.agents 三件套）；
 *     轮推进口径：真人消息（source.rpcId 非空，哪怕带不出代理号）开新轮清全部桶；
 *     无代理号的工单事件不清桶、不写状态。
 *   · 同轮同一代理第 2 次起给短文案：口径讲一次就够，别刷屏；新真人消息开新轮后重新给全。
 */
import { appendFileSync } from 'node:fs';
import { createGuard } from './policy.js';

/** 只依赖 tools 服务；没装 tools 的环境里本插件不激活，而不是抛错。 */
export const inject = ['tools'];

/** 审计日志：每次拒绝记一行，按天切一份，旧份不删。logDir 留空＝不记。 */
function datedLogPath(logDir, now = new Date()) {
  const dir = String(logDir ?? '').trim();
  if (dir === '') return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dir.replace(/[\\/]+$/, '')}\\web-local-gate-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.log`;
}

export function apply(ctx, config) {
  // 总开关：关掉就不注册任何守卫，等于没装。
  if ((config ?? {}).enabled === false) return;

  const logDir = String((config ?? {}).logDir ?? '').trim();
  const gate = createGuard({ ...(config ?? {}) });

  // 观察点：新一轮开头清「本轮」状态（真人消息开新轮；工单事件不清桶——见 policy.js）。
  // agent/pre-step 是瀑布事件：必须把 next() 的返回值原样交回去。
  ctx.on('agent/pre-step', (payload, next) => {
    gate.notePreStep(payload);
    return next();
  });

  // ctx.effect 拥有这个注册：插件卸载 / HMR / profile 改动时自动撤销。
  // wrapper 透传 snapshot/reset（审计与自检直接可用），拒绝时记账一行、记账失败不影响拦截。
  const wrapped = (exec) => {
    const verdict = gate(exec);
    if (typeof verdict === 'string' && logDir !== '') {
      try {
        const raw = String(exec?.arguments?.query ?? exec?.arguments?.url ?? '')
          .replace(/\s+/g, ' ').slice(0, 160);
        appendFileSync(
          datedLogPath(logDir),
          `${new Date().toISOString()}\tdeny\t${String(exec?.name ?? '')}\t${raw}\t${verdict.split('\n')[0]}\n`,
          'utf8',
        );
      } catch { /* 记账失败不影响拦截 */ }
    }
    return verdict;
  };
  wrapped.snapshot = gate.snapshot;
  wrapped.reset = gate.reset;
  ctx.effect(() => ctx.tools.guard(wrapped));
}
