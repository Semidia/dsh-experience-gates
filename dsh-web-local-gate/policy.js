/**
 * dsh-web-local-gate · 策略核（骨架版；纯函数：不 import 任何宿主/框架/node 内置模块，node 直跑）
 *
 * 口径：web_search / web_fetch 一律拒（总开关 enabled 默认开）；拒绝文案给可执行一步
 * （curl 直连优先，不通挂配置里的代理）＋两篇自定义出处（proxyDoc / errDoc）＋固化脚本（scriptPath）。
 *
 * 骨架版口径：gateRoot / proxyDoc / errDoc / scriptPath / proxyUrl / logDir 全走 config；
 * 出处与脚本留空＝文案相应行不展示（只剩通用兜底），代理留空＝提示去配置里填。
 *
 * 「本轮」状态按代理分桶：agentKeyOf / bucketOf / state.agents 三件套；
 * 轮推进口径：真人消息（source.rpcId 非空）开新轮清全部桶；带代理号的工单事件只清它自己的桶；
 * 无代理号的工单事件不清桶、不写状态——防止别代理的计数被无辜清掉。
 *
 * 同轮同一代理第 2 次起给短文案：口径讲一次就够，别刷屏；新真人消息开新轮后重新给全。
 *
 * 两条硬规矩：
 *   · 放行必须严格返回 undefined（守卫只有拒/放两态，不造 allow-note）；
 *   · guard 是同步函数：不跑检索、不等用户、不改写工具参数。
 */

/** 默认要拦的工具：DSH 官方联网工具就这两个。 */
export const DEFAULT_TOOLS = ['web_search', 'web_fetch'];

/** 配置默认值：骨架版全部留空＝未配置（文案走通用兜底）。 */
export const DEFAULT_GATE_ROOT = '';
export const DEFAULT_PROXY_DOC = '';
export const DEFAULT_ERR_DOC = '';
export const DEFAULT_SCRIPT_PATH = '';
export const DEFAULT_PROXY_URL = '';
export const DEFAULT_LOG_DIR = '';

/** 配置归一。enabled 默认开（总开关默认拦）。 */
export function normalizeConfig(config = {}) {
  const raw = config ?? {};
  const str = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback);
  const tools = Array.isArray(raw.tools) && raw.tools.length > 0 ? raw.tools.map(String) : [...DEFAULT_TOOLS];
  return {
    enabled: raw.enabled !== false,
    tools,
    gateRoot: str(raw.gateRoot, DEFAULT_GATE_ROOT),
    proxyDoc: str(raw.proxyDoc, DEFAULT_PROXY_DOC),
    errDoc: str(raw.errDoc, DEFAULT_ERR_DOC),
    scriptPath: str(raw.scriptPath, DEFAULT_SCRIPT_PATH),
    proxyUrl: str(raw.proxyUrl, DEFAULT_PROXY_URL),
    logDir: str(raw.logDir, DEFAULT_LOG_DIR),
  };
}

/** 出处一行的展示：配置了库根＋篇名才拼路径；只配篇名就裸给篇名；都没配返回空。 */
function docLine(cfg, rel) {
  if (rel === '') return '';
  if (cfg.gateRoot !== '') return `${cfg.gateRoot.replace(/[\\/]+$/, '')}\\${rel}`;
  return rel;
}

/** 判定一次调用拦不拦（纯函数）。key：disabled / tool-not-listed / web-local。 */
export function evaluateWeb({ toolName = '', enabled = true, tools = DEFAULT_TOOLS } = {}) {
  if (!enabled) return { blocked: false, key: 'disabled', toolName };
  if (!tools.includes(String(toolName))) return { blocked: false, key: 'tool-not-listed', toolName };
  return { blocked: true, key: 'web-local', toolName };
}

/** 代理那半句：配了给可照抄的命令，没配提示去配置里填。 */
function proxyPart(cfg) {
  if (cfg.proxyUrl !== '') return `直连不通再挂代理 \`curl -sL -x ${cfg.proxyUrl} "<URL>"\``;
  return '直连不通再挂代理（代理地址写在配置 proxyUrl）';
}

/** 全文案（本轮该代理第 1 次）：可执行一步＋固化脚本（可选）＋两篇出处（可选）＋关闸方法。 */
export function reasonText({ toolName = '', config = {} } = {}) {
  const cfg = normalizeConfig(config);
  const lines = [
    `本机网络闸门：「${toolName}」已拦下——按本机口径，网页搜索与网页抓取一律走本机网络，不用 DSH 官方联网工具。`,
    `可执行的一步：改用 curl 抓取——先试直连 \`curl -sL "<URL>"\`；${proxyPart(cfg)}；取回 HTML 后自己提取正文。`,
  ];
  if (cfg.scriptPath !== '') {
    lines.push(`现成脚本：pwsh -File ${cfg.scriptPath}（走配置里的代理；加 -NoProxy 直连；-OutFile 存原始 HTML）。`);
  }
  const d1 = docLine(cfg, cfg.proxyDoc);
  const d2 = docLine(cfg, cfg.errDoc);
  if (d1 !== '' && d2 !== '') {
    lines.push(
      '先读这两篇再动手：',
      `  1) ${d1} —— 你的本机网络口径篇（为什么不用官方联网工具、怎么用 curl 走代理）`,
      `  2) ${d2} —— 公网地址打不开先分诊本机代理（代理层报错别误判服务端）`,
    );
  } else if (d1 !== '' || d2 !== '') {
    lines.push(`先读这篇再动手：${d1 !== '' ? d1 : d2}`);
  } else {
    lines.push('（两篇网络口径出处未配置：在 config.proxyDoc / config.errDoc 里指到你的笔记）');
  }
  lines.push('要关掉这道闸：配置总开关 enabled: false（默认开；改 cordis.patch.yml 后重载 bundle）。');
  return lines.join('\n');
}

