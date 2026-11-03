/**
 * dsh-experience-context —— 经验库检索卡注入（骨架版）
 *
 * 每条用户消息的第一步，把一张「经验库检索卡」塞进上下文，让模型每轮都看见
 * 「去哪儿查、怎么查、查完要报什么」；并可按配置追加六张提醒卡与回复体检：
 *   检索卡（每轮一张，常驻「长活先派」一行）／回话格式卡（每轮带）／
 *   看图卡（带图·说图·用过看图工具）／先找现成方案卡（可行性问句）／
 *   沉淀卡（沉淀·偏好·习惯·规则话题）／收尾自检卡（五桶）／追因卡（三问递进）。
 * 全部只提醒不拦。
 *
 * 骨架版口径：
 *   · 所有本机路径、库根、篇名出处、代理地址、日志路径一律走 config（见 README 配置表）；
 *     默认值留空＝通用兜底文案，不带任何具体路径。
 *   · 挂载形态照 DSH 自带文档 cordis-plugin-development/references/host-plugin.md：
 *     apply(ctx, config) 里注册 agent/pre-step 瀑布，先 await next() 再往 decision.messages 插卡。
 *   · 注入消息三件套（id / role:'user' / content / source）满足 d-session 对
 *     user 消息的硬要求；只用 node 内置模块，不 import 任何宿主包。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const name = 'experience-context';

/** 注入消息的来源标签：回放/压缩/统计都靠这三个字段认它。 */
export const SOURCE = Object.freeze({
  kind: 'experience-context',
  form: 'notice',
  summary: '经验库检索卡',
});

/** 未配置库根时，卡片里用的占位说法（通用兜底文案，不带任何本机路径）。 */
export const ROOT_PLACEHOLDER = '<经验库根目录——在配置 libraryRoot 里填>';

/**
 * 拼「出处展示路径」：rel 为空返回空串；rel 是绝对路径（盘符/UNC/斜杠/波浪号开头）原样返回；
 * 否则拼到 libraryRoot 下。libraryRoot 也没配就返回空串（调用方按「无出处」渲染）。
 */
export function docRef(cfg, rel) {
  const r = String(rel ?? '').trim();
  if (r === '') return '';
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/.test(r)) return r;
  const root = String(cfg?.libraryRoot ?? '').trim().replace(/[\\/]+$/, '');
  if (root === '') return '';
  return `${root}\\${r}`;
}

/** 有出处就给「（出处：…）」，没有就给空串。 */
export function refNote(ref) {
  const r = String(ref ?? '').trim();
  return r === '' ? '' : `（出处：${r}）`;
}

/** 配置默认值：全部通用兜底；路径类一律空串＝未配置。 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  /** 【必配】经验/规则库根目录。空＝卡片用占位文案。 */
  libraryRoot: '',
  /** 库内分卷名列表；空＝检索卡不列分卷行。 */
  volumes: [],
  /** B 版开关：自动跑一次检索把命中文件路径带进卡。默认关（每轮多几百 token）。 */
  autoSearch: false,
  autoSearchMaxHits: 5,
  autoSearchTimeoutMs: 4000,
  autoSearchKeywordsMax: 6,
  /** rg 可执行文件路径；空＝用 PATH 上的 rg，没有 rg 退回 PowerShell 检索。 */
  rgPath: '',
  /** 仅测试用：注入 { run(keywords, root, config) => Promise<string[]|null> }。 */
  searchRunner: null,
  /** 回复体检：回看上一条助手回复，命中排期话／自设预算贴提醒。默认开。 */
  lint: true,
  /** 体检日志文件；空＝不记。按天切份。 */
  lintLog: '',
  lintDebug: false,
  /** 沉淀卡：消息提到沉淀/偏好/习惯/规则时递一张「四件事」卡。 */
  settleCard: true,
  settleDocRel: '',
  /** 回话格式卡：每轮都带，无词判断。 */
  replyFormatCard: true,
  replyFormatDocRel: '',
  /** 看图卡：带图附件／文字含图字／本轮用过看图工具，任一即递。 */
  imageCard: true,
  imageDocRel: '',
  /** 先找现成方案卡：可行性问句才递。 */
  solutionCard: true,
  solutionDocRel: '',
  networkDocRel: '',
  /** 联网备用代理地址；空＝文案提示去配置里填。 */
  proxyUrl: '',
  /** 收尾自检卡：消息命中收尾形状才递，五桶带出处。 */
  wrapupCard: true,
  wrapupDocRel: '',
  wrapupTempDocRel: '',
  wrapupOrderDoc: '',
  /** 追因卡：消息命中追因形状才递，三问递进带出处。 */
  causeCard: true,
  causeBirthDocRel: '',
  causeDisciplineDocRel: '',
  causeRootfixDocRel: '',
  causeMetaDocRel: '',
  /** 「长活先派」常驻行的出处（相对 libraryRoot）。 */
  longTaskDocRel: '',
});

