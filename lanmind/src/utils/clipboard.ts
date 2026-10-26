/** LAN pages use HTTP, where the modern clipboard API is often unavailable. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Use the user-gesture fallback below. */ }
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement('textarea');
  input.value = text; input.style.cssText = 'position:fixed;left:-10000px;top:0;';
  document.body.append(input); input.select();
  try { if (!document.execCommand('copy')) throw new Error('Clipboard unavailable'); }
  finally { input.remove(); previous?.focus(); }
}
