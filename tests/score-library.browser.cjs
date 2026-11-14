// Run with an isolated Chrome debugging profile: node tests/score-library.browser.cjs http://127.0.0.1:9222 http://127.0.0.1:3000
const fs = require('node:fs');
const ts = require('typescript');
const WebSocket = require('next/dist/compiled/ws');
(async () => {
  const [debuggerOrigin, appOrigin] = process.argv.slice(2);
  if (!debuggerOrigin || !appOrigin) throw Error('Pass the isolated Chrome debugger origin and local app origin.');
  const browser = await (await fetch(`${debuggerOrigin}/json/version`)).json();
  const socket = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Timed out: ${method}`)); }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
  });
  let targetId;
  try {
    ({ targetId } = await call('Target.createTarget', { url: `${appOrigin}/library-test-blank` }));
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await evaluate(`new Promise(resolve => { if (document.readyState === 'complete') resolve(); else addEventListener('load',resolve,{once:true}); })`);
    const name = `score-library-test-${Date.now()}`;
    const key = `${name}:metadata`;
    const source = fs.readFileSync(require.resolve('../app/score-sync/library.ts'), 'utf8').replaceAll('score-sync-cache', name).replaceAll('score-sync:last-session', key);
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const result = await evaluate(`(async () => {
      const expect = (value,message) => { if (!value) throw Error(message); };
      const name=${JSON.stringify(name)}, key=${JSON.stringify(key)};
      localStorage.setItem(key, JSON.stringify({youtubeUrl:'https://youtu.be/dQdc9DjtgQQ',bpm:115,beatsPerMeasure:4,offset:2.5}));
      await new Promise((resolve,reject) => {
        const request=indexedDB.open(name,1);
        request.onupgradeneeded=()=>request.result.createObjectStore('session');
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const db=request.result, tx=db.transaction('session','readwrite');
          tx.objectStore('session').put({blob:new Blob(['legacy PDF']),fileName:'legacy.pdf'},'last-pdf');
          tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>reject(tx.error);
        };
      });
      const lib={}; new Function('exports', ${JSON.stringify(compiled + '\nexports.close = async () => (await database)?.close();')})(lib);
      try {
        let data=await lib.readLibrary();
        expect(data.songs.length===1 && data.activeId==='legacy-score','migrate and select existing score');
        const first=data.songs[0];
        expect(first.bpm===115 && first.offset===2.5 && first.youtubeUrl.includes('dQdc9DjtgQQ') && await first.blob.text()==='legacy PDF','migration keeps PDF and settings together');
        const second={...first,id:'second',fileName:'second.pdf',blob:new Blob(['second PDF']),youtubeUrl:'',bpm:92,offset:0};
        await lib.saveSong(second,true);
        await Promise.all([lib.saveSong({...first,bpm:116}),lib.saveSong({...first,bpm:117,offset:3})]);
        data=await lib.readLibrary();
        expect(data.songs.length===2 && data.activeId==='second','save second without replacing first');
        expect(data.songs.find(song=>song.id===first.id).bpm===117 && data.songs.find(song=>song.id==='second').bpm===92,'ordered writes and separate settings');
        await lib.activateSong(first.id);
        expect((await lib.readLibrary()).activeId===first.id,'remember selected song');
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='songs')queueMicrotask(()=>this.transaction.abort());return request;};
        let rejected=false;
        try { await lib.saveSong({...first,bpm:200}); } catch { rejected=true; } finally { IDBObjectStore.prototype.put=put; }
        expect(rejected,'report failed transaction');
        expect((await lib.readLibrary()).songs.find(song=>song.id===first.id).bpm===117,'failed save preserves previous version');
        await lib.deleteSong(first.id); await lib.deleteSong(second.id);
        data=await lib.readLibrary();
        expect(!data.songs.length && !data.activeId,'deletion does not reimport legacy PDF');
        return 'PASS: migration, paired PDF/link/settings, ordered saves, selection, rollback and deletion';
      } finally { await lib.close(); indexedDB.deleteDatabase(name); localStorage.removeItem(key); }
    })()`);
    console.log(result);
  } finally {
    if (targetId) await call('Target.closeTarget', { targetId });
    socket.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
