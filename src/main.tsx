import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { defineAddon, logger, notifications, type AddonApi } from '@pulsesync/addon-sdk'
import addonConfig from '../addon.config.mjs'
import { settings } from './settings'
import { FontController, SYSTEM_FONTS } from './fonts'
import { ColorController } from './colors'
import './style.css'

let fonts: FontController | undefined
let panelOpen = false
const listeners = new Set<() => void>()
function showPanel(open: boolean) {
    panelOpen = open
    listeners.forEach(listener => listener())
}
function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function FontPanel() {
    const open = useSyncExternalStore(subscribe, () => panelOpen)
    const [current, setCurrent] = useState('')
    const [busy, setBusy] = useState(false)
    const dialog = useRef<HTMLDialogElement>(null)
    const input = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (!open) return
        setCurrent(fonts?.name ?? '')
        const element = dialog.current
        element?.showModal()
        return () => element?.close()
    }, [open])
    async function change(action: (controller: FontController) => Promise<void>) {
        if (!fonts || busy) return
        setBusy(true)
        try {
            await action(fonts)
            setCurrent(fonts?.name ?? '')
        } catch (error) {
            logger.error('Не удалось изменить шрифт', error)
            await notifications.error('Не удалось загрузить шрифт. Проверьте файл и повторите попытку.')
        } finally {
            setBusy(false)
        }
    }
    if (!open) return null
    return (
        <dialog
            ref={dialog}
            className="custom-fonts-dialog"
            aria-labelledby="custom-fonts-title"
            onCancel={() => showPanel(false)}
            onClose={() => showPanel(false)}
            onClick={event => {
                if (event.target === dialog.current) showPanel(false)
            }}
        >
            <div className="custom-fonts-content">
                <header>
                    <h2 id="custom-fonts-title">Кастомный шрифт</h2>
                    <button type="button" aria-label="Закрыть" onClick={() => showPanel(false)}>
                        ✕
                    </button>
                </header>
                <p aria-live="polite">{current ? `Текущий шрифт: ${current}` : 'Используется стандартный шрифт'}</p>
                <input
                    ref={input}
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2"
                    hidden
                    disabled={busy}
                    onChange={event => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ''
                        if (file) void change(controller => controller.upload(file))
                    }}
                />
                <button type="button" disabled={busy} onClick={() => input.current?.click()}>
                    Выбрать файл шрифта
                </button>
                <small>TTF, OTF, WOFF, WOFF2. Шрифт сохраняется после перезапуска.</small>
                <label>
                    Встроенные шрифты
                    <select
                        disabled={busy}
                        value={SYSTEM_FONTS.some(font => font.name === current) ? current : ''}
                        onChange={event => {
                            const name = event.currentTarget.value
                            void change(controller => (name ? controller.select(name) : controller.reset()))
                        }}
                    >
                        <option value="">Не выбран</option>
                        {SYSTEM_FONTS.map(font => (
                            <option key={font.name} value={font.name}>
                                {font.name}
                            </option>
                        ))}
                    </select>
                </label>
                <button type="button" disabled={busy} onClick={() => void change(controller => controller.reset())}>
                    Сбросить шрифт
                </button>
                <small>Типографика, цвет текста, текста песен и SVG настраиваются в PulseSync → Custom Fonts.</small>
            </div>
        </dialog>
    )
}

function installSettingsButton(api: AddonApi, controller: FontController) {
    const row = document.createElement('li')
    row.dataset.customFontsButton = ''
    let removeClickListener: (() => void) | undefined
    let container: Element | null = null
    let pending = false
    let active = true
    const update = () => {
        if (!active) return
        const target = container?.isConnected
            ? container
            : /^\/settings(?:\/|$)/.test(location.pathname)
              ? document.querySelector('[class*="Settings_root"]')
              : null
        container = target
        if (target && row.parentElement !== target) {
            const template = target.querySelector<HTMLButtonElement>(
                'button[class*="SettingsListButtonItem_root"]:not(.custom-fonts-settings-button)',
            )
            if (template) {
                // Clone only markup; cloneNode does not copy React handlers or event listeners.
                const button = template.cloneNode(true) as HTMLButtonElement
                const title = button.querySelector<HTMLElement>('[class*="SettingsListButtonItem_title"]')
                const description = button.querySelector<HTMLElement>('[class*="SettingsListButtonItem_description"]')
                if (title && description) {
                    for (const element of [button, ...button.querySelectorAll('*')]) {
                        for (const attribute of [...element.attributes]) {
                            if (/^(id|title|data-test-id|aria-describedby|aria-controls)$/.test(attribute.name))
                                element.removeAttribute(attribute.name)
                        }
                    }
                    button.classList.add('custom-fonts-settings-button')
                    button.disabled = false
                    button.type = 'button'
                    title.textContent = 'Кастомный шрифт'
                    removeClickListener?.()
                    removeClickListener = api.listen(button, 'click', () => showPanel(true))
                    row.className = template.closest('li')?.className ?? ''
                    row.replaceChildren(button)
                    target.prepend(row)
                }
            }
        }
        const description = row.querySelector('[class*="SettingsListButtonItem_description"]')
        const text = controller.name ? `Текущий шрифт: ${controller.name}` : 'Выбрать файл или встроенный шрифт'
        if (description && description.textContent !== text) description.textContent = text
        controller.ensureStyle()
    }
    const updateWave = () => {
        const wave = /^\/(home(?:\/|$)|$)/.test(location.pathname) || !!document.querySelector('[class*="VibePage_root"]')
        if (document.documentElement.classList.contains('custom-fonts-wave') !== wave) {
            document.documentElement.classList.toggle('custom-fonts-wave', wave)
        }
    }
    const schedule = () => {
        if (pending || !active) return
        pending = true
        queueMicrotask(() => {
            pending = false
            update()
        })
    }
    const observer = new MutationObserver(records => {
        if (
            !document.getElementById('custom-fonts-style') ||
            (/^\/settings(?:\/|$)/.test(location.pathname) &&
                (!container?.isConnected ||
                    row.parentElement !== container ||
                    records.some(record => [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))))
        )
            schedule()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    api.onCleanup(
        api.router.onChange(() => {
            updateWave()
            schedule()
        }),
    )
    api.onCleanup(controller.onChange(schedule))
    api.onCleanup(() => {
        active = false
        observer.disconnect()
        removeClickListener?.()
        row.remove()
        document.documentElement.classList.remove('custom-fonts-wave')
    })
    update()
    updateWave()
}

export default defineAddon({
    id: addonConfig.id,
    name: addonConfig.name,
    settings,
    component: FontPanel,
    playerBarButtons: [
        {
            id: 'custom-fonts',
            label: 'Кастомный шрифт',
            icon: 'settings',
            onClick: () => showPanel(true),
        },
    ],
    async start(api) {
        const controller = new FontController(api)
        const colors = new ColorController(api)
        fonts = controller
        api.onCleanup(() => {
            showPanel(false)
            controller.dispose()
            colors.dispose()
            if (fonts === controller) fonts = undefined
        })
        await controller.load()
        if (api.signal.aborted) return
        controller.apply(settings.store)
        colors.apply(settings.store)
        api.onCleanup(
            api.settings.onChange(() => {
                controller.apply(settings.store)
                colors.apply(settings.store)
            }),
        )
        installSettingsButton(api, controller)
    },
})
