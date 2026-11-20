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

    // The generated Read quote launcher is another distinct control inside each card.
    const launchers = card.locator('.guide-quote-launch');
    const launcherCount = await launchers.count();
    assert.ok(launcherCount > 0, 'Expected generated guide launchers in card ' + step);
    for (let index = 0; index < launcherCount; index++) {
      await launchers.nth(index).click();
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


test('Chromium: checklist controls remain clickable across laptop viewport and display-scale profiles', {
  timeout: 120000
}, async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const profiles = [
    {name: 'laptop-1366x768', viewport: {width: 1366, height: 768}, deviceScaleFactor: 1},
    {name: 'laptop-short-window-1366x650', viewport: {width: 1366, height: 650}, deviceScaleFactor: 1},
    {name: 'laptop-compact-1366x590', viewport: {width: 1366, height: 590}, deviceScaleFactor: 1},
    {name: 'laptop-125-percent-scale', viewport: {width: 1092, height: 614}, deviceScaleFactor: 1.25},
    {name: 'laptop-150-percent-scale', viewport: {width: 911, height: 512}, deviceScaleFactor: 1.5},
    {name: 'small-desktop-window-1024x640', viewport: {width: 1024, height: 640}, deviceScaleFactor: 1}
  ];
  const cloudChoices = ['cumulus', 'stratus', 'stratocumulus'];

  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const profile = profiles[profileIndex];
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor,
      serviceWorkers: 'block',
      permissions: []
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    try {
      await page.goto(host.url, {waitUntil: 'load'});
      await page.evaluate(() => {
        document.getElementById('view-pin')?.classList.add('hidden');
        window.dispatchEvent(new Event('faith-focus:app-unlocked'));
      });
      await page.getByRole('button', {name: 'Open Health Checklist'}).click();
      await page.locator('#card-step-1').waitFor({state: 'visible'});

      for (let step = 1; step <= 5; step++) {
        if (step > 1) {
          await page.locator('#btn-next').click();
          await page.locator('#card-step-' + step).waitFor({state: 'visible'});
        }

        const card = page.locator('#card-step-' + step);
        const launchers = card.locator('.guide-quote-launch');
        if (await launchers.count()) {
          const launcher = launchers.first();
          await assertPointerHitTarget(launcher, profile.name);
          await launcher.click();
          assert.equal(await page.locator('#anim-modal').evaluate(
            modal => !modal.classList.contains('hidden')), true,
            profile.name + ': quote launcher must open its modal');
          await page.locator('#anim-modal [data-action="closeModal"]').click();
        }

        const actions = card.locator('button[data-action="openModal"]');
        for (let index = 0; index < await actions.count(); index++) {
          const button = actions.nth(index);
          const target = await button.getAttribute('data-target');
          await assertPointerHitTarget(button, profile.name + ' card ' + step);
          await button.click();
          assert.equal(await page.locator('#anim-modal').evaluate(
            modal => !modal.classList.contains('hidden')), true,
            profile.name + ': guide action must open its modal (' + target + ')');

          const primaryAction = page.locator('#modal-complete-btn');
          const guideType = await button.getAttribute('data-modal');

          if (guideType === 'breathing') {
            // Breathing is a two-stage action: start the timed exercise, then complete it.
            // Use Playwright's deterministic clock so the five 12-second cycles do not
            // require a wall-clock minute and the real application timer logic still runs.
            await page.clock.install();
            assert.match(await primaryAction.textContent(), /Start 5 breathing cycles/);
            await primaryAction.click();
            assert.equal(await primaryAction.isDisabled(), true,
              profile.name + ': breathing action must disable its start button while running');
            assert.equal(await page.locator('#breathing-phase').textContent(), 'Breathe in');
            await page.clock.runFor(60_000);
            assert.equal(await primaryAction.isDisabled(), false,
              profile.name + ': breathing action must re-enable after five completed cycles');
            assert.match(await primaryAction.textContent(), /Good job!/);
            await primaryAction.click();
          } else {
            await primaryAction.click();
          }

          assert.equal(await page.locator('#anim-modal').evaluate(
            modal => modal.classList.contains('hidden')), true,
            profile.name + ': completing the guide must close its modal');

          const checkbox = page.locator('#chk-' + target);
          assert.equal(await checkbox.isEnabled(), true,
            profile.name + ': guide must unlock its associated checkbox (' + target + ')');
          if (!await checkbox.isChecked()) await checkbox.check();
          assert.equal(await checkbox.isChecked(), true,
            profile.name + ': unlocked checkbox must accept a user interaction (' + target + ')');
        }

        const enabledCheckboxes = card.locator('input.app-chk:visible:not([disabled])');
        for (let index = 0; index < await enabledCheckboxes.count(); index++) {
          const checkbox = enabledCheckboxes.nth(index);
          if (!await checkbox.isChecked()) await checkbox.check();
          assert.equal(await checkbox.isChecked(), true,
            profile.name + ': visible checklist checkbox must respond to interaction');
        }
      }

      await page.locator('#btn-next').click();
      await page.locator('#card-step-6').waitFor({state: 'visible'});
      const selectedCloud = cloudChoices[profileIndex % cloudChoices.length];
      const cloudButton = page.locator('.cloud-item[data-cloud="' + selectedCloud + '"]');
      await assertPointerHitTarget(cloudButton, profile.name + ' cloud choice');
      await cloudButton.click();
      assert.equal(await cloudButton.getAttribute('aria-pressed'), 'true',
        profile.name + ': selected cloud option must respond to a click');
      assert.equal(await page.locator('#chk-cloud-checked').isEnabled(), true,
        profile.name + ': cloud selection must unlock its checklist checkbox');
      await page.locator('#chk-cloud-checked').check();
      assert.equal(await page.locator('#chk-cloud-checked').isChecked(), true,
        profile.name + ': cloud completion checkbox must respond to interaction');

      assert.deepEqual(pageErrors, [],
        profile.name + ': checklist interaction must not throw browser runtime errors');
    } catch (error) {
      error.message = '[' + profile.name + '] ' + error.message;
      throw error;
    } finally {
      await context.close();
    }
  }
});

