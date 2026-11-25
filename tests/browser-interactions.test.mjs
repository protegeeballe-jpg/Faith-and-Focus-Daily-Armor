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

  await page.locator('#btn-next').click();
  await page.locator('#card-step-2').waitFor({state: 'visible'});
  const quoteButton = page.locator('#card-step-2 .guide-quote-launch[data-task-id="start-1"]');
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
  const guidedLaunch = page.locator('.guide-quote-launch[data-task-id="start-2"]');
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


test('Chromium: task-specific quote buttons are the only in-card actions and receive a real pointer click', {
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

  await page.route('**/bible/*.json', async route => {
    const fileName = new URL(route.request().url()).pathname.split('/').pop();
    const prefix = fileName === 'filipino_adb.json' ? 'SALIN' : 'ENGLISH';
    const sample = [{"book":"Genesis","chapter":1,"verse":1,"text":"In the beginning God created the heavens and the earth."},{"book":"Genesis","chapter":1,"verse":2,"text":"The earth was formless and empty."},{"book":"Genesis","chapter":1,"verse":3,"text":"Let there be light."},{"book":"Genesis","chapter":2,"verse":1,"text":"The heavens and the earth were finished."},{"book":"Exodus","chapter":1,"verse":1,"text":"Now these are the names of the children of Israel."},{"book":"Exodus","chapter":2,"verse":1,"text":"A man of the house of Levi went and took a daughter of Levi as his wife."},{"book":"Exodus","chapter":2,"verse":2,"text":"The woman conceived, and bore a son."}].map(record => ({
      ...record,
      text: prefix + ': ' + record.text
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sample)
    });
  });

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  await page.getByRole('button', {name: 'Open Health Checklist'}).click();

  const expectedLabels = {
    1: {
      'loc-home': 'At Home',
      'loc-house': "At someone else's Home",
      'loc-out': 'Out Here Somewhere',
      'loc-office': 'At Work'
    },
    2: {
      'bible-morning': 'Read & Reflect',
      'start-1': 'Mental Notes',
      'start-2': 'Set Intentions',
      'start-3': 'Move Your Body',
      'start-4': 'Drink Your Water'
    },
    3: {
      'mid-1': 'Posture Check',
      'mid-2': 'Breathing Exercise',
      'mid-3': 'Drink Your Water',
      'mid-4': 'Check Your Emotions',
      'mid-5': 'Check Your Thoughts'
    },
    4: {
      'end-1': 'My 3 Wins Today',
      'end-2': "Tomorrow's Goals",
      'end-3': 'Drink Your Water',
      'end-4': 'Good Job Poke'
    },
    5: {
      'sleep-1': 'Grateful to Others',
      'sleep-2': 'Grateful to God',
      'sleep-3': 'Digital Curfew',
      'sleep-4': 'Kneel & Pray',
      'sleep-5': 'Drink Your Water',
      'bible-evening': 'Read & Reflect'
    }
  };

  for (let step = 1; step <= 5; step++) {
    if (step > 1) await page.locator('#btn-next').click();
    const card = page.locator('#card-step-' + step);
    assert.equal(await card.locator('button[data-action="openModal"]').count(), 0,
      'Redundant standalone guide buttons must be removed from card ' + step);
    assert.equal(await card.locator('.ff-guide-row').count(), 0,
      'Duplicate guide title rows must be removed from card ' + step);

    const labels = expectedLabels[step];
    const launchers = card.locator('.guide-quote-launch');
    assert.equal(await launchers.count(), Object.keys(labels).length,
      'Every task in card ' + step + ' must have exactly one quote action');

    for (const [target, expectedLabel] of Object.entries(labels)) {
      const button = card.locator('.guide-quote-launch[data-task-id="' + target + '"]');
      assert.equal(await button.locator('.guide-quote-label').textContent(), expectedLabel,
        'Quote action must use the requested task label for ' + target);
      await assertPointerHitTarget(button, 'task quote ' + target);
      await button.click();
      if (target === 'bible-morning' || target === 'bible-evening') {
        assert.equal(await page.locator('#bible-reader-dialog').evaluate(dialog => dialog.open), true,
          'Read & Reflect must open the shared Bible reader: ' + target);
        await page.waitForFunction(() => {
          const complete = document.getElementById('bible-reader-complete-btn');
          return Boolean(complete && !complete.disabled);
        });
        assert.equal(await page.locator('#bible-reader-complete-btn').isEnabled(), true);
        await page.locator('#bible-reader-complete-btn').click();
        assert.equal(await page.locator('#bible-reader-dialog').evaluate(dialog => dialog.open), false,
          'Completing Bible reading must close the reader: ' + target);
      } else {
        assert.equal(await page.locator('#anim-modal').evaluate(
          modal => !modal.classList.contains('hidden')), true,
          'Task quote action failed to open its guide: ' + target);
        assert.equal(await page.locator('#modal-complete-btn').isEnabled(), true);

        const primaryAction = page.locator('#modal-complete-btn');
        if (target === 'mid-2') {
          assert.match(await primaryAction.textContent(), /Start 5 breathing cycles/);
          await page.clock.install();
          await primaryAction.click();
          assert.equal(await primaryAction.isDisabled(), true,
            'Guided breathing must disable its start button while running');
          assert.equal(await page.locator('#breathing-phase').textContent(), 'Breathe in');
          await page.clock.runFor(60_000);
          assert.equal(await primaryAction.isDisabled(), false,
            'Guided breathing must re-enable after five completed cycles');
          assert.match(await primaryAction.textContent(), /Good job!/);
        }

        await primaryAction.click();
        assert.equal(await page.locator('#anim-modal').isVisible(), false,
          'Completing the task guide must close its quote modal: ' + target);
      }

      const taskControl = card.locator('input.app-chk[data-id="' + target + '"]');
      await taskControl.waitFor({state: 'visible'});
      assert.equal(await taskControl.isEnabled(), true,
        'Completing the task quote must unlock its matching control: ' + target);

      if (step > 1) {
        await taskControl.check();
        await page.waitForFunction(targetId => {
          const input = document.querySelector('.app-chk[data-id="' + targetId + '"]');
          const quote = input?.closest('.guided-task-row')?.querySelector('.guide-quote-launch');
          return Boolean(input?.checked && quote?.hidden);
        }, target);
        assert.equal(await button.isVisible(), false,
          'Only the completed task quote button must disappear: ' + target);
        assert.equal(await card.locator('.guide-quote-launch:not([hidden])').count(),
          Object.keys(labels).length - Object.keys(labels).indexOf(target) - 1,
          'Unfinished task quote buttons must remain available on card ' + step);
      }
    }
  }

  assert.deepEqual(pageErrors, [],
    'In-card task quote interactions must not produce browser runtime errors');
  await context.close();
});

