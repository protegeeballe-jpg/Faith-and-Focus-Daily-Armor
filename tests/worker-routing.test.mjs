import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import worker from '../worker.js';

const PEPPER = 'worker-routing-test-secret-with-at-least-32-characters';

function makeEdgeLimiters({ auth = true, sensitive = true, vault = true, write = true, throws = [] } = {}) {
  const calls = [];
  const create = (name, success) => ({
    async limit({ key }) {
      calls.push({ name, key });
      if (throws.includes(name)) throw new Error("simulated edge limiter failure");
      return { success };
    }
  });
  return {
    calls,
    EDGE_RATE_LIMIT_PEPPER: PEPPER,
    AUTH_IP_RATE_LIMITER: create("auth", auth),
    SENSITIVE_IP_RATE_LIMITER: create("sensitive", sensitive),
    VAULT_ACCOUNT_RATE_LIMITER: create("vault", vault),
    VAULT_WRITE_ACCOUNT_RATE_LIMITER: create("write", write)
  };
}

async function membershipTicket(vaultId) {
  const encodedPayload = Buffer.from(JSON.stringify({
    version: 1,
    vaultId,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000
  })).toString('base64url');
  const key = await webcrypto.subtle.importKey(
    'raw', Buffer.from(PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode('FaithFocus|vault-membership|v1|' + encodedPayload)
  ));
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  return encodedPayload + '.' + hex;
}

test('vault PUT requests forward their JSON body to the Durable Object', async () => {
  const vaultId = 'a'.repeat(64);
  const payload = {
    packet: {
      format: 'faith-focus-encrypted-daily-packet',
      version: 1,
      dateString: '2026-11-13',
      algorithm: 'AES-256-GCM',
      compression: 'none',
      iv: 'AAAAAAAAAAAAAAAA',
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA=='
    },
    baseUpdatedAt: null
  };
  const expectedBody = JSON.stringify(payload);
  const ticket = await membershipTicket(vaultId);
  let forwarded = null;

  const env = {
    ...makeEdgeLimiters(),
    RECOVERY_PEPPER: PEPPER,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName: id => id,
      get: id => ({
        fetch: async request => {
          forwarded = {
            method: request.method,
            body: await request.text(),
            contentType: request.headers.get('Content-Type'),
            vaultId: request.headers.get('X-Vault-Id'),
            sessionToken: request.headers.get('X-Device-Session')
          };
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    }
  };

  const request = new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/day/2026-11-13',
    {
      method: 'PUT',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '203.0.113.44',
        'X-Vault-Membership': ticket,
        'X-Device-Session': 's'.repeat(43),
        'Content-Type': 'application/json',
        'X-Base-Updated-At': 'none'
      },
      body: expectedBody
    }
  );

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, {
    method: 'PUT',
    body: expectedBody,
    contentType: 'application/json',
    vaultId,
    sessionToken: 's'.repeat(43)
  });
});


test('Worker rejects missing membership tickets before creating a vault coordinator', async () => {
  let coordinatorTouched = false;
  const vaultId = 'b'.repeat(64);
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/index',
    {
      method: 'GET',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '203.0.113.44',
        'X-Device-Session': 's'.repeat(43)
      }
    }
  ), {
    ...makeEdgeLimiters(),
    RECOVERY_PEPPER: PEPPER,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 403);
  assert.equal(coordinatorTouched, false);
});

test('Worker rejects malformed ECDSA signatures before invoking the vault coordinator', async () => {
  const vaultId = 'c'.repeat(64);
  const ticket = await membershipTicket(vaultId);
  let coordinatorTouched = false;
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/device/verify',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '203.0.113.44',
        'X-Vault-Membership': ticket,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        challengeId: 'c'.repeat(43),
        deviceId: 'd'.repeat(43),
        signature: 'not-a-valid-p256-signature'
      })
    }
  ), {
    ...makeEdgeLimiters(),
    RECOVERY_PEPPER: PEPPER,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 400);
  assert.equal(coordinatorTouched, false);
});


