import { defineAddonSettings } from '@pulsesync/addon-sdk'

export const settings = defineAddonSettings([
    {
        title: 'Цвет основного текста',
        items: {
            textColorEnabled: { type: 'boolean', name: 'Изменять цвет текста', default: false },
            textColor: { type: 'color', name: 'Цвет текста', default: '#ffffff' },
        },
    },
    {
        title: 'Цвет текста песен',
        items: {
            lyricsColorEnabled: { type: 'boolean', name: 'Изменять цвет текста песен', default: false },
            lyricsColor: { type: 'color', name: 'Цвет текста песен', default: '#ffffff' },
        },
    },
    {
        title: 'Цвет иконок (SVG)',
        items: {
            svgColorEnabled: { type: 'boolean', name: 'Перекрашивать SVG', default: false },
            svgColor: { type: 'color', name: 'Цвет иконок', default: '#ffffff' },
        },
    },
    {
        title: 'Типографика',
        items: {
            fontWeight: {
                type: 'number',
                name: 'Жирность',
                description: 'Толщина шрифта (300 – 800)',
                default: 400,
                min: 300,
                max: 800,
                step: 50,
            },
            letterSpacing: {
                type: 'number',
                name: 'Межбуквенный',
                description: 'Расстояние между символами (-1px – 3px)',
                default: 0,
                min: -1,
                max: 3,
                step: 0.5,
            },
            italic: {
                type: 'boolean',
                name: 'Курсив',
                description: 'Наклонный шрифт',
                default: false,
            },
            underline: {
                type: 'boolean',
                name: 'Подчёркивание',
                description: 'Линия под текстом',
                default: false,
            },
            lineThrough: {
                type: 'boolean',
                name: 'Зачёркивание',
                description: 'Линия по центру текста',
                default: false,
            },
        },
    },
    {
        title: 'Тень текста',
        items: {
            textShadowEnabled: {
                type: 'boolean',
                name: 'Тень',
                description: 'Показывать тень у текста',
                default: false,
            },
            textShadowX: {
                type: 'number',
                name: 'Смещение X (px)',
                description: 'Горизонтальное смещение тени',
                default: 0,
                min: -10,
                max: 10,
                step: 1,
            },
            textShadowY: {
                type: 'number',
                name: 'Смещение Y (px)',
                description: 'Вертикальное смещение тени',
                default: 0,
                min: -10,
                max: 10,
                step: 1,
            },
            textShadowBlur: {
                type: 'number',
                name: 'Размытие (px)',
                description: 'Степень размытия тени',
                default: 0,
                min: 0,
                max: 20,
                step: 1,
            },
            textShadowColor: {
                type: 'color',
                name: 'Цвет тени',
                description: 'Выберите цвет тени',
                default: '#000000',
            },
        },
    },
] as const)

export type TypographySettings = typeof settings.defaults
