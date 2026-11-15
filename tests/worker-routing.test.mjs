import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../worker.js';

const PEPPER = 'worker-routing-test-secret-with-at-least-32-characters';

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
    RECOVERY_PEPPER: PEPPER,
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
        'X-Device-Session': 's'.repeat(43)
      }
    }
  ), {
    RECOVERY_PEPPER: PEPPER,
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
    RECOVERY_PEPPER: PEPPER,
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
        'X-Write-Token': 'w'.repeat(43),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ vaultId: 'e'.repeat(64) })
    }
  ), {
    RECOVERY_PEPPER: PEPPER,
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
        'X-Write-Token': 'w'.repeat(43),
        'X-Legacy-Username': username,
        'Content-Type': 'application/json'
      },
      body: '{}'
    }
  ), {
    RECOVERY_PEPPER: PEPPER,
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