/* ------------------------- 触发形状（窄口，避免满屏误触发） ------------------------- */

/** 沉淀卡触发：窄口关键词；日常聊「规则」两个字不触发。 */
export const SETTLE_KEYWORD = /沉淀|记住|偏好|习惯|规则本|进规则|成规则|升格|写成规则/;

/** 看图卡：「图」一个字已覆盖「图片／图像」（子串），「截图」单列只为读得懂。 */
export const IMAGE_KEYWORD = /图|截图|图像/;

/** 看图工具名形状（按宿主的看图工具名配；这里是通用默认）。 */
export const IMAGE_TOOL_PATTERN = /read_image/i;

/** 可行性问句（先找现成方案卡）：形状判断，非宽泛词。 */
export const FEASIBILITY_QUESTION = /(?:只能|不能|无法|走不通|做不到|行不行|可不可以|有没有办法)[\s\S]{0,40}?(?:吗|么|？)/;

/** 收尾自检卡触发（形状判断）。 */
export const WRAPUP_TRIGGER = /收尾|收工|打扫|收桌|清理一下|散场|还有什么(?:要)?(?:做|办|处理|问)|没有(?:什么)?(?:事|问题)了吗|结束了吗|完成了吗|可以交卷吗|归档吧/;

/** 追因卡触发：「为什么」只认 不行/做不到/失败 三种接法，光问为什么不算。 */
export const CAUSE_TRIGGER = /怎么办|怎么解决|怎么搞|为什么(?:不行|做不到|失败)|给个方案|出个方案|怎么回事/;

/* ----------------------------- 回话格式卡要点（可在源码里改） ----------------------------- */

/** 回话格式卡的行内要点；细则正本走 config.replyFormatDocRel。 */
export const REPLY_FORMAT_POINTS = Object.freeze([
  '一句结论先行，十秒读完；过程不进回话',
  '用户要读的字抄进回话；只给路径＝没交付',
  '没拍板不叫定稿；拍板前用「候选」字样',
  '请示按固定段落逐段给全；问句只许放末段；一次最多两条；理由与正反两面利弊必给',
  '拍板先讲情景后出稿；讲情景那轮不带稿',
  '开头不喊称呼，先报本轮读了哪些参考；没命中也说没命中',
  '一律简体中文大白话；行话缩写换人话',
  '智能体不叫 AI；说智能体、agent、DSH',
  '不拿外部说法套自己的产品；产品没有的词不许造',
  '讲机制只给情景：谁、何时、做了什么、看见什么被挡在哪',
  '情景只用界面上的字；动词取界面原文',
  '报错先给可执行一步，再说找谁',
  '报事点名报角色；禁「有个人说」',
  '保险话免责话整句删；只报情况与建议，不堆选项',
  '先讲发生了什么，再讲对产品意味什么；结论挂来源标签（实测与推导分开）',
  '一件活两态分列：已并挂提交号、未并挂分支名',
  '要用户回答尽量正文对话式，少弹选项卡',
  '提问前自检一句：这轮学过本卡没有',
  '出稿先对表：段落齐、理由一句、正反两面各半，缺一不发',
  '待定项一个不少；「我自己处理」「不用您操心」零命中',
  '结论挂提交号，回滚点说具体；说不出的不算已核',
]);

/* --------------------------------- 卡片正文（纯函数） --------------------------------- */

/** 「长活先派」常驻一行：每轮随检索卡带，不做词判断。 */
export function buildLongTaskLine(cfg = {}) {
  const base = '长活先派：预计超 30 秒或超 50 条/50 个文件的活先派同事再做，派完继续跟用户对话；'
    + '同一类活第二次还自己跑算违规';
  return base + refNote(docRef(cfg, cfg.longTaskDocRel));
}

