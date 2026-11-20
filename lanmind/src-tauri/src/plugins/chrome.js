// Host-injected frameless window chrome for isolated web plugins.
// Mounted on documentElement inside a closed Shadow DOM so plugin markup and CSS stay isolated.
(() => {
  const cfg = window.__LANMIND_PLUGIN_CHROME__;
  try { delete window.__LANMIND_PLUGIN_CHROME__; } catch { window.__LANMIND_PLUGIN_CHROME__ = undefined; }
  if (!cfg || typeof document === 'undefined') return;

  const HEIGHT = 38;
  const fitHeight = 'data-lanmind-plugin-fit-height';
  const fitMinHeight = 'data-lanmind-plugin-fit-min-height';
  let fittedElements = [];
  let fitFrame = 0;

  const fillsViewport = (value) => value.endsWith('px')
    && Math.abs(parseFloat(value) - window.innerHeight) < 0.5;

  const fitContentHeight = () => {
    const body = document.body;
    if (!body) return;
    for (const [element, attribute] of fittedElements) element.removeAttribute(attribute);
    fittedElements = [];
    const fitWrapper = (element) => {
      const style = getComputedStyle(element);
      // Typed OM keeps an automatic height distinct from the box's current size.
      const height = element.computedStyleMap?.().get('height')?.toString() ?? style.height;
      if (fillsViewport(height)) fittedElements.push([element, fitHeight]);
      if (fillsViewport(style.minHeight)) fittedElements.push([element, fitMinHeight]);
    };
    // Match full-viewport page wrappers, including ones mounted under an app root.
    let wrapper = body;
    while (wrapper) {
      fitWrapper(wrapper);
      const children = Array.from(wrapper.children).filter((child) => {
        const { display, position } = getComputedStyle(child);
        return display !== 'none' && position !== 'absolute' && position !== 'fixed';
      });
      if (children.length !== 1) {
        if (wrapper === body) children.forEach(fitWrapper);
        break;
      }
      wrapper = children[0];
    }
    for (const [element, attribute] of fittedElements) element.setAttribute(attribute, '');
  };

  const scheduleFit = () => {
    if (fitFrame) return;
    fitFrame = window.requestAnimationFrame(() => {
      fitFrame = 0;
      fitContentHeight();
    });
  };

  const invokeControl = (action) =>
    Promise.resolve()
      .then(() => window.__TAURI_INTERNALS__?.invoke?.('plugin_window_control', { action }))
      .catch(() => undefined);

  const isZh = (locale) => String(locale || '').toLowerCase().startsWith('zh');
  const labels = (locale) =>
    isZh(locale)
      ? { min: '最小化', max: '最大化', restore: '还原', close: '关闭' }
      : { min: 'Minimize', max: 'Maximize', restore: 'Restore', close: 'Close' };

  const resolveColors = (theme) => {
    const isLight = theme?.id === 'light';
    const c = (theme && theme.colors) || {};
    return {
      surface: c['--bg-surface'] || (isLight ? '#ffffff' : '#15181e'),
      canvas: c['--bg-canvas'] || (isLight ? '#f3f4f6' : '#0f1115'),
      border: c['--border-main'] || (isLight ? '#e5e7eb' : '#262b36'),
      text: c['--text-main'] || (isLight ? '#111827' : '#f1f3f5'),
      sub: c['--text-sub'] || (isLight ? '#4b5563' : '#9ca3af'),
      hover: isLight ? 'rgba(17, 24, 39, 0.06)' : 'rgba(255, 255, 255, 0.08)',
    };
  };

  let mounted = false;
  let shadow = null;
  let barEl = null;
  let frameEl = null;
  let maxBtn = null;
  let maxIconEl = null;
  let minBtn = null;
  let closeBtn = null;
  let maximized = false;
  let currentLocale = cfg.locale || 'zh-CN';

  const ICON_MAX = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/></svg>';
  const ICON_RESTORE = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4.5" width="9" height="9" rx="1.2"/><path d="M5 4.5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1.5"/></svg>';
  const ICON_MIN = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h10"/></svg>';
  const ICON_CLOSE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const ICON_PUZZLE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/></svg>';

  const applyTheme = (theme, locale) => {
    if (locale) currentLocale = locale;
    const palette = resolveColors(theme);
    const l = labels(currentLocale);
    if (barEl) {
      barEl.style.setProperty('--lm-surface', palette.surface);
      barEl.style.setProperty('--lm-border', palette.border);
      barEl.style.setProperty('--lm-text', palette.text);
      barEl.style.setProperty('--lm-sub', palette.sub);
      barEl.style.setProperty('--lm-hover', palette.hover);
    }
    if (frameEl) {
      frameEl.style.borderColor = palette.border;
    }
    if (minBtn) { minBtn.title = l.min; minBtn.setAttribute('aria-label', l.min); }
    if (maxBtn) {
      const text = maximized ? l.restore : l.max;
      maxBtn.title = text;
      maxBtn.setAttribute('aria-label', text);
    }
    if (closeBtn) { closeBtn.title = l.close; closeBtn.setAttribute('aria-label', l.close); }
  };

  const syncMaximized = (next) => {
    maximized = Boolean(next);
    const l = labels(currentLocale);
    if (maxIconEl) maxIconEl.innerHTML = maximized ? ICON_RESTORE : ICON_MAX;
    if (maxBtn) {
      const text = maximized ? l.restore : l.max;
      maxBtn.title = text;
      maxBtn.setAttribute('aria-label', text);
    }
    if (frameEl) frameEl.style.display = maximized ? 'none' : 'block';
  };

  const mount = () => {
    if (mounted || !document.documentElement) return;
    mounted = true;

    const styleEl = document.createElement('style');
    styleEl.id = '__lanmind_plugin_chrome_style__';
    styleEl.textContent = `
      html {
        box-sizing: border-box !important;
        padding-top: ${HEIGHT}px !important;
        height: 100% !important;
        scroll-padding-top: ${HEIGHT}px;
      }
      [${fitHeight}] {
        height: calc(100vh - ${HEIGHT}px) !important;
        height: calc(100dvh - ${HEIGHT}px) !important;
      }
      [${fitMinHeight}] {
        min-height: calc(100vh - ${HEIGHT}px) !important;
        min-height: calc(100dvh - ${HEIGHT}px) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(styleEl);
    fitContentHeight();
    if (document.readyState !== 'complete') window.addEventListener('load', scheduleFit, { once: true });
    new MutationObserver(scheduleFit).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
    });

    const host = document.createElement('div');
    host.id = '__lanmind_plugin_chrome__';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });

    const sheet = document.createElement('style');
    sheet.textContent = `
      :host { all: initial; }
      .frame {
        position: fixed;
        inset: 0;
        pointer-events: none;
        border: 1px solid var(--lm-border, #262b36);
        box-sizing: border-box;
      }
      .bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: ${HEIGHT}px;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--lm-surface, #15181e);
        border-bottom: 1px solid var(--lm-border, #262b36);
        color: var(--lm-text, #f1f3f5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
        user-select: none;
        -webkit-user-select: none;
        box-sizing: border-box;
      }
      .drag {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        cursor: default;
      }
      .icon {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
        color: var(--lm-sub, #9ca3af);
      }
      .icon img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      .title {
        font-size: 12.5px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .controls {
        display: flex;
        align-items: stretch;
        height: 100%;
        flex-shrink: 0;
      }
      .btn {
        appearance: none;
        border: 0;
        margin: 0;
        padding: 0;
        width: 44px;
        height: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--lm-sub, #9ca3af);
        cursor: pointer;
        outline: none;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .btn:hover {
        background: var(--lm-hover, rgba(255,255,255,0.08));
        color: var(--lm-text, #f1f3f5);
      }
      .btn.close:hover {
        background: #e11d48;
        color: #ffffff;
      }
    `;
    shadow.appendChild(sheet);

    frameEl = document.createElement('div');
    frameEl.className = 'frame';
    shadow.appendChild(frameEl);

    barEl = document.createElement('div');
    barEl.className = 'bar';

    const dragEl = document.createElement('div');
    dragEl.className = 'drag';
    dragEl.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.detail >= 2) return;
      void invokeControl('drag');
    });
    dragEl.addEventListener('dblclick', () => {
      void invokeControl('toggleMaximize').then((res) => {
        if (res && typeof res.maximized === 'boolean') syncMaximized(res.maximized);
      });
    });

    const iconEl = document.createElement('span');
    iconEl.className = 'icon';
    if (
      typeof cfg.iconDataUrl === 'string' &&
      /^data:image\/(?:svg\+xml|png|webp|jpeg|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/.test(cfg.iconDataUrl)
    ) {
      const img = document.createElement('img');
      img.src = cfg.iconDataUrl;
      img.alt = '';
      img.draggable = false;
      img.onerror = () => { iconEl.innerHTML = ICON_PUZZLE; };
      iconEl.appendChild(img);
    } else {
      iconEl.innerHTML = ICON_PUZZLE;
    }

    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = String(cfg.title || 'Plugin');

    dragEl.appendChild(iconEl);
    dragEl.appendChild(titleEl);
    barEl.appendChild(dragEl);

    const controls = document.createElement('div');
    controls.className = 'controls';

    minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'btn';
    minBtn.innerHTML = ICON_MIN;
    minBtn.addEventListener('click', () => { void invokeControl('minimize'); });

    maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'btn';
    maxIconEl = document.createElement('span');
    maxIconEl.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
    maxIconEl.innerHTML = ICON_MAX;
    maxBtn.appendChild(maxIconEl);
    maxBtn.addEventListener('click', () => {
      void invokeControl('toggleMaximize').then((res) => {
        if (res && typeof res.maximized === 'boolean') syncMaximized(res.maximized);
      });
    });

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn close';
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', () => { void invokeControl('close'); });

    controls.appendChild(minBtn);
    controls.appendChild(maxBtn);
    controls.appendChild(closeBtn);
    barEl.appendChild(controls);
    shadow.appendChild(barEl);

    document.documentElement.appendChild(host);
    applyTheme(cfg.theme, cfg.locale);
    syncMaximized(false);
  };

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (mounted) scheduleFit();
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      void invokeControl('isMaximized').then((res) => {
        if (res && typeof res.maximized === 'boolean') syncMaximized(res.maximized);
      });
    }, 80);
  });

  window.addEventListener('lanmind:context', (event) => {
    const detail = event && event.detail;
    if (detail) applyTheme(detail.theme, detail.locale);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
