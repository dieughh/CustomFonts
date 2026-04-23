(function() {
  'use strict';

  const ADDON_NAME = 'Custom Fonts';
  const FONT_FAMILY = 'CustomAppFont';
  const DB_NAME = 'CustomFontsDB';
  const STORE_NAME = 'fonts';

  const log = (...args) => console.log(`[${ADDON_NAME}]`, ...args);
  const warn = (...args) => console.warn(`[${ADDON_NAME}]`, ...args);
  const error = (...args) => console.error(`[${ADDON_NAME}]`, ...args);

  let settings = {
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
    fontData: null,
    fontFileName: ''
  };

  // Управление Blob URL
  let currentFontUrl = null;
  // Управление наблюдателями
  let styleObserver = null;
  let uiObserver = null;

  // --- IndexedDB ---
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function saveSettingsToDB() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const toSave = {
        fontWeight: settings.fontWeight,
        letterSpacing: settings.letterSpacing,
        italic: settings.italic,
        underline: settings.underline,
        lineThrough: settings.lineThrough,
        textShadowEnabled: settings.textShadowEnabled,
        textShadowX: settings.textShadowX,
        textShadowY: settings.textShadowY,
        textShadowBlur: settings.textShadowBlur,
        textShadowColor: settings.textShadowColor,
        fontData: settings.fontData,
        fontFileName: settings.fontFileName
      };
      store.put(toSave, 'current');
      await tx.done;
      log('Настройки сохранены в IndexedDB');
    } catch (e) {
      error('Ошибка сохранения настроек:', e);
    }
  }

  async function loadSettingsFromDB() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const data = await new Promise((resolve, reject) => {
        const req = store.get('current');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (data) {
        settings.fontWeight = data.fontWeight ?? 400;
        settings.letterSpacing = data.letterSpacing ?? 0;
        settings.italic = data.italic ?? false;
        settings.underline = data.underline ?? false;
        settings.lineThrough = data.lineThrough ?? false;
        settings.textShadowEnabled = data.textShadowEnabled ?? false;
        settings.textShadowX = data.textShadowX ?? 0;
        settings.textShadowY = data.textShadowY ?? 0;
        settings.textShadowBlur = data.textShadowBlur ?? 0;
        settings.textShadowColor = data.textShadowColor ?? '#000000';
        settings.fontData = data.fontData ?? null;
        settings.fontFileName = data.fontFileName ?? '';
        log('Настройки загружены из IndexedDB');
      }
    } catch (e) {
      error('Ошибка загрузки настроек:', e);
    }
  }

  async function resetFont() {
    settings.fontData = null;
    settings.fontFileName = '';
    await saveSettingsToDB();
    applyStyles();
    updateUI();
    log('Шрифт сброшен');
  }

  // --- Настройки из PulseSync ---
  function unwrapSetting(entry, fallback) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      if (typeof entry.value !== 'undefined') return entry.value;
      if (typeof entry.default !== 'undefined') return entry.default;
    }
    return typeof entry !== 'undefined' ? entry : fallback;
  }

  function updateTypographySettings(rawSettings) {
    settings.fontWeight = unwrapSetting(rawSettings.fontWeight, 400);
    settings.letterSpacing = unwrapSetting(rawSettings.letterSpacing, 0);
    settings.italic = unwrapSetting(rawSettings.italic, false);
    settings.underline = unwrapSetting(rawSettings.underline, false);
    settings.lineThrough = unwrapSetting(rawSettings.lineThrough, false);
    settings.textShadowEnabled = unwrapSetting(rawSettings.textShadowEnabled, false);
    settings.textShadowX = unwrapSetting(rawSettings.textShadowX, 0);
    settings.textShadowY = unwrapSetting(rawSettings.textShadowY, 0);
    settings.textShadowBlur = unwrapSetting(rawSettings.textShadowBlur, 0);
    settings.textShadowColor = unwrapSetting(rawSettings.textShadowColor, '#000000');
    log('Типографика обновлена');
  }

  // --- Применение CSS ---
  let styleElement = null;

  function getMimeType(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    return { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[ext] || 'font/ttf';
  }

  function getFormatFromFileName(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    return { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[ext] || 'truetype';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applyStyles() {
    const {
      fontWeight: userWeight, letterSpacing, italic, underline, lineThrough,
      textShadowEnabled, textShadowX, textShadowY, textShadowBlur, textShadowColor,
      fontData, fontFileName
    } = settings;
    let css = '';

    // Освобождаем предыдущий Blob URL
    if (currentFontUrl) {
      URL.revokeObjectURL(currentFontUrl);
      currentFontUrl = null;
    }

    if (fontData) {
      const blob = new Blob([fontData], { type: getMimeType(fontFileName) });
      currentFontUrl = URL.createObjectURL(blob);
      const format = getFormatFromFileName(fontFileName);
      css += `
        @font-face {
          font-family: '${FONT_FAMILY}';
          src: url('${currentFontUrl}') format('${format}');
          font-display: swap;
        }
      `;
    }

    const fallback = fontData
      ? `'${FONT_FAMILY}', "YS Text", "YSMusic Headline", system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
      : '"YS Text", "YSMusic Headline", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    const baseWeight = 400;
    const weightScale = userWeight / baseWeight;
    const bodyWeight = clamp(Math.round(baseWeight * weightScale), 100, 900);
    const mediumWeight = clamp(Math.round(500 * weightScale), 100, 900);
    const boldWeight = clamp(Math.round(700 * weightScale), 100, 900);

    const decorations = [];
    if (underline) decorations.push('underline');
    if (lineThrough) decorations.push('line-through');
    const textDecorationValue = decorations.length > 0 ? decorations.join(' ') : 'none';

    // Тень применяется только если включена
    const shadowValue = textShadowEnabled
      ? `${textShadowX}px ${textShadowY}px ${textShadowBlur}px ${textShadowColor}`
      : 'none';

    css += `
      :root {
        --pscf-font-family: ${fallback};
        --pscf-letter-spacing: ${letterSpacing}px;
        --pscf-weight-body: ${bodyWeight};
        --pscf-weight-medium: ${mediumWeight};
        --pscf-weight-bold: ${boldWeight};
        --pscf-text-shadow: ${shadowValue};
        --pscf-font-style: ${italic ? 'italic' : 'normal'};
        --pscf-text-decoration: ${textDecorationValue};
      }

      body, p, [class*="text"], [class*="Text"] {
        font-family: var(--pscf-font-family) !important;
        font-weight: var(--pscf-weight-body) !important;
        letter-spacing: var(--pscf-letter-spacing) !important;
        text-shadow: var(--pscf-text-shadow) !important;
        font-style: var(--pscf-font-style) !important;
        text-decoration: var(--pscf-text-decoration) !important;
      }

      button, span, [class*="title"], [class*="track"], [class*="Track"],
      [class*="description"], [class*="desc"], [class*="SettingsListButtonItem_title"] {
        font-family: var(--pscf-font-family) !important;
        font-weight: var(--pscf-weight-medium) !important;
        letter-spacing: var(--pscf-letter-spacing) !important;
        text-shadow: var(--pscf-text-shadow) !important;
        font-style: var(--pscf-font-style) !important;
        text-decoration: var(--pscf-text-decoration) !important;
      }

      h2, h3, [class*="heading"], [class*="headline"] {
        font-family: var(--pscf-font-family) !important;
        font-weight: var(--pscf-weight-bold) !important;
        letter-spacing: var(--pscf-letter-spacing) !important;
        text-shadow: var(--pscf-text-shadow) !important;
        font-style: var(--pscf-font-style) !important;
        text-decoration: var(--pscf-text-decoration) !important;
      }

      [class*="player"] [class*="title"],
      [class*="Player"] [class*="title"] {
        font-weight: var(--pscf-weight-medium) !important;
      }
    `;

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'custom-fonts-style';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
    log('Стили применены');
  }

  // --- Выбор файла ---
  function createFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.woff,.woff2';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async (e) => {
      const file = input.files[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        settings.fontData = buffer;
        settings.fontFileName = file.name;
        await saveSettingsToDB();
        applyStyles();
        updateUI();
        log('Шрифт загружен из файла:', file.name);
      } catch (err) {
        error('Ошибка чтения файла:', err);
      } finally {
        input.remove();
      }
    });

    input.click();
  }

  // --- UI ---
  let mainButtonDesc = null;

  function updateUI() {
    if (mainButtonDesc) {
      if (settings.fontData) {
        mainButtonDesc.textContent = `Файл: ${settings.fontFileName}`;
      } else {
        mainButtonDesc.textContent = 'Шрифт не выбран';
      }
    }
  }

  function openSubPage() {
    const existingPortal = document.querySelector('[data-custom-fonts-portal]');
    if (existingPortal) existingPortal.remove();

    const portal = document.createElement('div');
    portal.setAttribute('data-custom-fonts-portal', '');
    portal.style.position = 'fixed';
    portal.style.top = '0';
    portal.style.left = '0';
    portal.style.width = '100%';
    portal.style.height = '100%';
    portal.style.zIndex = '10000';

    const overlay = document.createElement('div');
    overlay.className = 'l66GiFKS1Ux_BNd603Cu NaZE1NCUxSM1MvpZuLJV';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.addEventListener('click', () => portal.remove());

    const modal = document.createElement('div');
    modal.className = 'ifxS_8bgSnwBoCsyow0E t7tk8IYH3tGrhDZJpi3Z GKgBufCxWa9erUCTU3Fp mjhMCLd6OX1d1_cJo5Cm ShortcutsModal_list__eS4ox';
    modal.style.position = 'fixed';
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.backgroundColor = 'var(--ym-background-color-primary, #1e1e1e)';
    modal.style.color = 'var(--ym-controls-color-primary-text-enabled, #fff)';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
    modal.style.width = '34.125rem';
    modal.style.maxWidth = '90vw';
    modal.style.maxHeight = '80vh';
    modal.style.overflow = 'hidden';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const header = document.createElement('header');
    header.className = 'wEOFUiLOfluq86BrDUfg ShortcutsModal_modalHeader__IYJ9m';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '16px 24px';
    header.style.borderBottom = '1px solid var(--ym-separator-color)';

    const title = document.createElement('h3');
    title.className = '_MWOVuZRvUQdXKTMcOPx _sd8Q9d_Ttn0Ufe4ISWS nSU6fV9y80WrZEfafvww xuw9gha2dQiGgdRcHNgU';
    title.textContent = 'Кастомный шрифт';
    title.style.margin = '0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '500';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cpeagBA1_PblpJn8Xgtv iJVAJMgccD4vj4E4o068 uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p nHWc2sto1C6Gm0Dpw_l0 oR11LfCBVqMbUJiAgknd qU2apWBO1yyEK0lZ3lPO YUY9QjXr1E4DQfQdMjGt';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '4px';
    closeBtn.style.color = 'inherit';
    closeBtn.addEventListener('click', () => portal.remove());

    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('class', 'J9wTKytjOWG73QMoN5WP l3tE1hAMmBj2aoPPwU08');
    closeIcon.setAttribute('focusable', 'false');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeIcon.style.width = '20px';
    closeIcon.style.height = '20px';
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons/sprite.svg#close_xxs');
    closeIcon.appendChild(use);
    closeBtn.appendChild(closeIcon);

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'fp0QgCrX1y48p3elvLVi ni3sfTj4hRfj63FbfQTG ShortcutsModal_modalContent__SCpYX Modal_content_no_right_padding';
    content.style.padding = '16px 0';
    content.style.overflowY = 'auto';
    content.style.flex = '1';

    const list = document.createElement('ul');
    list.className = 'Settings_root__FVVrn ShortcutsModal_list__eS4ox';
    list.style.listStyle = 'none';
    list.style.padding = '0';
    list.style.margin = '0';
    list.style.width = '100%';

    // Пункт 1: Выбрать файл
    const item1 = document.createElement('li');
    item1.className = 'Settings_item__Ksa9h';
    item1.style.padding = '0 24px';

    const btn1 = document.createElement('button');
    btn1.className = 'cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p j1jXIVckFgZECecFzZMe qU2apWBO1yyEK0lZ3lPO BbCxxIjBGupN28bq2lSP et24Jf7pT_X9Fvc7TznR SettingsListButtonItem_root__3dtV2 SettingsListButtonItem_important__AcEon';
    btn1.type = 'button';
    btn1.style.width = '100%';
    btn1.style.textAlign = 'left';

    const span1 = document.createElement('span');
    span1.className = 'JjlbHZ4FaP9EAcR_1DxF iOlzvyUREgDkthkrx7Sf SettingsListButtonItem_contentContainer__jqoKg';

    const content1 = document.createElement('div');
    content1.className = 'SettingsListButtonItem_content___Opuo';

    const title1 = document.createElement('div');
    title1.className = '_MWOVuZRvUQdXKTMcOPx LezmJlldtbHWqU7l1950 oyQL2RSmoNbNQf3Vc6YI V3WU123oO65AxsprotU9 Vi7Rd0SZWqD17F0872TB SettingsListButtonItem_title__npCza';
    title1.style.webkitLineClamp = '1';
    title1.textContent = 'Выбрать файл шрифта';

    const desc1 = document.createElement('div');
    desc1.className = '_MWOVuZRvUQdXKTMcOPx SehSa7OyRpC2nzYTVb2Q _3_Mxw7Si7j2g4kWjlpR SettingsListButtonItem_description__g8_Ba';
    desc1.textContent = settings.fontData ? `Текущий: ${settings.fontFileName}` : 'Локальный файл';

    content1.appendChild(title1);
    content1.appendChild(desc1);

    const svg1 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg1.setAttribute('class', 'J9wTKytjOWG73QMoN5WP RBoEbyJKP5rEtLsXM1ji SettingsListButtonItem_icon__WULZ1 UwnL5AJBMMAp6NwMDdZk');
    svg1.setAttribute('focusable', 'false');
    svg1.setAttribute('aria-hidden', 'true');
    const use1 = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use1.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons/sprite.svg#arrowRight_xs');
    svg1.appendChild(use1);

    span1.appendChild(content1);
    span1.appendChild(svg1);
    btn1.appendChild(span1);
    btn1.addEventListener('click', createFileInput);

    item1.appendChild(btn1);

    // Пункт 2: Сбросить шрифт
    const item2 = document.createElement('li');
    item2.className = 'Settings_item__Ksa9h';
    item2.style.padding = '0 24px';

    const btn2 = document.createElement('button');
    btn2.className = 'cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p j1jXIVckFgZECecFzZMe qU2apWBO1yyEK0lZ3lPO BbCxxIjBGupN28bq2lSP et24Jf7pT_X9Fvc7TznR SettingsListButtonItem_root__3dtV2 SettingsListButtonItem_important__AcEon';
    btn2.type = 'button';
    btn2.style.width = '100%';
    btn2.style.textAlign = 'left';

    const span2 = document.createElement('span');
    span2.className = 'JjlbHZ4FaP9EAcR_1DxF iOlzvyUREgDkthkrx7Sf SettingsListButtonItem_contentContainer__jqoKg';

    const content2 = document.createElement('div');
    content2.className = 'SettingsListButtonItem_content___Opuo';

    const title2 = document.createElement('div');
    title2.className = '_MWOVuZRvUQdXKTMcOPx LezmJlldtbHWqU7l1950 oyQL2RSmoNbNQf3Vc6YI V3WU123oO65AxsprotU9 Vi7Rd0SZWqD17F0872TB SettingsListButtonItem_title__npCza';
    title2.style.webkitLineClamp = '1';
    title2.textContent = 'Сбросить шрифт';

    const desc2 = document.createElement('div');
    desc2.className = '_MWOVuZRvUQdXKTMcOPx SehSa7OyRpC2nzYTVb2Q _3_Mxw7Si7j2g4kWjlpR SettingsListButtonItem_description__g8_Ba';
    desc2.textContent = 'Вернуть стандартный шрифт';

    content2.appendChild(title2);
    content2.appendChild(desc2);

    const svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg2.setAttribute('class', 'J9wTKytjOWG73QMoN5WP RBoEbyJKP5rEtLsXM1ji SettingsListButtonItem_icon__WULZ1 UwnL5AJBMMAp6NwMDdZk');
    svg2.setAttribute('focusable', 'false');
    svg2.setAttribute('aria-hidden', 'true');
    const use2 = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use2.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons/sprite.svg#arrowRight_xs');
    svg2.appendChild(use2);

    span2.appendChild(content2);
    span2.appendChild(svg2);
    btn2.appendChild(span2);
    btn2.addEventListener('click', async () => {
      await resetFont();
      updateUI();
    });

    item2.appendChild(btn2);

    list.appendChild(item1);
    list.appendChild(item2);
    content.appendChild(list);
    modal.appendChild(header);
    modal.appendChild(content);

    portal.appendChild(overlay);
    portal.appendChild(modal);
    document.body.appendChild(portal);
  }

  function injectSettingsUI() {
    let currentButtonLi = null;

    if (uiObserver) {
      uiObserver.disconnect();
      uiObserver = null;
    }

    const addButtonIfNeeded = () => {
      const settingsContainer = document.querySelector('[class*="Settings_root"]');
      if (!settingsContainer) {
        if (currentButtonLi) {
          currentButtonLi.remove();
          currentButtonLi = null;
        }
        return;
      }

      if (settingsContainer.querySelector('[data-custom-fonts-button]')) {
        return;
      }

      if (currentButtonLi) {
        currentButtonLi.remove();
      }

      const li = document.createElement('li');
      li.className = 'Settings_item__Ksa9h';
      li.setAttribute('data-custom-fonts-button', '');

      const button = document.createElement('button');
      button.className = 'cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p j1jXIVckFgZECecFzZMe qU2apWBO1yyEK0lZ3lPO BbCxxIjBGupN28bq2lSP et24Jf7pT_X9Fvc7TznR SettingsListButtonItem_root__3dtV2 SettingsListButtonItem_important__AcEon';
      button.type = 'button';

      const span = document.createElement('span');
      span.className = 'JjlbHZ4FaP9EAcR_1DxF iOlzvyUREgDkthkrx7Sf SettingsListButtonItem_contentContainer__jqoKg';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'SettingsListButtonItem_content___Opuo';

      const titleDiv = document.createElement('div');
      titleDiv.className = '_MWOVuZRvUQdXKTMcOPx LezmJlldtbHWqU7l1950 oyQL2RSmoNbNQf3Vc6YI V3WU123oO65AxsprotU9 Vi7Rd0SZWqD17F0872TB SettingsListButtonItem_title__npCza';
      titleDiv.style.webkitLineClamp = '1';
      titleDiv.textContent = 'Кастомный шрифт';

      const descDiv = document.createElement('div');
      descDiv.className = '_MWOVuZRvUQdXKTMcOPx SehSa7OyRpC2nzYTVb2Q _3_Mxw7Si7j2g4kWjlpR SettingsListButtonItem_description__g8_Ba';
      mainButtonDesc = descDiv;
      updateUI();

      contentDiv.appendChild(titleDiv);
      contentDiv.appendChild(descDiv);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'J9wTKytjOWG73QMoN5WP RBoEbyJKP5rEtLsXM1ji SettingsListButtonItem_icon__WULZ1 UwnL5AJBMMAp6NwMDdZk');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons/sprite.svg#arrowRight_xs');
      svg.appendChild(use);

      span.appendChild(contentDiv);
      span.appendChild(svg);
      button.appendChild(span);

      button.addEventListener('click', openSubPage);

      li.appendChild(button);
      settingsContainer.insertBefore(li, settingsContainer.firstChild);
      currentButtonLi = li;
      log('Кнопка добавлена в настройки');
    };

    uiObserver = new MutationObserver(() => {
      addButtonIfNeeded();
    });

    uiObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    addButtonIfNeeded();
  }

  function subscribeToPulseSyncSettings() {
    if (!window.pulsesyncApi || typeof window.pulsesyncApi.getSettings !== 'function') {
      warn('pulsesyncApi недоступен, используем значения по умолчанию.');
      return;
    }

    const store = window.pulsesyncApi.getSettings(ADDON_NAME);
    const update = () => {
      const current = store.getCurrent();
      updateTypographySettings(current);
      applyStyles();
    };
    update();
    store.onChange(() => update());
  }

  async function init() {
    log('Инициализация');
    await loadSettingsFromDB();
    subscribeToPulseSyncSettings();
    injectSettingsUI();

    if (styleObserver) {
      styleObserver.disconnect();
    }
    styleObserver = new MutationObserver(() => {
      if (!document.getElementById('custom-fonts-style')) {
        styleElement = null;
        applyStyles();
      }
    });
    styleObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();