async function assertPointerHitTarget(locator, profileName) {
  await locator.scrollIntoViewIfNeeded();
  const hitTest = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const style = getComputedStyle(element);
    return {
      visible: rect.width > 0 && rect.height > 0 &&
        style.visibility !== 'hidden' && style.display !== 'none',
      enabled: !element.disabled,
      receivesPointer: style.pointerEvents !== 'none',
      hitTarget: Boolean(hit && (hit === element || element.contains(hit))),
      x,
      y
    };
  });
  assert.equal(hitTest.visible, true, profileName + ': control must be visible');
  assert.equal(hitTest.enabled, true, profileName + ': control must be enabled');
  assert.equal(hitTest.receivesPointer, true,
    profileName + ': control must accept pointer events');
  assert.equal(hitTest.hitTarget, true,
    profileName + ': another element must not cover the control hit area');
}


test('Chromium: watercolor paper layers are visible and decorative edges never intercept clicks', {
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
    permissions: [],
    viewport: {width: 1366, height: 768}
  });
  const page = await context.newPage();
  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  await page.getByRole('button', {name: 'Open Health Checklist'}).click();

  const cardTexture = await page.locator('.garden-checklist-scene .step-card').first().evaluate(element => ({
    backgroundImage: getComputedStyle(element).backgroundImage,
    edgePointerEvents: getComputedStyle(element, '::after').pointerEvents,
    edgeBackground: getComputedStyle(element, '::after').backgroundImage,
    isolation: getComputedStyle(element).isolation
  }));
  assert.match(cardTexture.backgroundImage, /radial-gradient/);
  assert.match(cardTexture.backgroundImage, /repeating-linear-gradient/);
  assert.match(cardTexture.edgeBackground, /radial-gradient/);
  assert.equal(cardTexture.edgePointerEvents, 'none');
  assert.equal(cardTexture.isolation, 'isolate');

  const quoteLauncher = page.locator('.guide-quote-launch').first();
  await quoteLauncher.click();
  const quoteTexture = await page.locator('#anim-modal .guide-quote-card').evaluate(element => ({
    backgroundImage: getComputedStyle(element).backgroundImage,
    edgePointerEvents: getComputedStyle(element, '::after').pointerEvents,
    edgeBackground: getComputedStyle(element, '::after').backgroundImage,
    washBackground: getComputedStyle(element.querySelector('.guide-quote-wash')).backgroundImage,
    washFilter: getComputedStyle(element.querySelector('.guide-quote-wash')).filter,
    washOpacity: Number(getComputedStyle(element.querySelector('.guide-quote-wash')).opacity)
  }));
  assert.match(quoteTexture.backgroundImage, /radial-gradient/);
  assert.match(quoteTexture.backgroundImage, /repeating-linear-gradient/);
  assert.match(quoteTexture.edgeBackground, /radial-gradient/);
  assert.equal(quoteTexture.edgePointerEvents, 'none');
  assert.match(quoteTexture.washBackground, /radial-gradient/);
  assert.ok(quoteTexture.washOpacity > 0.7,
    'The pigment wash must remain visibly present');
  assert.ok(quoteTexture.washFilter.includes('saturate(1.08)'),
    'The pigment wash must retain its richer color treatment');

  const closeButton = page.locator('#anim-modal [data-action="closeModal"]');
  await assertPointerHitTarget(closeButton, 'watercolor quote modal close');
  await closeButton.click();
  await assertPointerHitTarget(quoteLauncher, 'watercolor quote launcher');
  await quoteLauncher.click();
  assert.equal(await page.locator('#anim-modal').evaluate(
    modal => !modal.classList.contains('hidden')), true,
    'Watercolor edge layers must not block the real quote launcher');
  await page.locator('#anim-modal [data-action="closeModal"]').click();

  await context.close();

  const reducedContext = await browser.newContext({
    serviceWorkers: 'block',
    reducedMotion: 'reduce'
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(host.url, {waitUntil: 'load'});
  await reducedPage.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  await reducedPage.getByRole('button', {name: 'Open Health Checklist'}).click();
  await reducedPage.locator('.guide-quote-launch').first().click();
  const reducedAnimation = await reducedPage.locator('#anim-modal .guide-quote-wash').evaluate(
    element => getComputedStyle(element).animationDuration);
  assert.equal(reducedAnimation, '0s',
    'Pigment motion must respect the reduced-motion preference');
  await reducedContext.close();
});


