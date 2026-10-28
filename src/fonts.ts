import type { AddonApi } from '@pulsesync/addon-sdk'
import { settings, type TypographySettings } from './settings'

export const SYSTEM_FONTS = [
    { name: 'Arial', file: 'Arial.ttf' },
    { name: 'Calibri', file: 'Calibri.ttf' },
    { name: 'Futura', file: 'Futura.otf' },
    { name: 'Garamond', file: 'Garamond.ttf' },
    { name: 'Georgia', file: 'Georgia.ttf' },
    { name: 'Helvetica', file: 'Helvetica.otf' },
    { name: 'OpenSans', file: 'OpenSans.ttf' },
    { name: 'Roboto', file: 'Roboto.ttf' },
    { name: 'Times New Roman', file: 'TimesNewRoman.ttf' },
    { name: 'Verdana', file: 'Verdana.ttf' },
] as const

type SavedFont = {
    fontData: ArrayBuffer | null
    fontFileName: string
    systemFontDisplayName: string | null
}
const EMPTY_FONT: SavedFont = { fontData: null, fontFileName: '', systemFontDisplayName: null }

// Keep the original database and key so previously uploaded fonts remain available.
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('CustomFontsDB', 2)
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('fonts')) request.result.createObjectStore('fonts')
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('База шрифтов занята другим окном'))
    })
}

async function readFont(): Promise<SavedFont | undefined> {
    const db = await openDatabase()
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('fonts', 'readonly')
            const request = tx.objectStore('fonts').get('current')
            tx.oncomplete = () => resolve(request.result)
            tx.onabort = () => reject(tx.error)
            tx.onerror = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

async function writeFont(value: SavedFont, typography: TypographySettings) {
    const db = await openDatabase()
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('fonts', 'readwrite')
            tx.objectStore('fonts').put({ ...typography, ...value }, 'current')
            tx.oncomplete = () => resolve()
            tx.onabort = () => reject(tx.error)
            tx.onerror = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

export function typographyCss(value: TypographySettings, fontUrl = '') {
    const clampWeight = (base: number) => Math.min(900, Math.max(100, Math.round((base * value.fontWeight) / 400)))
    const decoration = [value.underline && 'underline', value.lineThrough && 'line-through'].filter(Boolean).join(' ') || 'none'
    const color = CSS.supports('color', value.textShadowColor) ? value.textShadowColor : '#000000'
    const shadow = value.textShadowEnabled ? `${value.textShadowX}px ${value.textShadowY}px ${value.textShadowBlur}px ${color}` : 'none'
    const family = `${fontUrl ? '"CustomAppFont", ' : ''}"YS Text", "YSMusic Headline", system-ui, -apple-system, "Segoe UI", sans-serif`
    const selectors = [
        ['body, p, [class*="text"], [class*="Text"]', 400],
        ['button, span, [class*="title"], [class*="track"], [class*="Track"], [class*="description"], [class*="desc"]', 500],
        ['h2, h3, [class*="heading"], [class*="headline"]', 700],
    ] as const
    return `${fontUrl ? `@font-face { font-family: "CustomAppFont"; src: url(${JSON.stringify(fontUrl)}); font-display: swap; }` : ''}
        :root { --pscf-font-family: ${family}; }
        ${selectors
            .map(
                ([selector, weight]) => `${selector} {
            font-family: var(--pscf-font-family) !important;
            font-weight: ${clampWeight(weight)} !important;
            letter-spacing: ${value.letterSpacing}px !important;
            text-shadow: ${shadow} !important;
            font-style: ${value.italic ? 'italic' : 'normal'} !important;
            text-decoration: ${decoration} !important;
        }`,
            )
            .join('\n')}`
}

export class FontController {
    private saved: SavedFont = { ...EMPTY_FONT }
    private typography: TypographySettings = settings.defaults
    private style = document.createElement('style')
    private url = ''
    private objectUrl = ''
    private disposed = false
    private listeners = new Set<() => void>()

    constructor(private api: AddonApi) {
        this.style.id = 'custom-fonts-style'
    }

    get name() {
        return this.saved.fontFileName || this.saved.systemFontDisplayName || ''
    }

    onChange(listener: () => void) {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    async load() {
        try {
            const saved = await readFont()
            if (this.disposed) return
            if (saved)
                this.saved = {
                    fontData: saved.fontData instanceof ArrayBuffer ? saved.fontData : null,
                    fontFileName: typeof saved.fontFileName === 'string' ? saved.fontFileName : '',
                    systemFontDisplayName: SYSTEM_FONTS.some(font => font.name === saved.systemFontDisplayName) ? saved.systemFontDisplayName : null,
                }
            this.updateUrl()
        } catch (error) {
            this.api.logger.error('Не удалось прочитать сохранённый шрифт', error)
            if (!this.disposed) await this.api.notifications.error('Не удалось прочитать сохранённый шрифт. Можно выбрать его заново.')
        }
    }

    private updateUrl() {
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
        this.objectUrl = ''
        this.url = ''
        if (this.saved.fontData) {
            this.objectUrl = URL.createObjectURL(new Blob([this.saved.fontData]))
            this.url = this.objectUrl
        } else {
            const font = SYSTEM_FONTS.find(font => font.name === this.saved.systemFontDisplayName)
            // SDK asset names are relative to Assets, not to the addon's root.
            if (font) this.url = this.api.assets.url(font.file)
        }
    }

    private async commit(saved: SavedFont) {
        if (this.disposed) return
        await writeFont(saved, this.typography)
        if (this.disposed) return
        this.saved = saved
        this.updateUrl()
        this.apply(this.typography)
        this.listeners.forEach(listener => listener())
    }

    async upload(file: File) {
        if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Неподдерживаемый формат шрифта')
        const data = await file.arrayBuffer()
        // Validate before replacing a working font or persisting invalid bytes.
        await new FontFace('CustomFontsValidation', data).load()
        await this.commit({ fontData: data, fontFileName: file.name, systemFontDisplayName: null })
    }

    async select(name: string) {
        const font = SYSTEM_FONTS.find(font => font.name === name)
        if (!font) throw new Error('Неизвестный шрифт')
        await new FontFace('CustomFontsValidation', `url(${JSON.stringify(this.api.assets.url(font.file))})`).load()
        await this.commit({ fontData: null, fontFileName: '', systemFontDisplayName: name })
    }

    async reset() {
        await this.commit({ ...EMPTY_FONT })
    }

    apply(value: TypographySettings) {
        if (this.disposed) return
        this.typography = value
        const css = typographyCss(value, this.url)
        if (this.style.textContent !== css) this.style.textContent = css
        this.ensureStyle()
    }

    ensureStyle() {
        if (!this.disposed && !this.style.isConnected) document.head.append(this.style)
    }

    dispose() {
        this.disposed = true
        this.style.remove()
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
        this.objectUrl = ''
        this.listeners.clear()
    }
}
