import { test, expect } from '@playwright/test';

test.describe('gardenmate E2E', () => {

  test('app loads the main window', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('GardenMate');
  });

  test('canvas is visible', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('#garden-canvas');
    await expect(canvas).toBeVisible();
  });

  test('toolbar buttons are present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-add-plant')).toBeVisible();
    await expect(page.locator('#btn-settings')).toBeVisible();
    await expect(page.locator('#btn-achievements')).toBeVisible();
    await expect(page.locator('#btn-widget')).toBeVisible();
  });

  test('opens species catalog', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-add-plant');
    const overlay = page.locator('#catalog-overlay');
    await expect(overlay).toHaveClass(/open/);
    const cards = page.locator('.catalog-card');
    await expect(cards.first()).toBeVisible();
  });

  test('opens settings modal', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-settings');
    const overlay = page.locator('#settings-overlay');
    await expect(overlay).toHaveClass(/open/);
  });

  test('opens achievements panel', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-achievements');
    const panel = page.locator('#achievements-panel');
    await expect(panel).toHaveClass(/open/);
  });

  test('adds a plant from catalog', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-add-plant');
    const card = page.locator('.catalog-card:not(.locked)').first();
    await card.click();

    const canvas = page.locator('#garden-canvas');
    await canvas.click({ position: { x: 300, y: 200 } });

    const statusBar = page.locator('#plant-count');
    await expect(statusBar).not.toHaveText('0 alive / 0 dead');
  });

  test('closes catalog with escape', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-add-plant');
    await expect(page.locator('#catalog-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#catalog-overlay')).not.toHaveClass(/open/);
  });

  test('status bar shows initial state', async ({ page }) => {
    await page.goto('/');
    const statusBar = page.locator('.status-bar');
    await expect(statusBar).toBeVisible();
  });

  test('error toast dismisses', async ({ page }) => {
    await page.goto('/');
    const errorToast = page.locator('#error-toast');
    await expect(errorToast).toBeAttached();
  });
});
