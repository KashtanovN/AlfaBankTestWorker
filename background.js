'use strict';
let queue = Promise.resolve();
function courseKey(raw) {
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://alfapeople.alfabank.ru' || !url.pathname.includes('/wshcm-player/')) return null;
    const launch = new URL(decodeURIComponent(url.pathname.split('/wshcm-player/')[1]), url.origin);
    const course = launch.searchParams.get('course_id'), object = launch.searchParams.get('object_id');
    return course && object ? `${course}:${object}` : null;
  } catch { return null; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || !sender.url?.startsWith('https://alfapeople.alfabank.ru/')) return;
  queue = queue.then(async () => {
    const key = `tab-${sender.tab.id}`;
    const saved = (await chrome.storage.session.get(key))[key];
    const state = saved?.schema === 2 ? saved : {schema: 2, enabled: false, status: 'Откройте нужный курс и нажмите «Запустить».', last: 0, activity: 0, seen: [], course: null};
    const current = courseKey(sender.tab.url || (sender.frameId === 0 ? sender.url : ''));
    if (state.enabled && current !== state.course) {
      state.enabled = false;
      state.status = 'Остановлено: вы вышли из выбранного курса.';
    }
    if (message.type === 'toggle' && sender.frameId === 0) {
      state.enabled = message.enabled === true && !!current;
      state.course = current;
      state.status = state.enabled ? 'Прохожу только выбранный курс.' : (message.enabled ? 'Сначала нажмите «Начать» у нужного курса, затем запустите расширение внутри него.' : 'Остановлено');
      state.last = 0; state.activity = Date.now(); state.seen = [];
    }
    if (message.type === 'activity' && state.enabled) { state.activity = Date.now(); state.status = 'Воспроизводится видео…'; }
    if (message.type === 'stop' && state.enabled) { state.enabled = false; state.status = String(message.reason).slice(0, 250); }
    let granted = false;
    if (message.type === 'claim' && state.enabled && current === state.course && Date.now() - state.last > 1600) {
      if (!state.seen.includes(message.key)) {
        granted = true; state.last = Date.now(); state.seen.push(message.key);
        state.status = String(message.label).slice(0, 150);
        if (state.seen.length > 500) state.seen.shift();
      } else {
        state.enabled = false; state.status = 'Остановлено: этот шаг уже выполнялся. Проверьте страницу.';
      }
    }
    await chrome.storage.session.set({[key]: state});
    respond({...state, granted});
  }).catch(() => respond({enabled: false, status: 'Ошибка связи с расширением'}));
  return true;
});
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove(`tab-${id}`));
