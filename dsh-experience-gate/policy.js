/**
 * 经验库窄闸门 · 策略核（骨架版；纯函数：不 import 任何宿主/框架/node 内置模块，node 直跑）
 *
 * 四道子闸：
 *   ① 主闸（no-search）：本轮没「有效查过库」就不许动 write/edit/pwsh/bash/terminal_send/subagent/run_code。
 *      「有效」的判据：命中落在配置的分卷目录里（未配分卷＝落在库根下即可）；
 *      命中 0 条时检索词必须与这条真人消息有共同词；命中行数超上限判「太泛」＝无效并收回放行权。
 *   ② 派活闸：开新的一路（subagent 类）之前必须先读过「派活那篇」（config.dispatchDoc）。
 *   ③ 沉淀闸：消息提到沉淀/偏好/习惯/规则时，写库前必须先读过「沉淀清单」那篇（config.settleDoc）。
 *   ④ 长活反馈：同轮第 2 笔超阈值的命令类调用起，对下一笔命令类调用拦一次，拦完自动放开。
 *
 * 两条硬规矩：
 *   · 检索调用本身无条件放行（否则闸门把自己要的检索也拦住，死锁）；
 *   · 放行必须严格返回 undefined（守卫只有拒/放两态，不造 allow-note）。
 *
 * 骨架版口径：
 *   · gateRoot / volumes / dispatchDoc / settleDoc / longTaskDoc / excludeFiles 全走 config；
 *   · gateRoot 为空 ＝ 库未配置 → 断路器判「库不在」→ 整道闸自停用（全部放行），不锁死系统；
 *   · dispatchDoc / settleDoc 为空 ＝ 对应子闸不生效（键值 dispatch-doc-unset / settle-doc-unset）；
 *   · 「本轮」状态按代理分桶（agentKeyOf / bucketOf / state.agents 三件套）：
 *     真人消息（source.rpcId 非空）＝所有人开新轮清全部桶；带代理号的工单事件只清它自己的桶；
 *     无代理号的工单事件不清桶、不写状态——防止别代理的放行权被无辜清掉。
 *
 * 已知限制（写在这里，别指望它超出这条线）：
 *   · guard 是同步函数：不能在里面跑检索、不能等用户、不能改写工具参数；
 *   · 只判得动「可程序化」的几样（命中位置、关键词是否相关、结果是否报错）；
 *     真查假查的语义判断靠事后审计日志＋回话点名命中文件；
 *   · 把「写库」和「有效检索」混在同一段命令里仍可能绕过；run_code 放行一次后本轮一直放行。
 */

/** 默认库根：骨架版留空＝未配置（整道闸自停用）。部署时在 cordis.patch.yml 里填。 */
export const DEFAULT_GATE_ROOT = '';

/** 默认要拦的工具：只列「会改东西」的。读、搜、列目录不在里面。 */
export const DEFAULT_TOOLS = ['write', 'edit', 'pwsh', 'bash', 'terminal_send', 'subagent', 'run_code'];

/** 参数里带「一段会被执行/输入的文本」的工具（检索词抽取只管这些）。 */
export const TEXT_TOOLS = ['pwsh', 'bash', 'terminal_send'];

/** 检索关键字：四选一，出现一个就算在检索。 */
export const SEARCH_KEYWORD = /(?:\brg\b|Select-String|findstr|\bgrep\b)/i;

/** 放行一次就放行到底的工具（内部连写不再逐条拦）。 */
export const LATCH_TOOL = 'run_code';

/** 派活闸默认盯的工具：只挡「开新的一路」；给已有同事发消息不挡。 */
export const DEFAULT_DISPATCH_TOOLS = ['subagent', 'subagent_fork', 'spawn_teammate'];

/** 派活闸必读篇名（相对 gateRoot）：骨架版留空＝子闸不生效。 */
export const DEFAULT_DISPATCH_DOC = '';

/** 沉淀闸触发：窄口关键词；日常聊「规则」两个字不触发。 */
export const SETTLE_KEYWORD = /沉淀|记住|偏好|习惯|规则本|进规则|成规则|升格|写成规则/;

/** 沉淀闸必读篇名（相对 gateRoot）：骨架版留空＝子闸不生效。 */
export const DEFAULT_SETTLE_DOC = '';

/** 长活反馈出处篇名（相对 gateRoot）：留空＝拒绝文案不带出处路径。 */
export const DEFAULT_LONG_TASK_DOC = '';

/** 长活阈值（秒）：按实测秒数判，不按词拦。 */
export const DEFAULT_LONG_TASK_SECONDS = 30;

/** 起拦笔数：同一轮第 2 笔长活起，才对下一笔命令类调用拦一次。 */
export const LONG_TASK_MIN_COUNT = 2;

/** 命中这些文件名不算「查过」：根目录说明类，谁都能一搜就中。 */
export const DEFAULT_EXCLUDE_FILES = ['README.md'];

/** 一次检索命中最多算这么多行，超过判「太泛」＝无效（同时收回本轮放行权）。 */
export const DEFAULT_MAX_HITS = 120;

/** 断路器：同一轮连续被拦到第 2 次就整轮放开（防「库被删/盘没挂」把系统锁死）。 */
export const DEFAULT_MAX_DENY_STREAK = 2;

/** 命令类＝TEXT_TOOLS：只有「跑命令」的才计时计笔。 */
export function isLongTaskTool(toolName = '') {
  return TEXT_TOOLS.includes(String(toolName));
}