/** 检索卡正文。cfg 至少含 libraryRoot / volumes / longTaskDocRel；hits 为命中文件路径数组。 */
export function buildCardText(cfg = {}, hits = []) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const rootShow = String(c.libraryRoot ?? '').trim() !== '' ? String(c.libraryRoot).trim() : ROOT_PLACEHOLDER;
  const volumes = Array.isArray(c.volumes) ? c.volumes : [];
  const thirdTarget = volumes.length > 0 ? `${rootShow}\\${volumes[0]}` : rootShow;
  const lines = [
    '<system-reminder>',
    '经验库检索卡（每条消息只发一次）——动手之前先来这儿查一遍。',
    '',
    `库根：${rootShow}　入口：README.md（不维护集中索引，一律全文搜索）`,
    '三条命令，照抄，把 <关键词> 换掉：',
    `1) rg -n "<关键词>" ${rootShow}`,
    `2) rg -l "<关键词>" ${rootShow}`,
    `3) rg -n "<关键词>" ${thirdTarget}`,
  ];
  if (volumes.length > 0) lines.push(`分卷（${volumes.length} 个）：${volumes.join('／')}`);
  lines.push(
    '',
    '查完在回报里写明命中的文件名；命中 0 条也要写「查过没命中」。',
    buildLongTaskLine(c),
  );
  if (Array.isArray(hits) && hits.length > 0) {
    lines.push('', '自动检索命中（只是线索，要自己打开核对）：');
    for (const hit of hits) lines.push(`- ${hit}`);
  }
  lines.push('</system-reminder>');
  return lines.join('\n');
}

/** 回话格式卡正文（每轮都带）。 */
export function buildReplyFormatCardText(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const ref = docRef(c, c.replyFormatDocRel);
  const head = ref === ''
    ? '回话格式速查卡（每轮都带）——给用户回话／请示／汇报前先过一遍；细则正本未配置（config.replyFormatDocRel）：'
    : `回话格式速查卡（每轮都带）——给用户回话／请示／汇报前先过一遍；细则与出处见正本：${ref}`;
  const lines = ['<system-reminder>', head, ''];
  REPLY_FORMAT_POINTS.forEach((point, index) => lines.push(`${index + 1}. ${point}`));
  lines.push('</system-reminder>');
  return lines.join('\n');
}

/** 看图卡正文。 */
export function buildImageCardText(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const ref = docRef(c, c.imageDocRel);
  return [
    '<system-reminder>',
    '看图卡——这一轮在聊图／带了图／刚用过看图工具，三句先记住：',
    '· 有图 ≠ 能看图：先试一次看图工具，没试过不许写「本模型不支持读图」。',
    '· 直读不通走像素分析：图是文件，解成像素矩阵照样看——量尺寸、算色块、判边界。',
    '· 先像素后 OCR：像素答「有没有、多大、什么颜色、在哪」，读字交给 OCR；两路都试过才准说做不到。',
    ref === '' ? '细则与四条硬参数：未配置（config.imageDocRel 指到你的看图办法篇）' : `细则与四条硬参数：${ref}`,
    '（只递卡不拦人，不用回复这条）',
    '</system-reminder>',
  ].join('\n');
}

/** 先找现成方案卡正文。 */
export function buildSolutionCardText(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const proxyPart = String(c.proxyUrl ?? '').trim() !== ''
    ? `直连不通再挂代理 -x ${String(c.proxyUrl).trim()}`
    : '直连不通再挂代理（代理地址写在配置 proxyUrl）';
  return [
    '<system-reminder>',
    '先找现成方案卡——这条消息在问「能不能／行不行」：',
    `① 答「能不能」先查三层：官方文档 → 社区与 GitHub → 本机源码；只说「内置工具没有」就是答错${refNote(docRef(c, c.solutionDocRel))}。`,
    '② 先搜别人的现成解法：抄原文关键句与链接，再分「可照做／已无解」；说得出搜了哪个仓库。',
    `③ 联网搜索走本机网络：curl 直连优先，${proxyPart}${refNote(docRef(c, c.networkDocRel))}。`,
    '（只递卡不拦人；误触发代价＝多这一行字）',
    '</system-reminder>',
  ].join('\n');
}