/** 同轮重复撞门的短文案：口径只给一句可执行路，不重复展开出处。 */
export function shortReasonText({ toolName = '', denyCount = 2, config = {} } = {}) {
  const cfg = normalizeConfig(config);
  const doc = docLine(cfg, cfg.proxyDoc);
  const tail = doc !== '' ? `；出处 ${doc}` : '';
  return `本机网络闸门（本轮第 ${denyCount} 次拦）：「${toolName}」仍要停用——口径不变：curl 直连优先，${proxyPart(cfg)}${tail}。`;
}

/** 外壳：把纯函数策略核包成 ctx.tools.guard() 要的同步守卫。 */
export function createGuard(config = {}) {
  const settings = normalizeConfig(config);

  // 顶层字段＝「无代理标识」的默认桶（老调用形状行为不变）；带标识的各用各的桶。
  // 注意：全局审计计数（totalDenies）与桶内「本轮第几次」（turnDenies）是两个字段——
  // 顶层桶就是 state 本体，若共用一个字段，第一次撞门会被双重自加成 2、误判短文案。
  const state = {
    totalDenies: 0, // 全局拒绝计数（审计用，跨桶累计）
    turnKey: null,  // 最近见过的「轮」记号（最后一条 user 消息的 key）
    ownKey: null,   // 顶层默认桶自己的「已判过」记号
    turnDenies: 0,  // 顶层默认桶的「本轮第几次」
    agents: new Map(),
  };

  /** 这次调用/事件属于哪个代理：exec 与 pre-step payload 都认 agent.id（或 agentId / session.agentId）。 */
  const agentKeyOf = (x) => String(x?.agent?.id ?? x?.agentId ?? x?.session?.agentId ?? '').trim();
  /** 无代理标识 → 顶层默认桶；有标识 → 该代理自己的桶。 */
  const bucketOf = (x) => {
    const k = agentKeyOf(x);
    if (k === '') return state;
    let b = state.agents.get(k);
    if (b === undefined) {
      b = { ownKey: null, turnDenies: 0 };
      state.agents.set(k, b);
    }
    return b;
  };

  /** 新真人消息＝所有人开新轮：全部桶的「本轮」状态清零（断路器语义同源）。 */
  function resetTurn() {
    state.totalDenies = 0;
    state.turnDenies = 0;
    for (const b of state.agents.values()) {
      b.ownKey = null;
      b.turnDenies = 0;
    }
  }

  /**
   * 观察 agent/pre-step：按「最近一条 kind:'user' 的 user 消息」推进轮：
   *   · 真人消息（source.rpcId 非空，哪怕带不出代理号）→ resetTurn 清全部桶；
   *   · 工单/注入类消息（无 rpcId）→ 带得出代理 id 才清它自己的桶；
   *   · 无代理号的工单事件 → 什么都不清、不写状态（防止清掉别人已取得的计数与放行权）。
   */
  function notePreStep(payload) {
    const messages = Array.isArray(payload?.messages) ? payload.messages : null;
    if (messages === null) return false;
    let human = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message || message.role !== 'user') continue;
      if (message?.source?.kind !== 'user') continue;
      human = message;
      break;
    }
    if (human === null) return false;
    const agentKey = agentKeyOf(payload);
    const humanId = String(human.id ?? '');
    const key = agentKey === '' ? humanId : `${agentKey}::${humanId}`;
    if (key === '') return false;
    const bucket = bucketOf(payload);
    if (key === state.turnKey || key === bucket.ownKey) return false; // 自己那轮已判过就不重判
    state.turnKey = key;
    bucket.ownKey = key;
    const isRealHuman = typeof human?.source?.rpcId === 'string' && human.source.rpcId !== '';
    if (isRealHuman) {
      resetTurn();
    } else if (agentKey !== '') {
      bucket.turnDenies = 0; // 工单事件只清「这个代理自己」的桶
    }
    return true;
  }

  /** ctx.tools.guard() 要的形状：返回字符串＝拒绝，返回 undefined＝放行。 */
  function guard(exec) {
    const verdict = evaluateWeb({
      toolName: String(exec?.name ?? ''),
      enabled: settings.enabled,
      tools: settings.tools,
    });
    if (!verdict.blocked) return undefined;
    const bucket = bucketOf(exec);
    state.totalDenies += 1;   // 审计计数：只进账，不参与判定
    bucket.turnDenies += 1;   // 轮内计数：决定全文案还是短文案
    return bucket.turnDenies === 1
      ? reasonText({ toolName: verdict.toolName, config: settings })
      : shortReasonText({ toolName: verdict.toolName, denyCount: bucket.turnDenies, config: settings });
  }

  guard.notePreStep = notePreStep;
  guard.reset = resetTurn;
  guard.snapshot = () => ({
    totalDenies: state.totalDenies,
    turnKey: state.turnKey,
    agentCount: state.agents.size,
    enabled: settings.enabled,
    tools: [...settings.tools],
    gateRoot: settings.gateRoot,
    proxyDoc: settings.proxyDoc,
    errDoc: settings.errDoc,
    scriptPath: settings.scriptPath,
    proxyUrl: settings.proxyUrl,
    logDir: settings.logDir,
  });
  return guard;
}
