import type { Page } from '@playwright/test';
export async function revealNavigation(page:Page) {
  const toggle=page.getByTestId('mobile-navigation-toggle');
  if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
}