/** 沉淀卡正文（四件事一起办）。 */
export function buildSettleCardText(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const ref = docRef(c, c.settleDocRel);
  return [
    '<system-reminder>',
    '沉淀卡——这一条提到了沉淀／偏好／习惯／规则，四件事一起办：',
    '① 经验：这次发生了什么、怎么修的。',
    '② 偏好：用户喜欢哪种做法、不喜欢哪种。',
    '③ 习惯：下次该养成什么可重复动作。',
    '④ 规则：够不够格进规则本（下次不做会踩线／一句话说清／有当场可验判据，三条全中才升）。',
    ref === '' ? '写经验库之前先读：未配置（config.settleDocRel 指到你的沉淀清单篇）' : `写经验库之前先读：${ref}`,
    '回报三句：经验写哪一篇／偏好与习惯是什么／这条升不升规则。',
    '</system-reminder>',
  ].join('\n');
}

/** 收尾自检卡正文（五桶）。 */
export function buildWrapupCardText(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  return [
    '<system-reminder>',
    '收尾自检卡——用户在说收尾／收工／还有什么要做的，五桶挨个过：',
    `① 过程件进回收站：临时诊断产物、失败截图、旧中间版、被取代旧件，当场清只报一句${refNote(docRef(c, c.wrapupDocRel))}`,
    `② 归档：归档区只收方案计划，成果旧件留原位，活账不入序${refNote(docRef(c, c.wrapupDocRel))}`,
    `③ 交接：交接件写事实与待办，不写时间现场${refNote(docRef(c, c.wrapupDocRel))}`,
    `④ 散落物：临时物只许放指定的临时区，越界的收回去${refNote(docRef(c, c.wrapupTempDocRel))}`,
    `⑤ 必答三态：清理/归档/交接各做了什么、没做的为什么——不许一句「没事了」交卷${refNote(String(c.wrapupOrderDoc ?? '').trim())}`,
    '（只递卡不拦人，不用回复这条）',
    '</system-reminder>',
  ].join('\n');
}

/** 追因卡正文（三问递进，方案给在出生层）。 */
export function buildCauseCardText(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const birth = docRef(c, c.causeBirthDocRel);
  return [
    '<system-reminder>',
    '追因卡——这条消息在问「怎么办／为什么不行／给个方案」：出方案前先答三问，一层比一层往前推：',
    `① 这个问题被什么前提触发？${refNote(docRef(c, c.causeDisciplineDocRel))}`,
    `② 那前提靠什么成立？${refNote(docRef(c, c.causeMetaDocRel))}`,
    `③ 出生层在哪——方案给在出生层，不给在别层；拿不出出生层的方案就先别出，治标的话先挂根治点${refNote(docRef(c, c.causeRootfixDocRel))}`,
    birth === '' ? '三问正本：未配置（config.causeBirthDocRel 指到你的追因方法篇）' : `三问正本：${birth}`,
    '（只递卡不拦人，不用回复这条）',
    '</system-reminder>',
  ].join('\n');
}

/** 触发判定的小工具：取最后一条真人用户消息。 */
export function lastHumanMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (message?.role === 'user' && message?.source?.kind === 'user') return message;
  }
  return null;
}

/** 这条消息带没带图片附件。 */
export function hasImageAttachment(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts.some((part) => typeof part?.type === 'string' && part.type.toLowerCase().includes('image'));
}

/** 本轮（最后一条真人消息之后）用没用过看图工具。 */
export function findImageToolUse(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let lastHuman = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (message?.role === 'user' && message?.source?.kind === 'user') { lastHuman = i; break; }
  }
  if (lastHuman < 0) return false;
  for (let i = lastHuman + 1; i < list.length; i += 1) {
    const message = list[i];
    if (message?.role !== 'assistant') continue;
    const parts = Array.isArray(message.content) ? message.content : [];
    if (parts.some((part) => part?.type === 'tool_use' && IMAGE_TOOL_PATTERN.test(String(part.name ?? '')))) return true;
  }
  return false;
}

/** 看图卡触发判定（任一即递）。 */
export function isImageTurn({ humanText = '', messages = [] } = {}) {
  return hasImageAttachment(lastHumanMessage(messages))
    || IMAGE_KEYWORD.test(String(humanText ?? ''))
    || findImageToolUse(messages);
}