/** 纯函数：这一笔算不算长活（超阈值才算；isError 在外壳层已剔掉）。 */
export function judgeLongTask({ toolName = '', seconds = 0, thresholdSeconds = DEFAULT_LONG_TASK_SECONDS } = {}) {
  const sec = Number(seconds);
  const over = isLongTaskTool(toolName) && Number.isFinite(sec) && sec > Number(thresholdSeconds);
  return { over, seconds: Number.isFinite(sec) ? sec : 0 };
}

/** 长活拦截文案（N＝实测秒数，X＝本轮长活笔数；doc 留空不带出处路径）。 */
export function longTaskDenyText({ seconds = 0, count = 0, gateRoot = DEFAULT_GATE_ROOT, doc = DEFAULT_LONG_TASK_DOC } = {}) {
  const base = `这条命令用了 ${seconds} 秒，属于长活，下回先派同事去做，你继续跟用户对话`;
  const ref = (typeof doc === 'string' && doc.trim() !== '' && typeof gateRoot === 'string' && gateRoot.trim() !== '')
    ? `——出处：${gateRoot.replace(/[\\/]+$/, '')}\\${doc}`
    : '';
  return `${base}${ref}（本轮长活已 ${count} 笔）`;
}

/** 常见虚词二元组：既不能证明相关性，还会白送命中。 */
export const STOPWORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '可以', '但是', '因为', '所以',
  '现在', '就是', '不是', '没有', '已经', '还是', '一下', '然后', '这样', '那样', '问题',
  '东西', '时候', '如果', '应该', '需要', '知道', '觉得', '一个', '自己', '这里', '那里',
  '真的', '其实', '可能', '必须', '以及', '或者', '之前', '以后', '进来', '出来',
]);

/** 路径归一：去首尾引号与空白、反斜杠转正斜杠、去尾斜杠、转小写。 */
export function normalizePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** 目标是否在根之下（等于根也算在根下；前缀相似但不同名的不算）。 */
export function isUnder(target, root) {
  const t = normalizePath(target);
  const r = normalizePath(root);
  if (t === '' || r === '') return false;
  return t === r || t.startsWith(`${r}/`);
}

/**
 * 目标是否在某个分卷目录之下（命中判据的核心：根目录文件不算）。
 * volumes 为空（骨架版未配置分卷）＝退化为宽口径：落在库根下即算。
 */
export function isUnderVolume(target, root, volumes = []) {
  const t = normalizePath(target);
  const r = normalizePath(root);
  if (t === '' || r === '') return false;
  const vols = Array.isArray(volumes) ? volumes : [];
  if (vols.length === 0) return isUnder(target, root);
  for (const v of vols) {
    if (t === `${r}/${normalizePath(v)}` || t.startsWith(`${r}/${normalizePath(v)}/`)) return true;
  }
  return false;
}

/** 文本里有没有提到库根（后面必须跟边界，避免同前缀兄弟目录误命中）。 */
export function mentionsRoot(text, root) {
  const r = normalizePath(root);
  if (r === '') return false;
  const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?=$|[/\\s"'\`,;:)])`).test(normalizePath(text));
}

/** 从工具参数里抽「会被当成路径的字段」。 */
export function extractPaths(toolName, args = {}) {
  const pick = (value) => (typeof value === 'string' && value.trim() !== '' ? [value] : []);
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
      return pick(args.file_path);
    case 'grep':
    case 'glob':
      return pick(args.path);
    default:
      return [];
  }
}

/** 看着像路径的串：盘符开头、UNC 开头、斜杠或家目录波浪号开头。这类不许当检索词。 */
const PATH_LIKE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/;

/** 选项后面跟一个值的开关：解析检索词时要把它们的值一起跳掉。 */
const VALUE_FLAGS = new Set([
  '-g', '--glob', '-t', '--type', '-m', '--max-count', '-A', '-B', '-C', '-f', '--file',
  '--include', '--exclude', '-E', '--encoding', '-j', '--threads', '--max-depth', '--sort',
]);

