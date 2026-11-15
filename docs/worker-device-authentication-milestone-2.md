# Worker / Durable Object Device Authentication — Milestone 2

**Status:** draft implementation on \`security/worker-device-auth\`. Not merged into \`main\` and not deployed.

## Scope

This milestone adds a server-verified device challenge and short-lived device session while preserving the current local-first data model and all existing sync triggers. It is an authentication transition only; event-driven synchronization is a later milestone.

## Authentication path

1. The browser looks up the username and receives the account's PBKDF2 salt/iteration settings.
2. The browser performs the existing 600,000-iteration PBKDF2 derivation locally. The plaintext account passphrase is not sent to the Worker, and the Worker does not run PBKDF2.
3. The browser sends its derived vault write credential to \`/account/unlock\`. Before routing to the per-vault \`VaultCoordinator\`, the Worker asks \`AccountRegistry\` to prove that the Vault ID belongs to an account. It only calls the Coordinator after that check succeeds.
4. After the Coordinator accepts the derived write credential, the Worker returns a short-lived, HMAC-signed vault-membership ticket. The ticket is an edge-routing attestation, not a data-access credential.
5. The browser creates or retrieves its non-exportable P-256 device key in the separate IndexedDB device-identity store.
6. The browser requests \`/vault/{vaultId}/device/challenge\` with the membership ticket, account-derived write credential, device ID, and SPKI public key. The Worker validates request shape, public-key encoding/size, and the SHA-256 public-key fingerprint before invoking the Coordinator.
7. The Coordinator verifies the account-derived write credential, imports the P-256 public key, creates a cryptographically random challenge ID and nonce, and stores the challenge with its vault/device binding and 60-second expiry.
8. The browser signs the server-provided, domain-separated challenge message. It submits the challenge ID, device ID, and signature to \`/device/verify\`.
9. The Worker validates the exact request shape and base64url signature format/64-byte raw signature length before invoking the Coordinator. The Coordinator atomically reads and deletes the challenge, then checks expiry/bindings and verifies the signature with Web Crypto.
10. On success, the Coordinator registers the public key and issues a random 256-bit session token. Only SHA-256(token) is stored. The plaintext token is returned once to the authenticated client.
11. Ordinary vault \`claim\`, \`index\`, and \`day\` operations require the device session and membership ticket. The long-lived account-derived write credential is no longer sent with ordinary vault data requests.
12. The existing two-minute app inactivity lock stops synchronization, attempts explicit session revocation, and clears the in-memory session token. The server independently enforces a two-minute idle expiry and a 12-hour absolute expiry. Durable Object alarms purge expired session records if the client is offline or cannot complete explicit revocation.

## Challenge and session bounds

| Control | Current limit |
|---|---:|
| Device challenge lifetime | 60 seconds |
| Pending challenges per vault | 3 |
| Challenge creation | 5 per vault / minute |
| Challenge verification | 10 per vault / minute |
| Failed vault authentication | 12 per vault / minute |
| Enrolled devices per vault | 10 |
| Session idle expiry | 2 minutes |
| Session absolute expiry | 12 hours |
| Session revocation | Explicit endpoint; all sessions revoked on account credential rotation |

Challenges are consumed with a Durable Object storage transaction before signature validation. Thus an invalid signature also consumes the challenge, and concurrent submissions of the same challenge cannot both succeed. Expired challenges are rejected and removed. Device public-key registrations remain when a session expires, allowing the same device to re-authenticate with its persisted key.

Changing/resetting the account credential calls the Coordinator's internal token-rotation path, which revokes all extant device sessions but preserves registered public keys. The user must sign in again to obtain new sessions.

## Password hashing and CPU budget

The 600,000-iteration PBKDF2 derivation remains in \`assets/vault-crypto.js\` and executes in the browser. The Worker does not receive the plaintext passphrase and does not recompute PBKDF2. Lowering the client KDF iteration count would weaken account protection and would not reduce Worker CPU.

The edge Worker performs bounded request parsing, membership-ticket HMAC verification, and public-key fingerprint hashing. It intentionally does not import the P-256 key at the edge; the Coordinator imports the key before storing it and verifies the signature when consuming the challenge.

Web Crypto is used for SHA-256, HMAC, P-256 key import, and ECDSA verification. Cloudflare states Web Crypto is significantly faster than equivalent pure-JavaScript cryptographic work, but this does not guarantee a fixed sub-millisecond operation or prove that every full request remains below 10 ms. Measure the actual Worker and Durable Object invocation CPU after deployment using Workers Logs/Observability or trace events. GitHub Actions/Node tests validate correctness and replay behavior, not Cloudflare production CPU time.

References:
- [Cloudflare Web Crypto API](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare Workers limits and CPU profiling guidance](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Object storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

## Free-plan edge rate limiting — required before production

The application currently uses a \`workers.dev\` API hostname. Cloudflare describes \`workers.dev\` as a Free website hostname intended for personal or hobby projects and recommends a Workers route or Custom Domain for production. Configurable zone-level WAF rules require an API hostname in a Cloudflare zone that the account controls.

Before production, attach the Worker to a custom API hostname in a zone you control, then configure the single Free-plan rate-limiting rule to cover authentication and device-enrollment routes without throttling encrypted daily-data traffic.

Suggested Free-plan rate-limit rule:

**When incoming requests match**

\`\`\`text
starts_with(http.request.uri.path, "/account/")
or starts_with(http.request.uri.path, "/legacy-claim/")
or contains(http.request.uri.path, "/device/")
\`\`\`

**Suggested rule settings**
- Counting characteristic: source IP (the available Free-plan characteristic).
- Threshold: 20 requests in 10 seconds per source IP.
- Mitigation: Block for 10 seconds.
- Do not match \`/vault/{vaultId}/index\` or \`/vault/{vaultId}/day/{date}\`; those are ordinary authenticated encrypted-data routes.
- Do not use an interactive Managed Challenge as the normal action for JSON \`fetch()\` endpoints. A challenge page can replace the expected JSON response and break legitimate API calls.

Cloudflare Free WAF rate limiting supports path-based rule expressions and IP counting, with one rate-limiting rule. It cannot count by account ID or device ID. Account/vault-specific strict counters therefore remain in the Account Registry and per-vault Coordinator. Any Worker Rate Limiting API counters should be treated as approximate/local safeguards, not a globally strict quota.

References:
- [Cloudflare Free-plan rate-limiting rule availability](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare Rate Limiting API accuracy and strict-limit guidance](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare workers.dev guidance](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

## Legacy migration exception — explicitly constrained

Pre-registry legacy vaults were originally identified by a deterministic username-derived Vault ID. They do not yet have an Account Registry record, so the Worker cannot prove account-to-vault membership from the new registry before the first legacy credential check.

For that one-time migration only, the client now calls the dedicated \`/legacy-claim/{vaultId}\` route. The Worker:
- requires the normalized legacy username and a syntactically valid derived write credential;
- recomputes and checks the deterministic username-to-Vault-ID relationship before invoking any Durable Object;
- asks Account Registry to confirm that the username is not already registered and applies a per-username attempt limit;
- then asks the existing Coordinator to verify the actual legacy write credential.

**This is a narrow bootstrap exception, not equivalent to normal registry membership pre-validation.** A caller who guesses a valid username and its deterministic Vault ID can still cause the corresponding Coordinator to be invoked before the legacy credential is checked. The dedicated path exists so the Free-plan WAF rate-limit rule can apply IP throttling specifically to \`/legacy-claim/*\` without affecting normal vault claims. Do not enable public legacy migration until that edge rule is configured and tested. Once legacy migration succeeds, the account is recorded in Account Registry and future sign-ins use the normal membership-ticket path.

## KV and Durable Object resource protection

Device challenge, device verification, session revocation, claim, and internal admin routes do not initialize the daily packet index and therefore do not perform the KV index bootstrap read. Only \`/index\` and \`/day/{date}\` data paths require that bootstrap.

Account Registry maintains rolling per-subject attempt records. The per-vault Coordinator maintains rolling challenge, verification, and authentication-failure counters. The membership ticket and request schema are validated at the Worker before a client-controlled vault ID reaches its Coordinator.

The edge WAF rule remains necessary: server-side counters cannot prevent all requests from consuming the Worker request allowance before they reach the account registry or Coordinator.

## Compatibility and intentionally unchanged behavior

- Existing client PBKDF2 parameters and account recovery format are unchanged.
- Existing encrypted daily packet format, compression, Diary key, voice notes, Garden, local packet store, and conflict resolution are unchanged.
- Existing sync triggers remain unchanged for this milestone: login reconciliation, local-change debounce, online/foreground refresh, periodic refresh, and page-hide flush. They will only be removed in the later event-driven-sync milestone after the session layer is proven.
- No D1 binding or new database product has been introduced. The current KV and SQLite-backed Durable Object architecture remains in use.
- The code in this draft does not configure Cloudflare dashboard WAF rules or deploy the Worker.

## Validation coverage

The regression suite covers:
- account/vault membership rejection before Coordinator creation;
- absent membership ticket and malformed signature rejection before Coordinator invocation;
- deterministic legacy ID mismatch rejection before Account Registry or Coordinator access;
- successful P-256 challenge and session creation;
- two concurrent verification attempts on one challenge yielding only one successful session;
- invalid-signature challenge consumption and replay rejection;
- expired challenge consumption/rejection with no session creation;
- SHA-256-only session persistence;
- explicit revocation and post-revocation denial;
- two-minute idle cleanup via Durable Object alarm;
- session revocation on credential rotation;
- no packet-index KV bootstrap during authentication-only paths;
- existing encrypted packet, merge, local-first, and conflict regression tests.

**Production gate:** all repository CI must pass on the exact proposed commit, the WAF IP rule must be configured and tested on the custom API hostname, and actual Worker/DO CPU usage must be measured before deployment.