test('Chromium: location quote unlocks the radio and its button disappears after selection', async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(host.url);
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  await page.getByRole('button', {name: 'Open Health Checklist'}).click();

  const home = page.locator('#card-step-1 [data-id="loc-home"]');
  const quote = page.locator('#card-step-1 .guide-quote-launch[data-task-id="loc-home"]');
  await quote.waitFor({state: 'visible'});
  assert.equal(await home.isVisible(), false,
    'Location radio remains hidden until its quote is completed');

  await quote.click();
  assert.equal(await page.locator('#anim-modal').evaluate(
    modal => !modal.classList.contains('hidden')), true,
    'Location quote must open its guided modal');
  await page.locator('#modal-complete-btn').click();
  await home.waitFor({state: 'visible'});
  assert.equal(await home.isEnabled(), true,
    'Completing the quote must unlock the location radio');

  await home.check();
  await page.waitForFunction(() => {
    const button = document.querySelector('#card-step-1 .guide-quote-launch[data-task-id="loc-home"]');
    return button?.hidden === true;
  });
  assert.equal(await quote.isVisible(), false,
    'The selected location quote button must disappear after completion is checked');
  assert.equal(await page.locator('#card-step-1 .guide-quote-launch[data-task-id="loc-office"]').isVisible(), true,
    'Unselected location choices must retain their Read quote buttons');

  await context.close();
});


