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
    url: 'http://127.0.0.1:' + address.port + '/',
    close: () => new Promise(resolveClose => server.close(resolveClose))
  };
}

test('Chromium: one shared Diary notepad adds encrypted notes while the device is offline', {
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
    viewport: {width: 1280, height: 800}
  });
  const page = await context.newPage();
  await page.goto(host.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    document.getElementById('view-pin')?.classList.add('hidden');
    window.dispatchEvent(new Event('faith-focus:app-unlocked'));
    document.dispatchEvent(new CustomEvent('garden:show-scene', {
      detail: {scene: 'diary'}
    }));
  });
  await page.locator('#view-diary').waitFor({state: 'visible'});

  const setup = await page.evaluate(async () => {
    const module = await import('./assets/writing-security.js');
    const key = await crypto.subtle.generateKey(
      {name: 'AES-GCM', length: 256},
      false,
      ['encrypt', 'decrypt']
    );
    await module.adoptVaultEncryptionKey(key);
    module.renderDiarySecurityUI();
    document.getElementById('currentDate')?.dispatchEvent(
      new Event('change', {bubbles: true})
    );
    window.__diaryNoteTestModule = module;
    return {
      secureContext: window.isSecureContext,
      dateString: module.getCurrentWritingDate()
    };
  });
  assert.equal(setup.secureContext, true, 'The local test origin must provide Web Crypto');
  assert.match(setup.dateString, /^\d{4}-\d{2}-\d{2}$/);

  const composer = page.locator('#diary-note-composer');
  const addButton = page.locator('#diary-add-note-button');
  await composer.waitFor({state: 'visible'});
  await page.waitForFunction(
    () => document.getElementById('diary-add-note-button')?.disabled === false
  );

  assert.equal(await page.locator('#diary-additional-notes textarea').count(), 1,
    'The Additional Notes section must expose exactly one writing notepad');
  assert.equal(await page.locator('#diary-additional-notes-list textarea').count(), 0,
    'Saved notes must be displayed as entries, not as additional editing boxes');
  assert.equal(await page.locator('.diary-note-composer-actions').count(), 1,
    'The ADD action must have one stable placement');

  await context.setOffline(true);
  assert.equal(await page.evaluate(() => navigator.onLine), false,
    'The test must be genuinely offline before adding notes');

  await addButton.click();
  assert.equal(await page.locator('.diary-note-card').count(), 0,
    'An empty submission must not create a blank entry');

  await composer.fill('Private laptop thought — first separate note.');
  await addButton.click();
  await page.locator('.diary-note-card-text').first().waitFor({state: 'visible'});
  await page.waitForFunction(
    () => document.getElementById('diary-note-composer')?.value === ''
  );

  let saved = await page.evaluate(dateString => {
    const record = localStorage.getItem('dmp_diary_cipher_v1_' + dateString);
    const notes = window.__diaryNoteTestModule.getPrivateDiaryNotesForDate(dateString);
    return {
      record,
      notes,
      containsPlaintext: record?.includes('Private laptop thought') === true
    };
  }, setup.dateString);
  assert.equal(saved.notes.length, 1);
  assert.equal(saved.notes[0].text, 'Private laptop thought — first separate note.');
  assert.ok(saved.record, 'The encrypted daily Diary record must exist locally');
  assert.equal(saved.containsPlaintext, false,
    'Private note text must not appear in localStorage ciphertext');

  await composer.fill('A second thought for the exact same day.');
  await addButton.click();
  await page.waitForFunction(
    () => document.querySelectorAll('#diary-additional-notes-list .diary-note-card').length === 2
      && document.getElementById('diary-note-composer')?.value === ''
  );

  saved = await page.evaluate(dateString => {
    const record = localStorage.getItem('dmp_diary_cipher_v1_' + dateString);
    const notes = window.__diaryNoteTestModule.getPrivateDiaryNotesForDate(dateString);
    return {
      record,
      notes,
      containsPlaintext: record?.includes('A second thought') === true
    };
  }, setup.dateString);
  assert.equal(saved.notes.length, 2);
  assert.deepEqual(
    saved.notes.map(note => note.text),
    [
      'Private laptop thought — first separate note.',
      'A second thought for the exact same day.'
    ]
  );
  assert.notEqual(saved.notes[0].id, saved.notes[1].id,
    'Each separate note must receive a unique identifier');
  assert.equal(saved.containsPlaintext, false,
    'Neither note may be written to localStorage in plaintext');
  assert.equal(await page.locator('#diary-additional-notes textarea').count(), 1,
    'Adding a note must reuse the original notepad');
  assert.equal(await page.locator('#diary-additional-notes-list textarea').count(), 0);
  assert.match(await page.locator('#writing-save-status').textContent(),
    /saved on this device|Saved securely/i);
  await context.close();
});
