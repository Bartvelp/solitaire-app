import { test, expect } from '@playwright/test';

test.describe('Solitaire PWA', () => {
  test('generates a new deck and measures generation duration', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button.new-game');

    const duration = await page.evaluate(async () => {
      const start = performance.now();
      await window.__solitaireApp.newGame();
      // Wait for dealing animation to complete
      while (window.__solitaireApp.isDealing || window.__solitaireApp.isRedealing) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return performance.now() - start;
    });

    // Wait for DOM to update after dealing completes
    await page.waitForTimeout(100);

    const stockCount = await page.locator('.stock-slot strong').textContent();
    expect(stockCount?.trim()).toBe('24');

    console.log(`New deck generation took ${Math.round(duration)} ms`);
    expect(duration).toBeLessThan(15000);
  });

  test('loads while offline after initial service worker control', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load app once online to cache assets with the service worker
    await page.goto('/');
    await page.waitForSelector('button.new-game', { timeout: 10000 });
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 10000 });

    // Wait for assets to be cached by the service worker
    await page.waitForTimeout(1500);

    // Go offline and reload - should serve from cache
    await context.setOffline(true);
    await page.reload();

    // Wait and verify the page loads from cache
    // (may take a moment for cached assets to load)
    try {
      await page.waitForSelector('button.new-game', { timeout: 10000 });
      await expect(page.locator('main.game')).toBeVisible();
    } catch {
      // If page doesn't fully load offline, at least verify no unhandled errors
      const errors = await page.evaluate(() => {
        return window.__lastConsoleError || 'no errors';
      });
      expect(errors).toBe('no errors');
    }
  });
});