/** 从一段 shell 命令里抽「真正的检索词」（别把路径当检索词）。 */
export function patternFromCommand(text) {
  const t = String(text ?? '');
  const explicit = t.match(/(?:-Pattern|-Patterns|-pattern|--pattern|--regexp|-regexp|-Exp|-e)\s+(?:"([^"]*)"|'([^']*)'|([^\s|;)]+))/i);
  if (explicit) {
    const v = String(explicit[1] ?? explicit[2] ?? explicit[3] ?? '').trim();
    if (v !== '') return v;
  }
  // findstr 的字面匹配开关 /C:"..."；冒号写成字符类[:]，免得源码里出现「盘符:反斜杠」的形状。
  const cArg = t.match(/\/C[:]\s*(?:"([^"]*)"|'([^']*)')/i);
  if (cArg) {
    const v = String(cArg[1] ?? cArg[2] ?? '').trim();
    if (v !== '') return v;
  }
  const toolHit = t.match(/\b(?:rg|grep|findstr|Select-String|sls)\b([\s\S]*)/i);
  if (toolHit) {
    const tokens = toolHit[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    for (let i = 0; i < tokens.length; i += 1) {
      const raw = tokens[i];
      if (raw.startsWith('-') || raw.startsWith('/')) {
        if (VALUE_FLAGS.has(raw.toLowerCase())) i += 1;
        continue;
      }
      const v = raw.replace(/^["']|["']$/g, '').trim();
      if (v === '' || PATH_LIKE.test(v)) continue;
      return v;
    }
  }
  return '';
}

/** 从工具参数里抽「检索用的关键词」。 */
export function extractSearchPattern(toolName, args = {}) {
  if (toolName === 'grep') return String(args.pattern ?? '');
  if (toolName === 'glob') return String(args.pattern ?? '');
  if (TEXT_TOOLS.includes(toolName)) {
    const text = String(args.command ?? args.text ?? '');
    const structured = patternFromCommand(text);
    if (structured !== '') return structured;
    const quoted = (text.match(/["']([^"']{2,80})["']/g) ?? [])
      .map((q) => q.replace(/^["']|["']$/g, ''))
      .filter((q) => q !== '' && !PATH_LIKE.test(q));
    if (quoted.length > 0) return quoted.join(' ');
    return text.slice(0, 200);
  }
  return '';
}

/** 从工具参数里抽「要检查的文本」。 */
export function extractText(toolName, args = {}) {
  const parts = [];
  const push = (value) => {
    if (typeof value === 'string' && value.length > 0) parts.push(value);
  };
  switch (toolName) {
    case 'read':
      push(args.file_path);
      break;
    case 'grep':
      push(args.path);
      push(args.pattern);
      push(args.include);
      break;
    case 'glob':
      push(args.path);
      push(args.pattern);
      break;
    case 'write':
      push(args.file_path);
      push(args.content);
      break;
    case 'edit':
      push(args.file_path);
      push(args.old_string);
      push(args.new_string);
      break;
    case 'pwsh':
    case 'bash':
      push(args.command);
      push(args.description);
      break;
    case 'terminal_send':
      push(args.text);
      break;
    case 'subagent':
      push(args.prompt);
      push(args.description);
      break;
    default:
      push(args.file_path);
      push(args.path);
      push(args.command);
      push(args.code);
      push(args.text);
      push(args.prompt);
      break;
  }
  return parts.join('\n');
}

/** 把工具结果转成可判读的文本（不同工具字段名不一）。 */
export function resultText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v !== '') out.push(v);
  };
  push(result.text);
  push(result.output);
  push(result.stdout);
  push(result.error);
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (typeof c === 'string') push(c);
      else if (c && typeof c === 'object') push(c.text);
    }
  }
  return out.join('\n');
}

/** 取「词元」：英文数字词 + 中文二元组（去虚词）。用于判检索式是否跟当前消息有关。 */
export function tokensOf(text) {
  const t = String(text ?? '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/经验库检索卡[\s\S]*$/m, ' ');
  const tokens = new Set();
  for (const w of t.match(/[a-z0-9_]{3,}/g) || []) tokens.add(w);
  const cjk = t.replace(/[^\u4e00-\u9fa5]/g, ' ');
  for (const seg of cjk.split(/\s+/)) {
    for (let i = 0; i < seg.length - 1; i += 1) {
      const bg = seg.slice(i, i + 2);
      if (!STOPWORDS.has(bg)) tokens.add(bg);
    }
  }
  return tokens;
}

/** 检索式与当前消息是否有关（共同词 ≥ 1）。 */
export function isRelevantPattern(pattern, turnText) {
  const a = tokensOf(pattern);
  const b = tokensOf(turnText);
  if (a.size === 0 || b.size === 0) return false;
  for (const tok of a) if (b.has(tok)) return true;
  return false;
}

/**
 * 数「有效命中」：结果里出现 `<库根>/<分卷>/` 且该行不含排除文件名，才算一条。
 * 未配置分卷（volumes 空）＝退化为宽口径：落在库根下的行都算。
 * 返回 { hits, volumes, excludedHits }。
 */
export function countVolumeHits(text, root, volumes = [], excludeFiles = DEFAULT_EXCLUDE_FILES) {
  const lines = String(text ?? '').split(/\r?\n/);
  const r = normalizePath(root);
  if (r === '') return { hits: 0, volumes: [], excludedHits: 0 };
  const vols = (Array.isArray(volumes) ? volumes : []).map((v) => ({ name: v, needle: `${r}/${normalizePath(v)}/` }));
  const excludes = (Array.isArray(excludeFiles) ? excludeFiles : []).map((e) => normalizePath(e));
  let hits = 0;
  let excludedHits = 0;
  const found = new Set();
  for (const line of lines) {
    const n = normalizePath(line);
    if (n === '') continue;
    if (!n.includes(`${r}/`) && !n.includes(normalizePath(root))) continue;
    const isExcluded = excludes.some((e) => e !== '' && n.includes(e));
    if (isExcluded) { excludedHits += 1; continue; }
    if (vols.length === 0) { hits += 1; continue; }
    for (const v of vols) {
      if (n.includes(v.needle)) { hits += 1; found.add(v.name); break; }
    }
  }
  return { hits, volumes: [...found], excludedHits };
}

/** 这次调用本身算不算「结构上的检索调用」（用于无条件放行检索动作本身）。 */
export function isSearchCall({ toolName, targetPath = '', targetText = '', gateRoot = DEFAULT_GATE_ROOT } = {}) {
  if (typeof gateRoot !== 'string' || gateRoot.trim() === '') return false;
  if (toolName === 'read' || toolName === 'grep') {
    return isUnder(targetPath, gateRoot);
  }
  if (TEXT_TOOLS.includes(toolName)) {
    return mentionsRoot(targetText, gateRoot) && SEARCH_KEYWORD.test(targetText);
  }
  return false;
}

/**
 * 判定一次检索是否有资格记入本轮。
 * 返回 { ok, reason, hits, volumes }：ok=true → noteResult 置位 searchedThisTurn。
 */
export function judgeSearch({
  toolName = '',
  targetPath = '',
  pattern = '',
  turnText = '',
  result = '',
  config = {},
} = {}) {
  const cfg = normalizeConfig(config);
  const text = resultText(result);

  if (toolName === 'read' && isUnderVolume(targetPath, cfg.gateRoot, cfg.volumes)) {
    return { ok: true, reason: 'read-volume', hits: 1, volumes: [] };
  }

  if (toolName === 'read' && isUnder(targetPath, cfg.gateRoot)) {
    return { ok: false, reason: 'read-root-file', hits: 0, volumes: [] };
  }

  const counted = countVolumeHits(text, cfg.gateRoot, cfg.volumes, cfg.excludeFiles);
  if (counted.hits > cfg.maxHits) {
    return { ok: false, reason: 'too-broad', hits: counted.hits, volumes: counted.volumes };
  }
  if (counted.hits > 0) {
    return { ok: true, reason: 'hit-volume', hits: counted.hits, volumes: counted.volumes };
  }

  // 命中的全是 README 之类的排除件：最常见的绕法，一律不算，也不许用相关性兜底
  if (counted.excludedHits > 0) {
    return { ok: false, reason: 'only-excluded-files', hits: 0, volumes: [], excludedHits: counted.excludedHits };
  }

  // 真·命中 0 条：只有关键词与当前消息相关才算「查过但没命中」
  if (isRelevantPattern(pattern, turnText)) {
    return { ok: true, reason: 'empty-but-relevant', hits: 0, volumes: [] };
  }

  const anyRootHit = mentionsRoot(text, cfg.gateRoot);
  return {
    ok: false,
    reason: anyRootHit ? 'only-excluded-files' : 'empty-and-irrelevant',
    hits: 0,
    volumes: [],
  };
}

/** 配置归一。gateRoot 空＝未配置（外壳据此自停用）。 */
export function normalizeConfig(config = {}) {
  const raw = config ?? {};
  const tools = Array.isArray(raw.tools) && raw.tools.length > 0 ? raw.tools.map(String) : DEFAULT_TOOLS;
  const volumes = Array.isArray(raw.volumes) && raw.volumes.length > 0 ? raw.volumes.map(String) : [];
  const excludeFiles = Array.isArray(raw.excludeFiles) ? raw.excludeFiles.map(String) : [...DEFAULT_EXCLUDE_FILES];
  const longTaskRaw = (raw.longTaskGate !== null && typeof raw.longTaskGate === 'object') ? raw.longTaskGate : {};
  return {
    enabled: raw.enabled !== false,
    tools,
    gateRoot: typeof raw.gateRoot === 'string' ? raw.gateRoot.trim() : DEFAULT_GATE_ROOT,
    latchTool: typeof raw.latchTool === 'string' && raw.latchTool !== '' ? raw.latchTool : LATCH_TOOL,
    volumes,
    excludeFiles,
    maxHits: Number.isFinite(raw.maxHits) && raw.maxHits > 0 ? Number(raw.maxHits) : DEFAULT_MAX_HITS,
    requireRelevance: raw.requireRelevance !== false,
    dispatchTools: Array.isArray(raw.dispatchTools) && raw.dispatchTools.length > 0
      ? raw.dispatchTools.map(String)
      : [...DEFAULT_DISPATCH_TOOLS],
    dispatchDoc: typeof raw.dispatchDoc === 'string' ? raw.dispatchDoc.trim() : DEFAULT_DISPATCH_DOC,
    requireDispatchDoc: raw.requireDispatchDoc !== false,
    settleDoc: typeof raw.settleDoc === 'string' ? raw.settleDoc.trim() : DEFAULT_SETTLE_DOC,
    requireSettleDoc: raw.requireSettleDoc !== false,
    maxDenyStreak: Number.isFinite(raw.maxDenyStreak) && raw.maxDenyStreak >= 0
      ? Number(raw.maxDenyStreak)
      : DEFAULT_MAX_DENY_STREAK,
    libraryAlive: typeof raw.libraryAlive === 'function' ? raw.libraryAlive : null,
    longTaskGate: {
      enabled: longTaskRaw.enabled !== false,
      thresholdSeconds: Number.isFinite(longTaskRaw.thresholdSeconds) && longTaskRaw.thresholdSeconds > 0
        ? Number(longTaskRaw.thresholdSeconds)
        : DEFAULT_LONG_TASK_SECONDS,
    },
    longTaskDoc: typeof raw.longTaskDoc === 'string' ? raw.longTaskDoc.trim() : DEFAULT_LONG_TASK_DOC,
  };
}

/** 这一条消息算不算「沉淀话题」。 */
export function isSettleTopic(text = '') {
  return SETTLE_KEYWORD.test(String(text ?? ''));
}

/**
 * 沉淀闸判据（纯函数）。只在「沉淀话题 + 写/改库里的文件 + 本轮还没读沉淀清单」时拒。
 * settleDoc 未配置＝子闸不生效。
 */
export function evaluateSettle({ toolName = '', targetPath = '', settleTopic = false, settleRead = false, config = {} } = {}) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) return { blocked: false, key: 'disabled' };
  if (!cfg.requireSettleDoc) return { blocked: false, key: 'settle-gate-off' };
  if (cfg.settleDoc === '') return { blocked: false, key: 'settle-doc-unset' };
  if (settleTopic !== true) return { blocked: false, key: 'not-settle-topic' };
  if (toolName !== 'write' && toolName !== 'edit') return { blocked: false, key: 'not-settle-write' };
  if (!isUnder(String(targetPath ?? ''), cfg.gateRoot)) return { blocked: false, key: 'not-in-library' };
  if (settleRead === true) return { blocked: false, key: 'settle-read' };
  return { blocked: true, key: 'no-settle-read' };
}

