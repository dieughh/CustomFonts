import type { AddonApi } from '@pulsesync/addon-sdk'
import type { TypographySettings } from './settings'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const SHAPES = 'path, rect, circle, ellipse, polygon, polyline, line, text, textPath, use'
const BLOCKED = ':is(:disabled, [disabled], [aria-disabled="true"], [data-disabled="true"], [data-state="disabled"], [inert])'
const LYRICS = '[class*="SyncLyrics"], [class*="LyricsLine"], [class*="LyricsText"], [data-custom-fonts-lyrics]'
function validColor(value: string) {
    return CSS.supports('color', value) ? value : '#ffffff'
}

export function imageColorFilter(color: string) {
    const escaped = validColor(color).replace(
        /[&<>"']/g,
        character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
    )
    // Flood with the chosen color, then retain the original image's alpha silhouette.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="tint" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feFlood flood-color="${escaped}"/><feComposite in2="SourceGraphic" operator="in"/></filter></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}#tint")`
}

export function colorCss(value: TypographySettings) {
    const css: string[] = []
    if (value.textColorEnabled) css.push(`:root { --pscf-text-color: ${validColor(value.textColor)}; }`)
    if (value.lyricsColorEnabled) css.push(`:root { --pscf-lyrics-color: ${validColor(value.lyricsColor)}; }`)
    if (value.svgColorEnabled) {
        css.push(`:root { --pscf-svg-color: ${validColor(value.svgColor)}; }
            :root:root svg:not(${BLOCKED}, ${BLOCKED} *),
            :root:root svg *:not(${BLOCKED}, ${BLOCKED} *) { color: var(--pscf-svg-color) !important; }`)
        css.push(`:root:root [class*="WheelItem_coverContainer_iconCover"] > img:not(${BLOCKED}, ${BLOCKED} *),
            :root:root :is([data-test-id="WHEEL_SETTING_ITEM"], [data-test-id="WHEEL_RESHUFFLE_ITEM"]) img:not(${BLOCKED}, ${BLOCKED} *) {
                filter: ${imageColorFilter(value.svgColor)} !important;
            }`)
    }
    return css.join('\n')
}
type Paint = { value: string; priority: string }
type Painted = { fill?: Paint; stroke?: Paint }
type TextPaint = { color: Paint; fill: Paint }
type Reference = { href: string | null; xlink: string | null; local: string }

export class ColorController {
    private style = document.createElement('style')
    private observer: MutationObserver
    private enabled = false
    private textEnabled = false
    private lyricsEnabled = false
    private texts = new Map<HTMLElement, TextPaint>()
    private disposed = false
    private queued = false
    private dirty = new Map<Element, boolean>()
    private removed = false
    private signature = ''
    private scanned = new WeakSet<SVGElement>()
    private paints = new Map<SVGElement, Painted>()
    private references = new Map<SVGUseElement, Reference>()
    private sprites = new Map<string, Promise<Map<string, string>>>()
    private definitions = document.createElementNS(SVG_NS, 'svg')
    private nextId = 0

    constructor(private api: AddonApi) {
        this.style.id = 'custom-fonts-colors'
        this.definitions.id = 'custom-fonts-svg-definitions'
        this.definitions.setAttribute('aria-hidden', 'true')
        this.definitions.setAttribute('width', '0')
        this.definitions.setAttribute('height', '0')
        this.definitions.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden'
        this.observer = new MutationObserver(records => this.mutations(records))
        this.observe()
    }

    private mutations(records: MutationRecord[]) {
        if (!this.enabled && !this.textEnabled && !this.lyricsEnabled) {
            if (!this.style.isConnected) this.schedule()
            return
        }
        this.observer.disconnect()
        for (const record of records) {
            if (record.type === 'characterData') {
                if (record.target.parentElement) this.mark(record.target.parentElement, false)
            } else if (record.type === 'childList') {
                if (record.target instanceof Element) this.mark(record.target, false)
                for (const node of record.addedNodes) if (node instanceof Element) this.mark(node)
                if ([...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE)) this.removed = true
            } else if (record.target instanceof Element) {
                const target = record.target
                const attribute = record.attributeName
                const svg = target instanceof SVGElement
                const control = target.matches('button, [role="button"], input, select, textarea')
                const lyrics = attribute === 'class' && /lyrics/i.test(`${record.oldValue} ${target.getAttribute('class')}`)
                const deep = svg || control || lyrics || !['style', 'class'].includes(attribute ?? '')
                if (this.enabled && (svg || control) && ['fill', 'stroke', 'style', 'class'].includes(attribute ?? '')) {
                    const shapes =
                        target instanceof SVGElement
                            ? [target, ...target.querySelectorAll<SVGElement>(SHAPES)]
                            : target.querySelectorAll<SVGElement>(`svg :is(${SHAPES})`)
                    for (const element of shapes) {
                        const saved = this.paints.get(element)
                        if (saved) this.restorePaint(element, saved)
                        this.paints.delete(element)
                        this.scanned.delete(element)
                    }
                }
                this.mark(target, deep)
            }
        }
        this.observe()
        this.schedule()
    }

    private mark(element: Element, deep = true) {
        this.dirty.set(element, deep || this.dirty.get(element) === true)
    }

    private observe() {
        if (!this.disposed)
            this.observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: this.enabled || this.textEnabled || this.lyricsEnabled,
                ...(this.enabled || this.textEnabled || this.lyricsEnabled ? { attributeOldValue: true } : {}),
                ...(this.enabled || this.textEnabled || this.lyricsEnabled
                    ? {
                          attributeFilter: [
                              'href',
                              'xlink:href',
                              'fill',
                              'stroke',
                              'style',
                              'class',
                              'disabled',
                              'aria-disabled',
                              'data-disabled',
                              'data-state',
                              'inert',
                          ],
                      }
                    : {}),
                characterData: this.textEnabled || this.lyricsEnabled,
            })
    }

    apply(value: TypographySettings) {
        const signature = JSON.stringify([
            value.textColorEnabled,
            value.textColor,
            value.lyricsColorEnabled,
            value.lyricsColor,
            value.svgColorEnabled,
            value.svgColor,
        ])
        if (signature === this.signature) return
        this.signature = signature
        const changed =
            this.enabled !== value.svgColorEnabled || this.textEnabled !== value.textColorEnabled || this.lyricsEnabled !== value.lyricsColorEnabled
        this.observer.disconnect()
        this.enabled = value.svgColorEnabled
        this.textEnabled = value.textColorEnabled
        this.lyricsEnabled = value.lyricsColorEnabled
        const css = colorCss(value)
        if (this.style.textContent !== css) this.style.textContent = css
        this.ensureStyle()
        if (!this.enabled && (this.paints.size || this.references.size)) this.restore()
        if (changed) this.mark(document.body)
        this.observe()
        this.schedule()
    }

    ensureStyle() {
        if (!this.disposed && !this.style.isConnected) document.head.append(this.style)
    }

    private schedule() {
        if (this.queued || this.disposed) return
        this.queued = true
        queueMicrotask(() => {
            this.queued = false
            if (this.disposed) return
            this.observer.disconnect()
            try {
                this.ensureStyle()
                const roots = [...this.dirty].filter(([element]) => element.isConnected)
                this.dirty.clear()
                for (const [root, deep] of roots) {
                    if (roots.some(([ancestor, full]) => full && ancestor !== root && ancestor.contains(root))) continue
                    if (this.textEnabled || this.lyricsEnabled || this.texts.size) this.scanText(root, deep)
                    if (this.enabled) this.scan(root, deep)
                }
                if (this.removed) {
                    this.removed = false
                    for (const [element, saved] of this.texts)
                        if (!element.isConnected) {
                            this.restoreText(element, saved)
                            this.texts.delete(element)
                        }
                    for (const [element, saved] of this.paints)
                        if (!element.isConnected) {
                            this.restorePaint(element, saved)
                            this.paints.delete(element)
                            this.scanned.delete(element)
                        }
                    for (const [element, reference] of this.references)
                        if (!element.isConnected) {
                            this.restoreReference(element, reference)
                            this.references.delete(element)
                        }
                }
            } finally {
                this.observe()
            }
        })
    }

    private scan(root: Element, deep: boolean) {
        const shapes: SVGElement[] = []
        if (root instanceof SVGElement && root.matches(SHAPES)) shapes.push(root)
        if (deep) shapes.push(...root.querySelectorAll<SVGElement>(`svg :is(${SHAPES})`))
        // Read paints before changing any ancestors. Do not turn unfilled stroke icons into solid blocks.
        for (const shape of shapes) {
            if (shape.closest('mask, clipPath')) continue
            if (shape.closest(BLOCKED)) {
                if (shape instanceof SVGUseElement) {
                    const reference = this.references.get(shape)
                    if (reference) this.restoreReference(shape, reference)
                    this.references.delete(shape)
                }
                const saved = this.paints.get(shape)
                if (saved) this.restorePaint(shape, saved)
                // React or other addons may clone an already painted icon into a disabled control.
                for (const property of ['fill', 'stroke']) {
                    if (shape.style.getPropertyValue(property) === 'var(--pscf-svg-color)') shape.style.removeProperty(property)
                }
                this.paints.delete(shape)
                this.scanned.delete(shape)
                continue
            }
            if (shape instanceof SVGUseElement) void this.localize(shape)
            if (this.scanned.has(shape)) continue
            let saved = this.paints.get(shape)
            if (!saved) {
                saved = {}
                this.paints.set(shape, saved)
            }
            const computed = getComputedStyle(shape)
            for (const property of ['fill', 'stroke'] as const) {
                const current = shape.style.getPropertyValue(property)
                const priority = shape.style.getPropertyPriority(property)
                if (saved[property] && current === 'var(--pscf-svg-color)' && priority === 'important') continue
                const paint = computed.getPropertyValue(property)
                if (paint === 'none' || paint === 'transparent' || paint === 'rgba(0, 0, 0, 0)') {
                    delete saved[property]
                    continue
                }
                saved[property] = { value: current, priority }
                shape.style.setProperty(property, 'var(--pscf-svg-color)', 'important')
            }
            this.scanned.add(shape)
        }
    }

    private scanText(root: Element, deep: boolean) {
        const seen = new Set<HTMLElement>()
        const apply = (element: HTMLElement) => {
            if (seen.has(element)) return
            seen.add(element)
            const lyrics = !!element.closest(LYRICS)
            const hasText =
                element.matches('input:not([type="hidden"]), textarea, select') ||
                [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
            if (
                !hasText ||
                element.closest(`${BLOCKED}, svg, script, style, noscript, template`) ||
                (lyrics ? !this.lyricsEnabled : !this.textEnabled)
            ) {
                const saved = this.texts.get(element)
                if (saved) this.restoreText(element, saved)
                this.texts.delete(element)
                return
            }
            const style = element.style
            let saved = this.texts.get(element)
            const color = { value: style.getPropertyValue('color'), priority: style.getPropertyPriority('color') }
            const fill = { value: style.getPropertyValue('-webkit-text-fill-color'), priority: style.getPropertyPriority('-webkit-text-fill-color') }
            if (!saved) {
                saved = { color, fill }
                this.texts.set(element, saved)
            } else {
                if (!color.value.startsWith('var(--pscf-') || color.priority !== 'important') saved.color = color
                if (fill.value.toLowerCase() !== 'currentcolor' || fill.priority !== 'important') saved.fill = fill
            }
            const target = lyrics ? 'var(--pscf-lyrics-color)' : 'var(--pscf-text-color)'
            if (color.value !== target || color.priority !== 'important') style.setProperty('color', target, 'important')
            if (fill.value.toLowerCase() !== 'currentcolor' || fill.priority !== 'important')
                style.setProperty('-webkit-text-fill-color', 'currentColor', 'important')
        }
        if (root instanceof HTMLElement) apply(root)
        if (!deep) return
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
            const node = walker.currentNode
            if (!node.textContent?.trim()) continue
            const parent = node.parentElement
            if (parent instanceof HTMLElement) apply(parent)
        }
        for (const input of root.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, select')) apply(input)
    }

    private restoreText(element: HTMLElement, saved: TextPaint) {
        for (const [property, original, ours] of [
            ['color', saved.color, element.style.getPropertyValue('color').startsWith('var(--pscf-')],
            ['-webkit-text-fill-color', saved.fill, element.style.getPropertyValue('-webkit-text-fill-color').toLowerCase() === 'currentcolor'],
        ] as const) {
            if (!ours) continue
            if (original.value) element.style.setProperty(property, original.value, original.priority)
            else element.style.removeProperty(property)
        }
    }

    private async localize(use: SVGUseElement) {
        if (use.closest(BLOCKED)) return
        const source = use.getAttribute('href') || use.getAttributeNS(XLINK_NS, 'href')
        if (!source || source.startsWith('#')) return
        const url = new URL(source, location.href)
        if (!url.hash || url.protocol !== location.protocol || url.host !== location.host) return
        const fragment = decodeURIComponent(url.hash.slice(1))
        url.hash = ''
        const key = url.href
        let sprite = this.sprites.get(key)
        if (!sprite) {
            sprite = this.importSprite(key).catch(error => {
                if (!this.disposed) this.api.logger.warn('Не удалось обработать SVG-спрайт', key, error)
                return new Map<string, string>()
            })
            this.sprites.set(key, sprite)
        }
        try {
            const ids = await sprite
            if (this.disposed || !this.enabled || !use.isConnected || use.closest(BLOCKED)) return
            if ((use.getAttribute('href') || use.getAttributeNS(XLINK_NS, 'href')) !== source) return
            const id = ids.get(fragment)
            if (!id) return
            const local = `#${id}`
            this.references.set(use, { href: use.getAttribute('href'), xlink: use.getAttributeNS(XLINK_NS, 'href'), local })
            use.setAttribute('href', local)
            if (use.hasAttributeNS(XLINK_NS, 'href')) use.setAttributeNS(XLINK_NS, 'xlink:href', local)
            this.mark(use)
            this.schedule()
        } catch (error) {
            this.api.logger.warn('Не удалось обработать SVG-спрайт', key, error)
        }
    }

    private async importSprite(url: string) {
        const response = await fetch(url, { signal: this.api.signal })
        if (!response.ok) throw new Error(`SVG sprite: HTTP ${response.status}`)
        const source = new DOMParser().parseFromString(await response.text(), 'image/svg+xml')
        if (source.querySelector('parsererror')) throw new Error('Некорректный SVG')
        const ids = new Map<string, string>()
        // Prefix all identifiers, including gradients/masks referenced by symbols.
        for (const element of source.querySelectorAll('[id]')) ids.set(element.id, `pscf-svg-${++this.nextId}`)
        for (const element of source.querySelectorAll('*')) {
            if (element.id) element.id = ids.get(element.id)!
            for (const attribute of [...element.attributes]) {
                let value = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id) => (ids.has(id) ? `url(#${ids.get(id)})` : match))
                if (attribute.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`
                if (value !== attribute.value) element.setAttributeNS(attribute.namespaceURI, attribute.name, value)
            }
        }
        // Import definitions only; never execute SVG scripts or embed foreign content.
        for (const unsafe of source.querySelectorAll('script, foreignObject, style')) unsafe.remove()
        for (const element of source.querySelectorAll('*')) {
            for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
        }
        if (!this.disposed) {
            for (const child of [...source.documentElement.children]) this.definitions.append(document.importNode(child, true))
            if (!this.definitions.isConnected) document.body.append(this.definitions)
            this.mark(this.definitions)
            this.schedule()
        }
        return ids
    }

    private restorePaint(element: SVGElement, saved: Painted) {
        for (const property of ['fill', 'stroke'] as const) {
            const original = saved[property]
            if (original && element.style.getPropertyValue(property) === 'var(--pscf-svg-color)') {
                if (original.value) element.style.setProperty(property, original.value, original.priority)
                else element.style.removeProperty(property)
            }
        }
    }

    private restore() {
        for (const [element, saved] of this.paints) this.restorePaint(element, saved)
        this.paints.clear()
        this.scanned = new WeakSet()
        for (const [use, reference] of this.references) this.restoreReference(use, reference)
        this.references.clear()
    }

    private restoreReference(use: SVGUseElement, reference: Reference) {
        if (use.getAttribute('href') === reference.local) {
            if (reference.href === null) use.removeAttribute('href')
            else use.setAttribute('href', reference.href)
        }
        if (use.getAttributeNS(XLINK_NS, 'href') === reference.local) {
            if (reference.xlink === null) use.removeAttributeNS(XLINK_NS, 'href')
            else use.setAttributeNS(XLINK_NS, 'xlink:href', reference.xlink)
        }
    }

    dispose() {
        this.disposed = true
        this.observer.disconnect()
        this.restore()
        for (const [element, saved] of this.texts) this.restoreText(element, saved)
        this.texts.clear()
        this.dirty.clear()
        this.sprites.clear()
        this.definitions.remove()
        this.style.remove()
    }
}
