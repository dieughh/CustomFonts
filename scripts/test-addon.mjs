import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { build } from 'vite'
import { indexedDB } from 'fake-indexeddb'

async function loadModule(entry) {
    const bundle = await build({
        configFile: false,
        logLevel: 'silent',
        build: {
            write: false,
            minify: false,
            lib: { entry, formats: ['es'] },
        },
    })
    const output = Array.isArray(bundle) ? bundle[0].output : bundle.output
    return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`)
}
const { FontController, typographyCss } = await loadModule('src/fonts.ts')
const { colorCss, imageColorFilter } = await loadModule('src/colors.ts')
const defaults = {
    fontWeight: 400,
    letterSpacing: 0,
    italic: false,
    underline: false,
    lineThrough: false,
    textShadowEnabled: false,
    textShadowX: 0,
    textShadowY: 0,
    textShadowBlur: 0,
    textShadowColor: '#000000',
    textColorEnabled: true,
    textColor: '#ffffff',
    lyricsColorEnabled: true,
    lyricsColor: '#ffffff',
    svgColorEnabled: true,
    svgColor: '#ffffff',
}

async function database(action) {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('CustomFontsDB', 2)
        request.onupgradeneeded = () => request.result.createObjectStore('fonts')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('fonts', 'readwrite')
            const request = action(tx.objectStore('fonts'))
            tx.oncomplete = () => resolve(request.result)
            tx.onabort = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

test('legacy font migration, persistence, replacement, reset, and lifecycle cleanup', async () => {
    globalThis.indexedDB = indexedDB
    globalThis.CSS = { supports: (_, value) => /^#[\da-f]{6}$/i.test(value) }
    const styles = []
    globalThis.document = {
        createElement: () => ({
            textContent: '',
            isConnected: false,
            remove() {
                this.isConnected = false
            },
        }),
        head: {
            append(style) {
                style.isConnected = true
                styles.push(style)
            },
        },
    }
    const revoked = []
    const originalRevoke = URL.revokeObjectURL
    URL.revokeObjectURL = url => {
        revoked.push(url)
        originalRevoke(url)
    }
    globalThis.FontFace = class {
        constructor(_name, source) {
            this.source = source
        }
        async load() {
            if (this.source instanceof ArrayBuffer && this.source.byteLength === 0) throw new Error('Invalid font')
            return this
        }
    }
    const errors = []
    const api = {
        assets: {
            url: file => {
                assert.ok(!file.includes('/'), 'assets.url expects a filename relative to Assets, without its directory prefix')
                return `https://addon.test/${file}`
            },
        },
        logger: { error: (...args) => errors.push(args) },
        notifications: { error: async (...args) => errors.push(args) },
    }
    await database(store =>
        store.put(
            {
                ...defaults,
                fontData: new Uint8Array([0, 1, 2]).buffer,
                fontFileName: 'legacy.woff2',
                systemFontDisplayName: null,
            },
            'current',
        ),
    )
    const controller = new FontController(api)
    await controller.load()
    controller.apply(defaults)
    assert.equal(controller.name, 'legacy.woff2')
    assert.match(styles.at(-1).textContent, /blob:/)
    await assert.rejects(controller.upload(new File([], 'broken.woff2')), /Invalid font/)
    assert.equal(controller.name, 'legacy.woff2')
    await assert.rejects(controller.upload(new File(['text'], 'file.txt')), /Неподдерживаемый/)
    await controller.select('Roboto')
    assert.match(styles.at(-1).textContent, /addon.test\/Roboto.ttf/)
    assert.equal(revoked.length, 1)
    const restored = new FontController(api)
    await restored.load()
    assert.equal(restored.name, 'Roboto')
    await controller.upload(new File(['valid-font-bytes'], 'new.ttf'))
    assert.equal((await database(store => store.get('current'))).fontFileName, 'new.ttf')
    controller.apply({ ...defaults, italic: true })
    await controller.reset()
    assert.equal(controller.name, '')
    assert.doesNotMatch(styles.at(-1).textContent, /@font-face/)
    assert.match(styles.at(-1).textContent, /font-style: italic/)
    assert.equal((await database(store => store.get('current'))).fontData, null)
    const style = styles.at(-1)
    style.remove()
    controller.ensureStyle()
    assert.equal(style.isConnected, true)
    controller.dispose()
    controller.ensureStyle()
    assert.equal(style.isConnected, false)
    restored.dispose()
    const stopped = new FontController(api)
    const loading = stopped.load()
    stopped.dispose()
    await loading
    stopped.apply(defaults)
    assert.equal(errors.length, 0)
    URL.revokeObjectURL = originalRevoke
})

