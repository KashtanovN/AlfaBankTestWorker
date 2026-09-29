(() => {
  'use strict';
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
  const controlsSelector = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
  const visible = el => !!el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]');
  const checked = el => el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true';
  const send = message => chrome.runtime.sendMessage(message);
  let busy = false, ui, status, startButton, lastPage = '', waitingSince = Date.now();
  const visited = new WeakSet();
  const mediaProgress = new WeakMap();
  const soughtMedia = new WeakMap();
  function mediaKey(video) {
    return [video.currentSrc || video.src || video.querySelector('source')?.src || '', video.duration].join('|');
  }
  function videoAction(video) {
    const key = mediaKey(video);
    const duration = video.duration;
    const target = Math.max(0, duration - 1);
    const attempt = soughtMedia.get(video);
    if (attempt?.key === key && !video.seeking && Date.now() - attempt.at > 5000 && video.currentTime < attempt.target - 1) {
      return {blocked: 'Плеер отклонил перемотку. Требуется просмотр видео вручную.'};
    }
    if (Number.isFinite(duration) && duration > 1 && video.currentTime < target && attempt?.key !== key) {
      for (let i = 0; i < video.seekable.length; i++) {
        if (video.seekable.start(i) <= target && video.seekable.end(i) >= target) {
          return {el: video, label: 'Перемотать видео к концу', media: true, seekTo: target, mediaKey: key, step: `seek-${key}`};
        }
      }
    }
    return video.paused ? {el: video, label: 'Воспроизвести видео', media: true, step: `play-${key}`} : {waiting: video};
  }
  async function playMedia(action) {
    if (action.seekTo !== undefined) {
      action.el.currentTime = action.seekTo;
      soughtMedia.set(action.el, {key: action.mediaKey, target: action.seekTo, at: Date.now()});
    }
    await action.el.play();
  }
  const sliders = new WeakMap();
  const chosenCustom = new Set();
  function isSelected(el) {
    for (let node = el, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      if (node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true') return true;
      if (node.matches('input:checked')) return true;
      if (/(^|[-_\s])(checked|selected|active|chosen)([-_\s]|$)/i.test(String(node.className || ''))) return true;
      if (/(checked|selected|active|chosen)/i.test(node.getAttribute('data-state') || '')) return true;
    }
    return false;
  }
  function exactTextTarget(answer) {
    const candidates = [...document.querySelectorAll('label,button,[role],a,li,div,span,p')]
      .filter(el => visible(el) && norm(el.innerText || '') === answer &&
        !el.closest('nav,header,aside,[role="navigation"]'));
    return candidates.find(el => ![...el.children].some(child => norm(child.innerText || '') === answer)) || null;
  }
  function customAnswerAction(items, text) {
    if (items.length !== 1 || !items[0].answers?.length) return null;
    const item = items[0];
    const keyBase = `${location.pathname}|${item.id}|`;
    for (const raw of item.answers) {
      const answer = norm(raw);
      const target = exactTextTarget(answer);
      if (!target) return {blocked: 'Не нашёл текст правильного варианта на странице теста.'};
      const key = keyBase + answer;
      if (isSelected(target) || chosenCustom.has(key)) continue;
      return {el: target, label: 'Выбрать правильный вариант', customKey: key};
    }
    const submit = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')]
      .filter(el => visible(el) && enabled(el) && label(el) === 'ответить и перейти далее');
    if (submit.length === 1) return {el: submit[0], label: 'Отправить выбранный ответ'};
    if (submit.length > 1) return {blocked: 'Найдено несколько кнопок отправки ответа.'};
    return null;
  }
  function sliderAction() {
    const arrows = [...document.querySelectorAll('button[aria-label="Next slide"]')]
      .filter(el => visible(el) && enabled(el) && !el.closest('nav,header,aside,[role="navigation"]'));
    for (const el of arrows) {
      const data = el.getAttribute('data-qa-data') || '';
      if (!data.includes('sliderElNav')) continue;
      if (/["']?disabled["']?\s*:\s*true/.test(data)) continue;
      const match = data.match(/["']?activeIndex["']?\s*:\s*(\d+)/);
      if (!match) return {blocked: 'Карусель найдена, но номер слайда не распознан.'};
      const index = Number(match[1]);
      const state = sliders.get(el);
      if (state?.done) continue;
      if (state?.seen.has(index)) {
        if (state.last !== index) { state.done = true; continue; }
        return {blocked: 'Ожидаю смену слайда карусели. Если он не сменится, выполнение остановится.'};
      }
      return {el, label: 'Следующий слайд карусели', sliderIndex: index, step: `slide-${index}`};
    }
    return null;
  }
  function recordSlider(action) {
    if (action.sliderIndex === undefined) return;
    const state = sliders.get(action.el) || {seen: new Set(), last: null, done: false};
    state.seen.add(action.sliderIndex);
    state.last = action.sliderIndex;
    sliders.set(action.el, state);
  }
  function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); }
  function label(el) { return norm(el.innerText || el.value || el.getAttribute('aria-label') || el.title).replace(/[\s→➜➔›»]+$/u, ''); }
  function option(el) {
    const labels = [...(el.labels || [])];
    if (labels.length) return {el, text: norm(labels.map(l => l.innerText).join(' ')), target: labels[0]};
    if (el.getAttribute('aria-label')) return {el, text: norm(el.getAttribute('aria-label')), target: el};
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const siblings = [...p.querySelectorAll(controlsSelector)];
      if (p !== el && siblings.length !== 1) break;
      const text = norm(p.innerText);
      if (text) return {el, text, target: visible(el) ? el : p};
    }
    return {el, text: '', target: el};
  }
  function plan() {
    const text = norm(document.body.innerText);
    const buttons = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')].filter(el => visible(el) && enabled(el));
    const named = names => buttons.filter(el => names.includes(label(el)));
    // Prefer an explicit, enabled exit before interacting with lesson content.
    const exits = buttons.filter(el => !el.closest('nav,header,aside,[role="navigation"]'));
    for (const labels of [
      ['продолжить'],
      ['пропустить раздел', 'пропустить этот раздел', 'пропустить видео', 'перейти к следующему разделу'],
      ['далее', 'следующий вопрос']
    ]) {
      const matches = exits.filter(el => labels.includes(label(el)));
      if (matches.length === 1) return {el: matches[0], label: 'Приоритетный переход: ' + label(matches[0])};
      if (matches.length > 1) return {blocked: 'Найдено несколько кнопок перехода. Выберите нужную вручную.'};
    }
    const options = [...document.querySelectorAll(controlsSelector)].map(option).filter(o => visible(o.target));
    const active = options.filter(o => enabled(o.el));
    if (active.length) {
      const items = (globalThis.alfaHelper?.getItems() || []).filter(i => i.question.length > 8 && text.includes(norm(i.question)));
      if (items.length !== 1 || !items[0].answers.length) return {blocked: 'Нет однозначного ответа в XML. Нужен ручной выбор.'};
      const wanted = items[0].answers.map(norm);
      if (wanted.some(a => active.filter(o => o.text === a).length !== 1)) {
        return customAnswerAction(items, text) || {blocked: 'Не удалось сопоставить ответы с переключателями страницы.'};
      }
      if (active.some(o => !o.text) || new Set(active.map(o => o.text)).size !== active.length) return {blocked: 'Неоднозначная разметка вариантов ответа.'};
      if (wanted.length > 1 && active.some(o => o.el.matches('input[type="radio"],[role="radio"]'))) return {blocked: 'Тип вопроса не совпадает с ответами XML.'};
      const wrong = active.find(o => checked(o.el) && !wanted.includes(o.text) && o.el.matches('input[type="checkbox"],[role="checkbox"]'));
      if (wrong) return {el: wrong.target, label: 'Снять лишнюю отметку'};
      const missing = active.find(o => wanted.includes(o.text) && !checked(o.el));
      if (missing) return {el: missing.target, label: 'Выбрать правильный вариант'};
      const submit = named(['ответить', 'ответить и перейти далее', 'отправить', 'проверить']);
      if (submit.length === 1) return {el: submit[0], label: 'Отправить ответ'};
      return {blocked: 'Ответ выбран. Кнопка отправки не распознана или недоступна.'};
    }
    const quizItems = (globalThis.alfaHelper?.getItems() || []).filter(i => i.question.length > 8 && text.includes(norm(i.question)));
    const custom = customAnswerAction(quizItems, text);
    if (custom) return custom;
    const expand = [...document.querySelectorAll('main details:not([open]) > summary,article details:not([open]) > summary,details:not([open]) > summary,button[aria-expanded="false"],[role="button"][aria-expanded="false"]')]
      .filter(el => visible(el) && enabled(el) && !visited.has(el) && !el.closest('nav,header,aside,[role="navigation"]'));
    if (expand.length) return {el: expand[0], label: 'Раскрыть учебный блок', visit: true};
    const tabs = [...document.querySelectorAll('[role="tab"][aria-selected="false"]')]
      .filter(el => visible(el) && enabled(el) && !visited.has(el) && !el.closest('nav,header,aside,[role="navigation"]'));
    if (tabs.length) return {el: tabs[0], label: 'Открыть вкладку учебного блока', visit: true};
    const videos = [...document.querySelectorAll('video')].filter(el => visible(el) && !el.ended);
    if (videos.length) {
      const video = videos[0];
      return videoAction(video);
    }
    const slider = sliderAction();
    if (slider) return slider;
    const launch = named(['начать тест']);
    if (launch.length === 1) return {el: launch[0], label: 'Открыть тест внутри выбранного курса'};
    return {blocked: 'Нет доступного шага. Возможно, курс завершён или нужен ручной ввод.'};
  }
  async function tick() {
    if (busy || !document.body || document.hidden) return;
    busy = true;
    try {
      const state = await send({type: 'state'});
      if (ui) { status.textContent = state.status; startButton.textContent = state.enabled ? 'Стоп' : 'Запустить'; startButton.dataset.running = String(state.enabled); }
      if (!state.enabled) { waitingSince = Date.now(); return; }
      const page = location.href + '|' + norm(document.body.innerText);
      if (page !== lastPage) { lastPage = page; waitingSince = Date.now(); }
      const action = plan();
      if (action.waiting) {
        const previous = mediaProgress.get(action.waiting);
        const time = action.waiting.currentTime;
        mediaProgress.set(action.waiting, time);
        if (previous === undefined || time > previous) await send({type: 'activity'});
      }
      if (!action.el) {
        // A parent frame may have no controls while its child runs the course.
        if (Date.now() - Math.max(waitingSince, state.last, state.activity || 0) > 30000) await send({type: 'stop', reason: action.blocked || 'Видео не продвигается. Проверьте воспроизведение.'});
        return;
      }
      const element = action.el;
      const all = [...document.querySelectorAll('*')];
      const signature = hash(page + '|' + action.label + '|' + (action.step || '') + '|' + all.indexOf(element) + '|' + [...document.querySelectorAll(controlsSelector)].map(checked).join(','));
      const claim = await send({type: 'claim', key: signature, label: action.label});
      if (claim.granted && element.isConnected && enabled(element)) {
        element.scrollIntoView({block: 'center', behavior: 'instant'});
        if (action.media) {
          try { await playMedia(action); }
          catch { await send({type: 'stop', reason: 'Не удалось перемотать или запустить видео. Используйте плеер вручную и снова запустите расширение.'}); }
        } else { recordSlider(action); element.click(); }
        if (action.visit) visited.add(element);
        if (action.customKey) chosenCustom.add(action.customKey);
        waitingSince = Date.now();
      }
    } catch { if (status) status.textContent = 'Перезагрузите страницу после обновления расширения.'; }
    finally { busy = false; }
  }
  function mount() {
    if (window === window.top) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647';
      ui = host.attachShadow({mode: 'closed'});
      ui.innerHTML = `<style>:host{all:initial}section{width:300px;background:#fff;color:#222;padding:12px;border:1px solid #ccc;border-radius:12px;box-shadow:0 4px 24px #0003;font:14px/1.4 Arial}button{padding:8px 18px;cursor:pointer}p{font-size:12px}</style><section><b>Только выбранный курс · 1.3.5</b><p>Откройте курс кнопкой «Начать», затем нажмите «Запустить» здесь. Ответы из XML отправляются автоматически.</p><button>Запустить</button><p id="status">Выключено</p></section>`;
      document.documentElement.append(host);
      status = ui.querySelector('#status'); startButton = ui.querySelector('button');
      startButton.addEventListener('click', async () => { const s = await send({type: 'toggle', enabled: startButton.dataset.running !== 'true'}); startButton.dataset.running = String(s.enabled); startButton.textContent = s.enabled ? 'Стоп' : 'Запустить'; status.textContent = s.status; });
      window.addEventListener('keydown', e => { if (e.key === 'Escape') send({type: 'stop', reason: 'Остановлено клавишей Esc'}); });
    }
    setInterval(tick, 1000); tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();
})();