export function isFeasibilityQuestion(text = '') {
  return FEASIBILITY_QUESTION.test(String(text ?? ''));
}

export function isWrapupMessage(text = '') {
  return WRAPUP_TRIGGER.test(String(text ?? ''));
}

export function isCauseQuestion(text = '') {
  return CAUSE_TRIGGER.test(String(text ?? ''));
}

export function isSettleMessage(text = '') {
  return SETTLE_KEYWORD.test(String(text ?? ''));
}

/**
 * 粗略 token 估算：中日韩字符按 1.5 字/token，其余按 4 字符/token。
 * 只用来守预算，不保证与真实分词器一致。
 */
export function estimateTokens(text) {
  const src = String(text ?? '');
  let cjk = 0;
  let other = 0;
  for (const ch of src) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/* --------------------------------- 回复体检 --------------------------------- */

/**
 * 体检规则（只提醒不阻断，误伤无害，刻意收窄）：
 *   · schedule：时间词 + 12 字内出现「发／上线／装／改／交付／开始／做完」这类未来动作词。
 *   · cost：成本词 + 12 字内出现「高／大／多／不够／有限／省／控制／超」，或「少跑／别测」类省钱句式。
 * 反例（不许误伤）：「今晚没有进程在跑」——时间词后面没有未来动作词，不命中。
 */
export const LINT_RULES = Object.freeze([
  {
    key: 'schedule',
    label: '排期话',
    source: '(?:明天|今天|今晚|明早|明晚|下周|本周)[^。\\n]{0,12}(?:发|上线|装|改|开始|交付|做完|提交|跑)|(?:上午|下午|晚上)[^。\\n]{0,10}(?:发|上线|装|开始|交付|做完)',
  },
  {
    key: 'cost',
    label: '自设预算',
    source: '(?:花(?:钱|费)|成本|费用|额度|预算|省钱|按量计费|充值|欠费)[^。\\n]{0,12}(?:高|大|多|不够|有限|省|控制|超)|(?:少|别|不要)[^。\\n]{0,6}(?:跑|测|试)[^。\\n]{0,6}(?:省钱|花钱|成本|额度|费用)',
  },
]);

/** 扫一段助手回复，返回命中清单（空数组＝干净）。纯函数。 */
export function scanReplyText(text) {
  const src = String(text ?? '');
  const hits = [];
  const NEGATION = /没有|没在|不在|并非|并不|不是|不会|无[^。\n]{0,3}(?:进程|人|事)/;
  for (const rule of LINT_RULES) {
    const re = new RegExp(rule.source, 'g');
    for (const match of src.matchAll(re)) {
      if (NEGATION.test(match[0])) continue;
      const at = match.index ?? 0;
      const excerpt = src.slice(Math.max(0, at - 8), Math.min(src.length, at + match[0].length + 8))
        .replace(/\s+/g, ' ');
      hits.push({ key: rule.key, label: rule.label, match: match[0], excerpt });
      if (hits.length >= 4) return hits;
    }
  }
  return hits;
}

/** 取最后一条助手回复的正文。 */
export function lastAssistantText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (message?.role !== 'assistant') continue;
    const text = (Array.isArray(message.content) ? message.content : [])
      .map((part) => (part?.type === 'text' ? part.text : ''))
      .join('\n');
    if (text.trim() !== '') return { id: message.id ?? `at-${i}`, text };
  }
  return null;
}

/** 体检提醒正文。 */
export function buildLintText(hits) {
  const lines = ['<system-reminder>', '上一轮回复体检（自动，只看上一条助手回复）：'];
  for (const hit of hits) lines.push(`- ${hit.label}：「${hit.match}」`);
  lines.push(
    '规矩：汇报不写未来时刻，只写卡在哪条前提。',
    '这一轮按规矩写即可，不用解释这条提醒。',
    '</system-reminder>',
  );
  return lines.join('\n');
}

/* ------------------------------- 消息构造与注入 ------------------------------- */

/** 造一条带来源的持久 user 消息（满足宿主对 user 消息的硬要求）。 */
export function createContextMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ ...SOURCE }),
  });
}

/** 这条消息是不是本插件发的（回放/压缩/重入时用来去重）。 */
export function isContextMessage(message) {
  return Boolean(message) && typeof message === 'object'
    && message.source?.kind === SOURCE.kind;
}

