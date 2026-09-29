'use strict';
// Serialize frame requests so two frames cannot click simultaneously.
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || !sender.url?.startsWith('https://alfapeople.alfabank.ru/')) return;
  queue = queue.then(async () => {
    const key = `tab-${sender.tab.id}`;
    const saved = (await chrome.storage.session.get(key))[key];
    const auto = (await chrome.storage.local.get('autoStart')).autoStart === true;
    const state = saved || {enabled: auto, status: auto ? 'Автозапуск' : 'Выключено', last: 0, seen: []};
    if (message.type === 'toggle' && sender.frameId === 0) {
      state.enabled = message.enabled === true;
      state.status = state.enabled ? 'Ищу следующий шаг…' : 'Остановлено';
      state.last = 0; state.seen = [];
    }
    if (message.type === 'auto' && sender.frameId === 0) await chrome.storage.local.set({autoStart: message.enabled === true});
    if (message.type === 'stop' && state.enabled) { state.enabled = false; state.status = String(message.reason).slice(0, 250); }
    let granted = false;
    if (message.type === 'claim' && state.enabled && Date.now() - state.last > 1600) {
      if (!state.seen.includes(message.key)) {
        granted = true; state.last = Date.now(); state.seen.push(message.key);
        state.status = String(message.label).slice(0, 150);
        if (state.seen.length > 500) state.seen.shift();
      } else {
        state.enabled = false; state.status = 'Остановлено: этот шаг уже выполнялся. Проверьте страницу.';
      }
    }
    await chrome.storage.session.set({[key]: state});
    respond({...state, autoStart: auto, granted});
  }).catch(() => respond({enabled: false, status: 'Ошибка связи с расширением'}));
  return true;
});
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove(`tab-${id}`));
