const addonConfig = {
    id: '68f0d4da-d1c4-4aeb-92a4-ea4b9553fd8c',
    directoryName: '68f0d4da-d1c4-4aeb-92a4-ea4b9553fd8c',
    name: 'Custom Fonts',
    description:
        'Этот аддон для изменения типографики в приложении. С его помощью вы можете загрузить любой файл шрифта (TTF, OTF, WOFF) и полностью настроить его отображение: от жирности и межбуквенного интервала до декоративных теней. Сделайте интерфейс по-настоящему своим!',
    version: '2.0.0',
    author: 'dieugh',
    type: 'web-addon',
    image: 'logo.png',
    banner: 'banner.png',
    libraryLogo: 'logo.png',
    tags: ['fonts', 'custom', 'web-addon'],
    dependencies: [],
    allowedUrls: [],
    supportedVersions: [],
    cssScope: 'global',
    requirements: {
        minHostApi: 1,
        capabilities: ['lifecycle-v1', 'async-start-v1', 'net-per-addon-v1'],
    },
}

export default addonConfig
