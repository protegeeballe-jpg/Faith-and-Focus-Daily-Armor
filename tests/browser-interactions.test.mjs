import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = resolve(root, relative);
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolveClose, reject) =>
      server.close(error => error ? reject(error) : resolveClose()))
  };
}

test('Chromium: primary account, navigation, settings, and quote controls receive real clicks', {
  timeout: 30000
}, async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({serviceWorkers: 'block'});
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(host.url, {waitUntil: 'load'});
  await page.locator('#vault-show-signup').click();
  assert.equal(await page.locator('#vault-signup-panel').isVisible(), true,
    'Create New Account must open the signup panel');

  await page.locator('#vault-back-to-signin-from-signup').click();
  assert.equal(await page.locator('#vault-signin-panel').isVisible(), true,
    'Signup back button must return to sign in');

  await page.locator('#vault-show-recovery').click();
  assert.equal(await page.locator('#vault-recovery-panel').isVisible(), true,
    'Forgot Password / Username must open account recovery');

  await page.locator('#vault-back-to-signin-from-recovery').click();
  assert.equal(await page.locator('#vault-signin-panel').isVisible(), true,
    'Recovery back button must return to sign in');

  // Isolate authenticated app interactions without creating or modifying an account.
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });

  const settings = page.locator('#settings-modal');
  await page.locator('#settings-open-button').click();
  assert.equal(await settings.evaluate(dialog => dialog.open), true,
    'Settings button must open the native dialog');
  await page.locator('#settings-close-button').click();
  assert.equal(await settings.evaluate(dialog => dialog.open), false,
    'Settings close button must close the native dialog');

  const checklistButton = page.getByRole('button', {name: 'Open Health Checklist'});
  await checklistButton.click();
  assert.equal(await page.locator('[data-garden-scene="checklist"]').evaluate(
    scene => !scene.classList.contains('hidden')), true,
  'Health Checklist navigation must activate its scene');

  const quoteButton = page.locator('.guide-quote-launch').first();
  await quoteButton.waitFor({state: 'visible'});
  await quoteButton.click();
  assert.equal(await page.locator('#anim-modal').evaluate(
    modal => !modal.classList.contains('hidden')), true,
  'Read quote must open the quote modal');
  await page.locator('#anim-modal [data-action="closeModal"]').click();
  assert.equal(await page.locator('#anim-modal').evaluate(
    modal => modal.classList.contains('hidden')), true,
  'Quote modal close button must close the modal');

  assert.deepEqual(pageErrors, [],
    'The application must not throw browser runtime errors during these interactions');
  await context.close();
});
