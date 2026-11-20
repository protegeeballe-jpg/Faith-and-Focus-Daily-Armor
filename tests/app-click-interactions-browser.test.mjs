import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Local runs may omit Playwright. CI installs it before running this suite.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

test('the real app loads and its account, navigation, quote, checklist, and Settings buttons respond to clicks', {
  skip: chromium ? false : 'Playwright is not installed in this environment'
}, async () => {
  const missingFiles = [];
  const server = createServer(async (request, response) => {
    let requestedPath = '(unknown)';
    try {
      requestedPath = decodeURIComponent(
        new URL(request.url || '/', 'http://127.0.0.1').pathname
      );
      const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
      const filePath = path.resolve(root, relativePath);

      if (!filePath.startsWith(root + path.sep) || filePath === root) {
        response.writeHead(403).end();
        return;
      }

      const content = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        // A service-worker script must be revalidated as a script, while
        // application assets and pages stay uncached in this test harness.
        'Cache-Control': requestedPath.endsWith('/sw.js') ? 'no-cache' : 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(content);
    } catch {
      missingFiles.push(requestedPath);
      response.writeHead(404).end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1200 },
      reducedMotion: 'no-preference',
      serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleMessages = [];
    const failedRequests = [];
    const serviceWorkerMessages = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push(message.type() + ': ' + message.text());
      }
    });
    page.on('requestfailed', request => {
      failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText || 'unknown request failure'
      });
    });
    context.on('serviceworker', worker => {
      worker.on('console', message => serviceWorkerMessages.push(message.type() + ': ' + message.text()));
      worker.on('pageerror', error => serviceWorkerMessages.push('pageerror: ' + error.message));
    });

    const address = server.address();
    await page.goto('http://127.0.0.1:' + address.port + '/index.html', {
      waitUntil: 'load',
      timeout: 30000
    });

    // Exercise the actual offline shell as a controlled page, not only a
    // network-loaded tab. The service worker must finish its full precache
    // before we reload into the controlled session.
    try {
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.state === 'activated';
      }, null, { timeout: 20000 });
    } catch (error) {
      const registrationState = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return {
          isSecureContext: window.isSecureContext,
          serviceWorkerAvailable: 'serviceWorker' in navigator,
          registrationFound: Boolean(registration),
          scope: registration?.scope || null,
          activeState: registration?.active?.state || null,
          installingState: registration?.installing?.state || null,
          waitingState: registration?.waiting?.state || null,
          controller: navigator.serviceWorker.controller?.scriptURL || null
        };
      });
      throw new Error('Service worker did not activate. ' + JSON.stringify({
        registrationState,
        missingFiles,
        pageErrors,
        consoleMessages,
        failedRequests,
        serviceWorkerMessages,
        cause: error.message
      }));
    }
    const shellCacheNames = await page.evaluate(() => caches.keys());
    assert.ok(shellCacheNames.includes('faith-focus-shell-v33-guide-quotes'),
      'the activated worker must have installed the expected offline shell cache');

    // The first navigation can finish before the new worker controls it.
    // Navigate again after activation; the reloaded page must be controlled.
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
        timeout: 10000
      });
    } catch (error) {
      const controllerState = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return {
          registrationScope: registration?.scope || null,
          activeState: registration?.active?.state || null,
          controller: navigator.serviceWorker.controller?.scriptURL || null
        };
      });
      throw new Error('Reloaded app was not controlled by its activated service worker. ' + JSON.stringify({
        controllerState,
        missingFiles,
        pageErrors,
        consoleMessages,
        failedRequests,
        serviceWorkerMessages,
        cause: error.message
      }));
    }

    assert.equal(await page.locator('#vault-login-form').isVisible(), true,
      'the account sign-in form must render');
    await page.locator('#vault-login-submit').click();
    assert.equal(await page.locator('#vault-login-message').getAttribute('data-state'), 'error',
      'the Sign In submit button must run validation without contacting the account service');
    assert.match(await page.locator('#vault-login-message').textContent(), /Enter a valid username/,
      'invalid sign-in input must produce an accessible validation message');
    assert.equal(await page.locator('#vault-show-signup').isEnabled(), true);
    await page.locator('#vault-show-signup').click();
    assert.equal(await page.locator('#vault-signup-panel').isVisible(), true,
      'Sign Up must open from the sign-in screen');
    await page.locator('#vault-back-to-signin-from-signup').click();
    assert.equal(await page.locator('#vault-signin-panel').isVisible(), true,
      'Sign Up must return to Sign In');

    await page.locator('#vault-show-recovery').click();
    assert.equal(await page.locator('#vault-recovery-panel').isVisible(), true,
      'Recovery must open from the sign-in screen');
    await page.locator('#vault-back-to-signin-from-recovery').click();
    assert.equal(await page.locator('#vault-signin-panel').isVisible(), true,
      'Recovery must return to Sign In');

    // The account service is intentionally not called by this smoke test.
    // Signal the same post-authentication event used by the verified session
    // flow so existing in-app click paths can be exercised without changing
    // credentials or touching persistent user data.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('faith-focus:app-unlocked'));
    });

    const garden = page.locator('#little-garden');
    await garden.waitFor({ state: 'visible', timeout: 10000 });

    await page.locator('#settings-open-button').click();
    assert.equal(await page.locator('#settings-modal').evaluate(dialog => dialog.open), true,
      'Settings must open when its gear button is clicked');
    await page.locator('#settings-close-button').click();
    assert.equal(await page.locator('#settings-modal').evaluate(dialog => dialog.open), false,
      'Settings must close from its close button');

    await page.locator('#little-garden button[data-action="showPage"][data-page="checklist"]').click();
    assert.equal(await page.locator('#view-checklist').isVisible(), true,
      'the Health Checklist navigation button must open the checklist scene');

    await page.locator('#btn-next').click();
    assert.equal(await page.locator('#card-step-2').isVisible(), true,
      'Next Card must advance the checklist');

    const readQuote = page.locator('.guide-quote-launch[aria-label="Read quote for start-1"]');
    await readQuote.waitFor({ state: 'visible', timeout: 10000 });
    await readQuote.click();
    assert.equal(await page.locator('#anim-modal').isVisible(), true,
      'Read quote must open the activity modal');
    assert.equal(
      (await page.locator('#modal-quote-target blockquote').textContent()).trim(),
      'Three priceless sparks upon the page, To light the morning’s opening stage.',
      'the activity modal must render the supplied quote'
    );

    await page.locator('#modal-complete-btn').click();
    assert.equal(await page.locator('#anim-modal').isVisible(), false,
      'the activity completion button must close the modal');
    const gratefulCheckbox = page.locator('.app-chk[data-id="start-1"]');
    assert.equal(await gratefulCheckbox.isEnabled(), true,
      'completing the guide must unlock its checklist checkbox');
    assert.equal(await gratefulCheckbox.isVisible(), true,
      'the unlocked checklist checkbox must become visible');
    await gratefulCheckbox.check();
    assert.equal(await gratefulCheckbox.isChecked(), true,
      'the unlocked checklist checkbox must accept a click');

    await page.locator('#btn-prev').click();
    assert.equal(await page.locator('#card-step-1').isVisible(), true,
      'Previous Card must return to the prior checklist card');

    assert.deepEqual(pageErrors, [],
      'the actual application must not produce uncaught JavaScript errors while its controls are exercised');

    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
