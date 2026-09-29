(() => {
  'use strict';
  let items = [], current = '', root, list, query, status, timer;
  const clean = s => s.replace(/\s+/g, ' ').trim();
  const normalize = s => clean(s).toLocaleLowerCase('ru');
  globalThis.alfaHelper = { getItems: () => items };
  const marked = new Set();
  const highlightClass = 'alfa-qti-helper-correct-answer';
  let highlightStyle;
  function highlight(item) {
    const wanted = new Set((item?.answers || []).map(normalize));
    const next = new Set();
    if (wanted.size && document.body) {
      const candidates = [...document.body.querySelectorAll('label,span,div,p,li,td,button,a,strong,b,em')]
        .filter(el => !el.closest('script,style,textarea,[contenteditable="true"]') &&
          el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' &&
          wanted.has(normalize(el.innerText || '')));
      for (const el of candidates) {
        if (!candidates.some(child => child !== el && el.contains(child))) next.add(el);
      }
    }
    for (const el of marked) if (!next.has(el)) el.classList.remove(highlightClass);
    for (const el of next) if (!marked.has(el)) el.classList.add(highlightClass);
    marked.clear();
    for (const el of next) marked.add(el);
    if (next.size && !highlightStyle?.isConnected) {
      highlightStyle = document.createElement('style');
      highlightStyle.textContent = `.${highlightClass}{background-color:#d9fbe5!important;color:#125c2e!important;text-decoration:underline!important;text-decoration-color:#168343!important;text-decoration-thickness:2px!important;text-underline-offset:3px!important;box-shadow:0 0 0 3px #d9fbe5!important;border-radius:3px!important}`;
      document.documentElement.append(highlightStyle);
    }
  }
  function material(node) {
    if (!node) return '';
    return clean([...node.querySelectorAll('mattext')].map(n => {
      if (/html/i.test(n.getAttribute('texttype') || '')) {
        const doc = new DOMParser().parseFromString(n.textContent, 'text/html');
        return doc.body.textContent || '';
      }
      return n.textContent;
    }).join(' '));
  }
  function mount() {
    if (root || !document.documentElement) return;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;';
    root = host.attachShadow({mode: 'closed'});
    root.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box}details{width:360px;max-width:90vw;background:#fff;color:#202124;border:1px solid #ccc;border-radius:12px;box-shadow:0 4px 24px #0003;font:14px/1.45 Arial,sans-serif}summary{padding:12px;cursor:pointer;font-weight:bold}section{padding:0 12px 12px}input{width:100%;padding:9px;border:1px solid #bbb;border-radius:6px}#list{max-height:55vh;overflow:auto}article{padding:10px 0;border-bottom:1px solid #ddd}h4{margin:0 0 6px}ul{margin:0;padding-left:20px;color:#146c36}p{color:#666;font-size:12px}button{padding:6px;cursor:pointer}
      </style><details open><summary>Подсказки к тесту</summary><section><input placeholder="Поиск по вопросу" aria-label="Поиск по вопросу"><p id="status"></p><div id="list"></div><button>Показать все вопросы</button><p>Варианты из XML: ws_right="1". Автопрохождение включается отдельно в панели снизу.</p></section></details>`;
    document.documentElement.append(host);
    list = root.querySelector('#list'); query = root.querySelector('input'); status = root.querySelector('#status');
    query.addEventListener('input', render);
    root.querySelector('button').addEventListener('click', () => { current = ''; query.value = ''; render(); });
  }
  function render() {
    if (!root) return;
    const term = normalize(query.value);
    const shown = items.filter(i => term ? normalize(i.question).includes(term) : !current || i.id === current);
    status.textContent = `${shown.length} из ${items.length} вопросов · ${term ? 'Поиск' : current ? 'Вопрос на странице' : 'Все вопросы'}`;
    list.replaceChildren();
    for (const item of shown) {
      const article = document.createElement('article');
      const heading = document.createElement('h4'); heading.textContent = item.question; article.append(heading);
      const ul = document.createElement('ul');
      for (const answer of item.answers) { const li = document.createElement('li'); li.textContent = answer; ul.append(li); }
      article.append(ul);
      if (!item.answers.length) { const p = document.createElement('p'); p.textContent = 'Метки правильного ответа не найдены. Этот формат пока не поддерживается.'; article.append(p); }
      list.append(article);
    }
  }
  function detect() {
    if (!items.length || !document.body) return;
    const text = normalize(document.body.innerText);
    const matches = items.filter(i => i.question.length > 8 && text.includes(normalize(i.question)));
    const next = matches.length === 1 ? matches[0].id : '';
    highlight(matches.length === 1 ? matches[0] : null);
    if (next !== current) { current = next; render(); }
  }
  window.addEventListener('alfa-qti-helper-document', e => {
    try {
      const data = JSON.parse(e.detail);
      if (typeof data.xml !== 'string' || data.xml.length > 8000000) return;
      const doc = new DOMParser().parseFromString(data.xml, 'application/xml');
      if (doc.querySelector('parsererror')) return;
      items = [...doc.querySelectorAll('item')].map((item, index) => ({
        id: String(index),
        question: material(item.querySelector('presentation > material')) || item.getAttribute('title') || `Вопрос ${index + 1}`,
        answers: [...item.querySelectorAll('response_label[ws_right="1"]')].map(n => material(n) || '(Ответ содержит изображение или другой нетекстовый материал)')
      }));
      highlight(null);
      if (!items.length) return;
      current = ''; mount(); render(); detect();
    } catch {}
  });
  window.dispatchEvent(new Event('alfa-qti-helper-ready'));
  const start = () => {
    window.dispatchEvent(new Event('alfa-qti-helper-reload'));
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(detect, 250); })
      .observe(document.body || document.documentElement, {subtree: true, childList: true, characterData: true});
    setInterval(() => { if (!document.hidden) detect(); }, 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
