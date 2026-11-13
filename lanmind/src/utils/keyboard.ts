/** WebKit may end composition before dispatching its confirming Enter keydown. */
export function isComposingKeyboardEvent(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229;
}