test('Chromium: completed tasks hide only their own quote buttons on every checklist card', async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({viewport: {width: 360, height: 800}});
  const page = await context.newPage();
  await page.goto(host.url);
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  await page.getByRole('button', {name: 'Open Health Checklist'}).click();
  await page.locator('#btn-next').click();

  for (let step = 2; step <= 5; step++) {
    if (step > 2) await page.locator('#btn-next').click();
    const card = page.locator('#card-step-' + step);
    await card.waitFor({state: 'visible'});
    const quote = card.locator('.guide-quote-launch:not([data-task-id^="bible-"])').first();
    await quote.waitFor({state: 'visible'});
    assert.ok(await quote.evaluate(button => button.getBoundingClientRect().height >= 44),
      'Mobile card ' + step + ' quote button must retain its 44px touch target');
    const target = await quote.getAttribute('data-task-id');
    await quote.click();
    await page.locator('#modal-complete-btn').click();

    const checkbox = card.locator('input.app-chk[type="checkbox"][data-id="' + target + '"]');
    await checkbox.waitFor({state: 'visible'});
    await checkbox.check();
    await page.waitForFunction(targetId => {
      const input = document.querySelector('.app-chk[data-id="' + targetId + '"]');
      const button = input?.closest('.guided-task-row')?.querySelector('.guide-quote-launch');
      return Boolean(input?.checked && button?.hidden);
    }, target);
    assert.equal(await quote.isVisible(), false,
      'Mobile card ' + step + ' must hide only the completed task quote');
    const otherQuotes = card.locator('.guide-quote-launch:not([hidden])');
    assert.ok(await otherQuotes.count() > 0,
      'Mobile card ' + step + ' must retain quote buttons for unfinished tasks');
  }

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
    {name: 'phone-narrow-360x800', viewport: {width: 360, height: 800}, deviceScaleFactor: 3},
    {name: 'phone-standard-390x844', viewport: {width: 390, height: 844}, deviceScaleFactor: 2},
    {name: 'compact-tablet-612x900', viewport: {width: 612, height: 900}, deviceScaleFactor: 1},
    {name: 'tablet-768x1024', viewport: {width: 768, height: 1024}, deviceScaleFactor: 1},
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

      const densityMetrics = await page.evaluate(() => {
        const toolbar = document.querySelector('#view-checklist > header');
        const toolbarLeft = toolbar?.querySelector('.checklist-header-left');
        const toolbarRight = toolbar?.querySelector('.checklist-header-right');
        const card = document.querySelector('#card-step-1');
        const heading = card?.querySelector('h2');
        const rect = card?.getBoundingClientRect();
        const shellRect = document.querySelector('#little-garden .garden-shell')?.getBoundingClientRect();
        const nextButton = document.querySelector('#btn-next');
        const nextStyle = nextButton ? getComputedStyle(nextButton) : null;
        const cardStyle = card ? getComputedStyle(card) : null;
        const nextRect = nextButton?.getBoundingClientRect();
        return {
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          cardPaddingTop: parseFloat(cardStyle?.paddingTop || '0'),
          cardPaddingBottom: parseFloat(cardStyle?.paddingBottom || '0'),
          cardPaddingLeft: parseFloat(cardStyle?.paddingLeft || '0'),
          cardPaddingRight: parseFloat(cardStyle?.paddingRight || '0'),
          headingFontSize: parseFloat(getComputedStyle(heading).fontSize),
          cardLeft: rect?.left ?? -1,
          cardRight: rect?.right ?? Infinity,
          cardWidth: rect?.width ?? 0,
          shellWidth: shellRect?.width ?? 0,
          nextButtonWidth: nextRect?.width ?? 0,
          nextButtonHeight: nextRect?.height ?? 0,
          nextButtonFlexGrow: parseFloat(nextStyle?.flexGrow || '0'),
          nextButtonPaddingTop: parseFloat(nextStyle?.paddingTop || '0'),
          nextButtonPaddingLeft: parseFloat(nextStyle?.paddingLeft || '0'),
          toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
          toolbarFlexWrap: toolbar ? getComputedStyle(toolbar).flexWrap : '',
          toolbarLeftTop: toolbarLeft?.getBoundingClientRect().top ?? -1,
          toolbarRightTop: toolbarRight?.getBoundingClientRect().top ?? -1,
          toolbarRightEdge: toolbarRight?.getBoundingClientRect().right ?? Infinity,
          viewportWidth: window.innerWidth
        };
      });
      assert.equal(densityMetrics.rootFontSize, '15px',
        profile.name + ': shared type scale must load');
      assert.ok(densityMetrics.cardPaddingTop >= 6
          && densityMetrics.cardPaddingTop <= 12.5
          && densityMetrics.cardPaddingBottom <= 12.5,
        profile.name + ': frame padding must preserve the updated spacing scale');
      assert.ok(densityMetrics.cardPaddingLeft <= 14.5
          && densityMetrics.cardPaddingRight <= 14.5,
        profile.name + ': frame side padding must preserve the updated spacing scale');
      assert.ok(densityMetrics.headingFontSize >= 14 && densityMetrics.headingFontSize <= 16,
        profile.name + ': checklist heading must stay compact and readable');
      assert.ok(densityMetrics.cardLeft >= -1
          && densityMetrics.cardRight <= densityMetrics.viewportWidth + 1,
        profile.name + ': checklist card must remain inside the viewport');
      const shellRatio = densityMetrics.shellWidth / densityMetrics.viewportWidth;
      const frameRatio = densityMetrics.cardWidth / densityMetrics.viewportWidth;
      if (profile.viewport.width <= 480) {
        assert.ok(shellRatio >= .88 && shellRatio <= .98,
          profile.name + ': phone content should use the screen without edge-to-edge frames');
        assert.ok(frameRatio <= .94,
          profile.name + ': phone activity frame must retain a visible outer gutter');
      } else if (profile.viewport.width < 768) {
        assert.ok(shellRatio >= .45 && shellRatio <= .75,
          profile.name + ': compact tablet column must remain proportionate');
        assert.ok(frameRatio <= .74,
          profile.name + ': compact tablet activity frame must stay proportionate');
      } else {
        assert.ok(shellRatio >= .6 && shellRatio <= .9,
          profile.name + ': expanded app column must use the available desktop space');
        assert.ok(frameRatio >= .5 && frameRatio <= .9,
          profile.name + ': expanded checklist card must stay balanced within the app column');
      }
      if (profile.viewport.width >= 800) {
        assert.equal(densityMetrics.toolbarFlexWrap, 'nowrap',
          profile.name + ': desktop checklist toolbar must remain on one row');
        assert.ok(densityMetrics.toolbarHeight >= 48 && densityMetrics.toolbarHeight <= 58,
          profile.name + ': desktop checklist toolbar must stay close to a 50px row');
        assert.ok(Math.abs(densityMetrics.toolbarLeftTop - densityMetrics.toolbarRightTop) <= 2,
          profile.name + ': desktop toolbar groups must align on the same row');
        assert.ok(densityMetrics.toolbarRightEdge <= densityMetrics.viewportWidth + 1,
          profile.name + ': desktop toolbar must remain inside the viewport');
      }
      if (profile.viewport.width >= 1300) {
        assert.ok(densityMetrics.shellWidth >= 899 && densityMetrics.shellWidth <= 901,
          profile.name + ': wide desktop app column must cap at 900px');
        assert.ok(densityMetrics.cardWidth >= 749 && densityMetrics.cardWidth <= 751,
          profile.name + ': wide desktop checklist card must cap at 750px');
      }
      assert.equal(densityMetrics.nextButtonFlexGrow, 0,
        profile.name + ': navigation buttons must not stretch to fill the footer');
      assert.ok(densityMetrics.nextButtonWidth < densityMetrics.viewportWidth * .35,
        profile.name + ': navigation button width must follow its label');
      assert.ok(densityMetrics.nextButtonPaddingTop <= 9.5
          && densityMetrics.nextButtonPaddingLeft <= 16.5,
        profile.name + ': navigation button padding must match the updated spacing scale');
      assert.ok(densityMetrics.nextButtonHeight >= 36
          && densityMetrics.nextButtonHeight <= 44,
        profile.name + ': button height must remain compact while preserving touch sizing');

      const cardSurfaceMetrics = await page.locator(
        '#view-checklist .step-card'
      ).evaluateAll(cards => cards.map(card => {
        const cardStyle = getComputedStyle(card);
        const nested = [...card.querySelectorAll('label, .ff-guide-row, .space-y-3 > div.flex.items-center.justify-between, .space-y-4 > div.flex.items-center.justify-between')].map(node => {
          const style = getComputedStyle(node);
          return {
            background: style.backgroundColor,
            border: style.borderTopWidth,
            radius: style.borderTopLeftRadius,
            shadow: style.boxShadow
          };
        });
        const cloudPanel = card.id === 'card-step-6'
          ? card.querySelector('.space-y-2\\.5 > .bg-white\\/80')
          : null;
        const cloudStyle = cloudPanel ? getComputedStyle(cloudPanel) : null;
        return {
          id: card.id,
          visible: card.getBoundingClientRect().width > 0,
          outerShadow: cardStyle.boxShadow,
          nested,
          cloudPanel: cloudStyle ? {
            background: cloudStyle.backgroundColor,
            border: cloudStyle.borderTopWidth,
            radius: cloudStyle.borderTopLeftRadius,
            shadow: cloudStyle.boxShadow
          } : null
        };
      }));
      assert.equal(cardSurfaceMetrics.length, 6,
        profile.name + ': all six checklist cards must be checked');
      assert.deepEqual(cardSurfaceMetrics.map(card => card.id), [
        'card-step-1', 'card-step-2', 'card-step-3',
        'card-step-4', 'card-step-5', 'card-step-6'
      ], profile.name + ': all six checklist steps must be represented');
      const visibleCards = cardSurfaceMetrics.filter(card => card.visible);
      assert.equal(visibleCards.length, 1,
        profile.name + ': the checklist wizard must show only its active step');
      assert.equal(visibleCards[0].id, 'card-step-1',
        profile.name + ': Card 1 must be the active step at checklist entry');
      for (const card of cardSurfaceMetrics) {
        assert.notEqual(card.outerShadow, 'none',
          profile.name + ': each step must retain its single outer card surface');
        for (const inner of card.nested) {
          assert.equal(inner.background, 'rgba(0, 0, 0, 0)',
            profile.name + ': inner checklist content must remain transparent');
          assert.equal(inner.border, '0px',
            profile.name + ': inner checklist content must not draw card borders');
          assert.equal(inner.radius, '0px',
            profile.name + ': inner checklist content must not use card corners');
          assert.equal(inner.shadow, 'none',
            profile.name + ': inner checklist content must not cast card shadows');
        }
        if (card.id === 'card-step-6') {
          assert.ok(card.cloudPanel,
            profile.name + ': Card 6 emotion choices must be checked for an extra wrapper');
          assert.equal(card.cloudPanel.background, 'rgba(0, 0, 0, 0)',
            profile.name + ': Card 6 must not retain a nested white panel');
          assert.equal(card.cloudPanel.border, '0px',
            profile.name + ': Card 6 nested panel must not retain a border');
          assert.equal(card.cloudPanel.radius, '0px',
            profile.name + ': Card 6 nested panel must not retain rounded corners');
          assert.equal(card.cloudPanel.shadow, 'none',
            profile.name + ': Card 6 nested panel must not cast a shadow');
        }
      }

      const initialLocationChoices = await page.locator(
        '#card-step-1 .checklist-location-choice'
      ).evaluateAll(labels => labels.map(label => {
        const radio = label.querySelector('input[type="radio"]');
        return {
          radioHidden: radio?.classList.contains('guide-hidden') ?? false,
          labelHidden: getComputedStyle(label).display === 'none',
          row: label.closest('.guided-task-row')?.getBoundingClientRect().width ?? 0
        };
      }));
      assert.equal(initialLocationChoices.length, 4,
        profile.name + ': all four location choices must retain their own quote flow');
      for (const choice of initialLocationChoices) {
        assert.equal(choice.radioHidden, true,
          profile.name + ': each location control waits for its quote');
        assert.equal(choice.labelHidden, true,
          profile.name + ': locked location labels stay out of the way');
        assert.ok(choice.row > 0,
          profile.name + ': each quote remains inside its own full-width choice row');
      }
      const locationQuoteButtons = page.locator('#card-step-1 .guide-quote-launch');
      assert.equal(await locationQuoteButtons.count(), 4,
        profile.name + ': every location choice must have a Read quote button');
      for (let index = 0; index < 4; index++) {
        const quote = locationQuoteButtons.nth(index);
        await assertPointerHitTarget(quote, profile.name + ' location quote ' + index);
        assert.equal(await quote.isVisible(), true,
          profile.name + ': location quote button must be visible before completion');
        await quote.click();
        assert.equal(await page.locator('#anim-modal').evaluate(
          modal => !modal.classList.contains('hidden')), true,
          profile.name + ': location quote button must open its guide');
        await page.locator('#modal-complete-btn').click();
        await page.locator('#card-step-1 .checklist-location-choice').nth(index)
          .locator('input[type="radio"]').waitFor({state: 'visible'});
      }

      const locationChoiceMetrics = await page.locator(
        '#card-step-1 .checklist-location-choice'
      ).evaluateAll(labels => labels.map(label => {
        const radio = label.querySelector('input[type="radio"]');
        const text = label.querySelector('.checklist-location-choice-text');
        const row = label.closest('.guided-task-row');
        const quote = row?.querySelector('.guide-quote-launch');
        const rowRect = row?.getBoundingClientRect();
        const quoteRect = quote?.getBoundingClientRect();
        return {
          width: label.getBoundingClientRect().width,
          display: getComputedStyle(label).display,
          radioWidth: radio?.getBoundingClientRect().width ?? 0,
          radioDisplay: radio ? getComputedStyle(radio).display : '',
          radioGuideHidden: radio?.classList.contains('guide-hidden') ?? false,
          quoteHeight: quoteRect?.height ?? 0,
          quoteScrollWidth: quote?.scrollWidth ?? 0,
          quoteClientWidth: quote?.clientWidth ?? 0,
          quoteLeft: quoteRect?.left ?? 0,
          quoteRight: quoteRect?.right ?? 0,
          rowLeft: rowRect?.left ?? 0,
          rowRight: rowRect?.right ?? 0,
          textWidth: text?.getBoundingClientRect().width ?? 0,
          textScrollWidth: text?.scrollWidth ?? 0,
          textClientWidth: text?.clientWidth ?? 0,
          textHeight: text?.getBoundingClientRect().height ?? 0,
          textLineHeight: parseFloat(getComputedStyle(text).lineHeight || '0')
        };
      }));
      assert.equal(locationChoiceMetrics.length, 4,
        profile.name + ': all four location answers must remain present');
      for (const choice of locationChoiceMetrics) {
        assert.ok(choice.width > 0,
          profile.name + ': unlocked location answers remain visible');
        assert.ok(choice.quoteLeft >= choice.rowLeft - 1
            && choice.quoteRight <= choice.rowRight + 1,
          profile.name + ': each Card 1 task button must fit inside its full-width row');
        assert.ok(choice.quoteScrollWidth <= choice.quoteClientWidth + 1,
          profile.name + ': Card 1 task labels must not overflow their buttons');
        assert.ok(choice.radioWidth >= 17 && choice.radioWidth <= 19,
          profile.name + ': radio control retains its 18px footprint');
        assert.equal(choice.radioGuideHidden, false,
          profile.name + ': completed quote must reveal its radio control');
        assert.ok(choice.textWidth > 0 && choice.textScrollWidth <= choice.textClientWidth + 1,
          profile.name + ': answer text remains fully visible');
        if (profile.viewport.width <= 620) {
          assert.ok(choice.quoteHeight >= 44,
            profile.name + ': mobile quote controls retain a 44px touch target');
        }
      }
      assert.ok(locationChoiceMetrics[0].textHeight <= locationChoiceMetrics[0].textLineHeight * 1.6,
        profile.name + ': AT HOME remains on one line');
      const atHomeChoice = page.locator('#card-step-1 .checklist-location-choice').filter({hasText:'AT HOME'});
      const atHomeQuote = page.locator('#card-step-1 .guide-quote-launch[data-task-id="loc-home"]');
      await atHomeChoice.click();
      assert.equal(await atHomeChoice.locator('input[type="radio"]').isChecked(), true,
        profile.name + ': AT HOME selection behavior remains unchanged');
      await page.waitForFunction(() => {
        const button = document.querySelector('#card-step-1 .guide-quote-launch[data-task-id="loc-home"]');
        return button?.hidden === true;
      });
      assert.equal(await atHomeQuote.isVisible(), false,
        profile.name + ': completed location quote button disappears after selection');
      assert.equal(await page.locator('#card-step-1 .guide-quote-launch[data-task-id="loc-office"]').isVisible(), true,
        profile.name + ': other location quote buttons remain available');

      for (let step = 1; step <= 5; step++) {
        if (step > 1) {
          await page.locator('#btn-next').click();
          await page.locator('#card-step-' + step).waitFor({state: 'visible'});
        }

        const card = page.locator('#card-step-' + step);
        const cardTypography = await card.evaluate(element => {
          const heading = element.querySelector('h2');
          const boldLabels = [...element.querySelectorAll('.font-bold, .font-extrabold')]
            .filter(label => !label.matches('h2') && !label.closest('button'));
          return {
            headingSize: parseFloat(getComputedStyle(heading).fontSize),
            buttonSizes: [...element.querySelectorAll('button')]
              .map(button => parseFloat(getComputedStyle(button).fontSize)),
            boldLabelSizes: boldLabels
              .map(label => parseFloat(getComputedStyle(label).fontSize))
          };
        });
        assert.ok(cardTypography.headingSize >= 14 && cardTypography.headingSize <= 16,
          profile.name + ': every card title must share the compact heading scale');
        assert.ok(cardTypography.buttonSizes.every(size => size >= 9.5 && size <= 11.5),
          profile.name + ': card action labels must stay compact without becoming tiny');
        assert.ok(cardTypography.boldLabelSizes.every(size => size <= 13),
          profile.name + ': emphasized task labels must not overpower their body copy');

        if ([3, 5].includes(step) && profile.viewport.width >= 768) {
          const rowMetrics = await card.evaluate(element => {
            const rows = [...element.querySelectorAll(
              '.guided-task-row, .space-y-3 > div.flex.items-center.justify-between, .space-y-4 > div.flex.items-center.justify-between'
            )];
            const cardWidth = element.getBoundingClientRect().width;
            return rows.map(row => {
              const rect = row.getBoundingClientRect();
              return {
                display: getComputedStyle(row).display,
                width: rect.width,
                cardWidth,
                top: rect.top,
                bottom: rect.bottom
              };
            });
          });
          assert.ok(rowMetrics.length >= 2,
            profile.name + ': checklist cards must expose their action rows for layout checks');
          for (const row of rowMetrics) {
            assert.equal(row.display, 'flex',
              profile.name + ': desktop action rows must be block-level flex rows');
            assert.ok(row.width >= row.cardWidth * .9,
              profile.name + ': desktop action rows must use the card width');
          }
          const siblingRows = rowMetrics;
          for (let index = 1; index < siblingRows.length; index++) {
            assert.ok(siblingRows[index].top >= siblingRows[index - 1].bottom - 1,
              profile.name + ': checklist action rows must occupy separate lines');
          }
        }

        if (step === 3 && profile.viewport.width >= 481 && profile.viewport.width < 768) {
          const actionRow = card.locator('.guided-task-row').first();
          const rowMetrics = await actionRow.evaluate(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const button = element.querySelector('.guide-quote-launch');
            const buttonStyle = button ? getComputedStyle(button) : null;
            const buttonRect = button?.getBoundingClientRect();
            return {
              display: style.display,
              width: rect.width,
              cardWidth: element.closest('.step-card').getBoundingClientRect().width,
              paddingTop: parseFloat(style.paddingTop),
              paddingLeft: parseFloat(style.paddingLeft),
              buttonHeight: buttonRect?.height ?? 0,
              buttonPaddingTop: parseFloat(buttonStyle?.paddingTop || '0'),
              buttonPaddingLeft: parseFloat(buttonStyle?.paddingLeft || '0'),
              buttonFlexGrow: parseFloat(buttonStyle?.flexGrow || '0')
            };
          });
          assert.equal(rowMetrics.display, 'inline-flex',
            profile.name + ': compact tablet task rows must retain their content-sized layout');
          assert.ok(rowMetrics.width <= rowMetrics.cardWidth * .86,
            profile.name + ': compact tablet task rows must remain content-sized');
          assert.ok(rowMetrics.paddingTop <= 8.5 && rowMetrics.paddingLeft <= 12.5,
            profile.name + ': task-row padding must stay within the compact spacing scale');
          assert.equal(rowMetrics.buttonFlexGrow, 0,
            profile.name + ': task quote button must remain content-sized');
          assert.ok(rowMetrics.buttonPaddingTop <= 9.5
              && rowMetrics.buttonPaddingLeft <= 16.5,
            profile.name + ': task quote button padding must match the compact spacing scale');
          assert.ok(rowMetrics.buttonHeight >= 44 && rowMetrics.buttonHeight <= 48,
            profile.name + ': compact tablet task quote buttons must retain a 44px minimum touch target');
        }
        const launchers = card.locator('.guide-quote-launch:not([hidden]):not([data-task-id^="bible-"])');
        if (await launchers.count()) {
          const launcher = launchers.first();
          await assertPointerHitTarget(launcher, profile.name);
          await launcher.click();
          assert.equal(await page.locator('#anim-modal').evaluate(
            modal => !modal.classList.contains('hidden')), true,
            profile.name + ': quote launcher must open its modal');
          await page.locator('#anim-modal [data-action="closeModal"]').click();
        }

        assert.equal(await card.locator('button[data-action="openModal"]').count(), 0,
          profile.name + ': redundant standalone guide buttons must be removed from card ' + step);

        const enabledCheckboxes = card.locator('input.app-chk[type="checkbox"]:visible:not([disabled])');
        for (let index = 0; index < await enabledCheckboxes.count(); index++) {
          const checkbox = enabledCheckboxes.nth(index);
          if (!await checkbox.isChecked()) await checkbox.check();
          assert.equal(await checkbox.isChecked(), true,
            profile.name + ': visible checklist checkbox must respond to interaction');
        }
      }

      await page.locator('#btn-next').click();
      await page.locator('#card-step-6').waitFor({state: 'visible'});
      const cloudTypography = await page.locator('#card-step-6').evaluate(element => {
        const heading = element.querySelector('h2');
        const buttons = [...element.querySelectorAll('.cloud-item')];
        return {
          headingSize: parseFloat(getComputedStyle(heading).fontSize),
          buttonSizes: buttons.map(button => parseFloat(getComputedStyle(button).fontSize)),
          statusSizes: buttons.map(button => parseFloat(getComputedStyle(button.querySelector('.cloud-status')).fontSize))
        };
      });
      assert.ok(cloudTypography.headingSize >= 14 && cloudTypography.headingSize <= 16,
        profile.name + ': Cloud Check title must match the other card titles');
      assert.ok(cloudTypography.buttonSizes.every(size => size >= 9.5 && size <= 11.5),
        profile.name + ': Cloud choices must keep compact readable labels');
      assert.ok(cloudTypography.statusSizes.every(size => size >= 9 && size <= 10.5),
        profile.name + ': Cloud action status must remain secondary');

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

      await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('garden:show-scene', {
          detail: {scene: 'diary'}
        }));
        const editor = document.getElementById('diary-editor-panel');
        editor?.classList.remove('hidden');
        editor?.removeAttribute('data-ff-tabs');
        editor?.removeAttribute('data-ff-tab');
      });
      await page.locator('#view-diary:not(.hidden) > .card-lavender').waitFor({state: 'visible'});
      const diaryMetrics = await page.evaluate(() => {
        const box = selector => document.querySelector(selector)?.getBoundingClientRect();
        const composer = box('#diary-note-composer');
        const addButton = box('#diary-add-note-button');
        return {
          card: box('#view-diary > .card-lavender')?.width ?? 0,
          notes: box('#diary-additional-notes')?.width ?? 0,
          location: box('#diary-location-history')?.width ?? 0,
          composer: composer?.width ?? 0,
          composerLeft: composer?.left ?? 0,
          composerRight: composer?.right ?? 0,
          composerTop: composer?.top ?? 0,
          composerBottom: composer?.bottom ?? 0,
          addButtonLeft: addButton?.left ?? 0,
          addButtonRight: addButton?.right ?? 0,
          addButtonTop: addButton?.top ?? 0,
          addButtonBottom: addButton?.bottom ?? 0,
          addButtonHeight: addButton?.height ?? 0,
          emptyNote: box('#diary-additional-notes-list > li')?.width ?? 0,
          viewportWidth: window.innerWidth
        };
      });
      assert.ok(diaryMetrics.card > 0 && diaryMetrics.card <= diaryMetrics.viewportWidth + 1,
        profile.name + ': Diary outer frame must remain within the viewport');
      assert.ok(diaryMetrics.notes > 0 && diaryMetrics.notes <= diaryMetrics.card,
        profile.name + ': Diary sections must fit inside the main frame');
      assert.ok(diaryMetrics.composer > 0 && diaryMetrics.composer <= diaryMetrics.notes,
        profile.name + ': note composer must remain inside its section frame');
      const diaryPanelCap = diaryMetrics.viewportWidth >= 768 ? 480 : 360;
      assert.ok(diaryMetrics.location > 0 && diaryMetrics.location <= diaryPanelCap,
        profile.name + ': Location History frame must respect its responsive panel cap');
      assert.ok(diaryMetrics.notes <= diaryPanelCap && diaryMetrics.notes < diaryMetrics.card * .9,
        profile.name + ': Saved Notes frame must be visibly narrower than the Diary card');
      assert.ok(diaryMetrics.composer <= diaryMetrics.notes && diaryMetrics.composer > diaryMetrics.notes * .82,
        profile.name + ': note composer must use the available width inside Saved Notes');
      assert.ok(diaryMetrics.addButtonLeft >= diaryMetrics.composerLeft - 1
          && diaryMetrics.addButtonRight <= diaryMetrics.composerRight + 1
          && diaryMetrics.addButtonTop >= diaryMetrics.composerTop
          && diaryMetrics.addButtonBottom <= diaryMetrics.composerBottom + 1,
        profile.name + ': ADD must sit inside the note-writing surface');
      assert.ok(diaryMetrics.addButtonHeight >= 32 && diaryMetrics.addButtonHeight <= 40,
        profile.name + ': inset ADD action must remain compact');
      assert.ok(diaryMetrics.emptyNote < diaryMetrics.notes * .96,
        profile.name + ': short Diary empty-state frames must fit their message');

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
  await locator.evaluate(element => element.scrollIntoView({
    block: 'center',
    inline: 'nearest'
  }));
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
    profileName + ': another element must not cover the control hit area; ' + JSON.stringify(hitTest));
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

  await page.locator('#btn-next').click();
  await page.locator('#card-step-2').waitFor({state: 'visible'});
  const quoteLauncher = page.locator('#card-step-2 .guide-quote-launch[data-task-id="start-1"]');
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
  t.diagnostic('Diary notebook locked-state interaction verified');

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
  await reducedPage.locator('#btn-next').click();
  await reducedPage.locator('#card-step-2').waitFor({state: 'visible'});
  await reducedPage.locator('#card-step-2 .guide-quote-launch[data-task-id="start-1"]').click();
  const reducedAnimation = await reducedPage.locator('#anim-modal .guide-quote-wash').evaluate(
    element => getComputedStyle(element).animationDuration);
  assert.equal(reducedAnimation, '0s',
    'Pigment motion must respect the reduced-motion preference');
  await reducedContext.close();
});


