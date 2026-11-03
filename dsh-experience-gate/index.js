/**
 * dsh-experience-gate —— 经验库窄闸门（骨架版）。
 *
 * 拦截点：ctx.tools.guard()。它是 tools/pre-execute 瀑布之后注册的单调守卫：
 * 返回字符串即拒绝该次调用，且后续监听器无法把拒绝翻回允许；放行必须严格返回 undefined。
 *
 * 形态依据（DSH 自带文档 cordis-plugin-development/references/）：
 *   · host-plugin.md（bundle 清单、patch、apply 导出形态）；
 *   · practices.md（「必须无视顺序成立的拒绝用 ctx.tools.guard()」）；
 *   · 工具流水线 tools/pre-execute → guards → tools/execute → tools/result 固定顺序。
 *
 * 状态采集（本插件仅有的两个观察点）：
 *   · tools/result（emit，(exec, result)）：成功的「检索调用」才置位；isError 不算——查错了不等于查过；
 *   · agent/pre-step（waterfall，(payload, next)）：新真人消息＝新一轮，状态清零。
 *
 * 骨架版口径：gateRoot、分卷、篇名出处、日志目录全部走 config；
 * gateRoot 留空＝libraryAlive 判「库不在」→ 整道闸自停用（全部放行），不会锁死系统。
 */
import { appendFileSync, existsSync, statSync } from 'node:fs';
import { createGuard } from './policy.js';

/** 只依赖 tools 服务；没装 tools 的环境里本插件不激活，而不是抛错。 */
export const inject = ['tools'];

/**
 * 审计日志：每次检索判定与每次拦截记一行，按天切份（xxx-YYYYMMDD.log），旧份一律不删。
 * logDir 留空＝不记日志（骨架版默认）。
 */
function datedLogPath(logDir, now = new Date()) {
  const dir = String(logDir ?? '').trim();
  if (dir === '') return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dir.replace(/[\\/]+$/, '')}\\experience-gate-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.log`;
}

function makeLogger(logDir) {
  const dir = String(logDir ?? '').trim();
  if (dir === '') return null;
  return (payload) => {
    const now = new Date();
    const stamp = now.toISOString();
    const line = `${stamp}\t${payload.kind}\t${payload.tool ?? ''}\t${payload.reason ?? payload.key ?? ''}\thits=${payload.hits ?? '-'}\tvols=${(payload.volumes ?? []).join(',') || '-'}\tpattern=${payload.pattern ?? '-'}\n`;
    try {
      appendFileSync(datedLogPath(dir, now), line, 'utf8');
    } catch {
      /* 记账失败不影响判定 */
    }
  };
}

/**
 * 库还在不在（断路器的证据源检查）。
 * 判「在」的标准：库根存在且是目录；requiredVolumes 非空时，还要求其中任一分卷目录存在。
 * 判错方向是安全的：真库在而判「不在」＝这一轮闸门放行（少拦一次），两头都不会锁死。
 */
export function libraryAlive(root, requiredVolumes = []) {
  try {
    if (typeof root !== 'string' || root.trim() === '') return false;
    if (!existsSync(root)) return false;
    if (!statSync(root).isDirectory()) return false;
    const vols = Array.isArray(requiredVolumes) ? requiredVolumes : [];
    if (vols.length === 0) return true;
    return vols.some((v) => {
      const p = `${root.replace(/[\\/]+$/, '')}\\${v}`;
      return existsSync(p) && statSync(p).isDirectory();
    });
  } catch {
    return false;
  }
}

export function apply(ctx, config) {
  const cfg = config ?? {};
  const onLog = makeLogger(cfg.logDir);
  const gate = createGuard({
    ...cfg,
    ...(onLog ? { onLog } : {}),
    libraryAlive: () => libraryAlive(cfg.gateRoot ?? '', cfg.requiredVolumes ?? []),
  });

  // 观察点一：工具调用结束。只有「真的检索了库且没报错」才置位本轮。
  ctx.on('tools/result', (exec, result) => {
    gate.noteResult(exec, result);
  });

  // 观察点二：新一轮开头清零。pre-step 是瀑布事件：必须把 next() 的返回值原样交回去。
  ctx.on('agent/pre-step', (payload, next) => {
    gate.notePreStep(payload);
    return next();
  });

  // ctx.effect 拥有这个注册：插件卸载 / HMR / profile 改动时自动撤销。
  ctx.effect(() => ctx.tools.guard(gate));
}
