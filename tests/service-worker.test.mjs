import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const registration = readFileSync(
    new URL('../assets/service-worker-registration.js', import.meta.url),
    'utf8'
);
const manifest = JSON.parse(
    readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
);

test('the main app page connects its manifest and service-worker registration module', () => {
    assert.match(html, /<link rel="manifest" href="\.\/manifest\.json">/);
    assert.match(html, /<meta name="theme-color" content="#FBF9F5">/);
    assert.match(html, /type="module" src="\.\/assets\/service-worker-registration\.js"/);
    assert.equal(manifest.start_url, './index.html');
});

test('the offline shell version advances when sync runtime assets change', () => {
    assert.match(worker, /const CACHE_NAME = 'faith-focus-shell-v37-cross-device-sync'/);
});

test('the registration module resolves the worker and scope from the app path', () => {
    assert.match(registration, /navigator\.serviceWorker\.register/);
    assert.match(registration, /new URL\('\.\.\/', import\.meta\.url\)/);
    assert.match(registration, /new URL\('sw\.js', appScopeUrl\)/);
    assert.match(registration, /window\.isSecureContext/);
});

test('the offline shell includes every page and runtime dependency needed by the app', () => {
    const requiredResources = [
        './index.html',
        './home.html',
        './privacy.html',
        './terms.html',
        './manifest.json',
        './assets/lexend.css',
        './assets/tailwind.generated.css',
        './assets/app.css',
        './assets/garden.css',
        './assets/legal.css',
        './assets/app.js',
        './assets/guide-quotes.js',
        './assets/missed-card-notifications.js',
        './assets/garden.js',
        './assets/settings-modal.js',
        './assets/vault-crypto.js',
        './assets/vault-storage.js',
        './assets/vault-sync.js',
        './assets/backup-import-transaction.js',
        './assets/vault-session.js',
        './assets/device-identity.js',
        './assets/local-backup.js',
        './assets/service-worker-registration.js',
        './assets/location-checkin.js',
        './assets/garden-model.js',
        './assets/writing-security.js',
        './assets/private-writing-migration.js',
        './assets/voice-note-store.js',
        './assets/compressor.js',
        './assets/garden-room-background.jpg',
        './assets/icon.png'
    ];

    for (const resource of requiredResources) {
        assert.ok(worker.includes("'" + resource + "'"), 'Missing offline resource: ' + resource);
    }
});


test('the offline shell precaches the full transitive JavaScript module graph', () => {
    const queue = [...html.matchAll(/<script\s+type="module"\s+src="\.\/([^"]+)"/g)]
        .map(match => match[1]);
    const visited = new Set();

    while (queue.length) {
        const modulePath = queue.shift();
        if (visited.has(modulePath)) continue;
        visited.add(modulePath);

        const source = readFileSync(new URL('../' + modulePath, import.meta.url), 'utf8');
        for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.\/[^'"]+)['"]/g)) {
            const directory = modulePath.slice(0, modulePath.lastIndexOf('/') + 1);
            queue.push(directory + match[1].slice(2));
        }
    }

    for (const modulePath of visited) {
        assert.ok(worker.includes("'./" + modulePath + "'"), 'Missing offline module: ' + modulePath);
    }
});

test('the worker is scoped to safe GET requests and does not cache cloud or private data', () => {
    assert.match(worker, /request\.method !== 'GET'/);
    assert.match(worker, /!isWithinAppScope\(url\)/);
    assert.match(worker, /request\.mode === 'navigate'/);
    assert.match(worker, /async function cacheFirst/);
    assert.match(worker, /event\.waitUntil\(refreshPromise\.then\(\(\) => undefined\)\)/);
    assert.match(worker, /isStaticAppAsset\(url\)/);
    assert.match(worker, /Cache-Control/);
    assert.match(worker, /ignoreSearch:\s*true/);
    assert.match(worker, /Response\.error\(\)/);
    assert.doesNotMatch(worker, /faith-focus-proxy|accounts\.google\.com|gist\.github\.com/i);
});

test('the worker keeps previous open app tabs safe during an update', () => {
    assert.match(worker, /Deliberately do not call skipWaiting/);
    assert.match(worker, /self\.clients\.claim\(\)/);
    assert.match(worker, /cacheName\.startsWith\(CACHE_PREFIX\)/);
});
