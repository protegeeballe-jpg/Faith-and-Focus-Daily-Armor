# Device Authentication Foundation

**Status:** foundational client module only; not yet connected to Worker routes or enabled for vault synchronization.

## Scope

\`assets/device-identity.js\` provides persistent browser-side signing-key storage. It deliberately does not contact Cloudflare, issue a session, enroll a device, or start synchronization. This separation prevents the client from treating a locally generated key as trusted before the server verifies the account credential and one-time challenge.

## Device key lifecycle

1. Call \`getOrCreateDeviceIdentity()\` only after the user's existing account passphrase has been accepted and the account vault has been unlocked.
2. The module generates an ECDSA P-256 key pair using Web Crypto. The private key is non-extractable and has only the \`sign\` usage. The public key is exported as SubjectPublicKeyInfo (SPKI).
3. The public-key fingerprint is \`base64url(SHA-256(SPKI))\`; it is the stable device identifier. The public key and private \`CryptoKey\` are saved together in IndexedDB.
4. The IndexedDB transaction is read-before-add and serialized by the browser's read-write transaction. Concurrent tabs therefore reuse the winner rather than silently replacing each other's key.
5. The module reads the record back from storage and validates the schema, curve, private-key extractability, public-key fingerprint, and key-pair correspondence before returning it.
6. \`signDeviceMessage()\` signs only a bounded, caller-supplied challenge message. The caller is responsible for including the server-defined domain, account, challenge ID, nonce, expiry context, and protocol version in that message.

## Browser data clearing and recovery

Browsers do not provide a reliable page event notifying an application that a user or privacy extension has cleared a particular IndexedDB database. The supported detection point is the next authenticated login:

- **No record:** treat the browser profile as a new device. Generate and persist a new key, then require a fresh server challenge and device enrollment before any cloud sync.
- **Valid record:** reuse the persisted key and require a fresh server challenge for the current login/session.
- **Corrupt or unsupported record:** fail closed. Do not silently replace it during the same attempt and do not start network synchronization. Ask the user to complete a fresh account sign-in/recovery flow before establishing a new device identity.
- **IndexedDB unavailable, blocked, or over quota:** do not fall back to \`localStorage\`, session storage, cookies, or an in-memory key. Stop enrollment and explain that persistent site storage must be enabled.

A site-data clear may also delete the separate local daily-packet database. If only the device-identity database is cleared, local encrypted packets may still exist. The later sync implementation must reconcile those packets using the existing conditional-write and merge rules; it must not assume that a new device key means an empty local account.

A replacement key has a different public-key fingerprint and must be enrolled as a new device by the Worker. Server-side device revocation/management is a separate follow-up requirement; this client module cannot revoke a previously enrolled public key by itself.

## Security boundaries

- The private key is not exported, serialized to JSON, or stored in \`localStorage\`.
- The public key is not a secret. The account credential and server-side challenge verification are still required for enrollment.
- A non-extractable browser key is not a hardware-backed key. Same-origin malicious script may still ask the browser to use it, so Content Security Policy, output handling, and endpoint authorization remain important.
- A missing local key is not proof that a user is malicious; browser profiles, private browsing, storage cleanup, and device replacement naturally produce new identities.
- The module must not be connected to \`startVaultSync()\` until Worker-side challenge consumption, device registration, time-limited sessions, and session authorization are deployed and tested together.

## Worker CPU budget

Cloudflare documents that Workers Web Crypto is substantially faster than performing cryptographic operations in JavaScript. This supports using \`crypto.subtle.verify()\` for P-256 signature verification, but it does **not** guarantee a fixed sub-millisecond cost or prove that the complete request will fit inside the Free plan's 10 ms CPU limit. Request parsing, base64 decoding, key import, hashing, authorization checks, and application code also consume CPU. Measure actual deployed Worker CPU time and keep a safety margin; Cloudflare's documentation describes typical Workers and authentication-heavy requests as potentially exceeding 10 ms.

## Required server-side follow-up before activation

- Authenticate the account before creating a vault Durable Object for a client-supplied vault ID.
- Issue cryptographically random challenges with a short expiry, account/device binding, and one-time consumption enforced in a serialized Durable Object operation.
- Verify the ECDSA P-256 signature with \`crypto.subtle.verify()\` on the Worker side.
- Limit the number and lifetime of pending challenges and enrolled devices.
- Issue opaque, high-entropy, time-limited session tokens only after successful verification; store token hashes rather than plaintext tokens.
- Bind each session to the account and device key; enforce revocation, expiry, and per-account request/byte budgets server-side.
- Authorize sync routes only with a valid device session. Do not continue accepting the long-lived account-derived write token as a general-purpose vault API credential after the migration is complete.
- Ensure a single successful handshake produces one bounded sync authorization; remove periodic refresh, focus/visibility refresh, online-event sync, and debounce-triggered cloud pushes when the event-driven sync migration is ready.
- Retain encrypted local packets and existing conflict handling on 401, 409, 429, offline, and expired-session outcomes.

## Tests

\`tests/device-identity.test.mjs\` covers missing-key detection, key persistence/reuse, non-extractable private-key properties, signature verification, a new identity after simulated storage loss, corrupted-record fail-closed behavior, unavailable IndexedDB, and invalid signing input.