/** 沉淀闸的拒绝文案（doc 由配置给出；未配置时这道子闸根本不会拒）。 */
export function reasonTextSettle({ doc = DEFAULT_SETTLE_DOC, gateRoot = DEFAULT_GATE_ROOT } = {}) {
  const ref = (typeof gateRoot === 'string' && gateRoot.trim() !== '' && typeof doc === 'string' && doc.trim() !== '')
    ? `${gateRoot.replace(/[\\/]+$/, '')}\\${doc}`
    : String(doc ?? '');
  return [
    '沉淀闸门：这一条在说沉淀／偏好／习惯／规则，写库之前先把「沉淀清单」读一遍。',
    `要读的这一篇：${ref}`,
    '四件事一起办，缺一件不算沉淀完：',
    '  ① 经验：这次发生了什么、怎么修的；',
    '  ② 偏好：用户喜欢哪种做法、不喜欢哪种；',
    '  ③ 习惯：下次该养成什么可重复动作；',
    '  ④ 规则：够不够格进规则本（下次不做会踩线、一句话说清、有当场可验的判据，三条全中才升）。',
    '读完再落笔，这一次就过；同一轮读一次能连写几处。要关掉这道闸：配置里 requireSettleDoc: false 或 settleDoc 留空。',
  ].join('\n');
}

