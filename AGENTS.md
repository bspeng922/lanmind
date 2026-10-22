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
