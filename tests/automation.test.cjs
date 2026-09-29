const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {chromium} = require('playwright');
let browser, page;
const source = fs.readFileSync(path.join(__dirname, '../automation.js'), 'utf8')
  .replace("  if (document.readyState === 'loading')", "  globalThis.testPlan = plan; globalThis.testRecordSlider = recordSlider; globalThis.testPlayMedia = playMedia; globalThis.testCustomAnswerAction = customAnswerAction; globalThis.testChosenCustom = chosenCustom; return;\n  if (document.readyState === 'loading')");
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
async function carousel(count = 3, loop = false) {
  await fixture('<button id="left" aria-label="Previous slide">◀</button><button id="right" aria-label="Next slide">▶</button><button id="continue" disabled>Продолжить</button>');
  await page.evaluate(({count,loop}) => {
    const right = document.querySelector('#right');
    let index = 0;
    const update = () => right.setAttribute('data-qa-data', `"el":"sliderElNav"|"name":"right"|"activeIndex":${index}|"disabled":false`);
    update();
    right.onclick = () => {
      index = loop ? (index + 1) % count : index + 1;
      update();
      if (loop ? index === 0 : index === count - 1) {
        document.querySelector('#continue').disabled = false;
        if (!loop) right.setAttribute('aria-disabled', 'true');
      }
    };
  }, {count,loop});
}
async function slideClick() { return page.evaluate(() => { const action = testPlan(); testRecordSlider(action); action.el.click(); return action.step; }); }
test('carousel traverses image-only slides and then continues', async () => {
  await carousel();
  assert.equal((await plan()).id, 'right');
  assert.equal(await slideClick(), 'slide-0');
  assert.equal(await slideClick(), 'slide-1');
  assert.equal((await plan()).id, 'continue');
});
test('looping carousel stops at previously visited slide', async () => {
  await carousel(3, true);
  for (let i = 0; i < 3; i++) assert.equal(await slideClick(), `slide-${i}`);
  assert.equal((await plan()).id, 'continue');
});
test('non-responsive carousel is not clicked repeatedly', async () => {
  await carousel();
  await page.evaluate(() => document.querySelector('#right').onclick = null);
  await slideClick();
  assert.equal((await plan()).id, undefined);
  assert.match((await plan()).blocked, /Ожидаю смену/);
});
test('two carousels on one page have separate progress', async () => {
  await carousel(2);
  await page.evaluate(() => {
    const second = document.querySelector('#right').cloneNode(true);
    second.id = 'second';
    document.body.insertBefore(second, document.querySelector('#continue'));
  });
  await slideClick();
  await page.evaluate(() => document.querySelector('#continue').disabled = true);
  assert.equal((await plan()).id, 'second');
});
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
  assert.match((await plan()).blocked, /Неоднозначная разметка вариантов ответа/);
});
test('expands lesson details only while Continue is disabled and ignores navigation', async () => {
  await fixture('<nav><button aria-expanded="false">Меню</button></nav><main><details><summary id="expand">Материал</summary>Текст</details><button id="next" disabled>Продолжить</button></main>');
  assert.equal((await plan()).id, 'expand');
  await page.evaluate(() => testPlan().el.click());
  await page.evaluate(() => document.querySelector('#next').disabled = false);
  assert.equal((await plan()).id, 'next');
});
test('Continue takes priority over unopened lesson blocks and unanswered quiz', async () => {
  await fixture('<details><summary>Материал</summary>Текст</details><label><input type="radio">Ответ</label><button id="next">Продолжить</button>');
  assert.equal((await plan()).id,'next');
});
test('combined answer and next button works with custom selected answer widgets', async () => {
  await fixture('<main><h1>Контрольный вопрос для проверки?</h1><div role="radio" aria-checked="true">Первый вариант</div><button id="answerNext">Ответить и перейти далее</button></main>');
  assert.equal((await plan()).id,'answerNext');
});
test('selects exact XML answer before combined submit button on custom controls', async () => {
  await fixture('<main><h1>Контрольный вопрос для проверки?</h1><div class="answer">Первый вариант</div><div class="answer">Другой вариант</div><button id="answerNext">Ответить и перейти далее</button></main>');
  await page.evaluate(() => globalThis.alfaHelper.getItems = () => [{id:'1',question:'Контрольный вопрос для проверки?',answers:['Первый вариант']}]);
  assert.equal((await plan()).label,'Выбрать правильный вариант');
  await page.evaluate(() => {const action=testPlan(); action.el.click(); testChosenCustom.add(action.customKey);});
  assert.equal((await plan()).id,'answerNext');
});
test('Continue takes priority over carousel', async () => {
  await carousel();
  await page.evaluate(() => document.querySelector('#continue').disabled=false);
  assert.equal((await plan()).id,'continue');
});
test('explicit section skip takes priority over interactive blocks', async () => {
  await fixture('<details><summary>Материал</summary>Текст</details><button id="skip">Пропустить раздел</button>');
  assert.equal((await plan()).id,'skip');
});
test('ambiguous exits stop instead of clicking an arbitrary button', async () => {
  await fixture('<button>Продолжить</button><button>Продолжить</button><details><summary>Материал</summary>Текст</details>');
  assert.match((await plan()).blocked,/несколько кнопок/);
});
test('disabled and navigation-only exits are not clicked', async () => {
  await fixture('<nav><button>Продолжить</button></nav><button aria-disabled="true">Пропустить раздел</button><button>К следующей задаче</button>');
  assert.equal((await plan()).id,undefined);
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
  assert.equal((await plan()).id, undefined);
});
test('Continue with a trailing arrow is recognized', async () => {
  await fixture('<button id="next">Продолжить →</button>');
  assert.equal((await plan()).id, 'next');
});
test('never starts a different course or clicks next task', async () => {
  await fixture('<button id="launch">Начать</button><button id="nextTask">К следующей задаче</button>');
  assert.equal((await plan()).id, undefined);
});
test('video waits only while Continue is disabled', async () => {
  await fixture('<video id="video" style="width:300px;height:200px"></video><button id="next" disabled>Продолжить</button>');
  assert.equal((await plan()).label, 'Воспроизвести видео');
  await page.evaluate(() => Object.defineProperty(document.querySelector('video'), 'paused', {value:false, configurable:true}));
  assert.equal(await page.evaluate(() => testPlan().waiting?.id), 'video');
  await page.evaluate(() => document.querySelector('#next').disabled = false);
  assert.equal((await plan()).id, 'next');
});
async function seekFixture(duration, end) {
  await fixture('<video id="video" style="width:300px;height:200px"></video><button id="next" disabled>Продолжить</button>');
  await page.evaluate(({duration,end}) => {
    const v = document.querySelector('video');
    Object.defineProperties(v, {
      duration: {value:duration, configurable:true},
      seekable: {value:{length:1,start:()=>0,end:()=>end}, configurable:true},
      currentTime: {value:0,writable:true,configurable:true},
      paused: {value:false, configurable:true}
    });
    v.play = async () => {};
  }, {duration,end});
}
test('seeks a playing video once and waits for natural completion', async () => {
  await seekFixture(120,120);
  assert.equal((await plan()).label,'Перемотать видео к концу');
  await page.evaluate(() => testPlayMedia(testPlan()));
  assert.equal(await page.evaluate(() => document.querySelector('video').currentTime),119);
  assert.equal(await page.evaluate(() => testPlan().waiting?.id),'video');
  await page.evaluate(() => Object.defineProperty(document.querySelector('video'),'ended',{value:true}));
  await page.evaluate(() => document.querySelector('#next').disabled = false);
  assert.equal((await plan()).id,'next');
});
test('does not seek live streams or beyond available seek range', async () => {
  await seekFixture(Infinity,100);
  assert.equal(await page.evaluate(() => testPlan().waiting?.id),'video');
  await seekFixture(120,30);
  assert.equal(await page.evaluate(() => testPlan().waiting?.id),'video');
});
test('rejected seek reports a limitation rather than clicking Continue', async () => {
  await seekFixture(120,120);
  await page.evaluate(async () => {
    await testPlayMedia(testPlan());
    document.querySelector('video').currentTime=0;
    const original=Date.now;
    Date.now=()=>original()+6000;
  });
  assert.match((await plan()).blocked,/отклонил перемотку/);
});
test('enabled Continue wins over paused video and a possible seek', async () => {
  await seekFixture(120,120);
  await page.evaluate(() => {
    Object.defineProperty(document.querySelector('video'),'paused',{value:true});
    document.querySelector('#next').disabled=false;
  });
  assert.equal((await plan()).id,'next');
  assert.equal(await page.evaluate(() => document.querySelector('video').currentTime),0);
});
test('Continue unlocked after seeking wins before media ends', async () => {
  await seekFixture(120,120);
  await page.evaluate(async () => {
    await testPlayMedia(testPlan());
    document.querySelector('#next').disabled=false;
  });
  assert.equal((await plan()).id,'next');
  assert.equal(await page.evaluate(() => document.querySelector('video').ended),false);
});
test('aria-disabled Continue does not skip video', async () => {
  await seekFixture(120,120);
  await page.evaluate(() => {
    const b=document.querySelector('#next'); b.disabled=false; b.setAttribute('aria-disabled','true');
  });
  assert.equal((await plan()).label,'Перемотать видео к концу');
});
test('corrects a selected wrong radio answer before combined submit-next', async () => {
  await fixture('<h1>Контрольный вопрос для проверки?</h1><label><input id="correct" type="radio" name="answer">Первый вариант</label><label><input id="wrong" type="radio" name="answer" checked>Неверный вариант</label><button id="submit">Ответить и перейти далее</button><button disabled>Далее</button>');
  assert.equal((await plan()).label,'Выбрать правильный вариант');
  await page.evaluate(() => testPlan().el.click());
  assert.equal(await page.isChecked('#correct'),true);
  assert.equal(await page.isChecked('#wrong'),false);
  assert.equal((await plan()).id,'submit');
});

