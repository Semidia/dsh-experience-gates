/**
 * dsh-web-local-gate · 骨架版自检
 * 口径：不依赖任何本机路径；末行打 `ALL_PASS` 即全绿。
 * 最后一组用例自扫插件源码，断言「本机特征」零命中（特征串在运行时拼出来，
 * 本文件源码里不出现它们的连续字样）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_TOOLS, normalizeConfig, evaluateWeb, reasonText, shortReasonText, createGuard,
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

/** 测试用配置：占位值全部避开本机特征（运行时才有具体值，源码里只有这些写法）。 */
const CFG = {
  gateRoot: '/note-root',
  proxyDoc: 'net/local-notes.md',
  errDoc: 'net/proxy-trouble.md',
  scriptPath: '/tools/fetch-via-proxy.ps1',
  proxyUrl: 'http://127.0.0.1:3128',
};

function humanMsg(id, rpcId = 'rpc-1') {
  return { id, role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user', ...(rpcId ? { rpcId } : {}) } };
}

/* ---------- 判定 ---------- */

t('T01 两个官方联网工具都拦，别的工具不拦', () => {
  assert.equal(evaluateWeb({ toolName: 'web_search' }).blocked, true);
  assert.equal(evaluateWeb({ toolName: 'web_fetch' }).blocked, true);
  assert.equal(evaluateWeb({ toolName: 'read' }).blocked, false);
  assert.equal(DEFAULT_TOOLS.length, 2);
});

t('T02 总开关关掉：两个工具都放行（key=disabled）', () => {
  const verdict = evaluateWeb({ toolName: 'web_search', enabled: false });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.key, 'disabled');
});

/* ---------- 文案 ---------- */

t('T03 全文案（未配置）：可执行一步在、代理提示去配置填、特征端口零命中、无盘符路径', () => {
  const text = reasonText({ toolName: 'web_search', config: {} });
  assert.ok(text.includes('curl -sL'));
  assert.ok(text.includes('proxyUrl'));
  assert.ok(!text.includes(['78', '90'].join('')));
  assert.ok(!DRIVE_RE.test(text));
  assert.ok(text.includes('enabled: false'));
  assert.ok(text.includes('proxyDoc'));
});

t('T04 全文案（配置齐）：代理命令可照抄、两篇出处与脚本都在', () => {
  const text = reasonText({ toolName: 'web_fetch', config: CFG });
  assert.ok(text.includes('curl -sL -x http://127.0.0.1:3128'));
  assert.ok(text.includes('/note-root\\net/local-notes.md'));
  assert.ok(text.includes('/note-root\\net/proxy-trouble.md'));
  assert.ok(text.includes('/tools/fetch-via-proxy.ps1'));
});

t('T05 只配一篇出处：文案只展示那一篇', () => {
  const text = reasonText({ toolName: 'web_search', config: { proxyDoc: 'net/only.md' } });
  assert.ok(text.includes('先读这篇再动手：net/only.md'));
  assert.ok(!text.includes('两篇'));
});

/* ---------- 短文案与分桶 ---------- */

t('T06 同轮第 2 次给短文案；新真人消息开新轮重新给全', () => {
  const guard = createGuard(CFG);
  guard.notePreStep({ messages: [humanMsg('u-1')], agentId: 'A1' });
  const first = guard({ name: 'web_search', agentId: 'A1' });
  const second = guard({ name: 'web_fetch', agentId: 'A1' });
  assert.ok(first.includes('已拦下'));
  assert.ok(second.includes('本轮第 2 次拦'));
  guard.notePreStep({ messages: [humanMsg('u-2')], agentId: 'A1' }); // 新真人消息
  const third = guard({ name: 'web_search', agentId: 'A1' });
  assert.ok(third.includes('已拦下'));
});

t('T07 工单事件只清自己的桶：别人计数不受影响', () => {
  const guard = createGuard(CFG);
  guard.notePreStep({ messages: [humanMsg('u-1')], agentId: 'A1' });
  assert.ok(guard({ name: 'web_search', agentId: 'A1' }).includes('已拦下'));
  // 工单事件（无 rpcId）清 A1 自己的桶
  guard.notePreStep({ messages: [humanMsg('t-1', '')], agentId: 'A1' });
  // B 代理第一撞：仍是全文案
  guard.notePreStep({ messages: [humanMsg('u-1')], agentId: 'B2' });
  assert.ok(guard({ name: 'web_fetch', agentId: 'B2' }).includes('已拦下'));
});

t('T08 审计计数与轮内计数分家：第一次撞门就是全文案', () => {
  const guard = createGuard(CFG);
  guard.notePreStep({ messages: [humanMsg('u-1')], agentId: 'A1' });
  const first = guard({ name: 'web_search', agentId: 'A1' });
  assert.equal(guard.snapshot().totalDenies, 1);
  assert.ok(first.includes('已拦下')); // 若两计数混用，这里会误变短文案
});

/* ---------- 骨架自扫：本机特征零命中 ---------- */

t('T09 插件全部源文件：本机特征清单零命中、盘符形状零命中', () => {
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
