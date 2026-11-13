# LanMind Workspace Rules & Best Practices

## UI & Component Design

### 1. Portal Dropdowns & Popovers Positioning (Strict Rule)
When implementing or modifying any floating dropdown menu, select popup, or popover component that mounts via React Portal (`createPortal`):
- **Never** initialize position state with `{ top: 0, left: 0 }`. Always initialize to `null`.
- **Always** compute the trigger element's bounding rect synchronously *before* toggling `isOpen(true)`.
- **Always** guard portal rendering with `{isOpen && menuPos && createPortal(...)}` so the element never mounts at `(0, 0)` on the first frame.
- **Always** set inline style `transition: 'none'` on the portal root element so coordinates (`top`, `left`) are never animated or interpolated across the screen.
- **Always** specify an appropriate `origin-top-right`, `origin-top-left`, `origin-bottom-right`, or `origin-bottom-left` matching the trigger's placement.
- **Always** reset `menuPos` to `null` on close.

### 2. Modern Web Guidance & WebView Compatibility
- Use the `modern-web-guidance` skill for web UI and client-side platform changes; verify scan findings against their keep/drop rubric before editing.
- Support Tauri's WebView2, WKWebView and WebKitGTK runtimes as well as the network task page and standalone receiver. Vite's build target only controls compilation; it does not provide runtime API polyfills.
- Feature-detect newer APIs and retain working fallbacks. Do not raise the minimum OS/browser version or add a polyfill dependency just to satisfy a modernization scan.
- Use `isComposingKeyboardEvent` for custom input shortcuts, including the WebKit `keyCode === 229` fallback. Let the browser finish IME confirmation before submitting, renaming, selecting or moving focus.
- Prefer native CSS field sizing with the existing JavaScript fallback for older WebViews. Use `motion-safe:` for persistent animations and `preferredScrollBehavior` for optional smooth scrolling.
- Keep the specialized DOMPurify SVG/MathML policy unless a native sanitizer replacement is verified to preserve the same content and security boundaries.