test('Chromium: blue-and-yellow Diary and painterly Forge Room surfaces preserve real hit targets', {
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
    permissions: [],
    viewport: {width: 1366, height: 768}
  });
  const page = await context.newPage();
  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });

  await page.getByRole('button', {name: 'Open Faith & Focus: Daily Armor'}).click();
  const forgeSurface = await page.locator('#little-garden').evaluate(element => {
    const roomCard = element.querySelector('.garden-room-card');
    const plantingPanel = element.querySelector('.garden-planting-panel');
    return {
      scene: element.classList.contains('garden-room-home'),
      backgroundImage: getComputedStyle(element).backgroundImage,
      roomEdge: getComputedStyle(roomCard, '::before').backgroundImage,
      roomEdgePointerEvents: getComputedStyle(roomCard, '::before').pointerEvents,
      plantingBackground: getComputedStyle(plantingPanel).backgroundImage,
      roomRadius: getComputedStyle(roomCard).borderRadius
    };
  });
  assert.equal(forgeSurface.scene, true, 'The Forge Room must remain the active home scene');
  assert.match(forgeSurface.backgroundImage, /garden-room-background\.jpg/);
  assert.match(forgeSurface.backgroundImage, /repeating-linear-gradient/);
  assert.match(forgeSurface.roomEdge, /radial-gradient/);
  assert.equal(forgeSurface.roomEdgePointerEvents, 'none');
  assert.match(forgeSurface.plantingBackground, /repeating-linear-gradient/);
  assert.match(forgeSurface.roomRadius, /29px/);
  await assertPointerHitTarget(
    page.locator('#garden-planting-button'),
    'Forge Room planting action beneath watercolor paper layers'
  );

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('garden:show-scene', {
      detail: {scene: 'diary'}
    }));
  });
  const diary = page.locator('#view-diary');
  await diary.waitFor({state: 'visible'});
  const diarySurface = await page.locator('#little-garden').evaluate(element => {
    const card = element.querySelector('#view-diary > .card-lavender');
    const lockCard = element.querySelector('#diary-lock-panel');
    const editor = element.querySelector('#private-diary-entry');
    return {
      active: element.classList.contains('garden-diary-active'),
      backgroundColor: getComputedStyle(element).backgroundColor,
      backgroundImage: getComputedStyle(element).backgroundImage,
      cardBackground: getComputedStyle(card).backgroundImage,
      cardEdge: getComputedStyle(card, '::before').backgroundImage,
      cardEdgePointerEvents: getComputedStyle(card, '::before').pointerEvents,
      lockBackground: getComputedStyle(lockCard).backgroundImage,
      editorBackground: getComputedStyle(editor).backgroundImage,
      editorBorder: getComputedStyle(editor).borderColor
    };
  });
  assert.equal(diarySurface.active, true, 'The Diary-specific theme must be scoped to the Diary scene');
  assert.equal(diarySurface.backgroundColor, 'rgb(241, 247, 251)');
  assert.match(diarySurface.backgroundImage, /repeating-linear-gradient/);
  assert.match(diarySurface.cardBackground, /radial-gradient/);
  assert.match(diarySurface.cardBackground, /repeating-linear-gradient/);
  assert.match(diarySurface.cardEdge, /radial-gradient/);
  assert.equal(diarySurface.cardEdgePointerEvents, 'none');
  assert.match(diarySurface.lockBackground, /rgba\(244, 207, 116/);
  assert.match(diarySurface.editorBackground, /repeating-linear-gradient/);
  assert.match(diarySurface.editorBorder, /112, 157, 188/);

  await page.evaluate(() => {
    document.getElementById('diary-editor-panel')?.classList.remove('hidden');
  });
  const notebookButton = page.locator('#diary-archive-button');
  await assertPointerHitTarget(notebookButton, 'Diary notebook button beneath watercolor paper layers');
  await notebookButton.click();
  assert.match(
    await page.locator('#diary-security-status').textContent(),
    /Unlock your Diary before opening your notebook/,
    'The Diary notebook control must still receive and handle its click while locked'
  );

  await context.close();

  const reducedContext = await browser.newContext({
    serviceWorkers: 'block',
    reducedMotion: 'reduce'
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(host.url, {waitUntil: 'load'});
  await reducedPage.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
    document.getElementById('little-garden')?.classList.add('garden-room-home');
  });
  const reducedRoomMotion = await reducedPage.locator('.garden-room-card').evaluate(
    element => getComputedStyle(element, '::before').animationDuration);
  assert.equal(reducedRoomMotion, '0s',
    'Forge Room decorative effects must respect reduced-motion preferences');
  await reducedContext.close();
});