/** 口头禅/虚词表：这些词进检索只会带来噪音，自动检索时直接丢掉。 */
const STOPWORDS = new Set([
  '任务', '一下', '查一下', '看看', '看下', '怎么办', '怎么弄', '有没有', '能不能', '帮我',
  '这个', '那个', '现在', '然后', '还是', '就是', '可以', '需要', '问题', '麻烦',
]);

/** 从用户消息里取关键词：去重、去太短的、去口头禅、最多 N 个。 */
export function pickKeywords(text, max = DEFAULTS.autoSearchKeywordsMax) {
  const tokens = String(text ?? '').split(/[^\p{Script=Han}A-Za-z0-9_.\\/-]+/u);
  const out = [];
  for (const raw of tokens) {
    const token = raw.replace(/^[\\/.-]+|[\\/.-]+$/g, '');
    if (token.length < 2) continue;
    if (!/[\u3000-\u9fff]/.test(token) && token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    if (out.includes(token)) continue;
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 内置检索：只列文件名（不带正文，省 token）。
 * 拿不到 rg、超时、非零退出、没有命中——一律返回空数组，绝不抛错、绝不阻塞这一步。
 */
export function defaultSearchRunner(keywords, root, config) {
  if (!Array.isArray(keywords) || keywords.length === 0) return [];
  if (typeof root !== 'string' || root.trim() === '') return [];
  const rg = typeof config?.rgPath === 'string' && config.rgPath.trim() !== '' ? config.rgPath : 'rg';
  const args = ['--no-messages', '--files-with-matches', '-g', '*.md', '-g', '!**/archive/**', '-F'];
  for (const kw of keywords) args.push('-e', kw);
  args.push(root);
  const result = spawnSync(rg, args, {
    encoding: 'utf8',
    timeout: config.autoSearchTimeoutMs,
    windowsHide: true,
    maxBuffer: 1 << 20,
  });
  if (!result.error && result.status === 0) {
    return String(result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, config.autoSearchMaxHits);
  }
  // rg 缺失或启动失败 → 退回 PowerShell 检索
  if (result.error || result.status === null) return powershellSearch(keywords, root, config);
  return [];
}

/**
 * 兜底检索：一次 pwsh 调用把所有关键词交给 Select-String，只回文件路径。
 * （不用 findstr：它对中文关键词按字面量检索在对不上的控制台编码下会静默零命中。）
 */
function powershellSearch(keywords, root, config) {
  const max = config.autoSearchMaxHits ?? 5;
  const words = keywords.filter((kw) => typeof kw === 'string' && kw !== '' && !/['\r\n]/.test(kw));
  if (words.length === 0) return [];
  const patternList = words.map((kw) => `'${kw.replace(/'/g, "''")}'`).join(',');
  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    `$hits = Select-String -Path '${root.replace(/'/g, "''")}\\**\\*.md' -Pattern ${patternList} -List -ErrorAction SilentlyContinue`,
    `$hits | Where-Object { $_.Path -notmatch '\\\\archive\\\\' } | ForEach-Object { $_.Path } | Select-Object -Unique -First ${max}`,
  ].join('; ');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: config.autoSearchTimeoutMs,
    windowsHide: true,
    maxBuffer: 1 << 20,
  });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, max);
}

/**
 * 决定这一步要不要注入检索卡：决策是 enter、是这条用户消息的第一步、本轮还没发过卡。
 */
export function shouldInject({ decision, step, messages }) {
  if (!decision || decision.kind !== 'enter') return false;
  if (step !== 1) return false;
  const list = Array.isArray(decision.messages) ? decision.messages : [];
  return !list.some((message) => isContextMessage(message));
}

/** 插到「本条用户消息之后、其余背景之前」；没有用户消息就插到最前。 */
export function insertCard(decision, claimed, card) {
  const list = Array.isArray(decision.messages) ? decision.messages : [];
  const items = Array.isArray(card) ? card : [card];
  const clamp = (index) => Math.max(0, Math.min(index, list.length));
  const lastClaimedIndex = list.findLastIndex((message) => claimed.includes(message));
  const at = clamp(lastClaimedIndex + 1);
  return { ...decision, messages: [...list.slice(0, at), ...items, ...list.slice(at)] };
}

/** 日志按天切一份（`xxx-YYYYMMDD.log`），旧份一律不删。 */
function datedLogPath(path) {
  if (typeof path !== 'string' || path === '') return '';
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const suffix = `-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return path.replace(/\.log$/i, `${suffix}.log`);
}

function logLine(config, line) {
  const path = datedLogPath(typeof config.lintLog === 'string' ? config.lintLog.trim() : '');
  if (path === '') return;
  try {
    appendFileSync(path, line, 'utf8');
  } catch {
    /* 日志失败不打断这一步 */
  }
}

/** 体检诊断：lintDebug 打开时把「这一步看得见哪些消息」记一行，定位用，用完该关。 */
function logLintDebug(config, { claimed = [], decision = {}, last = null, lintHits = [] } = {}) {
  const path = datedLogPath(typeof config.lintLog === 'string' ? config.lintLog.trim() : '');
  if (path === '') return;
  const stamps = (list) => list.map((m) => `${m?.role ?? '?'}:${String(m?.id ?? '').slice(0, 6)}`).join(',');
  const dmsgs = Array.isArray(decision.messages) ? decision.messages : [];
  const lastText = last === null ? '-' : last.text.replace(/[\t\r\n]+/g, ' ').slice(-60);
  logLine(config, `${new Date().toISOString()}\tdebug\tclaimed=${claimed.length}[${stamps(claimed)}]`
    + `\tdecision=${dmsgs.length}[${stamps(dmsgs)}]`
    + `\tlast=${last === null ? 'none' : last.id}\thits=${lintHits.length}\ttail="${lastText}"\n`);
}

/** 体检审计：命中一次记一行。 */
function logLintHit(config, hits) {
  const path = datedLogPath(typeof config.lintLog === 'string' ? config.lintLog.trim() : '');
  if (path === '') return;
  const detail = hits.map((hit) => `${hit.key}:"${hit.match.replace(/[\t\r\n]/g, ' ')}"`).join(' ');
  logLine(config, `${new Date().toISOString()}\tlint\thits=${hits.length}\t${detail}\n`);
}

/**
 * 插件入口。挂载后只做一件事：在 agent/pre-step 里按判据发卡。
 * @param ctx 宿主上下文
 * @param rawConfig 装配那一行里的 config（可省略；见 README 配置表）
 */
export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  if (config.enabled === false) return;

  const runner = typeof config.searchRunner === 'function'
    ? config.searchRunner
    : defaultSearchRunner;

  let lastLintedId = null;      // 回复体检：同一条助手回复只提醒一次
  let imageCardTurnId = null;   // 看图卡：同一轮只递一次
  let wrapupCardTurnId = null;  // 收尾自检卡：同一轮只递一次
  let causeCardTurnId = null;   // 追因卡：同一轮只递一次

  ctx.effect(() => ctx.on('agent/pre-step', async (ctxInfo, next) => {
    const decision = await next();
    const { messages, step } = ctxInfo ?? {};
    const claimed = Array.isArray(messages) ? messages : [];
    if (!decision || decision.kind !== 'enter') return decision;

    const notices = [];
    let lintNotice = null;

    // 这条消息里「真人用户」写的字（不含我们注入的卡）：用于各卡触发判断。
    const humanText = claimed
      .filter((message) => message && message.role === 'user' && message?.source?.kind === 'user')
      .map((message) => (Array.isArray(message?.content) ? message.content : [])
        .map((part) => (part?.type === 'text' ? part.text : ''))
        .join('\n'))
      .join('\n');

    // 1) 回复体检：每轮第一步回看上一条助手回复。只提醒，不阻断。
    if (config.lint !== false && step === 1) {
      const fromDecision = Array.isArray(decision.messages) ? decision.messages : [];
      const last = lastAssistantText(fromDecision) ?? lastAssistantText(claimed);
      const lintHits = last === null ? [] : scanReplyText(last.text);
      if (config.lintDebug === true) logLintDebug(config, { claimed, decision, last, lintHits });
      if (last && last.id !== lastLintedId) {
        lastLintedId = last.id;
        if (lintHits.length > 0) {
          logLintHit(config, lintHits);
          lintNotice = createContextMessage(buildLintText(lintHits));
        }
      }
    }

    // 2) 检索卡（enter + 这条消息第一步 + 本轮还没发过卡）＋回话格式卡（每轮都带）。
    if (shouldInject({ decision, step, messages: claimed })) {
      let hits = [];
      if (config.autoSearch === true) {
        const keywords = pickKeywords(humanText, config.autoSearchKeywordsMax);
        try {
          const found = await runner(keywords, config.libraryRoot, config);
          hits = Array.isArray(found) ? found.slice(0, config.autoSearchMaxHits) : [];
        } catch {
          hits = [];
        }
      }
      notices.push(createContextMessage(buildCardText(config, hits)));
      if (config.replyFormatCard !== false) {
        notices.push(createContextMessage(buildReplyFormatCardText(config)));
      }
    }

    // 3) 看图卡：同一轮只递一次（记最近发卡那条真人消息 id）。
    if (config.imageCard !== false) {
      const scanMessages = Array.isArray(decision.messages) && decision.messages.length > 0 ? decision.messages : claimed;
      const human = lastHumanMessage(scanMessages);
      const turnId = human === null ? null : String(human.id ?? '');
      if (turnId !== null && turnId !== '' && turnId !== imageCardTurnId
        && isImageTurn({ humanText, messages: scanMessages })) {
        imageCardTurnId = turnId;
        notices.push(createContextMessage(buildImageCardText(config)));
      }
    }

    // 4) 先找现成方案卡：可行性问句形状才递。
    if (config.solutionCard !== false && step === 1 && isFeasibilityQuestion(humanText)) {
      notices.push(createContextMessage(buildSolutionCardText(config)));
    }

    // 5) 沉淀卡：与检索卡分开判，换一轮也照样贴。
    if (config.settleCard !== false && step === 1 && isSettleMessage(humanText)) {
      notices.push(createContextMessage(buildSettleCardText(config)));
    }

    // 6) 收尾自检卡：同一轮只递一次。
    if (config.wrapupCard !== false && step === 1) {
      const scanMessages = Array.isArray(decision.messages) && decision.messages.length > 0 ? decision.messages : claimed;
      const human = lastHumanMessage(scanMessages);
      const turnId = human === null ? null : String(human.id ?? '');
      if (turnId !== null && turnId !== '' && turnId !== wrapupCardTurnId && isWrapupMessage(humanText)) {
        wrapupCardTurnId = turnId;
        notices.push(createContextMessage(buildWrapupCardText(config)));
      }
    }

    // 7) 追因卡：同一轮只递一次。
    if (config.causeCard !== false && step === 1) {
      const scanMessages = Array.isArray(decision.messages) && decision.messages.length > 0 ? decision.messages : claimed;
      const human = lastHumanMessage(scanMessages);
      const turnId = human === null ? null : String(human.id ?? '');
      if (turnId !== null && turnId !== '' && turnId !== causeCardTurnId && isCauseQuestion(humanText)) {
        causeCardTurnId = turnId;
        notices.push(createContextMessage(buildCauseCardText(config)));
      }
    }

    if (notices.length === 0 && lintNotice === null) return decision;
    // 全序：检索→格式→看图→方案→沉淀→收尾→追因，体检提醒最后。
    if (lintNotice !== null) notices.push(lintNotice);
    return insertCard(decision, claimed, notices);
  }));
}

/** 给自检用的内部件（不在生产路径上主动调用）。 */
export const internals = {
  DEFAULTS, ROOT_PLACEHOLDER, docRef, refNote,
  buildCardText, buildLongTaskLine, buildReplyFormatCardText, buildImageCardText,
  buildSolutionCardText, buildSettleCardText, buildWrapupCardText, buildCauseCardText,
  REPLY_FORMAT_POINTS, LINT_RULES, scanReplyText, lastAssistantText, buildLintText,
  estimateTokens, createContextMessage, isContextMessage, pickKeywords,
  shouldInject, insertCard, lastHumanMessage, hasImageAttachment, findImageToolUse, isImageTurn,
  isFeasibilityQuestion, isWrapupMessage, isCauseQuestion, isSettleMessage,
  SETTLE_KEYWORD, IMAGE_KEYWORD, IMAGE_TOOL_PATTERN, FEASIBILITY_QUESTION, WRAPUP_TRIGGER, CAUSE_TRIGGER,
};
