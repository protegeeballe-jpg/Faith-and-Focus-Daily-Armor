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
  // Local runs may omit the optional browser package. CI installs it explicitly.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

test('Chromium renders hydration, 4–2–6 breathing, and live cloud selection', {
  skip: chromium ? false : 'Playwright is not installed in this environment'
}, async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const filePath = path.resolve(root, '.' + pathname);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(content);
    } catch {
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
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1200 },
      reducedMotion: 'no-preference'
    });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/tests/guide-player-browser.html`);
    await page.waitForFunction(() => window.__guidePlayerBrowserResult?.ready === true, null, {
      timeout: 15000
    });

    const result = await page.evaluate(() => window.__guidePlayerBrowserResult);
    assert.equal(result.error, undefined, result.error || 'Browser smoke test failed.');
    assert.deepEqual(pageErrors, [], 'The browser reported an uncaught page error.');
    assert.equal(result.hydrationAnimation, 'wgi-drink-reach');
    assert.equal(result.hydrationMoved, true);
    assert.ok(result.breathingScales.inhale > result.breathingScales.resting);
    assert.ok(result.cloudTransforms.cumulus !== 'none');
    assert.ok(result.cloudTransforms.stratus !== result.cloudTransforms.cumulus);
    assert.equal(result.cloudIdleAnimation, 'wgi-cloud-drift');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