test('Chromium: blue-and-yellow Diary and painterly Forge Room surfaces preserve real hit targets', {
  timeout: 60000
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
  await page.goto(host.url, {waitUntil: 'load', timeout: 8000});
  t.diagnostic('Static app loaded');
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });

  await page.evaluate(() => {
    document.dispatchEvent(new Event('garden:open'));
  });
  await page.locator('#little-garden.garden-room-home').waitFor({state: 'visible', timeout: 8000});
  t.diagnostic('Forge Room opened through its application home event');
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
  t.diagnostic('Forge Room planting action receives pointer input');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('garden:show-scene', {
      detail: {scene: 'diary'}
    }));
  });
  t.diagnostic('Diary scene event dispatched');
  const diary = page.locator('#view-diary');
  await diary.waitFor({state: 'visible', timeout: 8000});
  t.diagnostic('Diary scene became visible');
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
      editorBorder: getComputedStyle(editor).borderColor,
      archiveBackground: getComputedStyle(element.querySelector('.diary-archive-dialog')).backgroundImage,
      archiveBackdrop: getComputedStyle(element.querySelector('#diary-archive-panel')).backgroundColor,
      archiveCloseHeight: getComputedStyle(element.querySelector('.diary-archive-close')).minHeight,
      cardIsolation: getComputedStyle(card).isolation,
      archiveZIndex: getComputedStyle(element.querySelector('#diary-archive-panel')).zIndex
    };
  });
  assert.equal(diarySurface.active, true, 'The Diary-specific theme must be scoped to the Diary scene');
  assert.equal(diarySurface.backgroundColor, 'rgb(241, 247, 251)');
  assert.match(diarySurface.backgroundImage, /repeating-linear-gradient/);
  assert.match(diarySurface.cardBackground, /radial-gradient/);
  assert.match(diarySurface.cardBackground, /repeating-linear-gradient/);
  assert.match(diarySurface.cardEdge, /radial-gradient/);
  assert.equal(diarySurface.cardEdgePointerEvents, 'none');
  assert.match(diarySurface.lockBackground, /rgba\(239, 204, 116/);
  assert.match(diarySurface.editorBackground, /repeating-linear-gradient/);
  assert.match(diarySurface.editorBorder, /112, 157, 188/);
  assert.match(diarySurface.archiveBackground, /radial-gradient/);
  assert.match(diarySurface.archiveBackdrop, /29, 54, 72/);
  assert.equal(diarySurface.archiveCloseHeight, '44px');
  assert.equal(diarySurface.cardIsolation, 'auto',
    'The Diary paper must not create a stacking context around its fixed archive dialog');
  assert.equal(diarySurface.archiveZIndex, '90',
    'The full-screen Diary archive must retain its established overlay priority');
  t.diagnostic('Diary blue-and-honey surfaces and archive stacking verified');

  await page.evaluate(() => {
    document.getElementById('diary-editor-panel')?.classList.remove('hidden');
  });
  const notebookButton = page.locator('#diary-archive-button');
  await assertPointerHitTarget(notebookButton, 'Diary notebook button beneath watercolor paper layers');
  t.diagnostic('Diary notebook button is visible and pointer-accessible');
  await notebookButton.click({timeout: 8000});
  t.diagnostic('Diary notebook action was clicked');
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



test('Chromium: Read & Reflect loads Scripture on demand, remembers the default version, and unlocks both checklist tasks', {
  timeout: 30000
}, async t => {
  const host = await startStaticServer();
  const browser = await chromium.launch({headless: true});
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  const bibleRequests = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/bible/*.json', async route => {
    const fileName = new URL(route.request().url()).pathname.split('/').pop();
    bibleRequests.push(fileName);
    const prefix = fileName === 'filipino_adb.json' ? 'SALIN' : 'ENGLISH';
    const sample = [{"book":"Genesis","chapter":1,"verse":1,"text":"In the beginning God created the heavens and the earth."},{"book":"Genesis","chapter":1,"verse":2,"text":"The earth was formless and empty."},{"book":"Genesis","chapter":1,"verse":3,"text":"Let there be light."},{"book":"Genesis","chapter":2,"verse":1,"text":"The heavens and the earth were finished."},{"book":"Exodus","chapter":1,"verse":1,"text":"Now these are the names of the children of Israel."},{"book":"Exodus","chapter":2,"verse":1,"text":"A man of the house of Levi went and took a daughter of Levi as his wife."},{"book":"Exodus","chapter":2,"verse":2,"text":"The woman conceived, and bore a son."}].map(record => ({
      ...record,
      text: prefix + ': ' + record.text
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sample)
    });
  });

  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
  });
  assert.deepEqual(bibleRequests, [],
    'The Bible controller must not download Scripture during application startup');

  await page.getByRole('button', {name: 'Open Health Checklist'}).click();
  await page.locator('#btn-next').click();
  const morningCard = page.locator('#card-step-2');
  const morningRows = morningCard.locator('.guided-task-row');
  assert.equal(await morningRows.first().locator('.guide-quote-launch').getAttribute('data-task-id'), 'bible-morning',
    'Read & Reflect must be the first Card 2 task');
  await morningRows.first().locator('.guide-quote-launch').click();
  await page.locator('#bible-reader-dialog').waitFor({state: 'visible'});
  await page.waitForFunction(() =>
    document.querySelector('#bible-reader-book')?.options.length > 1
    && document.querySelector('#bible-reader-complete-btn')?.disabled === false
  );
  const phoneLayout = await page.evaluate(() => {
    const dialog = document.querySelector('#bible-reader-dialog');
    const passage = document.querySelector('#bible-reading-text');
    const content = document.querySelector('.bible-reader-content');
    const passageRegion = document.querySelector('.bible-reader-passage-region');
    return {
      viewportHeight: window.innerHeight,
      dialogHeight: dialog.getBoundingClientRect().height,
      dialogWidth: dialog.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      contentHeight: content.getBoundingClientRect().height,
      passageRegionHeight: passageRegion.getBoundingClientRect().height,
      passageHeight: passage.getBoundingClientRect().height
    };
  });
  assert.ok(phoneLayout.dialogHeight >= phoneLayout.viewportHeight * .9,
    'The mobile Bible reader must use nearly the full available screen height');
  assert.ok(phoneLayout.passageRegionHeight >= phoneLayout.contentHeight * .7,
    'The mobile Scripture region must use at least 70% of the reader content area');
  assert.ok(phoneLayout.passageHeight >= phoneLayout.dialogHeight * .52,
    'The mobile Scripture pane must receive most of the reader panel height');
  assert.ok(phoneLayout.dialogWidth >= phoneLayout.viewportWidth - 20,
    'The mobile reader panel must retain its existing near-full width');


  assert.deepEqual(bibleRequests, ['english_web.json'],
    'Opening the Bible must fetch only the selected default translation');
  assert.equal(await page.locator('#bible-reader-version').inputValue(), 'english_web');

  await page.locator('#bible-reader-version').selectOption('filipino_adb');
  await page.waitForFunction(() =>
    localStorage.getItem('faith_focus_bible_default_version') === 'filipino_adb'
    && document.querySelector('#bible-reader-book')?.options.length > 1
    && document.querySelector('#bible-reading-heading')?.textContent.includes('Ang Dating Biblia (ADB)')
  );
  assert.deepEqual(bibleRequests, ['english_web.json', 'filipino_adb.json'],
    'Changing the default must load only the newly selected translation');
  assert.match(await page.locator('#bible-reading-text').textContent(), /SALIN:/);

  await page.locator('#bible-reader-book').selectOption('Exodus');
  await page.locator('#bible-reader-chapter').selectOption('2');
  await page.locator('#bible-reader-verse').selectOption('2');
  const selectedVerse = page.locator('#bible-reading-text [data-verse-number="2"]');
  assert.equal(await selectedVerse.evaluate(element => element.classList.contains('is-selected')), true,
    'The selected Book, Chapter, and Verse must be clearly highlighted');
  assert.match(await selectedVerse.textContent(), /SALIN: The woman conceived/);

  await page.setViewportSize({width: 1280, height: 800});
  const desktopLayout = await page.evaluate(() => {
    const dialog = document.querySelector('#bible-reader-dialog');
    const passage = document.querySelector('#bible-reading-text');
    const content = document.querySelector('.bible-reader-content');
    const passageRegion = document.querySelector('.bible-reader-passage-region');
    return {
      viewportHeight: window.innerHeight,
      dialogHeight: dialog.getBoundingClientRect().height,
      dialogWidth: dialog.getBoundingClientRect().width,
      contentHeight: content.getBoundingClientRect().height,
      passageRegionHeight: passageRegion.getBoundingClientRect().height,
      passageHeight: passage.getBoundingClientRect().height
    };
  });
  assert.ok(desktopLayout.dialogHeight >= desktopLayout.viewportHeight * .9,
    'The desktop Bible reader must also use nearly the full available screen height');
  assert.ok(desktopLayout.passageRegionHeight >= desktopLayout.contentHeight * .7,
    'The desktop Scripture region must use at least 70% of the reader content area');
  assert.ok(desktopLayout.passageHeight >= desktopLayout.dialogHeight * .52,
    'The desktop Scripture pane must receive most of the reader panel height');
  assert.ok(desktopLayout.dialogWidth <= 760,
    'The desktop reader must keep the established maximum panel width');

  await page.locator('#bible-reader-complete-btn').click();
  await page.waitForFunction(() => document.querySelector('#bible-reader-dialog')?.open === false);
  const morningCheckbox = morningCard.locator('input.app-chk[data-id="bible-morning"]');
  await morningCheckbox.waitFor({state: 'visible'});
  assert.equal(await morningCheckbox.isEnabled(), true);
  assert.equal(await morningCheckbox.isChecked(), false,
    'Reading unlocks the checklist checkbox but does not auto-check it');
  await morningCheckbox.check();
  await page.waitForFunction(() =>
    document.querySelector('#card-step-2 .guide-quote-launch[data-task-id="bible-morning"]')?.hidden === true
  );

  for (let step = 0; step < 3; step++) {
    await page.locator('#btn-next').click();
  }
  const eveningCard = page.locator('#card-step-5');
  const eveningRows = eveningCard.locator('.guided-task-row');
  assert.equal(await eveningRows.last().locator('.guide-quote-launch').getAttribute('data-task-id'), 'bible-evening',
    'Read & Reflect must be the last Card 5 task');
  await eveningRows.last().locator('.guide-quote-launch').click();
  await page.locator('#bible-reader-dialog').waitFor({state: 'visible'});
  await page.waitForFunction(() =>
    document.querySelector('#bible-reader-book')?.options.length > 1
    && document.querySelector('#bible-reader-complete-btn')?.disabled === false
  );
  assert.equal(await page.locator('#bible-reader-version').inputValue(), 'filipino_adb',
    'The selected translation must remain the default for the evening reader');
  assert.deepEqual(bibleRequests, ['english_web.json', 'filipino_adb.json', 'filipino_adb.json'],
    'Closing the reader releases its in-memory data; reopening loads only the saved version');
  await page.locator('#bible-reader-complete-btn').click();
  const eveningCheckbox = eveningCard.locator('input.app-chk[data-id="bible-evening"]');
  await eveningCheckbox.waitFor({state: 'visible'});
  assert.equal(await eveningCheckbox.isEnabled(), true);

  assert.deepEqual(pageErrors, [],
    'Bible reader interactions must not produce browser runtime errors');
  await context.close();
});
