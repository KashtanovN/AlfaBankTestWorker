const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {chromium} = require('playwright');
let browser, page;
const source = fs.readFileSync(path.join(__dirname, '../automation.js'), 'utf8')
  .replace("  if (document.readyState === 'loading')", "  globalThis.testPlan = plan; return;\n  if (document.readyState === 'loading')");
before(async () => {
  browser = await chromium.launch({channel: process.env.TEST_BROWSER === 'chromium' ? undefined : (process.env.TEST_BROWSER || 'chrome'), headless: true});
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });
async function fixture(html, answers = ['Первый вариант']) {
  await page.setContent(html);
  await page.evaluate(answers => {
    globalThis.chrome = {runtime: {sendMessage: async () => ({})}};
    globalThis.alfaHelper = {getItems: () => [{question: 'Контрольный вопрос для проверки?', answers}]};
  }, answers);
  await page.addScriptTag({content: source});
}
async function plan() { return page.evaluate(() => { const p = testPlan(); return {label:p.label, blocked:p.blocked, id:p.el?.id}; }); }
test('selects the exact radio answer, then submits', async () => {
  await fixture('<h1>Контрольный вопрос для проверки?</h1><label><input id="a" type="radio" name="x">Первый вариант</label><label><input type="radio" name="x">Второй вариант</label><button id="submit">Ответить</button>');
  assert.equal((await plan()).label, 'Выбрать правильный вариант');
  await page.evaluate(() => testPlan().el.click());
  assert.equal((await plan()).id, 'submit');
});
test('clears wrong checkbox and selects all correct options', async () => {
  await fixture('<h1>Контрольный вопрос для проверки?</h1><label><input type="checkbox" checked>Лишний</label><label><input type="checkbox">Первый вариант</label><label><input type="checkbox">Второй вариант</label><button id="submit">Отправить</button>', ['Первый вариант', 'Второй вариант']);
  assert.equal((await plan()).label, 'Снять лишнюю отметку');
  for (let i = 0; i < 3; i++) await page.evaluate(() => testPlan().el.click());
  assert.equal((await plan()).id, 'submit');
});
test('unknown question does not submit or guess', async () => {
  await fixture('<h1>Другой вопрос</h1><label><input type="radio">Первый вариант</label><button>Отправить</button>');
  assert.match((await plan()).blocked, /Нет однозначного/);
});
test('duplicate answer labels stop automation', async () => {
  await fixture('<h1>Контрольный вопрос для проверки?</h1><label><input type="radio">Первый вариант</label><label><input type="radio">Первый вариант</label>');
  assert.match((await plan()).blocked, /сопоставить/);
});
test('expands lesson details before continuing and ignores navigation', async () => {
  await fixture('<nav><button aria-expanded="false">Меню</button></nav><main><details><summary id="expand">Материал</summary>Текст</details><button id="next">Продолжить</button></main>');
  assert.equal((await plan()).id, 'expand');
  await page.evaluate(() => testPlan().el.click());
  assert.equal((await plan()).id, 'next');
});
test('disabled Continue is never clicked', async () => {
  await fixture('<button disabled>Продолжить</button>');
  assert.equal((await plan()).id, undefined);
});
test('feedback with disabled options can continue', async () => {
  await fixture('<label><input type="checkbox" disabled>Ответ</label><button id="next">Продолжить</button>');
  assert.equal((await plan()).id, 'next');
});
test('multiple launch buttons require a manual choice', async () => {
  await fixture('<button>Начать</button><button>Начать</button><button>К следующей задаче</button>');
  assert.match((await plan()).blocked, /несколько кнопок запуска/);
});