test('typography combines decorations, clamps weights, and validates shadow colors', () => {
    const css = typographyCss({
        ...defaults,
        fontWeight: 800,
        underline: true,
        lineThrough: true,
        textShadowEnabled: true,
        textShadowColor: 'red; } body { display:none',
    })
    assert.match(css, /font-weight: 900/)
    assert.match(css, /underline line-through/)
    assert.match(css, /0px 0px 0px #000000/)
    assert.doesNotMatch(css, /display:none/)
})

test('built package uses web-addon metadata and contains every referenced asset', async () => {
    const root = new URL('../dist/68f0d4da-d1c4-4aeb-92a4-ea4b9553fd8c/', import.meta.url)
    const metadata = JSON.parse(await readFile(new URL('metadata.json', root), 'utf8'))
    assert.equal(metadata.type, 'web-addon')
    assert.equal(metadata.cssScope, 'global')
    assert.equal(metadata.settings.sections.flatMap(section => section.items).length, 16)
    const settingItems = Object.fromEntries(metadata.settings.sections.flatMap(section => section.items).map(item => [item.id, item]))
    for (const name of ['textColorEnabled', 'lyricsColorEnabled', 'svgColorEnabled']) {
        assert.equal(settingItems[name].defaultValue, false)
        assert.equal(settingItems[name].value, false)
    }
    for (const name of ['textColor', 'lyricsColor', 'svgColor']) {
        assert.equal(settingItems[name].defaultValue, '#ffffff')
        assert.equal(settingItems[name].value, '#ffffff')
    }
    assert.equal(metadata.dependencies.length, 0)
    for (const file of [metadata.script, metadata.css, metadata.image, metadata.banner]) {
        assert.ok((await readFile(new URL(file, root))).length > 0)
    }
    const assets = await readdir(new URL('Assets/', root))
    assert.equal(assets.filter(file => /\.(ttf|otf)$/.test(file)).length, 10)
})

test('text, lyrics, and SVG colors are independent and validate input', () => {
    assert.equal(colorCss({ ...defaults, textColorEnabled: false, lyricsColorEnabled: false, svgColorEnabled: false }), '')
    const text = colorCss({ ...defaults, textColor: '#112233', lyricsColorEnabled: false, svgColorEnabled: false })
    assert.match(text, /#112233/)
    assert.doesNotMatch(text, /pscf-svg-color|pscf-lyrics-color/)
    const lyrics = colorCss({ ...defaults, textColorEnabled: false, lyricsColor: '#445566', svgColorEnabled: false })
    assert.match(lyrics, /pscf-lyrics-color/)
    assert.match(lyrics, /#445566/)
    assert.doesNotMatch(lyrics, /--ym-controls/)
    const icons = colorCss({ ...defaults, textColorEnabled: false, lyricsColorEnabled: false, svgColor: 'red;}body{display:none' })
    assert.match(icons, /--pscf-svg-color: #ffffff/)
    assert.match(icons, /aria-disabled/)
    assert.doesNotMatch(icons, /display:none/)
})

test('wave icon images use a filter with the chosen color and preserve source alpha', () => {
    const filter = imageColorFilter('#12ab34')
    const decoded = decodeURIComponent(filter)
    assert.match(decoded, /feFlood flood-color="#12ab34"/)
    assert.match(decoded, /feComposite in2="SourceGraphic" operator="in"/)
    const css = colorCss({ ...defaults, svgColor: '#12ab34' })
    assert.match(css, /WheelItem_coverContainer_iconCover/)
    assert.match(css, /WHEEL_RESHUFFLE_ITEM/)
    assert.match(css, /filter: url\(/)
    assert.doesNotMatch(colorCss({ ...defaults, svgColorEnabled: false }), /filter:/)
})
