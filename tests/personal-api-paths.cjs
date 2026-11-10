// Run complete production scripts in V8; DOM/fetch are host doubles, not browser E2E.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor() { this.listeners = {}; this.value = ''; this.dataset = {}; this.classList = {add(){}, remove(){}, toggle(){}, contains(){return false}}; }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  emit(k, event = {}) { return Promise.all((this.listeners[k] || []).map(f => f({preventDefault(){}, ...event}))); }
  setAttribute(){} removeAttribute(){} append(){} focus(){} querySelector(){return null}
}
async function run(prefix, configured, publicReports) {
  const calls = [], nodes = new Map(), document = new Element();
  document.getElementById = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  document.querySelectorAll = () => [];
  document.querySelector = () => null;
  document.currentScript = {src: 'https://fixture.test' + prefix + '/assets/gate.js'};
  document.documentElement = new Element(); document.body = new Element(); document.readyState = 'loading';
  const window = new Element();
  Object.assign(window, {
    location: new URL('https://fixture.test' + prefix + '/inbox/index.html'),
    FASTNEWS_PUBLIC_REPORTS: publicReports,
    localStorage: {getItem(){return null}, setItem(){}}, history: {replaceState(){}},
    setTimeout(){return 1}, clearTimeout(){},
  });
  if (configured) window.FASTNEWS_PUBLIC_PATH = prefix + '/';
  const now = new Date();
  const shanghai = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 8 * 3600000);
  const date = `${shanghai.getFullYear()}-${String(shanghai.getMonth()+1).padStart(2,'0')}-${String(shanghai.getDate()).padStart(2,'0')}`;
  const inbox = {items: [{id:'today', date, kind:'daily-paper', title:'Fixture', read:false}], unread:1};
  window.FASTNEWS_INBOX = inbox;
  document.dispatchEvent = event => document.emit(event.type, event);
  let active = '';
  const fetch = async (url, options = {}) => {
    calls.push({script: active, url, method: options.method || 'GET', options});
    const payload = url.endsWith('/me') ? {userId:'u', csrf:'c', authors:[], impression:{text:'saved'}, inboxUnread:1}
      : url.endsWith('/authors') ? {authors:[{id:'a', name:'Fixture', homepage:'https://example.test', tags:[]}], customTags:[]}
      : url.endsWith('/inbox') ? inbox : {impression:{text:'saved'}};
    return {ok:true, json:async () => payload};
  };
  const context = vm.createContext({window, document, fetch, URL, URLSearchParams, console,
    CSS:{escape:x=>x}, HTMLElement:Element, CustomEvent:class {constructor(type, init){this.type=type; Object.assign(this,init)}}});
  for (const file of ['gate.js', 'authors-nav.js', 'impression.js', 'inbox.js', 'authors.js']) {
    active = file;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets', file), 'utf8'), context, {filename:file});
    await tick(); await tick();
    if (file === 'impression.js') await nodes.get('impressionForm').emit('submit');
    if (file === 'authors.js') {
      await nodes.get('authorList').emit('click', {target:{closest(selector){return selector === '[data-delete-id]' ? {dataset:{deleteId:'a'}} : null}}});
      document.visibilityState = 'hidden'; await document.emit('visibilitychange'); await tick();
    }
  }
  assert.equal(calls.length, publicReports ? 10 : 11);
  for (const call of calls) {
    assert(call.url.startsWith(prefix + '/api/content/'), `${call.script}: ${call.url} escaped ${prefix || '/'}`);
    assert.equal(call.options.credentials, 'include');
    if (call.method === 'PUT') assert.equal(call.options.headers['X-CSRF-Token'], 'c');
  }
  assert.deepEqual(calls.filter(c => c.method === 'PUT').map(c => c.url),
    ['/impression', '/inbox', '/authors'].map(p => prefix + '/api/content' + p));
  return {prefix: prefix || '/', configured, publicReports, calls: calls.map(({script,url,method}) => ({script,url,method}))};
}
(async () => {
  for (const prefix of ['', '/news', '/lab/news'])
    for (const configured of [false, true])
      for (const publicReports of [false, true])
        console.log(JSON.stringify(await run(prefix, configured, publicReports)));
})().catch(error => { console.error(error); process.exitCode = 1; });
