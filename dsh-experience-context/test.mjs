/**
 * dsh-experience-context · 骨架版自检
 * 口径：不依赖任何本机路径；末行打 `ALL_PASS` 即全绿。
 * 最后一组用例自扫插件源码，断言「本机特征」零命中（特征串在运行时拼出来，
 * 本文件源码里不出现它们的连续字样）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULTS, ROOT_PLACEHOLDER, docRef, refNote,
  buildCardText, buildLongTaskLine, buildReplyFormatCardText, buildImageCardText,
  buildSolutionCardText, buildSettleCardText, buildWrapupCardText, buildCauseCardText,
  REPLY_FORMAT_POINTS, scanReplyText, estimateTokens,
  createContextMessage, isContextMessage, shouldInject, insertCard,
  isSettleMessage, isFeasibilityQuestion, isWrapupMessage, isCauseQuestion,
} from './index.js';

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

const SKELETON_FILES = ['index.js', 'test.mjs', 'README.md', 'package.json', 'cordis.patch.yml'];

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

const EMPTY_CFG = { ...DEFAULTS };

/* ---------- 检索卡 ---------- */

t('T01 未配置库根：检索卡用占位文案，不带盘符路径', () => {
  const text = buildCardText(EMPTY_CFG, []);
  assert.ok(text.includes(ROOT_PLACEHOLDER));
  assert.ok(!DRIVE_RE.test(text));
  assert.ok(text.includes('长活先派'));
});

t('T02 配置库根：命令示例拼上根，出处键留空不带出处括号', () => {
  const text = buildCardText({ ...EMPTY_CFG, libraryRoot: '/test-root', longTaskDocRel: '' }, []);
  assert.ok(text.includes('1) rg -n "<关键词>" /test-root'));
  assert.ok(!text.includes('（出处：'));
});

t('T03 分卷：配置了就列一行，数对了', () => {
  const text = buildCardText({ ...EMPTY_CFG, volumes: ['alpha', 'beta'] }, []);
  assert.ok(text.includes('分卷（2 个）：alpha／beta'));
  assert.ok(text.includes('3) rg -n "<关键词>" ' + ROOT_PLACEHOLDER + '\\alpha'));
});

t('T04 未配分卷：不列分卷行', () => {
  const text = buildCardText(EMPTY_CFG, []);
  assert.ok(!text.includes('分卷（'));
});

t('T05 长活行：出处配了就带（出处：…），没配就不带', () => {
  const withRef = buildLongTaskLine({ ...EMPTY_CFG, longTaskDocRel: 'guides/dispatch.md', libraryRoot: '/test-root' });
  const noRef = buildLongTaskLine(EMPTY_CFG);
  assert.ok(withRef.includes('（出处：/test-root\\guides/dispatch.md）'));
  assert.ok(!noRef.includes('（出处：'));
});

/* ---------- 回话格式卡 ---------- */

t('T06 回话格式卡：要点 21 条，私有篇名字样为零，出处未配置有提示', () => {
  const text = buildReplyFormatCardText(EMPTY_CFG);
  assert.equal(REPLY_FORMAT_POINTS.length, 21);
  assert.ok(!text.includes(['五段', '式'].join('')));
  assert.ok(text.includes('理由与正反两面利弊必给'));
  assert.ok(text.includes('replyFormatDocRel'));
  assert.ok(!DRIVE_RE.test(text));
});

/* ---------- 看图卡 / 方案卡 ---------- */

t('T07 看图卡：像素分析与 OCR 两路都在；未配置不带路径', () => {
  const text = buildImageCardText(EMPTY_CFG);
  assert.ok(text.includes('像素分析'));
  assert.ok(text.includes('OCR'));
  assert.ok(text.includes('imageDocRel'));
  assert.ok(!DRIVE_RE.test(text));
});

t('T08 方案卡：curl 直连优先 + 可配置代理；未配代理提示去配置填；特征端口零命中', () => {
  const text = buildSolutionCardText(EMPTY_CFG);
  assert.ok(text.includes('curl 直连优先'));
  assert.ok(text.includes('proxyUrl'));
  assert.ok(!text.includes(['78', '90'].join('')));
  const configured = buildSolutionCardText({ ...EMPTY_CFG, proxyUrl: 'http://127.0.0.1:3128', networkDocRel: 'net/proxy.md', libraryRoot: '/test-root' });
  assert.ok(configured.includes('-x http://127.0.0.1:3128'));
  assert.ok(configured.includes('（出处：/test-root\\net/proxy.md）'));
});

/* ---------- 沉淀卡 / 收尾卡 / 追因卡 ---------- */