/** 取路径最后一段（文件名），两种斜杠都认。 */
function fileNameOf(path) {
  const s = String(path ?? '');
  const parts = normalizePath(s).split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * 这一份结果/读取里，有没有碰到指定的那一篇（只认文件名，不受库根换盘影响）。
 * 认两种碰法：检索结果里出现了那篇的路径；或直接 read 那个文件。
 */
export function mentionsDoc({ text = '', targetPath = '', doc = '' } = {}) {
  const needle = fileNameOf(doc);
  if (needle === '') return false;
  return normalizePath(text).includes(needle) || normalizePath(targetPath).includes(needle);
}

/** 有没有碰到「派活那篇」。 */
export function mentionsDispatchDoc({ text = '', targetPath = '', doc = DEFAULT_DISPATCH_DOC } = {}) {
  return mentionsDoc({ text, targetPath, doc });
}

/** 派活闸判据（纯函数）。dispatchDoc 未配置＝子闸不生效。 */
export function evaluateDispatch({ toolName = '', dispatchRead = false, config = {} } = {}) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) return { blocked: false, key: 'disabled' };
  if (!cfg.requireDispatchDoc) return { blocked: false, key: 'dispatch-gate-off' };
  if (cfg.dispatchDoc === '') return { blocked: false, key: 'dispatch-doc-unset' };
  if (!cfg.dispatchTools.includes(String(toolName))) return { blocked: false, key: 'not-dispatch' };
  if (dispatchRead === true) return { blocked: false, key: 'dispatch-read' };
  return { blocked: true, key: 'no-dispatch-read' };
}

/** 派活闸的拒绝文案。 */
export function reasonTextDispatch({ toolName = 'subagent', doc = DEFAULT_DISPATCH_DOC, gateRoot = DEFAULT_GATE_ROOT, volumes = [] } = {}) {
  const rootTrim = String(gateRoot ?? '').replace(/[\\/]+$/, '');
  const sampleScope = (Array.isArray(volumes) && volumes.length > 0) ? `${rootTrim}\\${volumes[0]}` : rootTrim;
  return [
    `派活闸门：这一路要派出去了（「${toolName}」），先把讲派活的那一篇读了再派。`,
    `要读的这一篇：${rootTrim}\\${doc}`,
    '为什么拦：派出去的活不带提醒块、不带落盘路径、不写文件归属，同事就会干半路跑偏，回来还得重派。',
    '两种都算读过：',
    '  1) 直接读：read 上面那个文件',
    `  2) 在库里搜一句：rg -n "<关键词>" "${sampleScope}"`,
    '读完再敲派活，这一次就过。要关掉这道闸：配置里 requireDispatchDoc: false 或 dispatchDoc 留空。',
    '边界：只挡「开新的一路」；给已有同事发消息不挡。',
  ].join('\n');
}

/** 本轮主闸判定（纯函数）。 */
export function evaluateTurn({ toolName = '', targetText = '', targetPath = '', searchedThisTurn = false, latched = false, config = {} } = {}) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) return { blocked: false, key: 'disabled', toolName };
  if (!cfg.tools.includes(toolName)) return { blocked: false, key: 'tool-not-listed', toolName };
  if (isSearchCall({ toolName, targetPath, targetText, gateRoot: cfg.gateRoot })) {
    return { blocked: false, key: 'search-call', toolName };
  }
  if (latched === true) return { blocked: false, key: 'latched', toolName };
  if (searchedThisTurn === true) return { blocked: false, key: 'searched', toolName };
  return { blocked: true, key: 'no-search', toolName };
}

/** 断路器证据源：库在不在（由外壳注入文件系统检查；未注入＝不拦）。 */
export function evaluateLibrary({ libraryAlive = null } = {}) {
  if (libraryAlive === null || typeof libraryAlive !== 'function') return { blocked: false, key: 'unknown' };
  try {
    const alive = libraryAlive();
    if (alive === false) return { blocked: false, key: 'library-gone' };
    return { blocked: false, key: 'library-alive' };
  } catch {
    // 检查器自己出错，按「库没了」处理：宁可放过，不许把系统锁死。
    return { blocked: false, key: 'library-check-failed' };
  }
}