test('account unlock checks registry membership before waking a vault coordinator', async () => {
  let coordinatorTouched = false;
  let registryPath = null;
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/account/unlock',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '203.0.113.44',
        'X-Write-Token': 'w'.repeat(43),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ vaultId: 'e'.repeat(64) })
    }
  ), {
    ...makeEdgeLimiters(),
    RECOVERY_PEPPER: PEPPER,
    MEMBERSHIP_PEPPER: PEPPER,
    ACCOUNT_REGISTRY: {
      idFromName: () => 'global-account-registry',
      get: () => ({
        fetch: async request => {
          registryPath = new URL(request.url).pathname;
          return new Response(JSON.stringify({ error: 'not registered' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    },
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 401);
  assert.equal(registryPath, '/vault-membership');
  assert.equal(coordinatorTouched, false);
});


test('legacy claims use a separate route and reject a username-to-vault mismatch before Durable Object access', async () => {
  const username = 'legacy.family';
  const wrongVaultId = 'a'.repeat(64);
  let registryTouched = false;
  let coordinatorTouched = false;
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/legacy-claim/' + wrongVaultId,
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '203.0.113.44',
        'X-Write-Token': 'w'.repeat(43),
        'X-Legacy-Username': username,
        'Content-Type': 'application/json'
      },
      body: '{}'
    }
  ), {
    ...makeEdgeLimiters(),
    RECOVERY_PEPPER: PEPPER,
    MEMBERSHIP_PEPPER: PEPPER,
    ACCOUNT_REGISTRY: {
      idFromName() { registryTouched = true; return 'global-account-registry'; },
      get() {
        registryTouched = true;
        return { fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) };
      }
    },
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 400);
  assert.equal(registryTouched, false);
  assert.equal(coordinatorTouched, false);
});


test('Worker fails closed when the independent membership signing secret is missing', async () => {
  const vaultId = 'f'.repeat(64);
  const ticket = await membershipTicket(vaultId);
  let coordinatorTouched = false;
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/index',
    {
      method: 'GET',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '203.0.113.44',
        'X-Vault-Membership': ticket,
        'X-Device-Session': 's'.repeat(43)
      }
    }
  ), {
    // Recovery pepper alone must not be reused to sign membership tickets.
    ...makeEdgeLimiters(),
    RECOVERY_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 503);
  assert.equal(coordinatorTouched, false);
});


test('sensitive account routes are edge-limited before reading a request body', async () => {
  const limiters = makeEdgeLimiters({ sensitive: false });
  let registryTouched = false;
  const request = new Request('https://faith-focus-proxy.nine-westhigh.workers.dev/account/signup', {
    method: 'POST',
    headers: {
      Origin: 'https://protegeeballe-jpg.github.io',
      'X-App-Client': 'faith-focus-daily-armor-web/1',
      'CF-Connecting-IP': '198.51.100.77',
      'Content-Type': 'application/json',
      'Content-Length': String(1024 * 1024 + 1)
    },
    body: 'x'.repeat(1024 * 1024 + 1)
  });
  const response = await worker.fetch(request, {
    ...limiters,
    MEMBERSHIP_PEPPER: PEPPER,
    ACCOUNT_REGISTRY: {
      idFromName() { registryTouched = true; return 'global-account-registry'; },
      get() { registryTouched = true; throw new Error('account registry must not be reached'); }
    },
    VAULT_COORDINATOR: {}
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(registryTouched, false);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth', 'sensitive']);
  assert.ok(limiters.calls.every(call => !call.key.includes('198.51.100.77')));
});

test('the edge IP key requires CF-Connecting-IP and never falls back to X-Forwarded-For', async () => {
  const limiters = makeEdgeLimiters();
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/account/recover',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'X-Forwarded-For': '198.51.100.88',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ questionAnswers: [] })
    }
  ), {
    ...limiters,
    MEMBERSHIP_PEPPER: PEPPER,
    ACCOUNT_REGISTRY: {},
    VAULT_COORDINATOR: {}
  });

  assert.equal(response.status, 503);
  assert.equal(limiters.calls.length, 0);
});

test('edge limiter failures fail closed before a vault Durable Object is reached', async () => {
  const limiters = makeEdgeLimiters({ throws: ['auth'] });
  let coordinatorTouched = false;
  const vaultId = 'd'.repeat(64);
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/index',
    {
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.99'
      }
    }
  ), {
    ...limiters,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 503);
  assert.equal(coordinatorTouched, false);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth']);
});

test('Cloudflare native edge rate-limit bindings are configured with supported minute windows', () => {
  const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  for (const [name, limit] of [
    ['AUTH_IP_RATE_LIMITER', 120],
    ['SENSITIVE_IP_RATE_LIMITER', 5],
    ['VAULT_ACCOUNT_RATE_LIMITER', 120],
    ['VAULT_WRITE_ACCOUNT_RATE_LIMITER', 20]
  ]) {
    const start = wrangler.indexOf('name = "' + name + '"');
    assert.ok(start >= 0, 'Missing binding ' + name);
    const section = wrangler.slice(start);
    assert.match(section, new RegExp('limit = ' + limit + '\\s+period = 60'));
  }
  assert.equal((wrangler.match(/\[\[ratelimits\]\]/g) || []).length, 4);
});


