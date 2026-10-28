import assert from 'node:assert/strict'

const port = process.env.CDP_PORT || '9222'
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find(target => target.type === 'page' && target.url.startsWith('music-application:'))
assert.ok(target, 'Open Yandex Music with CDP enabled')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
})
const timeout = setTimeout(() => {
    socket.close()
    throw new Error('CDP test timeout')
}, 120000)
try {
    const result = await new Promise((resolve, reject) => {
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data)
            if (message.id !== 1) return
            if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
            else resolve(message.result.result.value)
        })
        socket.send(
            JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: `(${browserTests.toString()})()`,
                    awaitPromise: true,
                    returnByValue: true,
                },
            }),
        )
    })
    console.log(JSON.stringify(result, null, 2))
    assert.equal(result.failures.length, 0, result.failures.join('\n'))
} finally {
    clearTimeout(timeout)
    socket.close()
}

async function browserTests() {
    for (let attempt = 0; attempt < 40 && !document.getElementById('custom-fonts-colors'); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!document.getElementById('custom-fonts-colors')) throw new Error('Custom Fonts is not active')
    document.getElementById('custom-fonts-cdp-tests')?.remove()
    const id = '68f0d4da-d1c4-4aeb-92a4-ea4b9553fd8c'
    const api = window.pulsesyncApi
    const original = structuredClone(api.getSettings(id).getCurrent())
    const wait = () => new Promise(resolve => setTimeout(resolve, 180))
    const emit = async values => {
        const snapshot = { ...structuredClone(original), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) }
        for (const callback of api._addonSettingsListeners.get(id) || []) callback(snapshot)
        await wait()
    }
    const blocked = ':is(:disabled,[disabled],[aria-disabled="true"],[data-disabled="true"],[data-state="disabled"],[inert])'
    const results = { passed: [], failures: [], skipped: [], textElementsChecked: 0, nativeLyricsButtons: 0, waveImages: 0 }
    const check = (condition, label, detail = '') =>
        (condition ? results.passed : results.failures).push(`${label}${detail && !condition ? `: ${detail}` : ''}`)
    const paint = button => {
        const svg = button.querySelector('svg')
        const shape = button.querySelector('svg use, svg path')
        return {
            color: getComputedStyle(button).color,
            svg: svg && getComputedStyle(svg).color,
            fill: shape && getComputedStyle(shape).fill,
            stroke: shape && getComputedStyle(shape).stroke,
            href: shape?.getAttribute('href') || shape?.getAttribute('xlink:href'),
        }
    }
    const fixture = document.createElement('div')
    fixture.id = 'custom-fonts-cdp-tests'
    fixture.innerHTML = `<div class="opaque-hashed-class" style="color:#cc0000!important;-webkit-text-fill-color:#00cc00!important">Plain div</div>
        <span>Plain span</span><div class="SyncLyricsLine_root_test"><span>Lyrics</span></div>
        <button style="color:rgb(90,90,90)" disabled><span>Disabled</span><svg fill="currentColor"><path d="M0 0h10v10z"/></svg></button>
        <button aria-disabled="true" style="color:rgb(80,80,80)"><span>Aria disabled</span><svg fill="currentColor"><path d="M0 0h10v10z"/></svg></button>
        <button data-test-dynamic style="color:rgb(70,70,70)"><span>Dynamic</span><svg fill="currentColor"><path d="M0 0h10v10z"/></svg></button>
        <button data-test-external style="color:rgb(60,60,60)"><svg><use href="/icons/sprite.svg#syncLyrics_xs"/></svg></button>
        <div data-test-id="WHEEL_SETTING_ITEM" data-test-wave role="button"><div class="WheelItem_coverContainer_iconCover_test"><img alt="" style="filter:grayscale(.5)"/></div></div>`
    document.body.append(fixture)
    try {
        await emit({ textColorEnabled: false, lyricsColorEnabled: false, svgColorEnabled: false })
        const nativeLyrics = [...document.querySelectorAll('button')].filter(
            button =>
                button.disabled &&
                (/LYRICS/.test(button.dataset.testId || '') ||
                    button.hasAttribute('data-pc-lyrics-placeholder') ||
                    /Текст песни недоступен/.test(button.getAttribute('aria-label') || '')),
        )
        const baseline = nativeLyrics.map(paint)
        results.nativeLyricsButtons = nativeLyrics.length
        if (document.querySelector('[class*="FullscreenPlayerDesktop_root"]')) {
            check(
                nativeLyrics.some(button => button.closest('[class*="Fullscreen"]')),
                'Fullscreen lyrics button without lyrics is present',
            )
        } else results.skipped.push('Fullscreen lyrics button: fullscreen player is closed')
        const waveImages = [...document.querySelectorAll('[class*="WheelItem_coverContainer_iconCover"] > img')]
        const imageBaseline = waveImages.map(image => getComputedStyle(image).filter)
        results.waveImages = waveImages.filter(image => !fixture.contains(image)).length
        const unrelatedCover = document.querySelector('img[data-test-id="ENTITY_COVER_IMAGE"]:not([class*="WheelItem_cover"])')
        const unrelatedBaseline = unrelatedCover && getComputedStyle(unrelatedCover).filter
        const disabled = [...fixture.querySelectorAll('button:disabled,button[aria-disabled="true"]')]
        const disabledBaseline = disabled.map(paint)
        const dynamic = fixture.querySelector('[data-test-dynamic]')
        const external = fixture.querySelector('[data-test-external]')
        dynamic.disabled = true
        external.setAttribute('aria-disabled', 'true')
        await wait()
        const dynamicDisabledBaseline = paint(dynamic)
        const dynamicTextBaseline = getComputedStyle(dynamic.querySelector('span')).color
        const externalDisabledBaseline = paint(external)
        dynamic.disabled = false
        external.removeAttribute('aria-disabled')
        await emit({
            textColorEnabled: true,
            textColor: '#123456',
            lyricsColorEnabled: true,
            lyricsColor: '#654321',
            svgColorEnabled: true,
            svgColor: '#12ab34',
        })
        check(
            waveImages.every(image => decodeURIComponent(getComputedStyle(image).filter).includes('feFlood flood-color="#12ab34"')),
            'Wave action images use the selected icon color through CSS filter',
        )
        check(!unrelatedCover || getComputedStyle(unrelatedCover).filter === unrelatedBaseline, 'Album covers are not filtered')
        const wave = fixture.querySelector('[data-test-wave]')
        wave.setAttribute('aria-disabled', 'true')
        await wait()
        check(getComputedStyle(wave.querySelector('img')).filter === 'grayscale(0.5)', 'Disabled wave image retains original filter')
        wave.removeAttribute('aria-disabled')
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const checked = new Set()
        const missed = []
        while (walker.nextNode()) {
            const node = walker.currentNode,
                element = node.parentElement
            if (
                !node.textContent.trim() ||
                !(element instanceof HTMLElement) ||
                checked.has(element) ||
                !element.getClientRects().length ||
                element.closest(`${blocked},svg,script,style,noscript,template`)
            )
                continue
            checked.add(element)
            const expected = element.closest('[class*="SyncLyrics"],[class*="LyricsLine"],[class*="LyricsText"]')
                ? 'rgb(101, 67, 33)'
                : 'rgb(18, 52, 86)'
            if (getComputedStyle(element).color !== expected || getComputedStyle(element).webkitTextFillColor !== expected)
                missed.push({ text: node.textContent.trim().slice(0, 50), color: getComputedStyle(element).color })
        }
        results.textElementsChecked = checked.size
        check(
            missed.length === 0,
            'All visible enabled text is recolored',
            missed.length ? JSON.stringify(missed.slice(0, 15)) : `${checked.size} elements`,
        )
        check(
            nativeLyrics.every((button, index) => JSON.stringify(paint(button)) === JSON.stringify(baseline[index])),
            'Native unavailable lyrics buttons retain original colors and sprite references',
            JSON.stringify(nativeLyrics.map((button, index) => ({ actual: paint(button), expected: baseline[index] }))),
        )
        check(
            disabled.every((button, index) => JSON.stringify(paint(button)) === JSON.stringify(disabledBaseline[index])),
            'Disabled and aria-disabled fixture controls retain native colors',
        )
        check(paint(dynamic).fill === 'rgb(18, 171, 52)', 'Enabled SVG receives selected color')
        dynamic.disabled = true
        await wait()
        check(
            JSON.stringify(paint(dynamic)) === JSON.stringify(dynamicDisabledBaseline) &&
                getComputedStyle(dynamic.querySelector('span')).color === dynamicTextBaseline,
            'Enabled to disabled restores native text and SVG',
            JSON.stringify({ paint: paint(dynamic), text: getComputedStyle(dynamic.querySelector('span')).color }),
        )
        dynamic.disabled = false
        await wait()
        check(
            paint(dynamic).fill === 'rgb(18, 171, 52)' && getComputedStyle(dynamic.querySelector('span')).color === 'rgb(18, 52, 86)',
            'Disabled to enabled reapplies selected text and SVG colors',
        )
        check(paint(external).href.startsWith('#pscf-svg-'), 'Enabled external sprite is recolored')
        external.setAttribute('aria-disabled', 'true')
        await wait()
        check(
            JSON.stringify(paint(external)) === JSON.stringify(externalDisabledBaseline),
            'Disabling external sprite restores original href and fill',
            JSON.stringify(paint(external)),
        )
        const added = document.createElement('div')
        added.textContent = 'Text added after startup'
        fixture.append(added)
        await wait()
        check(getComputedStyle(added).color === 'rgb(18, 52, 86)', 'Dynamically added text is recolored')
        added.className = 'SyncLyricsLine_root_reused'
        added.firstChild.nodeValue = 'Reused element now contains lyrics'
        await wait()
        check(getComputedStyle(added).color === 'rgb(101, 67, 33)', 'Changed subtree switches from interface text to lyrics color')
        added.className = ''
        added.remove()
        await wait()
        check(added.style.getPropertyValue('color') === '', 'Detached text elements release their custom styles')
        fixture.append(added)
        await wait()
        check(getComputedStyle(added).color === 'rgb(18, 52, 86)', 'Reused detached elements are recolored again')
        const shape = dynamic.querySelector('path')
        shape.setAttribute('fill', 'none')
        shape.setAttribute('stroke', '#000000')
        await wait()
        check(
            getComputedStyle(shape).fill === 'none' && getComputedStyle(shape).stroke === 'rgb(18, 171, 52)',
            'SVG attribute changes invalidate only the affected paint',
        )
        await emit({ textColorEnabled: false, lyricsColorEnabled: false, svgColorEnabled: false })
        check(
            waveImages.every((image, index) => getComputedStyle(image).filter === imageBaseline[index]),
            'Disabling icon color restores all original image filters',
        )
        const plain = fixture.firstElementChild
        check(
            getComputedStyle(plain).color === 'rgb(204, 0, 0)' && getComputedStyle(plain).webkitTextFillColor === 'rgb(0, 204, 0)',
            'Disabling restores inline important text colors',
        )
    } finally {
        for (const callback of api._addonSettingsListeners.get(id) || []) callback(original)
        fixture.remove()
        await wait()
    }
    return results
}
