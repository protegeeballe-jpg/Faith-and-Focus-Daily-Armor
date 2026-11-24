/*
 * Faith & Focus: Daily Armor — offline app shell
 *
 * Cache only the app's own static files and HTML pages. Checklist data,
 * Diary records, voice-note data, authentication material, and cloud-sync
 * responses remain in their existing local stores / network flows.
 *
 * When the cache list or its behavior changes, increment CACHE_NAME so the
 * old shell is retired cleanly after the new worker activates.
 */
const CACHE_NAME = 'faith-focus-shell-v43-offline-repair';
const CACHE_PREFIX = 'faith-focus-';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE_URLS = [
    './',
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
    './assets/mobile.css',

    './assets/app.js',
    './assets/guide-quotes.js',
    './assets/missed-card-notifications.js',
    './assets/device-clock.js',
    './assets/garden.js',
    './assets/settings-modal.js',
    './assets/trusted-devices.js',
    './assets/vault-crypto.js',
    './assets/vault-storage.js',
    './assets/vault-sync.js',
    './assets/backup-import-transaction.js',
    './assets/daily-merge.js',
    './assets/daily-reset.js',
    './assets/vault-session.js',
    './assets/device-identity.js',
    './assets/local-backup.js',
    './assets/service-worker-registration.js',
    './assets/location-checkin.js',
    './assets/garden-model.js',
    './assets/writing-security.js',
    './assets/diary-archive.js',
    './assets/private-writing-migration.js',
    './assets/voice-note-store.js',
    './assets/compressor.js',
    './assets/mobile-diary-tabs.js',

    './assets/garden-room-background.jpg',
    './assets/icon.png'
];

async function precacheAppShell() {
    const cache = await caches.open(CACHE_NAME);
    const scopeUrl = new URL(self.registration.scope);

    // Fetch the complete shell before writing it to the cache. A missing
    // required file fails installation rather than creating a partial shell.
    const responses = await Promise.all(PRECACHE_URLS.map(async (path) => {
        const url = new URL(path, scopeUrl).href;
        const response = await fetch(url, { cache: 'reload' });

        if (!response.ok || response.type === 'opaque') {
            throw new Error('Unable to precache ' + url + ' (HTTP ' + response.status + ')');
        }

        const responseUrl = new URL(response.url || url);
        if (responseUrl.origin !== scopeUrl.origin ||
            !responseUrl.pathname.startsWith(scopeUrl.pathname)) {
            throw new Error('Precache response left the application scope: ' + url);
        }

        return [url, response];
    }));

    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
}

self.addEventListener('install', (event) => {
    event.waitUntil(precacheAppShell());

    // Deliberately do not call skipWaiting(). An update waits until existing
    // app tabs close, avoiding a new worker taking over an older open UI.
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();

        await Promise.all(cacheNames.map((cacheName) => {
            const isOurOldCache = cacheName.startsWith(CACHE_PREFIX) &&
                cacheName !== CACHE_NAME;

            return isOurOldCache ? caches.delete(cacheName) : Promise.resolve(false);
        }));

        await self.clients.claim();
    })());
});

function isWithinAppScope(url) {
    const scopeUrl = new URL(self.registration.scope);
    return url.origin === scopeUrl.origin &&
        url.pathname.startsWith(scopeUrl.pathname);
}

function isStaticAppAsset(url) {
    const scopeUrl = new URL(self.registration.scope);
    const pathWithinScope = url.pathname.slice(scopeUrl.pathname.length);

    // Keep this limited to the static app bundle and its web app manifest.
    // API calls, cloud backups, and user-generated content are not cacheable.
    return pathWithinScope === 'manifest.json' ||
        pathWithinScope.startsWith('assets/');
}

async function fetchWithTimeout(request) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    try {
        return await fetch(request, {
            cache: 'no-cache',
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

function isSafeAppResponse(request, response) {
    if (!response.ok || response.type === 'opaque') return false;
    if (response.headers.get('Cache-Control')?.toLowerCase().includes('no-store')) {
        return false;
    }

    const scopeUrl = new URL(self.registration.scope);
    const responseUrl = new URL(response.url || request.url);

    return responseUrl.origin === scopeUrl.origin &&
        responseUrl.pathname.startsWith(scopeUrl.pathname);
}

async function cacheFirst(request, isNavigation, event) {
    // Return the installed shell immediately. Refresh it in the background so
    // slow connections cannot hold a cached navigation or app module hostage.
    const cachePromise = caches.open(CACHE_NAME);
    const refreshPromise = fetchWithTimeout(request).then(async (response) => {
        if (isSafeAppResponse(request, response)) {
            try {
                const cache = await cachePromise;
                await cache.put(request, response.clone());
            } catch (cacheError) {
                // An unavailable/full cache must not prevent online use.
                console.warn('[Faith & Focus] Could not update the offline cache.', cacheError);
            }
        }
        return response;
    }).catch(() => null);

    // Keep the refresh alive after the cached response has been returned.
    if (event && typeof event.waitUntil === 'function') {
        event.waitUntil(refreshPromise.then(() => undefined));
    }

    const cache = await cachePromise;
    const savedResponse = await cache.match(request, { ignoreSearch: true });
    if (savedResponse) return savedResponse;

    const response = await refreshPromise;
    if (response?.ok) return response;

    if (isNavigation) {
        const offlineHome = await cache.match(
            new URL('./index.html', self.registration.scope).href
        );
        if (offlineHome) return offlineHome;
    }

    return response || Response.error();
}

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Never intercept writes, cross-origin requests, or requests outside this
    // GitHub Pages app path. This keeps Google/Gist/Worker sync network-only.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!isWithinAppScope(url)) return;

    if (request.mode === 'navigate') {
        event.respondWith(cacheFirst(request, true, event));
        return;
    }

    if (isStaticAppAsset(url)) {
        event.respondWith(cacheFirst(request, false, event));
    }
});
