/**
 * dsh-experience-gate · 骨架版自检
 * 口径：用临时目录当假库，不碰任何本机路径；末行打 `ALL_PASS` 即全绿。
 * 最后一组用例自扫插件源码，断言「本机特征」零命中（特征串在运行时拼出来，
 * 本文件源码里不出现它们的连续字样）。
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  DEFAULT_GATE_ROOT, DEFAULT_TOOLS, DEFAULT_EXCLUDE_FILES, DEFAULT_MAX_HITS,
  judgeLongTask, longTaskDenyText, isUnderVolume, isUnder, normalizePath,
  countVolumeHits, mentionsRoot, isSearchCall, judgeSearch,
  normalizeConfig, evaluateSettle, evaluateDispatch, evaluateTurn,
  reasonText, reasonTextDispatch, reasonTextSettle,
  createGuard, isSettleTopic, patternFromCommand, tokensOf, isRelevantPattern,
} from './policy.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 本机特征清单（运行时拼接，源码内不含连续字样）。 */
const FORBIDDEN = [
  ['Admin', 'istrator'].join(''),
  ['Sem', 'idia'].join(''),
  ['for-qie-dell', '-skill'].join(''),
  ['agent', '临时'].join(''),
  ['沉淀', '四联'].join(''),
  ['五段', '式'].join(''),
  ['通用', '-'].join(''),
  ['47.1', '15'].join(''),
  ['78', '90'].join(''),
];
const DRIVE_RE = /[a-zA-Z]:\\/; // 盘符路径形状
const SKELETON_FILES = ['index.js', 'policy.js', 'test.mjs', 'README.md', 'package.json', 'cordis.patch.yml'];