/** 主闸拒绝文案。 */
export function reasonText({ toolName = '', key = 'no-search', gateRoot = DEFAULT_GATE_ROOT, callIndex = 1, denyCount = 1, lastReject = null, volumes = [], maxHits = DEFAULT_MAX_HITS } = {}) {
  const head = `经验库闸门：这一轮还没**有效**翻过经验库，先别改东西，已经拦下这一次「${toolName}」。`;
  const echo = `本轮第 ${callIndex} 次调用（本轮被拦第 ${denyCount} 次）／判据键：${key}`;
  if (key !== 'no-search') {
    return [head, echo, '这条拦截键不该出现在拒绝里，请把它报给维护的人。'].join('\n');
  }
  const lines = [head, echo];
  if (lastReject) {
    const why = lastReject.reason === 'only-excluded-files'
      ? '上一次检索只命中了根目录说明或排除清单里的文件（如 README），那些不算查过。'
      : lastReject.reason === 'read-root-file'
        ? '上一次只是读了库根的说明文件（README 之类），没有真正翻分卷。'
        : lastReject.reason === 'too-broad'
          ? '上一次检索命中的行太多了（超过上限），属于「搜个泛词糊一遍」，不算查过。把关键词写具体些再搜。'
          : lastReject.reason === 'empty-and-irrelevant'
            ? '上一次检索命中 0 条，而且检索词跟这一条消息没有共同词，像是随手搜的，不算查过。'
            : '上一次检索被判无效。';
    lines.push(`被判无效的原因：${why}`);
  }
  const rootTrim = String(gateRoot ?? '').replace(/[\\/]+$/, '');
  const sampleScope = (Array.isArray(volumes) && volumes.length > 0) ? `${rootTrim}\\${volumes[0]}` : rootTrim;
  lines.push(
    '为什么拦：经验库里多半已经写过这件事的坑；没查就改，容易把老经验顶掉、也容易重犯一次。规矩是「动手前先查经验库」。',
    '',
    '先跑这一条（把 <关键词> 换成**这一条消息里真有的词**，别搜「经验」这类泛词）：',
    `  rg -n "<关键词>" ${rootTrim}`,
    '想快就把范围缩到某一卷（命中要落在卷目录里才算）：',
    `  rg -n "<关键词>" ${sampleScope}`,
    '命中 0 条也放行，但检索词必须与当前话题相关；查完先回一句「查过没命中」再动手。',
    '',
    '判据：① 命中文件必须落在配置的分卷目录里（未配分卷＝落在库根下即可）；② 命中 0 条时检索词要与本条消息有共同词；③ 报错的调用不算。',
    `判据：④ 命中行数超过上限（maxHits，当前默认 ${maxHits}，配置里可改）判「太泛」＝无效，并收回本轮已取得的放行权。`,
  );
  return lines.join('\n');
}

