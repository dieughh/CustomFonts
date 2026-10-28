import assert from 'node:assert/strict'

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const target = targets.find(target => target.type === 'page' && target.url.startsWith('music-application:'))
assert.ok(target, 'Yandex Music CDP page is required')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
let nextId = 0
const requests = new Map()
const contexts = []
socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context)
    if (message.id) {
        const request = requests.get(message.id)
        requests.delete(message.id)
        if (message.error) request.reject(new Error(JSON.stringify(message.error)))
        else request.resolve(message.result)
    }
})
const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = ++nextId
        requests.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
    })
const evaluate = async (expression, contextId) => {
    const result = await send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
}
const addonId = '68f0d4da-d1c4-4aeb-92a4-ea4b9553fd8c'
let context
try {
    await send('Runtime.enable')
    context = contexts.find(context => context.name.includes(addonId))?.id
    assert.ok(context, 'Active Custom Fonts isolated world is required')
    await evaluate(`(async () => {
        if(!document.getElementById('custom-fonts-colors'))throw new Error('Custom Fonts is not active');
        const api=window.pulsesyncApi,id=${JSON.stringify(addonId)};
        window.__customFontsBenchmarkSettings=structuredClone(api.getSettings(id).getCurrent());
        const settings={...window.__customFontsBenchmarkSettings,textColorEnabled:{value:true},lyricsColorEnabled:{value:true},svgColorEnabled:{value:true}};
        for(const callback of api._addonSettingsListeners.get(id)||[])callback(settings);
        await new Promise(r=>setTimeout(r,400));
    })()`)
    await evaluate(
        `(() => {
        const counts={styleReads:0,documentQueries:0,elementQueries:0,textWalks:0};
        const originals={style:globalThis.getComputedStyle,query:document.querySelectorAll,elementQuery:Element.prototype.querySelectorAll,walk:document.createTreeWalker};
        globalThis.getComputedStyle=function(...args){counts.styleReads++;return originals.style.apply(this,args)};
        document.querySelectorAll=function(...args){counts.documentQueries++;return originals.query.apply(this,args)};
        Element.prototype.querySelectorAll=function(...args){counts.elementQueries++;return originals.elementQuery.apply(this,args)};
        document.createTreeWalker=function(...args){counts.textWalks++;return originals.walk.apply(this,args)};
        globalThis.__customFontsBenchmark={counts,originals};
    })()`,
        context,
    )
    const timing = await evaluate(`(async () => {
        const fixture=document.createElement('div');fixture.id='custom-fonts-benchmark';fixture.style.cssText='position:fixed;left:-10000px';fixture.append(document.createTextNode('benchmark'));
        document.body.append(fixture);const start=performance.now();
        try {for(let i=0;i<60;i++){fixture.firstChild.nodeValue='benchmark '+i;await new Promise(queueMicrotask)}await new Promise(r=>setTimeout(r,200));if(fixture.style.color!=='var(--pscf-text-color)')throw new Error('Benchmark text was not recolored');return {updates:60,elapsedMs:Math.round(performance.now()-start)}}finally{fixture.remove()}
    })()`)
    const counts = await evaluate('({...globalThis.__customFontsBenchmark.counts})', context)
    console.log(JSON.stringify({ ...timing, ...counts }, null, 2))
} finally {
    if (context)
        await evaluate(
            `(() => {
        const saved=globalThis.__customFontsBenchmark;if(!saved)return;
        globalThis.getComputedStyle=saved.originals.style;document.querySelectorAll=saved.originals.query;
        Element.prototype.querySelectorAll=saved.originals.elementQuery;document.createTreeWalker=saved.originals.walk;
        delete globalThis.__customFontsBenchmark;
    })()`,
            context,
        ).catch(() => {})
    await evaluate(`(() => {
        const saved=window.__customFontsBenchmarkSettings;if(!saved)return;
        for(const callback of window.pulsesyncApi._addonSettingsListeners.get(${JSON.stringify(addonId)})||[])callback(saved);
        delete window.__customFontsBenchmarkSettings;
    })()`).catch(() => {})
    socket.close()
}
