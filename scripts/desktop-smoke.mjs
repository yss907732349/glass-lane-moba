import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.argv.includes('--allow-visible-window')) {
  console.log('Native window tests are disabled. Use pnpm test:browser for background-only checks.');
  process.exit(0);
}
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const errors = [];
const log = [];
let application;
const report = { checks: [], rendererErrors: errors, limits: ['Transparent window and alpha background are checked in constructor source plus transparent renderer CSS; Electron getBackgroundColor returns RGB only. No OS desktop pixel capture.', 'Shortcut registration is checked; hide/show is exercised through the UI and native window API, not by sending global physical keys.'] };
const record = (check, value) => { report.checks.push({ check, value }); console.log(`${check}: ${JSON.stringify(value)}`); };
try {
  application = await electron.launch({
    executablePath: require('electron'),
    args: [`--user-data-dir=${path.join(artifacts, `desktop-profile-${Date.now()}`)}`, root],
    cwd: root,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 45000,
  });
  application.process().stderr?.on('data', chunk => log.push(chunk.toString()));
  const page = await application.firstWindow({ timeout: 45000 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page.locator('#connection')).toHaveText('房间服务已连接', { timeout: 25000 });
  await expect(page.locator('#practice')).toBeVisible();
  const native = await application.evaluate(({ BrowserWindow, globalShortcut }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http'));
    return {
      background: window.getBackgroundColor(), alwaysOnTop: window.isAlwaysOnTop(),
      visible: window.isVisible(), opacity: window.getOpacity(), origin: new URL(window.webContents.getURL()).origin,
      shortcuts: { toggle: globalShortcut.isRegistered('Control+Shift+J'), restore: globalShortcut.isRegistered('Control+Shift+0') },
    };
  });
  const desktopSource = await readFile(path.join(root, 'desktop/main.cjs'), 'utf8');
  expect(desktopSource).toMatch(/transparent\s*:\s*true/);
  native.transparentConfigured = true;
  expect(desktopSource).toMatch(/backgroundColor\s*:\s*['"]#00000000['"]/);
  expect(native.background.toLowerCase()).toBe('#000000');
  expect(native.alwaysOnTop).toBe(true);
  expect(native.visible).toBe(true);
  expect(native.shortcuts.toggle).toBe(true);
  expect(native.shortcuts.restore).toBe(true);
  record('native-window', native);
  const healthResponse = await fetch(`${native.origin}/health`);
  expect(healthResponse.ok).toBe(true);
  record('embedded-health', await healthResponse.json());
  const css = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.documentElement).backgroundColor, desktopBridge: !!window.desktop }));
  expect(css.body).toBe('rgba(0, 0, 0, 0)');
  expect(css.root).toBe('rgba(0, 0, 0, 0)');
  expect(css.desktopBridge).toBe(true);
  record('transparent-renderer', css);
  await page.screenshot({ path: path.join(artifacts, 'desktop-lobby.png'), omitBackground: true });
  await page.locator('#settings-button').click();
  await expect(page.locator('#settings')).toBeVisible();
  await page.locator('#opacity').evaluate(element => { element.value = '70'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#opacity-value')).toHaveText('70%');
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity())).toBeCloseTo(.7, 1);
  record('opacity-slider', await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()));
  await page.locator('#opacity').evaluate(element => { element.value = '100'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#settings-close').click();
  await page.locator('#practice').click();
  await expect(page.locator('#hud')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#matchbar')).toContainText('赤方');
  await expect(page.locator('#lobby')).toBeHidden();
  await expect(page.locator('#hud .ability')).toHaveCount(3);
  await expect(page.locator('#clock')).not.toHaveText('00:00', { timeout: 5000 });
  record('one-click-practice', { hud: await page.locator('#hud').innerText(), match: await page.locator('#matchbar').innerText() });
  await expect(page.locator('#clock')).toHaveText('00:05', { timeout: 7000 });
  await page.screenshot({ path: path.join(artifacts, 'desktop-match.png'), omitBackground: true });
  await page.locator('#hide').click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  record('hide-and-show', true);
  await page.locator('#pin').click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(false);
  await page.locator('#pin').click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
  record('pin-toggle', true);
  expect(errors).toEqual([]);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || String(error);
  console.error(report.error);
  if (application) { try { await (await application.firstWindow()).screenshot({ path: path.join(artifacts, 'desktop-failure.png') }); } catch {} }
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(error => log.push(String(error)));
  await writeFile(path.join(artifacts, 'desktop-report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(artifacts, 'desktop-runtime.log'), log.join(''));
}