let pass = 0;
let fail = 0;
const fails = [];
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok   - ${name}`);
  } catch (err) {
    fail += 1;
    fails.push(`${name}: ${err.message}`);
    console.log(`FAIL - ${name}`);
  }
}

/** 假库：临时目录＋两个分卷＋一个根目录说明件＋两篇必读出处。 */
const ROOT = mkdtempSync(join(tmpdir(), 'exp-gate-test-'));
for (const vol of ['vol-a', 'vol-b']) mkdirSync(join(ROOT, vol), { recursive: true });
mkdirSync(join(ROOT, 'guides'), { recursive: true });
writeFileSync(join(ROOT, 'vol-a', 'notes.md'), 'alpha\n');
writeFileSync(join(ROOT, 'README.md'), 'root readme\n');
writeFileSync(join(ROOT, 'guides', 'dispatch.md'), 'dispatch notes\n');
writeFileSync(join(ROOT, 'guides', 'settle.md'), 'settle notes\n');

const CFG = {
  gateRoot: ROOT,
  volumes: ['vol-a', 'vol-b'],
  dispatchDoc: 'guides/dispatch.md',
  settleDoc: 'guides/settle.md',
  longTaskDoc: 'guides/long.md',
  logDir: '',
};

/** 假钟：0 起步，手动拨。 */
function makeClock() {
  const state = { now: 1_000_000 };
  return {
    now: () => state.now,
    advance: (ms) => { state.now += ms; },
  };
}

function humanMsg(id, text, rpcId = 'rpc-1') {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', ...(rpcId ? { rpcId } : {}) } };
}
function newGuard(config = CFG, clock = makeClock()) {
  const guard = createGuard({ ...config, now: clock.now });
  return { guard, clock };
}
/** 无代理号开一轮：真人消息（带 rpcId）清全部桶，turnText 落在顶层默认桶。 */
function startTurn(guard, text = '需求相关词 alpha') {
  guard.notePreStep({ messages: [humanMsg('u-1', text)] });
}
/** 跑一次有效检索（分卷内命中），返回 true 才算置位。 */
function doSearch(guard, id = 's1') {
  const exec = { name: 'pwsh', id, arguments: { command: `rg -n "alpha" "${ROOT}"` } };
  assert.equal(guard(exec), undefined, '检索调用本身必须放行');
  return guard.noteResult(exec, { stdout: `${ROOT}\\vol-a\\notes.md:1:alpha` });
}

/* ---------- 配置与默认值 ---------- */

t('T01 默认配置：库根为空、排除件只有 README、上限 120', () => {
  const cfg = normalizeConfig({});
  assert.equal(cfg.gateRoot, '');
  assert.equal(DEFAULT_GATE_ROOT, '');
  assert.deepEqual(cfg.excludeFiles, ['README.md']);
  assert.equal(cfg.maxHits, DEFAULT_MAX_HITS);
  assert.equal(DEFAULT_EXCLUDE_FILES.length, 1);
  assert.equal(cfg.longTaskGate.thresholdSeconds, 30);
  assert.equal(DEFAULT_TOOLS.includes('read'), false);
});

t('T02 gateRoot 留空＝整道闸自停用：write 也放行', () => {
  const { guard } = newGuard({ ...CFG, gateRoot: '' });
  const verdict = guard({ name: 'write', arguments: { file_path: '/somewhere/x.txt', content: 'x' } });
  assert.equal(verdict, undefined);
});

/* ---------- 主闸红绿 ---------- */

t('T03 未检索先写：拦下，文案带可执行一步与库根', () => {
  const { guard } = newGuard();
  startTurn(guard);
  const verdict = guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'x.md'), content: 'x' } });
  assert.equal(typeof verdict, 'string');
  assert.ok(verdict.includes('rg -n'));
  assert.ok(verdict.includes(ROOT));
  assert.ok(verdict.includes('no-search'));
});

t('T04 检索调用本身无条件放行', () => {
  const { guard } = newGuard();
  startTurn(guard);
  const verdict = guard({ name: 'pwsh', arguments: { command: `rg -n "alpha" "${ROOT}"`, description: 'search' } });
  assert.equal(verdict, undefined);
});

t('T05 分卷内命中：noteResult 置位，随后写放行', () => {
  const { guard } = newGuard();
  startTurn(guard);
  assert.equal(doSearch(guard, 'c1'), true);
  const verdict = guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'y.md'), content: 'y' } });
  assert.equal(verdict, undefined);
});

t('T06 0 命中但检索词与消息有共同词：也算查过', () => {
  const { guard } = newGuard();
  startTurn(guard, '这条消息在问 alpha 的用法');
  const exec = { name: 'pwsh', id: 'c2', arguments: { command: `rg -n "alpha" "${ROOT}"` } };
  guard(exec);
  assert.equal(guard.noteResult(exec, { stdout: '' }), true);
  const verdict = guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-b', 'z.md'), content: 'z' } });
  assert.equal(verdict, undefined);
});

t('T07 0 命中且不相关：拦截文案回带原因', () => {
  const { guard } = newGuard();
  startTurn(guard, '这条消息在说完全无关的事情');
  const exec = { name: 'pwsh', id: 'c3', arguments: { command: `rg -n "qqqqzzzz" "${ROOT}"` } };
  guard(exec);
  assert.equal(guard.noteResult(exec, { stdout: '' }), false);
  const verdict = guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'w.md'), content: 'w' } });
  assert.equal(typeof verdict, 'string');
  assert.ok(verdict.includes('没有共同词'));
});

t('T08 太泛：命中超上限判无效，并收回已取得的放行权', () => {
  const { guard } = newGuard({ ...CFG, maxHits: 2 });
  startTurn(guard, '消息提到 alpha');
  assert.equal(doSearch(guard, 'c4'), true);
  const noisyExec = { name: 'pwsh', id: 'c4b', arguments: { command: `rg -n "alpha" "${ROOT}"` } };
  guard(noisyExec);
  const noisy = Array.from({ length: 3 }, (_, i) => `${ROOT}\\vol-a\\n${i}.md:1:alpha`).join('\n');
  assert.equal(guard.noteResult(noisyExec, { stdout: noisy }), false);
  const verdict = guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'v.md'), content: 'v' } });
  assert.equal(typeof verdict, 'string');
});

t('T09 只命中根目录说明件：不算查过', () => {
  const { guard } = newGuard();
  startTurn(guard, '消息提到 alpha');
  const exec = { name: 'pwsh', id: 'c5', arguments: { command: `rg -n "alpha" "${ROOT}"` } };
  guard(exec);
  assert.equal(guard.noteResult(exec, { stdout: `${ROOT}\\README.md:1:alpha` }), false);
  const verdict = guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'q.md'), content: 'q' } });
  assert.equal(typeof verdict, 'string');
});

t('T10 断路器：同代理连拦 2 次自动放开', () => {
  const { guard } = newGuard();
  startTurn(guard);
  const call = () => guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'a.md'), content: 'a' } });
  assert.equal(typeof call(), 'string');
  assert.equal(call(), undefined); // 第 2 次拦截触发断路器 → 直接放行
});

/* ---------- 子闸：派活与沉淀 ---------- */

t('T11 派活闸：查过库后 subagent 仍先拦；读到那篇后放行；send_message 不挡', () => {
  const { guard } = newGuard();
  startTurn(guard, '需求 alpha');
  assert.equal(doSearch(guard, 'd0'), true); // 先把主闸的放行权拿到，确保拦下的是派活闸
  const blocked = guard({ name: 'subagent', arguments: { prompt: '去干活', description: '活' } });
  assert.equal(typeof blocked, 'string');
  assert.ok(blocked.includes('guides/dispatch.md'));
  const readExec = { name: 'read', id: 'r1', arguments: { file_path: join(ROOT, 'guides', 'dispatch.md') } };
  assert.equal(guard(readExec), undefined); // read 不在拦截清单
  guard.noteResult(readExec, { text: '派活提醒块全文' }); // 读那篇 → 记已读（读 guides 不算检索）
  const verdict = guard({ name: 'subagent', arguments: { prompt: '去干活', description: '活' } });
  assert.equal(verdict, undefined);
  assert.equal(guard({ name: 'send_message', arguments: { text: 'hi' } }), undefined); // 不挡发消息
});

t('T12 dispatchDoc 留空＝派活子闸不生效', () => {
  const { guard } = newGuard({ ...CFG, dispatchDoc: '' });
  startTurn(guard, '需求 alpha');
  assert.equal(doSearch(guard, 'd1'), true);
  assert.equal(guard({ name: 'subagent', arguments: { prompt: '去干活', description: '活' } }), undefined);
});

t('T13 沉淀闸：沉淀话题写库先拦、文案不带私有篇名；检索＋读那篇后放行；写库外不受沉淀闸管', () => {
  const { guard } = newGuard();
  startTurn(guard, '记住这个偏好，把它写成规则');
  const inLib = join(ROOT, 'vol-a', 'new-entry.md');
  const blocked = guard({ name: 'write', arguments: { file_path: inLib, content: 'x' } });
  assert.equal(typeof blocked, 'string');
  assert.ok(blocked.includes('沉淀清单'));
  assert.ok(!blocked.includes(['沉淀', '四联'].join('')));
  assert.equal(doSearch(guard, 's0'), true); // 主闸放行权
  const readExec = { name: 'read', id: 'r2', arguments: { file_path: join(ROOT, 'guides', 'settle.md') } };
  guard(readExec);
  guard.noteResult(readExec, { text: '四件事清单' }); // 读那篇 → 记已读
  assert.equal(guard({ name: 'write', arguments: { file_path: inLib, content: 'x' } }), undefined);
  const outside = guard({ name: 'write', arguments: { file_path: '/elsewhere/out.md', content: 'x' } });
  assert.equal(outside, undefined); // 写库外本来就不受沉淀闸管
});

t('T14 settleDoc 留空＝沉淀子闸不生效', () => {
  const { guard } = newGuard({ ...CFG, settleDoc: '' });
  startTurn(guard, '记住这个偏好，把它写成规则');
  assert.equal(doSearch(guard, 's1'), true);
  assert.equal(guard({ name: 'write', arguments: { file_path: join(ROOT, 'vol-a', 'n.md'), content: 'n' } }), undefined);
});

/* ---------- 长活反馈（假钟计时） ---------- */

t('T15 长活反馈：两笔超时后对下一笔命令拦一次（带实测秒数），拦完自动放开', () => {
  const clock = makeClock();
  const { guard } = newGuard(CFG, clock);
  startTurn(guard);
  // 夹具前提：先把主闸放行权拿到——不然两笔命令先被主闸拦，两连拦触发断路器，整轮放开，长活闸测不到。
  assert.equal(doSearch(guard, 'L0'), true);
  const c1 = { name: 'pwsh', id: 'L1', arguments: { command: 'Get-Date', description: 't1' } };
  guard(c1);
  clock.advance(40_000);
  guard.noteResult(c1, { stdout: 'ok' });
  const c2 = { name: 'pwsh', id: 'L2', arguments: { command: 'Get-Date', description: 't2' } };
  guard(c2);
  clock.advance(40_000);
  guard.noteResult(c2, { stdout: 'ok' });
  clock.advance(1_000);
  const denied = guard({ name: 'pwsh', id: 'L4', arguments: { command: 'Get-Date', description: 't4' } });
  assert.equal(typeof denied, 'string');
  assert.ok(denied.includes('40 秒'));
  assert.ok(denied.includes('本轮长活已 2 笔'));
  assert.ok(denied.includes(ROOT)); // 出处路径拼配置库根
  assert.ok(denied.includes('——出处：')); // longTaskDoc 已配置 → 带出处
  const again = guard({ name: 'pwsh', id: 'L5', arguments: { command: 'Get-Date', description: 't5' } });
  assert.equal(again, undefined); // 拦完自动放开
});

t('T16 longTaskDoc 留空＝长活文案不带出处路径', () => {
  const text = longTaskDenyText({ seconds: 42, count: 2, gateRoot: ROOT, doc: '' });
  assert.ok(text.includes('42 秒'));
  assert.ok(!text.includes('——出处：'));
  assert.equal(judgeLongTask({ toolName: 'pwsh', seconds: 31 }).over, true);
  assert.equal(judgeLongTask({ toolName: 'read', seconds: 99 }).over, false);
});

/* ---------- 分桶与轮口径 ---------- */

t('T17 工单事件只清自己桶（A 再写要重查）；新真人消息清全部桶', () => {
  const { guard } = newGuard();
  guard.notePreStep({ messages: [humanMsg('u-1', '需求 alpha')], agentId: 'A1' });
  const exec = { name: 'pwsh', id: 'T1', arguments: { command: `rg -n "alpha" "${ROOT}"` }, agentId: 'A1' };
  guard(exec);
  guard.noteResult(exec, { stdout: `${ROOT}\\vol-a\\notes.md:1:alpha` });
  assert.equal(guard({ name: 'write', agentId: 'A1', arguments: { file_path: join(ROOT, 'vol-a', 'ok.md'), content: 'o' } }), undefined);
  // 工单事件（无 rpcId）只清 A1 自己的桶 → A1 再写要重新查
  guard.notePreStep({ messages: [humanMsg('t-1', '工单', '')], agentId: 'A1' });
  const again = guard({ name: 'write', agentId: 'A1', arguments: { file_path: join(ROOT, 'vol-a', 'ok2.md'), content: 'o' } });
  assert.equal(typeof again, 'string');
  // 新真人消息（带 rpcId）清全部桶
  guard.notePreStep({ messages: [humanMsg('u-2', '又一条 alpha')], agentId: 'A1' });
  const verdict = guard({ name: 'write', agentId: 'A1', arguments: { file_path: join(ROOT, 'vol-a', 'ok3.md'), content: 'o' } });
  assert.equal(typeof verdict, 'string');
});

t('T18 两个代理互不污染：A 查过、B 仍要自己查', () => {
  const { guard } = newGuard();
  guard.notePreStep({ messages: [humanMsg('u-1', '需求 alpha')], agentId: 'A1' });
  const exec = { name: 'pwsh', id: 'S1', arguments: { command: `rg -n "alpha" "${ROOT}"` }, agentId: 'A1' };
  guard(exec);
  guard.noteResult(exec, { stdout: `${ROOT}\\vol-a\\notes.md:1:alpha` });
  assert.equal(guard({ name: 'write', agentId: 'A1', arguments: { file_path: join(ROOT, 'vol-a', 'a1.md'), content: 'x' } }), undefined);
  const verdictB = guard({ name: 'write', agentId: 'B2', arguments: { file_path: join(ROOT, 'vol-a', 'b1.md'), content: 'x' } });
  assert.equal(typeof verdictB, 'string');
});

/* ---------- 纯函数边界 ---------- */

t('T19 路径判据边界：同前缀兄弟目录不算在库内', () => {
  assert.equal(isUnder('/data/lib/x.md', '/data/lib'), true);
  assert.equal(isUnder('/data/libx/x.md', '/data/lib'), false);
  assert.equal(isUnderVolume('/data/lib/vol-a/x.md', '/data/lib', ['vol-a']), true);
  assert.equal(isUnderVolume('/data/lib/vol-a/x.md', '/data/lib', ['vol-b']), false);
  assert.equal(isUnderVolume('/data/lib/root-file.md', '/data/lib', []), true); // 未配分卷＝宽口径
});

t('T20 检索词抽取：不把路径当检索词', () => {
  assert.equal(patternFromCommand(`rg -n "alpha" "${ROOT}"`), 'alpha');
  assert.equal(patternFromCommand(`Select-String -Pattern 'beta' -Path x`), 'beta');
  assert.ok(mentionsRoot(`先跑 rg -n "k" ${ROOT} 再说`, ROOT));
  assert.ok(!mentionsRoot('/data/libx/other', '/data/lib'));
});

t('T21 相关性判定：共同词才算相关；虚词不算共同词', () => {
  assert.equal(isRelevantPattern('alpha 配置', '这条消息在问 alpha 的配置'), true);
  assert.equal(isRelevantPattern('这个 那个', '这个 那个 都不行'), false);
  assert.ok(tokensOf('rg alpha').has('alpha'));
});

t('T22 拒绝文案不含私有篇名连续字样', () => {
  // 用合成根（posix 形状），不传 tmpdir 真路径——真路径里带着运行机器的用户名，会把文案检查污染成假红。
  const synthetic = '/test-root';
  const texts = [
    reasonText({ toolName: 'write', gateRoot: synthetic, volumes: ['vol-a'] }),
    reasonTextDispatch({ toolName: 'subagent', doc: 'guides/dispatch.md', gateRoot: synthetic }),
    reasonTextSettle({ doc: 'guides/settle.md', gateRoot: synthetic }),
  ];
  for (const text of texts) {
    for (const word of FORBIDDEN) assert.ok(!text.includes(word), `文案命中特征：${word}`);
    assert.ok(!DRIVE_RE.test(text), '文案命中盘符路径形状');
  }
});

t('T23 判定纯函数：关键键值逐一核对', () => {
  assert.equal(isSearchCall({ toolName: 'pwsh', targetText: `rg -n "k" ${ROOT}`, gateRoot: ROOT }), true);
  assert.equal(isSearchCall({ toolName: 'pwsh', targetText: 'Get-Date', gateRoot: ROOT }), false);
  assert.equal(evaluateTurn({ toolName: 'read', config: normalizeConfig(CFG) }).key, 'tool-not-listed');
  assert.equal(evaluateTurn({ toolName: 'write', config: normalizeConfig(CFG) }).key, 'no-search');
  assert.equal(evaluateDispatch({ toolName: 'send_message', config: normalizeConfig(CFG) }).key, 'not-dispatch');
  assert.equal(evaluateSettle({ toolName: 'edit', targetPath: '/x', settleTopic: true, config: normalizeConfig(CFG) }).key, 'not-in-library');
  assert.equal(isSettleTopic('把它写成规则'), true);
  assert.equal(isSettleTopic('今天天气不错'), false);
});

/* ---------- 骨架自扫：本机特征零命中 ---------- */

t('T24 插件全部源文件：本机特征清单零命中、盘符形状零命中', () => {
  for (const file of SKELETON_FILES) {
    const text = readFileSync(join(HERE, file), 'utf8');
    for (const word of FORBIDDEN) {
      assert.ok(!text.includes(word), `${file} 命中特征：${word}`);
    }
    assert.ok(!DRIVE_RE.test(text), `${file} 命中盘符路径形状`);
  }
});

/* ---------- 汇总 ---------- */

console.log(`\nPASSED=${pass} / ${pass + fail}    FAILED=${fail}`);
if (fail === 0) {
  console.log('ALL_PASS');
  process.exit(0);
} else {
  console.log(fails.join('\n'));
  process.exit(1);
}