t('T09 沉淀卡：四件事齐全；标题不带私有篇名连续字样', () => {
  const text = buildSettleCardText(EMPTY_CFG);
  assert.ok(text.includes('① 经验'));
  assert.ok(text.includes('④ 规则'));
  assert.ok(!text.includes(['沉淀', '四联'].join('')));
  assert.ok(text.includes('settleDocRel'));
});

t('T10 收尾卡：五桶齐全，⑤必答三态在；出处留空零路径', () => {
  const text = buildWrapupCardText(EMPTY_CFG);
  for (const mark of ['①', '②', '③', '④', '⑤']) assert.ok(text.includes(mark));
  assert.ok(text.includes('必答三态'));
  assert.ok(!DRIVE_RE.test(text));
  const configured = buildWrapupCardText({ ...EMPTY_CFG, wrapupOrderDoc: '/notes/order.md' });
  assert.ok(configured.includes('（出处：/notes/order.md）'));
});

t('T11 追因卡：三问递进＋出生层在；出处未配置有提示', () => {
  const text = buildCauseCardText(EMPTY_CFG);
  assert.ok(text.includes('① 这个问题被什么前提触发'));
  assert.ok(text.includes('③ 出生层在哪'));
  assert.ok(text.includes('causeBirthDocRel'));
  const configured = buildCauseCardText({ ...EMPTY_CFG, causeBirthDocRel: 'docs/cause.md', libraryRoot: '/test-root' });
  assert.ok(configured.includes('三问正本：/test-root\\docs/cause.md'));
});

/* ---------- 触发形状（正反例） ---------- */

t('T12 沉淀触发是窄口：规则本命中、光说规则不命中', () => {
  assert.equal(isSettleMessage('把这个写成规则'), true);
  assert.equal(isSettleMessage('改一下游戏规则'), false);
});

t('T13 可行性问句：只能…吗／有没有办法…？命中，陈述句不命中', () => {
  assert.equal(isFeasibilityQuestion('只能这样吗'), true);
  assert.equal(isFeasibilityQuestion('有没有办法导出？'), true);
  assert.equal(isFeasibilityQuestion('这样可以'), false);
});

t('T14 收尾与追因形状：正反例各一', () => {
  assert.equal(isWrapupMessage('今天收工了吗'), true);
  assert.equal(isWrapupMessage('开工'), false);
  assert.equal(isCauseQuestion('为什么做不到'), true);
  assert.equal(isCauseQuestion('为什么天是蓝的'), false);
});

/* ---------- 注入机制 ---------- */

t('T15 注入消息三件套齐全，且能被 isContextMessage 认出', () => {
  const msg = createContextMessage('卡');
  assert.equal(msg.role, 'user');
  assert.equal(typeof msg.id, 'string');
  assert.ok(Array.isArray(msg.content));
  assert.equal(msg.source.kind, 'experience-context');
  assert.equal(isContextMessage(msg), true);
});

t('T16 shouldInject 三判据 + insertCard 插在用户消息之后；发过卡不再发', () => {
  const user = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } };
  const decision = { kind: 'enter', messages: [user] };
  assert.equal(shouldInject({ decision, step: 1, messages: [user] }), true);
  assert.equal(shouldInject({ decision, step: 2, messages: [user] }), false);
  assert.equal(shouldInject({ decision: { kind: 'reject' }, step: 1, messages: [user] }), false);
  const card = createContextMessage('卡');
  const next = insertCard(decision, [user], card);
  assert.equal(next.messages[1], card);
  assert.equal(shouldInject({ decision: next, step: 1, messages: [user] }), false);
});

/* ---------- 字数预算与体检 ---------- */

t('T17 默认检索卡在 300 token 预算内', () => {
  assert.ok(estimateTokens(buildCardText(EMPTY_CFG, [])) <= 300);
});

t('T18 回复体检：排期话命中、否定句不误伤', () => {
  const hits = scanReplyText('明天上午发布新版本');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, 'schedule');
  assert.equal(scanReplyText('今晚没有进程在跑').length, 0);
});

/* ---------- 工具函数 ---------- */

t('T19 docRef：绝对路径原样返回，相对路径拼根，没根返回空', () => {
  assert.equal(docRef({ libraryRoot: '/test-root' }, 'a/b.md'), '/test-root\\a/b.md');
  assert.equal(docRef({ libraryRoot: '/test-root' }, '/abs/a.md'), '/abs/a.md');
  assert.equal(docRef({}, 'a/b.md'), '');
  assert.equal(refNote(''), '');
  assert.equal(refNote('/x.md'), '（出处：/x.md）');
});

/* ---------- 骨架自扫：本机特征零命中 ---------- */

t('T20 插件全部源文件：本机特征清单零命中、盘符形状零命中', () => {
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