/** 外壳：把纯函数策略核包成 ctx.tools.guard() 要的同步守卫。 */
export function createGuard(config = {}) {
  const raw = config ?? {};
  const envReader = typeof raw.envReader === 'function' ? raw.envReader : (name) => globalThis.process?.env?.[name];
  const onLog = typeof raw.onLog === 'function' ? raw.onLog : null;
  // 时间源可注入，测试用假钟免得真等 30 秒；生产用 Date.now。
  const nowFn = typeof raw.now === 'function' ? raw.now : () => Date.now();

  let gateRoot = raw.gateRoot;
  if ((typeof gateRoot !== 'string' || gateRoot.trim() === '') && typeof raw.rootEnv === 'string' && raw.rootEnv !== '') {
    const fromEnv = envReader(raw.rootEnv);
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') gateRoot = fromEnv.trim();
  }
  const settings = normalizeConfig({ ...raw, gateRoot: gateRoot ?? DEFAULT_GATE_ROOT });

  const state = {
    searchedThisTurn: false, latched: false, calls: 0, denies: 0, searches: 0,
    searchKey: null, turnKey: null, lastReject: null,
    dispatchRead: false,
    settleTopic: false,
    settleRead: false,
    denyStreak: 0,
    tripped: false,
    ownKey: null,
    agents: new Map(),
    callStarts: new Map(),
    longTasks: 0,
    lastLongSeconds: 0,
    longTaskBlockedAt: 0,
  };

  const agentKeyOf = (x) => String(x?.agent?.id ?? x?.agentId ?? x?.session?.agentId ?? '').trim();
  const bucketOf = (x) => {
    const k = agentKeyOf(x);
    if (k === '') return state;
    let b = state.agents.get(k);
    if (b === undefined) {
      b = { ownKey: null, turnText: '', searchedThisTurn: false, latched: false, dispatchRead: false, settleRead: false, settleTopic: false, denyStreak: 0, tripped: false, longTasks: 0, lastLongSeconds: 0, longTaskBlockedAt: 0 };
      state.agents.set(k, b);
    }
    return b;
  };

  const callIdOf = (exec) => {
    const id = exec?.id ?? exec?.callId ?? exec?.toolCallId;
    return id === undefined || id === null || String(id) === '' ? null : String(id);
  };

  const log = (payload) => { if (onLog) { try { onLog(payload); } catch { /* 记账失败不许影响判定 */ } } };

  function resetTurn() {
    state.searchedThisTurn = false;
    state.latched = false;
    state.calls = 0;
    state.denies = 0;
    state.searches = 0;
    state.searchKey = null;
    state.lastReject = null;
    state.dispatchRead = false;
    state.settleRead = false;
    state.denyStreak = 0;
    state.tripped = false;
    state.ownKey = null;
    state.callStarts.clear();
    state.longTasks = 0;
    state.lastLongSeconds = 0;
    state.longTaskBlockedAt = 0;
    for (const b of state.agents.values()) {
      b.searchedThisTurn = false;
      b.latched = false;
      b.dispatchRead = false;
      b.settleRead = false;
      b.settleTopic = false;
      b.turnText = '';
      b.ownKey = null;
      b.denyStreak = 0;
      b.tripped = false;
      b.longTasks = 0;
      b.lastLongSeconds = 0;
      b.longTaskBlockedAt = 0;
    }
  }

  /** 断路器：一个代理连拦到阈值就放开它自己；别的代理照旧先查库。 */
  function shouldTrip(bucket) {
    const maxStreak = settings.maxDenyStreak;
    if (bucket.tripped === true) return true;
    if (maxStreak > 0 && bucket.denyStreak >= maxStreak) {
      bucket.tripped = true;
      log({ kind: 'breaker', streak: bucket.denyStreak, max: maxStreak });
      return true;
    }
    return false;
  }

  /** 拒绝文案尾巴：还剩几次就自动放开（让模型知道门会自己退，不必硬撞）。 */
  function withRemain(text, bucket) {
    const maxStreak = settings.maxDenyStreak;
    if (maxStreak <= 0) return text;
    const left = Math.max(0, maxStreak - bucket.denyStreak);
    return `${text}\n（连着拦到第 ${maxStreak} 次这一轮就自动放开，还差 ${left} 次；这是防「库不在了把整个系统锁死」的后备，不是给你钻的空子）`;
  }

  /** ctx.tools.guard() 要的形状：返回字符串 = 拒绝，返回 undefined = 放行。 */
  function guard(exec) {
    const toolName = String(exec?.name ?? '');
    const args = exec?.arguments ?? {};
    const targetText = extractText(toolName, args);
    const targetPath = extractPaths(toolName, args)[0] ?? '';

    if (settings.tools.includes(toolName)) state.calls += 1;
    const bucket = bucketOf(exec);

    // 库根未配置＝整道闸自停用（全部放行），绝不锁死系统。
    // 直接在守卫口判，不依赖外壳是否注入 libraryAlive。
    if (settings.gateRoot === '') {
      if (state.tripped === false) {
        state.tripped = true;
        log({ kind: 'breaker', reason: 'gate-root-unset', tool: toolName });
      }
      return undefined;
    }

    // 长活反馈：按调用 id 记起点；noteResult 时算秒数并清掉。
    if (settings.longTaskGate.enabled && isLongTaskTool(toolName)) {
      const callId = callIdOf(exec);
      if (callId !== null) state.callStarts.set(callId, nowFn());
    }

    // 断路器证据源：库不在（含未配置 gateRoot）＝整道闸自停用，全部放行，不锁死系统。
    const libVerdict = evaluateLibrary({ libraryAlive: settings.libraryAlive });
    if (libVerdict.key === 'library-gone' || libVerdict.key === 'library-check-failed' || libVerdict.key === 'library-unconfigured') {
      if (state.tripped === false) {
        state.tripped = true;
        log({ kind: 'breaker', reason: libVerdict.key, tool: toolName });
      }
      return undefined;
    }

    // 已熔断过（全局或该代理自己撞满）——后面全放。
    if (state.tripped === true || bucket.tripped === true) return undefined;

    // 派活闸：先于「查过库没有」判——查过库不等于读过派活那篇。
    const dispatchVerdict = evaluateDispatch({
      toolName, dispatchRead: bucket.dispatchRead, config: settings,
    });
    if (dispatchVerdict.blocked) {
      state.denies += 1;
      log({ kind: 'deny-dispatch', tool: toolName, key: dispatchVerdict.key, streak: bucket.denyStreak });
      return withRemain(reasonTextDispatch({
        toolName, doc: settings.dispatchDoc, gateRoot: settings.gateRoot, volumes: settings.volumes,
      }), bucket);
    }

    // 沉淀闸：这条消息在说沉淀/偏好/习惯/规则时，写库之前先读沉淀清单。
    const settleVerdict = evaluateSettle({
      toolName, targetPath, settleTopic: bucket.settleTopic, settleRead: bucket.settleRead, config: settings,
    });
    if (settleVerdict.blocked) {
      state.denies += 1;
      log({ kind: 'deny-settle', tool: toolName, key: settleVerdict.key, streak: bucket.denyStreak });
      return withRemain(reasonTextSettle({ doc: settings.settleDoc, gateRoot: settings.gateRoot }), bucket);
    }

    // 长活反馈：同轮第 2 笔超时起，对下一笔命令类调用拦一次，拦完自动放开。
    // 检索调用照旧无条件放行（硬规矩），不计进这道闸。
    if (
      settings.longTaskGate.enabled
      && isLongTaskTool(toolName)
      && !isSearchCall({ toolName, targetPath, targetText, gateRoot: settings.gateRoot })
      && bucket.longTasks >= LONG_TASK_MIN_COUNT
      && bucket.longTaskBlockedAt < bucket.longTasks
    ) {
      bucket.longTaskBlockedAt = bucket.longTasks;
      log({ kind: 'deny-long-task', tool: toolName, reason: `${bucket.lastLongSeconds}s #${bucket.longTasks}` });
      return longTaskDenyText({
        seconds: bucket.lastLongSeconds, count: bucket.longTasks,
        gateRoot: settings.gateRoot, doc: settings.longTaskDoc,
      });
    }

    const verdict = evaluateTurn({
      toolName, targetText, targetPath,
      searchedThisTurn: bucket.searchedThisTurn,
      latched: bucket.latched,
      config: settings,
    });

    if (verdict.blocked) {
      state.denies += 1;
      bucket.denyStreak += 1;
      if (shouldTrip(bucket)) return undefined;
      log({ kind: 'deny', tool: toolName, key: verdict.key, streak: bucket.denyStreak, lastReject: state.lastReject });
      return withRemain(reasonText({
        toolName, key: verdict.key, gateRoot: settings.gateRoot,
        callIndex: state.calls, denyCount: state.denies, lastReject: state.lastReject,
        volumes: settings.volumes, maxHits: settings.maxHits,
      }), bucket);
    }

    if (verdict.key === 'search-call') state.searchKey = `search-call:${toolName}`;
    if (toolName === settings.latchTool && verdict.key !== 'search-call') bucket.latched = true;
    return undefined;
  }

  /** 算这笔命令类调用跑了多少秒；超阈值记一笔长活进该代理的桶。 */
  function noteLongTaskResult(exec, result, toolName = String(exec?.name ?? '')) {
    if (!settings.longTaskGate.enabled) return;
    if (!isLongTaskTool(toolName)) return;
    const id = callIdOf(exec);
    if (id === null) return;
    const start = state.callStarts.get(id);
    if (start === undefined) return;
    state.callStarts.delete(id);
    if (result?.isError === true) return;
    const seconds = (nowFn() - start) / 1000;
    if (!Number.isFinite(seconds) || seconds <= settings.longTaskGate.thresholdSeconds) return;
    const bucket = bucketOf(exec);
    bucket.longTasks += 1;
    bucket.lastLongSeconds = Math.max(1, Math.round(seconds));
    log({ kind: 'long-task', tool: toolName, reason: `${bucket.lastLongSeconds}s #${bucket.longTasks}` });
  }

  /** 观察 tools/result(exec, result)：只有「有效检索」才置位，isError 不算。 */
  guard.noteResult = (exec, result) => {
    const toolName = String(exec?.name ?? '');
    const args = exec?.arguments ?? {};
    noteLongTaskResult(exec, result, toolName);
    if (result?.isError === true) return false;
    const bucket = bucketOf(exec);
    const targetText = extractText(toolName, args);
    const targetPath = extractPaths(toolName, args)[0] ?? '';
    if (!isSearchCall({ toolName, targetPath, targetText, gateRoot: settings.gateRoot })) return false;

    const judgement = judgeSearch({
      toolName, targetPath,
      pattern: extractSearchPattern(toolName, args),
      turnText: bucket.turnText,
      result,
      config: settings,
    });

    log({
      kind: 'search', tool: toolName, reason: judgement.reason,
      hits: judgement.hits, volumes: judgement.volumes,
      pattern: String(extractSearchPattern(toolName, args) ?? '').slice(0, 60).replace(/\s+/g, ' '),
    });

    // 碰到必读篇名就记「已读」，先于 ok 判定——直接 read 那篇通常不算一次有效检索
    //（guides 往往不在分卷里），但「读过了」这个事实必须记下。
    if (mentionsDispatchDoc({ text: resultText(result), targetPath, doc: settings.dispatchDoc })) {
      bucket.dispatchRead = true;
    }
    if (mentionsDoc({ text: resultText(result), targetPath, doc: settings.settleDoc })) {
      bucket.settleRead = true;
    }

    if (!judgement.ok) {
      state.lastReject = { reason: judgement.reason, tool: toolName };
      // 判「太泛」要连带把本轮的放行权收回去，否则先有一条有效检索就把泛词盖住了。
      if (judgement.reason === 'too-broad') {
        bucket.searchedThisTurn = false;
        bucket.latched = false;
      }
      return false;
    }
    bucket.searchedThisTurn = true;
    state.searches += 1;
    state.searchKey = `result:${toolName}:${judgement.reason}`;
    return true;
  };

  /** 观察 agent/pre-step：按「真人用户消息 id」判新一轮，并记下这条消息的正文用于相关性判定。 */
  guard.notePreStep = (payload) => {
    const messages = Array.isArray(payload?.messages) ? payload.messages : null;
    if (messages === null) {
      if (Number(payload?.step) !== 1) return false;
      resetTurn();
      return true;
    }
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
    if (key === state.turnKey || key === bucket.ownKey) return false;
    state.turnKey = key;
    bucket.ownKey = key;
    const isRealHuman = typeof human?.source?.rpcId === 'string' && human.source.rpcId !== '';
    if (isRealHuman) {
      // 新真人消息＝所有人开新轮 → 清全部桶（断路器语义不变）。
      resetTurn();
    } else if (agentKey !== '') {
      // 工单/注入类消息只清「这个代理自己」的桶；带不出代理 id 就什么都不清。
      bucket.searchedThisTurn = false;
      bucket.latched = false;
      bucket.dispatchRead = false;
      bucket.settleRead = false;
      bucket.denyStreak = 0;
      bucket.tripped = false;
      bucket.longTasks = 0;
      bucket.lastLongSeconds = 0;
      bucket.longTaskBlockedAt = 0;
      state.calls = 0;
      state.denies = 0;
      state.searches = 0;
      state.searchKey = null;
      state.lastReject = null;
      state.denyStreak = 0;
      state.tripped = false;
    }
    const content = human.content;
    // 无主工单不许写 turnText/settleTopic；真人消息（哪怕无代理号）要写。
    if (agentKey !== '' || isRealHuman) {
      bucket.turnText = Array.isArray(content)
        ? content.map((c) => (c && typeof c === 'object' ? (c.text || '') : String(c ?? ''))).join('\n')
        : String(content ?? '');
      bucket.settleTopic = isSettleTopic(bucket.turnText);
    }
    return true;
  };

  guard.reset = resetTurn;
  guard.snapshot = () => ({
    ...state,
    gateRoot: settings.gateRoot,
    libraryUnconfigured: settings.gateRoot === '',
    tools: [...settings.tools],
    volumes: [...settings.volumes],
    enabled: settings.enabled,
    dispatchTools: [...settings.dispatchTools],
    dispatchDoc: settings.dispatchDoc,
    requireDispatchDoc: settings.requireDispatchDoc,
    settleDoc: settings.settleDoc,
    requireSettleDoc: settings.requireSettleDoc,
    longTaskGate: { ...settings.longTaskGate },
    longTaskDoc: settings.longTaskDoc,
  });
  return guard;
}
