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


test('Chromium: checklist navigation, guided unlocks, checkbox persistence, cloud selection, and completion gate', {
  timeout: 30000
}, async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({
    serviceWorkers: 'block',
    permissions: []
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });

  await page.getByRole('button', {name: 'Open Health Checklist'}).click();
  const checklist = page.locator('#view-checklist');
  await page.locator('#card-step-1').waitFor({state: 'visible'});

  // Previous is disabled on the first card; Next advances exactly one card.
  assert.equal(await page.locator('#btn-prev').isDisabled(), true);
  await page.locator('#btn-next').click();
  assert.equal(await page.locator('#current-step-num').textContent(), '2');
  assert.equal(await page.locator('#card-step-2').isVisible(), true);
  assert.equal(await page.locator('#btn-prev').isDisabled(), false);

  // A guided task must unlock its associated checkbox through the actual modal action.
  const guidedLaunch = page.locator('.guide-quote-launch[aria-label="Read quote for start-2"]');
  await guidedLaunch.click();
  assert.equal(await page.locator('#anim-modal').isVisible(), true);
  await page.locator('#modal-complete-btn').click();
  assert.equal(await page.locator('#anim-modal').isVisible(), false);
  const guidedCheckbox = page.locator('#chk-start-2');
  assert.equal(await guidedCheckbox.isEnabled(), true,
    'Completing the guide must unlock its matching checkbox');
  await guidedCheckbox.check();
  assert.equal(await guidedCheckbox.isChecked(), true);

  // Confirm the change handler persists the checkbox in this fresh, isolated browser store.
  await expectStoredChecklistValue(page, 'start-2', true);

  // Exercise forward and backward navigation through all six cards.
  for (let step = 3; step <= 6; step++) {
    await page.locator('#btn-next').click();
    assert.equal(await page.locator('#current-step-num').textContent(), String(step));
    assert.equal(await page.locator('#card-step-' + step).isVisible(), true);
  }
  await page.locator('#btn-prev').click();
  assert.equal(await page.locator('#current-step-num').textContent(), '5');
  await page.locator('#btn-next').click();
  assert.equal(await page.locator('#current-step-num').textContent(), '6');

  // One cloud may be selected per day; selection unlocks the completion checkbox.
  const clouds = page.locator('.cloud-item[data-cloud]');
  assert.equal(await clouds.count(), 3);
  await page.locator('.cloud-item[data-cloud="cumulus"]').click();
  assert.equal(await page.locator('.cloud-item[data-cloud="cumulus"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.cloud-item[data-cloud="stratus"]').isDisabled(), true);
  assert.equal(await page.locator('.cloud-item[data-cloud="stratocumulus"]').isDisabled(), true);
  assert.equal(await page.locator('#chk-cloud-checked').isEnabled(), true);
  await expectStoredChecklistValue(page, 'cloud_cumulus', true);

  // Finishing an incomplete checklist must not show the finale or silently mark it complete.
  await page.locator('#btn-next').click();
  assert.equal(await page.locator('#grand-finale-overlay').evaluate(
    element => element.classList.contains('hidden')), true);
  assert.equal(await page.locator('#finish-status').isVisible(), true);
  assert.equal(await page.locator('#current-step-num').textContent(), '1',
    'The completion gate must take the user to the first incomplete card');

  assert.equal(await checklist.isVisible(), true);
  assert.deepEqual(pageErrors, [],
    'Checklist interactions must not produce browser runtime errors');
  await context.close();
});

async function expectStoredChecklistValue(page, key, expected) {
  const found = await page.evaluate(({key, expected}) => {
    for (let index = 0; index < localStorage.length; index++) {
      const raw = localStorage.getItem(localStorage.key(index));
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          return data[key] === expected;
        }
      } catch {
        // Ignore unrelated non-JSON storage entries.
      }
    }
    return false;
  }, {key, expected});
  assert.equal(found, true, 'Expected checklist value "' + key + '" to be persisted');
}


test('Chromium: every in-card guide action button receives a real pointer click', {
  timeout: 30000
}, async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({
    serviceWorkers: 'block',
    permissions: []
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  await page.getByRole('button', {name: 'Open Health Checklist'}).click();

  // Exercise the actual action buttons embedded in cards 2–5, not the card pager.
  const expectedTargets = new Map([
    ['prayer', 'start-2'],
    ['water', 'start-4'],
    ['breathing', 'mid-2'],
    ['water', 'mid-3'],
    ['feeling', 'mid-4'],
    ['water', 'end-3'],
    ['curfew', 'sleep-3'],
    ['water', 'sleep-5']
  ]);

  for (let step = 1; step <= 5; step++) {
    if (step > 1) await page.locator('#btn-next').click();
    const card = page.locator('#card-step-' + step);
    const actions = card.locator('button[data-action="openModal"]');
    const count = await actions.count();

    for (let index = 0; index < count; index++) {
      const button = actions.nth(index);
      const type = await button.getAttribute('data-modal');
      const target = await button.getAttribute('data-target');
      assert.ok(expectedTargets.has(type), 'Unexpected in-card guide action: ' + type);
      assert.ok(expectedTargets.get(type) === target
        || (type === 'water' && ['start-4','mid-3','end-3','sleep-5'].includes(target)),
        'Guide button must retain its intended target: ' + type + '/' + target);

      // Playwright performs browser hit-testing; an overlay intercepting the
      // pointer causes this click to fail rather than silently invoking a handler.
      await button.click();
      assert.equal(await page.locator('#anim-modal').evaluate(
        modal => !modal.classList.contains('hidden')), true,
        'In-card button failed to open its guide: ' + type + '/' + target);
      assert.equal(await page.locator('#modal-complete-btn').isEnabled(), true);
      await page.locator('#anim-modal [data-action="closeModal"]').click();
      assert.equal(await page.locator('#anim-modal').evaluate(
        modal => modal.classList.contains('hidden')), true,
        'Guide modal close action failed for: ' + type + '/' + target);
    }
  }

  // Every generated Read quote launcher must also be visible and receive pointer input.
  for (let step = 2; step <= 5; step++) {
    if (step > 2) await page.locator('#btn-next').click();
    const launchers = page.locator('#card-step-' + step + ' .guide-quote-launch');
    const count = await launchers.count();
    assert.ok(count > 0, 'Expected generated guide launchers in card ' + step);
    for (let index = 0; index < count; index++) {
      const launcher = launchers.nth(index);
      await launcher.click();
      assert.equal(await page.locator('#anim-modal').evaluate(
        modal => !modal.classList.contains('hidden')), true,
        'Read quote launcher did not receive click in card ' + step);
      await page.locator('#anim-modal [data-action="closeModal"]').click();
    }
  }

  assert.deepEqual(pageErrors, [],
    'In-card guide actions must not produce browser runtime errors');
  await context.close();
});
