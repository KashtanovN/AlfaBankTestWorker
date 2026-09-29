const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('background serializes frames and stops repeats', async () => {
  let listener, now = 10000;
  const memory = {};
  const area = {get: async key => ({[key]:memory[key]}), set: async data => Object.assign(memory,data), remove: async key => delete memory[key]};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), {
    chrome: {runtime: {onMessage: {addListener: fn => listener = fn}}, storage: {session: area, local: area}, tabs:{onRemoved:{addListener:()=>{}}}},
    Date: {now: () => now}, Promise
  });
  const request = (message, frameId = 0) => new Promise(resolve => listener(message, {tab:{id:7}, frameId, url:'https://alfapeople.alfabank.ru/test'}, resolve));
  await request({type:'toggle', enabled:true});
  const results = await Promise.all([request({type:'claim',key:'a',label:'Click'},1),request({type:'claim',key:'b',label:'Click'},2)]);
  assert.equal(results.filter(r=>r.granted).length, 1);
  assert.equal((await request({type:'state'})).enabled, true);
  now += 3000;
  assert.equal((await request({type:'claim',key:'a'})).enabled, false);
  await request({type:'toggle',enabled:true},1);
  assert.equal((await request({type:'state'})).enabled, false);
});