test('authenticated vault edge limits key by vault ID instead of shared client IP', async () => {
  const limiters = makeEdgeLimiters();
  const vaultId = 'e'.repeat(64);
  const ticket = await membershipTicket(vaultId);
  const dateString = '2026-11-13';
  const packet = {
    format: 'faith-focus-encrypted-daily-packet',
    version: 1,
    dateString,
    algorithm: 'AES-256-GCM',
    compression: 'none',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA=='
  };
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/day/' + dateString,
    {
      method: 'PUT',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.121',
        'X-Vault-Membership': ticket,
        'X-Device-Session': 's'.repeat(43),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ packet, baseUpdatedAt: null })
    }
  ), {
    ...limiters,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName: () => vaultId,
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ ok: true, updatedAt: '2026-11-13T00:00:00.000Z' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      })
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth', 'vault', 'write']);
  const vaultChecks = limiters.calls.filter(call => call.name === 'vault' || call.name === 'write');
  assert.deepEqual(vaultChecks, [
    { name: 'vault', key: 'vault:v1:' + vaultId },
    { name: 'write', key: 'vault-write:v1:' + vaultId }
  ]);
  assert.ok(vaultChecks.every(call => !call.key.includes('198.51.100.121')));
});


test('random vault IDs are IP-limited before membership verification and do not consume vault buckets', async () => {
  const limiters = makeEdgeLimiters({ auth: false });
  let coordinatorTouched = false;
  const vaultId = '9'.repeat(64);
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/index',
    {
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.129'
      }
    }
  ), {
    ...limiters,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });

  assert.equal(response.status, 429);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth']);
  assert.equal(coordinatorTouched, false);
});

test('unknown POST routes are rate-limited and rejected before body parsing', async () => {
  const limiters = makeEdgeLimiters();
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/not-a-real-route',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.130'
      },
      body: 'not-json'
    }
  ), { ...limiters, MEMBERSHIP_PEPPER: PEPPER });

  assert.equal(response.status, 404);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth']);
});

test('unsupported methods are rejected before body parsing and after ingress limiting', async () => {
  const limiters = makeEdgeLimiters();
  const vaultId = '8'.repeat(64);
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + vaultId + '/index',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.131'
      },
      body: 'not-json'
    }
  ), { ...limiters, MEMBERSHIP_PEPPER: PEPPER });

  assert.equal(response.status, 405);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth']);
});


test('edge limiter test fixtures do not silently satisfy membership secret configuration', () => {
  assert.equal('MEMBERSHIP_PEPPER' in makeEdgeLimiters(), false);
});


test('Worker fails closed when the independent edge rate-limit secret is missing', async () => {
  const env = makeEdgeLimiters();
  delete env.EDGE_RATE_LIMIT_PEPPER;
  let coordinatorTouched = false;
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/vault/' + 'f'.repeat(64) + '/index',
    {
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.210'
      }
    }
  ), {
    ...env,
    MEMBERSHIP_PEPPER: PEPPER,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName() { coordinatorTouched = true; throw new Error('must not create coordinator'); },
      get() { coordinatorTouched = true; throw new Error('must not wake coordinator'); }
    }
  });
  assert.equal(response.status, 503);
  assert.equal(coordinatorTouched, false);
});


test('sign-in fails with a configuration response when membership signing secret is missing', async () => {
  let registryTouched = false;
  const env = {
    ...makeEdgeLimiters(),
    ACCOUNT_REGISTRY: {
      idFromName() { registryTouched = true; return 'global-account-registry'; },
      get() { registryTouched = true; throw new Error('registry must not be reached'); }
    },
    VAULT_COORDINATOR: {}
  };
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/account/signin',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.211',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({username:'known.family'})
    }
  ), env);

  assert.equal(response.status, 503);
  assert.equal(registryTouched, false);
});


test('account registry routes receive a shared per-location ceiling in addition to per-IP ingress limiting', async () => {
  const limiters = makeEdgeLimiters();
  const response = await worker.fetch(new Request(
    'https://faith-focus-proxy.nine-westhigh.workers.dev/account/signin',
    {
      method: 'POST',
      headers: {
        Origin: 'https://protegeeballe-jpg.github.io',
        'X-App-Client': 'faith-focus-daily-armor-web/1',
        'CF-Connecting-IP': '198.51.100.212',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({username:'registry.probe'})
    }
  ), {
    ...limiters,
    MEMBERSHIP_PEPPER: PEPPER,
    ACCOUNT_REGISTRY: {},
    VAULT_COORDINATOR: {}
  });

  assert.equal(response.status, 503);
  assert.deepEqual(limiters.calls.map(call => call.name), ['auth', 'auth']);
  assert.equal(limiters.calls[1].key, 'account-registry-global:v1');
});
