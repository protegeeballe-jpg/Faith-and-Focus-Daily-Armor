const APP_ORIGIN = "https://protegeeballe-jpg.github.io";
const APP_CLIENT = "faith-focus-daily-armor-web/1";
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_VOICE_NOTE_CHUNK_CHARS = 256 * 1024;
const MAX_VOICE_NOTE_CHUNKS = 100;
const MAX_VOICE_NOTE_CIPHERTEXT_LENGTH = Math.ceil((16 * 1024 * 1024 + 16) / 3) * 4;
const MAX_PACKET_CIPHERTEXT_BYTES = 700 * 1024 + 16;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VAULT_ID_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PACKET_FORMAT = "faith-focus-encrypted-daily-packet";
const encoder = new TextEncoder();

const LEGACY_VAULT_ID_DOMAIN = "FaithFocus|VaultID|v1|";
const MEMBERSHIP_TICKET_TTL_MS = 12 * 60 * 60 * 1000;
const DEVICE_CHALLENGE_TTL_MS = 60 * 1000;
const DEVICE_SESSION_IDLE_MS = 2 * 60 * 1000;
const DEVICE_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
const MAX_DEVICES_PER_VAULT = 10;
const KV_WRITE_SPACING_BUCKET_COUNT = 32;
const MAX_PENDING_DEVICE_CHALLENGES = 3;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Invalid base64url value.");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function createVaultMembershipTicket(vaultId, pepper) {
  if (!VAULT_ID_PATTERN.test(vaultId || "")
      || typeof pepper !== "string" || pepper.length < 32) {
    throw new Error("Vault membership signing is not configured.");
  }
  const payload = {
    version: 1,
    vaultId,
    expiresAt: Date.now() + MEMBERSHIP_TICKET_TTL_MS
  };
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmacHex(
    pepper,
    "FaithFocus|vault-membership|v1|" + encodedPayload
  );
  return encodedPayload + "." + signature;
}

async function verifyVaultMembershipTicket(ticket, vaultId, pepper) {
  if (typeof ticket !== "string" || ticket.length > 1024
      || typeof pepper !== "string" || pepper.length < 32) return false;
  const parts = ticket.split(".");
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return false;

  let payload;
  try {
    const expected = await hmacHex(
      pepper,
      "FaithFocus|vault-membership|v1|" + parts[0]
    );
    if (!constantTimeEqual(expected, parts[1])) return false;
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
  } catch {
    return false;
  }

  const now = Date.now();
  return Boolean(payload && payload.version === 1
    && payload.vaultId === vaultId
    && Number.isSafeInteger(payload.expiresAt)
    && payload.expiresAt > now
    && payload.expiresAt <= now + MEMBERSHIP_TICKET_TTL_MS + 30_000);
}

async function validateDevicePublicKey(publicKeySpki, deviceId) {
  if (!DEVICE_ID_PATTERN.test(deviceId || "")
      || typeof publicKeySpki !== "string"
      || publicKeySpki.length < 80 || publicKeySpki.length > 180) return false;
  try {
    const spki = fromBase64Url(publicKeySpki);
    // Validate the public key encoding and fingerprint.
    if (spki.byteLength < 64 || spki.byteLength > 128) return false;
    const digest = await sha256Bytes(spki);
    return constantTimeEqual(encodeBase64Url(digest), deviceId);
  } catch {
    return false;
  }
}

function jsonResponse(body, status, origin = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  });
  if (origin === APP_ORIGIN) headers.set("Access-Control-Allow-Origin", APP_ORIGIN);
  return new Response(JSON.stringify(body), { status, headers });
}

function rateLimitedJsonResponse(message, origin = null) {
  const response = jsonResponse({ error: message }, 429, origin);
  response.headers.set("Retry-After", "60");
  return response;
}

export function getKvWriteSpacingBucket(key) {
  const value = String(key ?? "");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % KV_WRITE_SPACING_BUCKET_COUNT;
}

function getEdgeRateLimitPolicy(request) {
  const { pathname } = new URL(request.url);

  const accountRoute = /^\/account\/(signup|migrate-legacy|signin|unlock|recover|complete-recovery)$/.exec(pathname);
  if (accountRoute) {
    const route = accountRoute[1];
    const sensitive = ["signup", "migrate-legacy", "recover", "complete-recovery"].includes(route);
    return { ipLimited: true, accountRegistry: true, sensitiveRoute: sensitive ? "account:" + route : null };
  }

  if (/^\/legacy-claim\/[a-f0-9]{64}$/.test(pathname)) {
    return { ipLimited: true, accountRegistry: true, sensitiveRoute: "legacy-claim" };
  }

  const vaultRoute = /^\/vault\/[a-f0-9]{64}\/(claim|index|day\/\d{4}-\d{2}-\d{2}|device\/challenge|device\/verify|device\/session\/revoke|device\/list|device\/remove)$/.exec(pathname);
  if (vaultRoute) {
    const resource = vaultRoute[1];
    const sensitiveRoute = resource === "device/challenge" ? "device:challenge"
      : resource === "device/verify" ? "device:verify"
        : null;
    return { ipLimited: true, sensitiveRoute };
  }

  return { ipLimited: true, unmatched: true };
}

async function enforceEdgeRateLimits(request, env, origin) {
  const policy = getEdgeRateLimitPolicy(request);
  if (!policy.ipLimited) return null;

  // Cloudflare supplies CF-Connecting-IP for direct Worker requests.
  // Never trust X-Forwarded-For or a client-supplied proxy chain.
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  if (!clientIp || clientIp.length > 64 || /[\s,]/.test(clientIp)
      || !/^[0-9a-fA-F:.]+$/.test(clientIp)) {
    return jsonResponse({ error: "The client network identity is unavailable. Please retry." }, 503, origin);
  }

  const pepper = env.EDGE_RATE_LIMIT_PEPPER;
  if (typeof pepper !== "string" || pepper.length < 32) {
    return jsonResponse({ error: "Independent edge rate-limiting security is not configured." }, 503, origin);
  }

  let ipDigest;
  try {
    ipDigest = await hmacHex(pepper, "FaithFocus|edge-rate-limit-ip|v1|" + clientIp);
  } catch {
    return jsonResponse({ error: "Edge rate-limiting security is temporarily unavailable." }, 503, origin);
  }

  const checks = [[env.AUTH_IP_RATE_LIMITER, "ingress:v1:" + ipDigest]];
  if (policy.sensitiveRoute) {
    checks.push([env.SENSITIVE_IP_RATE_LIMITER, "sensitive:v1:" + policy.sensitiveRoute + ":" + ipDigest]);
  }
  if (policy.accountRegistry) {
    // Cap distributed requests to the single serialized registry per Cloudflare location.
    checks.push([env.AUTH_IP_RATE_LIMITER, "account-registry-global:v1"]);
  }

  for (const [binding, key] of checks) {
    if (!binding || typeof binding.limit !== "function") {
      return jsonResponse({ error: "Edge rate-limiting service is not configured." }, 503, origin);
    }
    let result;
    try {
      result = await binding.limit({ key });
    } catch {
      return jsonResponse({ error: "Edge rate-limiting service is temporarily unavailable." }, 503, origin);
    }
    if (!result || typeof result.success !== "boolean") {
      return jsonResponse({ error: "Edge rate-limiting service returned an invalid response." }, 503, origin);
    }
    if (!result.success) {
      return rateLimitedJsonResponse("Too many requests from this network. Please wait before trying again.", origin);
    }
  }

  return null;
}

async function enforceVaultAccountRateLimits(vaultId, isWrite, env, origin, isVoiceNoteWrite = false) {
  const checks = [[env.VAULT_ACCOUNT_RATE_LIMITER, "vault:v1:" + vaultId]];
  if (isWrite) {
    checks.push(isVoiceNoteWrite
      ? [env.VOICE_NOTE_WRITE_ACCOUNT_RATE_LIMITER, "voice-note-write:v1:" + vaultId]
      : [env.VAULT_WRITE_ACCOUNT_RATE_LIMITER, "vault-write:v1:" + vaultId]);
  }

  for (const [binding, key] of checks) {
    if (!binding || typeof binding.limit !== "function") {
      return jsonResponse({ error: "Edge rate-limiting service is not configured." }, 503, origin);
    }
    let result;
    try {
      result = await binding.limit({ key });
    } catch {
      return jsonResponse({ error: "Edge rate-limiting service is temporarily unavailable." }, 503, origin);
    }
    if (!result || typeof result.success !== "boolean") {
      return jsonResponse({ error: "Edge rate-limiting service returned an invalid response." }, 503, origin);
    }
    if (!result.success) {
      return rateLimitedJsonResponse("Too many requests for this account. Please wait before trying again.", origin);
    }
  }

  return null;
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validVoiceNoteId(id, dateString) {
  return typeof id === "string" && new RegExp("^" + dateString + "-[a-f0-9]{32}$").test(id);
}

function validVoiceNoteChunkUpload(payload, dateString, id, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || Object.keys(payload).sort().join(",") !== "ciphertextChunk,ciphertextLength,dateString,id,index,totalChunks"
      || payload.dateString !== dateString || payload.id !== id || payload.index !== index
      || !Number.isSafeInteger(payload.totalChunks) || payload.totalChunks < 1
      || payload.totalChunks > MAX_VOICE_NOTE_CHUNKS || index >= payload.totalChunks
      || !Number.isSafeInteger(payload.ciphertextLength)
      || payload.ciphertextLength < 24
      || payload.ciphertextLength > MAX_VOICE_NOTE_CIPHERTEXT_LENGTH
      || payload.ciphertextLength % 4 !== 0
      || payload.totalChunks !== Math.ceil(payload.ciphertextLength / MAX_VOICE_NOTE_CHUNK_CHARS)
      || typeof payload.ciphertextChunk !== "string"
      || payload.ciphertextChunk.length !== Math.min(
        MAX_VOICE_NOTE_CHUNK_CHARS,
        payload.ciphertextLength - index * MAX_VOICE_NOTE_CHUNK_CHARS
      )
      || payload.ciphertextChunk.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.ciphertextChunk)) return false;
  try {
    atob(payload.ciphertextChunk);
    return true;
  } catch {
    return false;
  }
}

function validPacket(packet, dateString) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return false;
  const allowedFields = new Set(["format", "version", "dateString", "algorithm", "compression", "iv", "ciphertext"]);
  const fields = Object.keys(packet);
  if (fields.length !== allowedFields.size || fields.some(field => !allowedFields.has(field))) return false;
  if (packet.format !== PACKET_FORMAT || packet.version !== 1
      || packet.dateString !== dateString || packet.algorithm !== "AES-256-GCM"
      || !["none", "gzip-base64"].includes(packet.compression)
      || typeof packet.iv !== "string" || typeof packet.ciphertext !== "string") return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(packet.iv)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.ciphertext)) return false;
  try {
    const iv = atob(packet.iv);
    const ciphertext = atob(packet.ciphertext);
    return iv.length === 12
      && ciphertext.length >= 16
      && ciphertext.length <= MAX_PACKET_CIPHERTEXT_BYTES;
  } catch {
    return false;
  }
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TypeError("Invalid base64.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function fromHex(value) {
  if (typeof value !== "string" || !/^[a-f0-9]+$/i.test(value) || value.length % 2) {
    throw new TypeError("Invalid hexadecimal value.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function encodeBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
}

function validUsername(value) {
  const normalized = normalizeUsername(value);
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(normalized) ? normalized : null;
}

function validQuestionAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) return false;
  const seen = new Set();
  return answers.every(item => {
    const id = Number(item?.questionId);
    const answer = item?.answer;
    if (!Number.isInteger(id) || id < 1 || id > 20 || seen.has(id)
        || typeof answer !== "string" || answer.length < 1 || answer.length > 64 || /\s/u.test(answer)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function canonicalRecoveryAnswers(answers) {
  if (!validQuestionAnswers(answers)) throw new TypeError("Exactly three distinct one-word answers are required.");
  return JSON.stringify(answers
    .map(item => ({ questionId: Number(item.questionId), answer: item.answer }))
    .sort((left, right) => left.questionId - right.questionId));
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}

async function sha256Hex(value) {
  const digest = await sha256Bytes(value);
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function recoverySealKey(pepper) {
  const raw = await sha256Bytes("FaithFocus|recovery-envelope-seal|v1|" + pepper);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function sealRecoveryEnvelope(envelope, vaultId, pepper) {
  const key = await recoverySealKey(pepper);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(envelope));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: encoder.encode("FaithFocus|recovery-envelope|v1|" + vaultId), tagLength: 128
  }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function unsealRecoveryEnvelope(sealed, vaultId, pepper) {
  const key = await recoverySealKey(pepper);
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: fromBase64(sealed.iv),
    additionalData: encoder.encode("FaithFocus|recovery-envelope|v1|" + vaultId),
    tagLength: 128
  }, key, fromBase64(sealed.ciphertext));
  const envelope = JSON.parse(new TextDecoder().decode(plaintext));
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM"
      || fromBase64(envelope.iv).length !== 12 || fromBase64(envelope.ciphertext).length !== 48) {
    throw new Error("The sealed recovery envelope is invalid.");
  }
  return envelope;
}

function validBase64Length(value, expectedLength) {
  try { return fromBase64(value).length === expectedLength; }
  catch { return false; }
}

function validEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.version !== 1 || value.algorithm !== "AES-256-GCM"
      || typeof value.iv !== "string" || typeof value.ciphertext !== "string") return false;
  try {
    return fromBase64(value.iv).length === 12 && fromBase64(value.ciphertext).length === 48;
  } catch {
    return false;
  }
}

async function readBodyLimited(request, limit) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function parseJsonBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function withCorsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Client, X-Write-Token, X-Base-Updated-At, X-Vault-Membership, X-Device-Session, X-Legacy-Username",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    }
  });
}

async function callCoordinator(env, vaultId, path, { token, oldToken, sessionToken, body } = {}) {
  const id = env.VAULT_COORDINATOR.idFromName(vaultId);
  const stub = env.VAULT_COORDINATOR.get(id);
  const headers = new Headers({ "X-Vault-Id": vaultId });
  if (token) headers.set("X-Write-Token", token);
  if (oldToken) headers.set("X-Legacy-Write-Token", oldToken);
  if (sessionToken) headers.set("X-Device-Session", sessionToken);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return stub.fetch(new Request("https://vault-coordinator.internal" + path, {
    method: body === undefined ? "POST" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

async function callRegistry(env, path, body) {
  const id = env.ACCOUNT_REGISTRY.idFromName("global-account-registry");
  const stub = env.ACCOUNT_REGISTRY.get(id);
  return stub.fetch(new Request("https://account-registry.internal" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const trustedOrigin = origin === APP_ORIGIN ? origin : null;

    // Apply the IP ingress limit before Origin, method, or client-header rejection.
    // This does not prevent Worker invocations, but limits downstream processing.
    const edgeLimitResponse = await enforceEdgeRateLimits(request, env, trustedOrigin);
    if (edgeLimitResponse) return edgeLimitResponse;

    if (origin !== APP_ORIGIN) return jsonResponse({ error: "Origin not allowed." }, 403);
    if (request.method === "OPTIONS") return withCorsPreflight();
    if (request.headers.get("X-App-Client") !== APP_CLIENT) {
      return jsonResponse({ error: "The application client header is required." }, 403, origin);
    }

    const url = new URL(request.url);
    const accountRoute = /^\/account\/(signup|migrate-legacy|signin|unlock|recover|complete-recovery)$/.exec(url.pathname);
    const legacyClaim = /^\/legacy-claim\/([a-f0-9]{64})$/.exec(url.pathname);
    const legacyUsernameHeader = request.headers.get("X-Legacy-Username");
    const match = /^\/vault\/([a-f0-9]{64})\/(claim|index|day\/(\d{4}-\d{2}-\d{2})|device\/challenge|device\/verify|device\/session\/revoke|device\/list|device\/remove)$/.exec(url.pathname);
    const voiceNoteMatch = /^\/vault\/([a-f0-9]{64})\/voice-note\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2}-[a-f0-9]{32})\/(\d{1,2})$/.exec(url.pathname);
    const knownRoute = Boolean(accountRoute || legacyClaim || match || voiceNoteMatch);

    if (!knownRoute) return jsonResponse({ error: "Route not found." }, 404, origin);
    if (url.search) return jsonResponse({ error: "Unexpected query parameters are not allowed." }, 400, origin);
    if (accountRoute && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (legacyClaim && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (legacyClaim && !legacyUsernameHeader) {
      return jsonResponse({ error: "Route not found." }, 404, origin);
    }
    if (match) {
      const resource = match[2];
      const expectedMethods = resource === "index" || resource === "device/list" ? ["GET"]
        : resource.startsWith("day/") ? ["GET", "PUT"] : ["POST"];
      if (!expectedMethods.includes(request.method)) {
        return jsonResponse({ error: "Method not allowed." }, 405, origin);
      }
      if (match[3] && !validDate(match[3])) {
        return jsonResponse({ error: "Invalid calendar date." }, 400, origin);
      }
    }
    if (voiceNoteMatch && (!validDate(voiceNoteMatch[2]) || !validVoiceNoteId(voiceNoteMatch[3], voiceNoteMatch[2])
        || !Number.isInteger(Number(voiceNoteMatch[4])) || Number(voiceNoteMatch[4]) >= MAX_VOICE_NOTE_CHUNKS)) {
      return jsonResponse({ error: "Invalid voice-note reference." }, 400, origin);
    }
    if (voiceNoteMatch && !["GET", "PUT"].includes(request.method)) {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (!["GET", "POST", "PUT"].includes(request.method)) {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }

    let bodyText = "";
    const readJsonBody = async () => {
      if (request.method !== "POST" && request.method !== "PUT") return null;
      const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (contentType !== "application/json") {
        return jsonResponse({ error: "Requests with a body must use Content-Type: application/json." }, 415, origin);
      }
      try {
        bodyText = await readBodyLimited(request, MAX_REQUEST_BYTES);
      } catch {
        return jsonResponse({ error: "The request body could not be read safely." }, 400, origin);
      }
      if (bodyText === null) return jsonResponse({ error: "Request payload exceeds the 1 MB limit." }, 413, origin);
      return null;
    };

    if (accountRoute) {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);
      if (!env.ACCOUNT_REGISTRY || !env.VAULT_COORDINATOR) {
        return jsonResponse({ error: "The account registry services are not configured. Please contact the app maintainer." }, 503, origin);
      }
      const route = accountRoute[1];
      if (["signup", "migrate-legacy", "recover", "unlock", "complete-recovery"].includes(route)
          && (!env.RECOVERY_PEPPER || String(env.RECOVERY_PEPPER).length < 32)) {
        return jsonResponse({ error: "Account security is not configured. Please contact the app maintainer." }, 503, origin);
      }
      if (["signup", "migrate-legacy", "signin", "unlock", "complete-recovery"].includes(route)
          && (!env.MEMBERSHIP_PEPPER || String(env.MEMBERSHIP_PEPPER).length < 32)) {
        return jsonResponse({ error: "Device membership signing is not configured. Please contact the app maintainer." }, 503, origin);
      }
      const bodyError = await readJsonBody();
      if (bodyError) return bodyError;
      const payload = await parseJsonBody(bodyText);
      if (!payload) return jsonResponse({ error: "Invalid JSON request body." }, 400, origin);

      if (route === "unlock") {
        const vaultId = payload.vaultId;
        const token = request.headers.get("X-Write-Token") || "";
        if (Object.keys(payload).length !== 1
            || !VAULT_ID_PATTERN.test(vaultId || "") || !TOKEN_PATTERN.test(token)) {
          return jsonResponse({ error: "The account credentials were not accepted." }, 401, origin);
        }

        // Confirm the account mapping before continuing.
        const membershipResponse = await callRegistry(
          env, "/vault-membership", { vaultId, action: "unlock" }
        );
        if (!membershipResponse.ok) {
          return jsonResponse({ error: "The username or passphrase was not accepted." }, 401, origin);
        }

        const claimResponse = await callCoordinator(env, vaultId, "/claim", { token });
        if (!claimResponse.ok) {
          return jsonResponse({ error: "The username or passphrase was not accepted." }, claimResponse.status, origin);
        }
        const metadataResponse = await callRegistry(env, "/authenticated-envelope", { vaultId }, request);
        const metadata = await metadataResponse.json();
        if (!metadataResponse.ok) return jsonResponse(metadata, metadataResponse.status, origin);

        const membershipTicket = await createVaultMembershipTicket(vaultId, env.MEMBERSHIP_PEPPER);
        return jsonResponse({ ...metadata, membershipTicket }, 200, origin);
      }

      const registryResponse = await callRegistry(env, "/" + route, payload);
      const responseText = await registryResponse.text();
      if (registryResponse.ok && ["signup", "migrate-legacy", "complete-recovery"].includes(route)) {
        let result;
        try { result = JSON.parse(responseText); }
        catch { return jsonResponse({ error: "The account registry returned an invalid response." }, 502, origin); }
        if (VAULT_ID_PATTERN.test(result?.vaultId || "")) {
          result.membershipTicket = await createVaultMembershipTicket(result.vaultId, env.MEMBERSHIP_PEPPER);
        }
        return jsonResponse(result, registryResponse.status, origin);
      }
      return new Response(responseText, {
        status: registryResponse.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": APP_ORIGIN,
          "Vary": "Origin",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    // Validate the legacy account reference.
    if (legacyClaim) {
      const username = validUsername(legacyUsernameHeader);
      const token = request.headers.get("X-Write-Token") || "";
      if (!username || !TOKEN_PATTERN.test(token)) {
        return jsonResponse({ error: "The existing vault credentials were not accepted." }, 401, origin);
      }
      const legacyBodyError = await readJsonBody();
      if (legacyBodyError) return legacyBodyError;
      const expectedVaultId = await sha256Hex(LEGACY_VAULT_ID_DOMAIN + username);
      if (!constantTimeEqual(expectedVaultId, legacyClaim[1])) {
        return jsonResponse({ error: "The legacy account reference is invalid." }, 400, origin);
      }
      if (!env.ACCOUNT_REGISTRY || !env.VAULT_COORDINATOR) {
        return jsonResponse({ error: "The account registry services are not configured." }, 503, origin);
      }
      const eligibility = await callRegistry(
        env, "/legacy-eligibility", { username, vaultId: legacyClaim[1] }
      );
      if (!eligibility.ok) {
        return jsonResponse(
          { error: "This account is not eligible for the legacy upgrade flow." },
          eligibility.status === 429 ? 429 : 401,
          origin
        );
      }
      const claimResponse = await callCoordinator(env, legacyClaim[1], "/claim", { token });
      if (!claimResponse.ok) {
        return jsonResponse({ error: "The username or passphrase was not accepted." }, claimResponse.status, origin);
      }
      return jsonResponse({ ok: true, claimed: true, legacy: true }, 200, origin);
    }

    if ((!match && !voiceNoteMatch) || !VAULT_ID_PATTERN.test(match?.[1] || voiceNoteMatch?.[1] || "")) {
      return jsonResponse({ error: "Route not found." }, 404, origin);
    }
    if (!env.VAULT_PACKETS || !env.VAULT_COORDINATOR
        || !env.MEMBERSHIP_PEPPER || String(env.MEMBERSHIP_PEPPER).length < 32) {
      return jsonResponse({ error: "Cloudflare vault services are not configured." }, 503, origin);
    }

    const vaultId = match?.[1] || voiceNoteMatch?.[1];
    const resource = voiceNoteMatch ? "voice-note" : match[2];
    const dateString = voiceNoteMatch ? voiceNoteMatch[2] : match[3];
    const voiceNoteId = voiceNoteMatch?.[3] || null;
    const voiceNoteChunkIndex = voiceNoteMatch ? Number(voiceNoteMatch[4]) : null;
    const expectedMethods = voiceNoteMatch ? ["GET", "PUT"]
      : resource === "index" || resource === "device/list" ? ["GET"]
        : resource.startsWith("day/") ? ["GET", "PUT"] : ["POST"];
    if (!expectedMethods.includes(request.method)) {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (dateString && !validDate(dateString)) {
      return jsonResponse({ error: "Invalid calendar date." }, 400, origin);
    }
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "PUT") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }

    // Validate membership before consuming the request body or account rate-limit bucket.
    const membershipTicket = request.headers.get("X-Vault-Membership") || "";
    if (!(await verifyVaultMembershipTicket(membershipTicket, vaultId, env.MEMBERSHIP_PEPPER))) {
      return jsonResponse({ error: "A valid account membership ticket is required. Please sign in again." }, 403, origin);
    }

    const isVoiceNoteWrite = resource === "voice-note" && request.method === "PUT";
    const accountLimitResponse = await enforceVaultAccountRateLimits(
      vaultId,
      (resource.startsWith("day/") && request.method === "PUT") || isVoiceNoteWrite,
      env,
      origin,
      isVoiceNoteWrite
    );
    if (accountLimitResponse) return accountLimitResponse;

    const vaultBodyError = await readJsonBody();
    if (vaultBodyError) return vaultBodyError;

    let payload = null;
    if (bodyText) {
      payload = await parseJsonBody(bodyText);
      if (!payload) return jsonResponse({ error: "Invalid JSON request body." }, 400, origin);
    }

    const token = request.headers.get("X-Write-Token") || "";
    const sessionToken = request.headers.get("X-Device-Session") || "";
    if (resource === "voice-note" && request.method === "PUT"
        && !validVoiceNoteChunkUpload(payload, dateString, voiceNoteId, voiceNoteChunkIndex)) {
      return jsonResponse({ error: "The encrypted voice-note attachment is invalid or exceeds its size limit." }, 400, origin);
    }

    if (resource === "device/challenge") {
      if (!payload || Object.keys(payload).length !== 2
          || typeof payload.deviceId !== "string"
          || typeof payload.publicKeySpki !== "string"
          || !TOKEN_PATTERN.test(token)
          || !(await validateDevicePublicKey(payload.publicKeySpki, payload.deviceId))) {
        return jsonResponse({ error: "The device registration request is invalid." }, 400, origin);
      }
    } else if (resource === "device/verify") {
      if (!payload || Object.keys(payload).length !== 3
          || !DEVICE_ID_PATTERN.test(payload.deviceId || "")
          || !DEVICE_ID_PATTERN.test(payload.challengeId || "")
          || !DEVICE_SIGNATURE_PATTERN.test(payload.signature || "")) {
        return jsonResponse({ error: "The device challenge response is invalid." }, 400, origin);
      }
      try {
        if (fromBase64Url(payload.signature).byteLength !== 64) {
          return jsonResponse({ error: "The device challenge signature has an invalid size." }, 400, origin);
        }
      } catch {
        return jsonResponse({ error: "The device challenge signature is malformed." }, 400, origin);
      }
    } else {
      if (!TOKEN_PATTERN.test(sessionToken)) {
        return jsonResponse({ error: "A valid device session is required. Please sign in again." }, 401, origin);
      }
      if ((resource === "device/session/revoke" || resource === "device/remove")
          && (!payload || Object.keys(payload).length !== 1
            || !DEVICE_ID_PATTERN.test(payload.deviceId || ""))) {
        return jsonResponse({ error: "The device management request is invalid." }, 400, origin);
      }
      if (resource === "device/list" && payload !== null) {
        return jsonResponse({ error: "The device-list request is invalid." }, 400, origin);
      }
    }

    const id = env.VAULT_COORDINATOR.idFromName(vaultId);
    const coordinator = env.VAULT_COORDINATOR.get(id);
    const internalPath = voiceNoteMatch ? "/voice-note/" + dateString + "/" + voiceNoteId + "/" + voiceNoteChunkIndex : "/" + resource;
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Vault-Id": vaultId
    });
    if (resource === "device/challenge") headers.set("X-Write-Token", token);
    if (sessionToken) headers.set("X-Device-Session", sessionToken);
    const coordinatorResponse = await coordinator.fetch(new Request(
      "https://vault-coordinator.internal" + internalPath,
      {
        method: request.method,
        headers,
        body: bodyText || undefined
      }
    ));
    const responseText = await coordinatorResponse.text();
    return new Response(responseText, {
      status: coordinatorResponse.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": APP_ORIGIN,
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
};

export class AccountRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  usernameKey(username) {
    return "username:" + username;
  }

  accountKey(vaultId) {
    return "account:" + vaultId;
  }

  async recoveryDigest(answers) {
    return hmacHex(this.env.RECOVERY_PEPPER, canonicalRecoveryAnswers(answers));
  }

  async scheduleTransientCleanup(expiresAt, prefix) {
    const storage = this.state.storage;
    if (!Number.isFinite(expiresAt) || typeof storage.setAlarm !== "function") return;

    // A new earlier-expiring key may sort before a saved pagination cursor.
    // Restart that prefix's sweep so the inserted record cannot be skipped.
    const cleanupState = prefix === "auth-rate:"
      ? ["auth-rate-cleanup-cursor", "auth-rate-cleanup-next-expiry"]
      : prefix === "recovery-grant:"
        ? ["recovery-grant-cleanup-cursor", "recovery-grant-cleanup-next-expiry"]
        : null;
    if (cleanupState) {
      const [cursor, scannedExpiry] = await Promise.all([
        storage.get(cleanupState[0]),
        storage.get(cleanupState[1])
      ]);
      if (cursor && Number.isFinite(scannedExpiry) && expiresAt < scannedExpiry) {
        await storage.delete(cleanupState[0]);
        await storage.delete(cleanupState[1]);
      }
    }

    const currentAlarm = typeof storage.getAlarm === "function" ? await storage.getAlarm() : null;
    if (Number.isFinite(currentAlarm) && currentAlarm <= expiresAt) return;
    await storage.setAlarm(Math.max(Date.now() + 1_000, expiresAt));
  }

  async rateLimitSubject(action, subject, limit, windowMs) {
    const key = "auth-rate:" + action + ":" + subject;
    const now = Date.now();
    let record = await this.state.storage.get(key);
    const legacyExpiry = Number.isFinite(record?.windowStartedAt)
      ? record.windowStartedAt + windowMs : 0;
    const expiresAt = Number.isFinite(record?.expiresAt) ? record.expiresAt : legacyExpiry;
    if (!record || !Number.isFinite(record.windowStartedAt)
        || !Number.isSafeInteger(record.count) || record.count < 0
        || now < record.windowStartedAt || expiresAt <= now) {
      record = { windowStartedAt: now, count: 0 };
    }
    const nextExpiry = record.windowStartedAt + windowMs;
    if (record.count >= limit) {
      await this.scheduleTransientCleanup(nextExpiry, "auth-rate:");
      return false;
    }
    await this.state.storage.put(key, {
      windowStartedAt: record.windowStartedAt,
      count: record.count + 1,
      expiresAt: nextExpiry
    });
    await this.scheduleTransientCleanup(nextExpiry, "auth-rate:");
    return true;
  }

  async ensureTransientCleanupScheduled() {
    const storage = this.state.storage;
    if (typeof storage.setAlarm !== "function" || typeof storage.list !== "function") return;
    if (typeof storage.getAlarm === "function" && Number.isFinite(await storage.getAlarm())) return;
    const [rateRecords, grantRecords] = await Promise.all([
      storage.list({ prefix: "auth-rate:", limit: 1 }),
      storage.list({ prefix: "recovery-grant:", limit: 1 })
    ]);
    if (rateRecords.size || grantRecords.size) await storage.setAlarm(Date.now() + 60_000);
  }

  async cleanupTransientPrefix(prefix, cursorKey, expiryKey, defaultWindowMs, now) {
    const storage = this.state.storage;
    let cursor = await storage.get(cursorKey) || null;
    let nextExpiry = await storage.get(expiryKey);
    if (!Number.isFinite(nextExpiry) || nextExpiry <= now) {
      cursor = null;
      nextExpiry = null;
      await storage.delete(cursorKey);
      await storage.delete(expiryKey);
    }
    let scanned = 0;

    while (scanned < 1_000) {
      const options = { prefix, limit: 250 };
      if (cursor) options.startAfter = cursor;
      const records = await storage.list(options);
      if (records.size === 0) {
        cursor = null;
        break;
      }

      for (const [key, record] of records) {
        cursor = key;
        scanned += 1;
        const expiry = Number.isFinite(record?.expiresAt) ? record.expiresAt
          : Number.isFinite(record?.windowStartedAt) ? record.windowStartedAt + defaultWindowMs
            : 0;
        if (expiry <= now) {
          await storage.delete(key);
        } else if (nextExpiry === null || expiry < nextExpiry) {
          nextExpiry = expiry;
        }
      }

      if (records.size < 250) {
        cursor = null;
        break;
      }
    }

    if (cursor !== null) {
      await storage.put(cursorKey, cursor);
      if (nextExpiry !== null) await storage.put(expiryKey, nextExpiry);
      return { more: true, nextExpiry };
    }

    await storage.delete(cursorKey);
    await storage.delete(expiryKey);
    return { more: false, nextExpiry };
  }

  async alarm() {
    return this.serialized(async () => {
      const now = Date.now();
      const rateLimits = await this.cleanupTransientPrefix(
        "auth-rate:", "auth-rate-cleanup-cursor", "auth-rate-cleanup-next-expiry",
        15 * 60 * 1000, now
      );
      const recoveryGrants = await this.cleanupTransientPrefix(
        "recovery-grant:", "recovery-grant-cleanup-cursor", "recovery-grant-cleanup-next-expiry",
        10 * 60 * 1000, now
      );

      if (rateLimits.more || recoveryGrants.more) {
        const earliestPendingExpiry = [rateLimits.nextExpiry, recoveryGrants.nextExpiry]
          .filter(Number.isFinite)
          .reduce((earliest, expiry) => earliest === null || expiry < earliest ? expiry : earliest, null);
        const nextSweep = Date.now() + 60_000;
        await this.state.storage.setAlarm(
          earliestPendingExpiry === null
            ? nextSweep
            : Math.min(nextSweep, Math.max(Date.now() + 1_000, earliestPendingExpiry))
        );
        return;
      }

      const nextExpiry = [rateLimits.nextExpiry, recoveryGrants.nextExpiry]
        .filter(Number.isFinite)
        .reduce((earliest, expiry) => earliest === null || expiry < earliest ? expiry : earliest, null);
      if (nextExpiry !== null) {
        await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, nextExpiry));
      } else if (typeof this.state.storage.deleteAlarm === "function") {
        await this.state.storage.deleteAlarm();
      }
    });
  }

  async createSigninDecoy(username) {
    const pepper = this.env.MEMBERSHIP_PEPPER;
    if (typeof pepper !== "string" || pepper.length < 32) {
      throw new Error("Membership signing is not configured.");
    }
    const vaultId = await hmacHex(pepper, "FaithFocus|signin-decoy-vault|v1|" + username);
    const saltHex = await hmacHex(pepper, "FaithFocus|signin-decoy-salt|v1|" + username);
    return {
      username,
      vaultId,
      passphraseSalt: toBase64(fromHex(saltHex).subarray(0, 16)),
      passphraseIterations: 600000
    };
  }

  async initializeVault(vaultId, writeToken) {
    const response = await callCoordinator(this.env, vaultId, "/admin/initialize", { token: writeToken });
    if (!response.ok) throw new Error("The account vault could not be initialized.");
  }

  async fetch(request) {
    return this.serialized(async () => {
      await this.ensureTransientCleanupScheduled();
      return this.handle(request);
    });
  }

  async handle(request) {
    const path = new URL(request.url).pathname;
    let payload;
    try {
      payload = await request.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload.");
    } catch {
      return jsonResponse({ error: "Invalid account request." }, 400);
    }

    if (path === "/vault-membership") {
      const vaultId = payload.vaultId;
      const action = payload.action;
      if (!VAULT_ID_PATTERN.test(vaultId || "") || action !== "unlock") {
        return jsonResponse({ error: "The account membership request is invalid." }, 400);
      }
      const record = await this.state.storage.get(this.accountKey(vaultId));
      if (!record || await this.state.storage.get(this.usernameKey(record.username)) !== vaultId) {
        return jsonResponse({ error: "The account membership could not be verified." }, 404);
      }
      if (!(await this.rateLimitSubject("unlock", vaultId, 10, 15 * 60 * 1000))) {
        return jsonResponse({ error: "Too many sign-in attempts for this account. Please try again later." }, 429);
      }
      return jsonResponse({ ok: true, username: record.username }, 200);
    }

    if (path === "/legacy-eligibility") {
      const username = validUsername(payload.username);
      const vaultId = payload.vaultId;
      if (!username || !VAULT_ID_PATTERN.test(vaultId || "")) {
        return jsonResponse({ error: "The legacy account reference is invalid." }, 400);
      }
      const expectedVaultId = await sha256Hex(LEGACY_VAULT_ID_DOMAIN + username);
      if (!constantTimeEqual(expectedVaultId, vaultId)) {
        return jsonResponse({ error: "The legacy account reference is invalid." }, 400);
      }
      if (await this.state.storage.get(this.usernameKey(username))) {
        return jsonResponse({ error: "This username already belongs to a registered account." }, 409);
      }
      return jsonResponse({ ok: true }, 200);
    }

    if (path === "/signup") {
      const username = validUsername(payload.username);
      const vaultId = payload.vaultId;
      const answers = payload.questionAnswers;
      if (!username || !VAULT_ID_PATTERN.test(vaultId || "")
          || !validBase64Length(payload.passphraseSalt, 16)
          || payload.passphraseIterations !== 600000 || !validEnvelope(payload.passphraseEnvelope)
          || !validBase64Length(payload.recoverySalt, 16)
          || payload.recoveryIterations !== 1200000 || !validEnvelope(payload.recoveryEnvelope)
          || !validQuestionAnswers(answers) || !TOKEN_PATTERN.test(payload.writeToken || "")) {
        return jsonResponse({ error: "The sign-up information is incomplete or invalid." }, 400);
      }
      const usernameIndexKey = this.usernameKey(username);
      if (await this.state.storage.get(usernameIndexKey)) {
        return jsonResponse({ error: "That username is already in use. Please choose another." }, 409);
      }

      const recoveryDigest = await this.recoveryDigest(answers);
      if (await this.state.storage.get("recovery:" + recoveryDigest)) {
        return jsonResponse({
          error: "That exact security-question combination is already in use. Choose different questions or less predictable answers."
        }, 409);
      }

      try {
        const sealedRecoveryEnvelope = await sealRecoveryEnvelope(
          payload.recoveryEnvelope, vaultId, this.env.RECOVERY_PEPPER
        );
        const record = {
          username,
          vaultId,
          passphraseSalt: payload.passphraseSalt,
          passphraseIterations: payload.passphraseIterations,
          passphraseEnvelope: payload.passphraseEnvelope,
          recoverySalt: payload.recoverySalt,
          recoveryIterations: payload.recoveryIterations,
          sealedRecoveryEnvelope,
          recoveryDigest,
          createdAt: new Date().toISOString()
        };
        await this.initializeVault(vaultId, payload.writeToken);
        await this.state.storage.put(this.accountKey(vaultId), record);
        await this.state.storage.put(usernameIndexKey, vaultId);
        await this.state.storage.put("recovery:" + recoveryDigest, vaultId);
        return jsonResponse({ ok: true, username, vaultId }, 201);
      } catch (error) {
        // Log only the error category. Never log account data or recovery answers.
        console.error("Account Registry sign-up failed:", error instanceof Error ? error.name : "UnknownError");
        return jsonResponse({ error: "The account could not be created. Please try again." }, 503);
      }
    }

    if (path === "/migrate-legacy") {
      const username = validUsername(payload.username);
      const vaultId = payload.vaultId;
      const answers = payload.questionAnswers;
      if (!username || !VAULT_ID_PATTERN.test(vaultId || "")
          || !validBase64Length(payload.passphraseSalt, 16)
          || payload.passphraseIterations !== 600000 || !validEnvelope(payload.passphraseEnvelope)
          || !validBase64Length(payload.recoverySalt, 16)
          || payload.recoveryIterations !== 1200000 || !validEnvelope(payload.recoveryEnvelope)
          || !validQuestionAnswers(answers)
          || !TOKEN_PATTERN.test(payload.writeToken || "")
          || !TOKEN_PATTERN.test(payload.legacyWriteToken || "")) {
        return jsonResponse({ error: "The legacy account upgrade information is incomplete or invalid." }, 400);
      }
      if (await this.state.storage.get(this.usernameKey(username))) {
        return jsonResponse({ error: "This username already has a registered account." }, 409);
      }
      const recoveryDigest = await this.recoveryDigest(answers);
      if (await this.state.storage.get("recovery:" + recoveryDigest)) {
        return jsonResponse({
          error: "That exact security-question combination is already in use. Choose different questions or less predictable answers."
        }, 409);
      }
      try {
        const sealedRecoveryEnvelope = await sealRecoveryEnvelope(
          payload.recoveryEnvelope, vaultId, this.env.RECOVERY_PEPPER
        );
        const record = {
          username,
          vaultId,
          passphraseSalt: payload.passphraseSalt,
          passphraseIterations: payload.passphraseIterations,
          passphraseEnvelope: payload.passphraseEnvelope,
          recoverySalt: payload.recoverySalt,
          recoveryIterations: payload.recoveryIterations,
          sealedRecoveryEnvelope,
          recoveryDigest,
          createdAt: new Date().toISOString(),
          upgradedFromLegacyVault: true
        };
        const migrated = await callCoordinator(this.env, vaultId, "/admin/migrate-legacy", {
          token: payload.writeToken,
          oldToken: payload.legacyWriteToken
        });
        if (!migrated.ok) {
          return jsonResponse({ error: "The existing vault credentials could not be verified. No account changes were made." }, 401);
        }
        await this.state.storage.put(this.accountKey(vaultId), record);
        await this.state.storage.put(this.usernameKey(username), vaultId);
        await this.state.storage.put("recovery:" + recoveryDigest, vaultId);
        return jsonResponse({ ok: true, username, vaultId, upgraded: true }, 200);
      } catch (error) {
        // Log only the error category, never account data or recovery answers.
        console.error("Account Registry legacy migration failed:", error instanceof Error ? error.name : "UnknownError");
        return jsonResponse({ error: "The existing account could not be upgraded. Keep your previous account credentials and try again." }, 503);
      }
    }

    if (path === "/signin") {
      const username = validUsername(payload.username);
      const decoyUsername = username
        || (typeof payload.username === "string" ? normalizeUsername(payload.username).slice(0, 32) : "")
        || "invalid";
      const decoy = await this.createSigninDecoy(decoyUsername);
      const mappedVaultId = username
        ? await this.state.storage.get(this.usernameKey(username))
        : null;
      const record = await this.state.storage.get(this.accountKey(mappedVaultId || decoy.vaultId));

      // Registered and unregistered usernames receive the same status and response shape.
      if (!username || !mappedVaultId || !record
          || record.username !== username || record.vaultId !== mappedVaultId) {
        return jsonResponse(decoy, 200);
      }
      return jsonResponse({
        username: record.username,
        vaultId: record.vaultId,
        passphraseSalt: record.passphraseSalt,
        passphraseIterations: record.passphraseIterations
      }, 200);
    }

    if (path === "/authenticated-envelope") {
      const vaultId = payload.vaultId;
      if (!VAULT_ID_PATTERN.test(vaultId || "")) return jsonResponse({ error: "Account not found." }, 404);
      const record = await this.state.storage.get(this.accountKey(vaultId));
      if (!record) return jsonResponse({ error: "Account not found." }, 404);
      return jsonResponse({
        username: record.username,
        vaultId: record.vaultId,
        passphraseEnvelope: record.passphraseEnvelope
      }, 200);
    }

    if (path === "/recover") {
      if (!validQuestionAnswers(payload.questionAnswers)) {
        return jsonResponse({ error: "Choose the same three questions and enter each one-word answer exactly as during sign-up." }, 400);
      }
      let vaultId;
      try {
        const digest = await this.recoveryDigest(payload.questionAnswers);
        vaultId = await this.state.storage.get("recovery:" + digest);
      } catch {
        return jsonResponse({ error: "The recovery answers could not be verified." }, 400);
      }
      if (!vaultId) return jsonResponse({ error: "The three answers did not match an account. Check the selected questions, spelling, and letter case." }, 401);
      const record = await this.state.storage.get(this.accountKey(vaultId));
      if (!record) return jsonResponse({ error: "The account recovery record could not be found." }, 404);
      let recoveryEnvelope;
      try {
        recoveryEnvelope = await unsealRecoveryEnvelope(
          record.sealedRecoveryEnvelope, vaultId, this.env.RECOVERY_PEPPER
        );
      } catch {
        return jsonResponse({ error: "The recovery record could not be opened. Contact the app maintainer." }, 503);
      }
      const grantBytes = crypto.getRandomValues(new Uint8Array(32));
      const grant = encodeBase64Url(grantBytes);
      const grantHash = await sha256Hex(grant);
      const grantExpiresAt = Date.now() + 10 * 60 * 1000;
      await this.state.storage.put("recovery-grant:" + grantHash, {
        vaultId,
        expiresAt: grantExpiresAt
      });
      await this.scheduleTransientCleanup(grantExpiresAt, "recovery-grant:");
      return jsonResponse({
        grant,
        username: record.username,
        vaultId: record.vaultId,
        recoverySalt: record.recoverySalt,
        recoveryIterations: record.recoveryIterations,
        recoveryEnvelope
      }, 200);
    }

    if (path === "/complete-recovery") {
      const grant = payload.grant;
      if (!TOKEN_PATTERN.test(grant || "")) return jsonResponse({ error: "The recovery session is invalid or expired." }, 401);
      const grantHash = await sha256Hex(grant);
      const grantKey = "recovery-grant:" + grantHash;
      const grantRecord = await this.state.storage.get(grantKey);
      if (!grantRecord || grantRecord.expiresAt < Date.now()) {
        if (grantRecord) await this.state.storage.delete(grantKey);
        return jsonResponse({ error: "The recovery session expired. Please verify your answers again." }, 401);
      }

      const record = await this.state.storage.get(this.accountKey(grantRecord.vaultId));
      if (!record) return jsonResponse({ error: "The account could not be found." }, 404);
      const newUsername = payload.newUsername ? validUsername(payload.newUsername) : null;
      if (payload.newUsername && !newUsername) {
        return jsonResponse({ error: "The new username must contain 3–32 letters, numbers, dots, hyphens, or underscores." }, 400);
      }
      const passwordFieldsPresent = payload.passphraseSalt !== undefined
        || payload.passphraseEnvelope !== undefined || payload.passphraseIterations !== undefined
        || payload.writeToken !== undefined;
      if (passwordFieldsPresent && (
        !validBase64Length(payload.passphraseSalt, 16)
        || payload.passphraseIterations !== 600000 || !validEnvelope(payload.passphraseEnvelope)
        || !TOKEN_PATTERN.test(payload.writeToken || "")
      )) {
        return jsonResponse({ error: "The new passphrase information is invalid." }, 400);
      }
      if (!newUsername && !passwordFieldsPresent) {
        return jsonResponse({ error: "Choose a new username, a new passphrase, or both." }, 400);
      }

      const oldUsername = record.username;
      if (newUsername && newUsername !== oldUsername) {
        const existingVault = await this.state.storage.get(this.usernameKey(newUsername));
        if (existingVault && existingVault !== record.vaultId) {
          return jsonResponse({ error: "That username is already in use. Choose another." }, 409);
        }
      }

      if (passwordFieldsPresent) {
        const rotated = await callCoordinator(this.env, record.vaultId, "/admin/rotate-token", { token: payload.writeToken });
        if (!rotated.ok) return jsonResponse({ error: "The account passphrase could not be updated." }, 503);
        record.passphraseSalt = payload.passphraseSalt;
        record.passphraseIterations = payload.passphraseIterations;
        record.passphraseEnvelope = payload.passphraseEnvelope;
      }
      if (newUsername && newUsername !== oldUsername) {
        await this.state.storage.delete(this.usernameKey(oldUsername));
        record.username = newUsername;
        await this.state.storage.put(this.usernameKey(newUsername), record.vaultId);
      }
      await this.state.storage.put(this.accountKey(record.vaultId), record);
      await this.state.storage.delete(grantKey);
      return jsonResponse({
        ok: true,
        username: record.username,
        vaultId: record.vaultId,
        usernameChanged: record.username !== oldUsername,
        passphraseChanged: passwordFieldsPresent
      }, 200);
    }

    return jsonResponse({ error: "Account route not found." }, 404);
  }
}

export class VaultCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
    this.initialized = null;
  }

  indexKey() {
    return this.vaultId + ":index";
  }

  packetKey(dateString) {
    return this.vaultId + ":" + dateString;
  }

  deviceChallengeKey(challengeId) {
    return "device-challenge:" + challengeId;
  }

  deviceKey(deviceId) {
    return "device:" + deviceId;
  }

  deviceSessionKey(tokenHash) {
    return "device-session:" + tokenHash;
  }

  async allowRateLimit(action, limit, windowMs) {
    // Update the request counter for this action.
    const key = "auth-rate:" + action;
    const now = Date.now();
    let record = await this.state.storage.get(key);
    if (!record || !Number.isFinite(record.windowStartedAt)
        || now < record.windowStartedAt || now - record.windowStartedAt >= windowMs) {
      record = { windowStartedAt: now, count: 0 };
    }
    if (record.count >= limit) return false;
    await this.state.storage.put(key, {
      windowStartedAt: record.windowStartedAt,
      count: record.count + 1
    });
    return true;
  }

  async createDeviceChallenge(request) {
    if (!(await this.authenticate(request))) return this.unauthorized();
    if (!(await this.allowRateLimit("device-challenge", 5, 60_000))) {
      return jsonResponse({ error: "Too many device sign-in attempts. Please try again in one minute." }, 429);
    }

    let payload;
    try { payload = await request.json(); }
    catch { return jsonResponse({ error: "Invalid device registration request." }, 400); }
    if (!payload || Object.keys(payload).length !== 2
        || !DEVICE_ID_PATTERN.test(payload.deviceId || "")
        || typeof payload.publicKeySpki !== "string"
        || payload.publicKeySpki.length < 80 || payload.publicKeySpki.length > 180) {
      return jsonResponse({ error: "Invalid device registration request." }, 400);
    }

    let spki;
    try {
      spki = fromBase64Url(payload.publicKeySpki);
      if (spki.byteLength < 64 || spki.byteLength > 128) throw new Error("Invalid public key size.");
      const fingerprint = encodeBase64Url(await sha256Bytes(spki));
      if (!constantTimeEqual(fingerprint, payload.deviceId)) {
        return jsonResponse({ error: "The device identity does not match its public key." }, 400);
      }
      const imported = await crypto.subtle.importKey(
        "spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
      );
      if (imported.algorithm?.namedCurve !== "P-256") throw new Error("Unsupported device curve.");
    } catch {
      return jsonResponse({ error: "The device public key is invalid or unsupported." }, 400);
    }

    const existingDevice = await this.state.storage.get(this.deviceKey(payload.deviceId));
    if (existingDevice && existingDevice.publicKeySpki !== payload.publicKeySpki) {
      return jsonResponse({ error: "This device identifier is already associated with a different public key." }, 409);
    }

    const now = Date.now();
    const pending = await this.state.storage.list({ prefix: "device-challenge:" });
    for (const [key, challenge] of pending) {
      if (!challenge || challenge.expiresAt <= now) await this.state.storage.delete(key);
    }
    const remaining = await this.state.storage.list({ prefix: "device-challenge:" });
    if (remaining.size >= MAX_PENDING_DEVICE_CHALLENGES) {
      return jsonResponse({ error: "Too many pending device sign-ins. Complete one or wait for it to expire." }, 429);
    }

    const devices = await this.state.storage.list({ prefix: "device:" });
    if (!existingDevice && devices.size >= MAX_DEVICES_PER_VAULT) {
      return jsonResponse({ error: "This account has reached its trusted-device limit. Remove an old device before adding another." }, 429);
    }

    const challengeId = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = now + DEVICE_CHALLENGE_TTL_MS;
    const message = JSON.stringify({
      domain: "FaithFocus|device-auth|v1",
      vaultId: this.vaultId,
      deviceId: payload.deviceId,
      challengeId,
      nonce,
      expiresAt
    });
    await this.state.storage.put(this.deviceChallengeKey(challengeId), {
      vaultId: this.vaultId,
      deviceId: payload.deviceId,
      publicKeySpki: payload.publicKeySpki,
      message,
      expiresAt,
      createdAt: now
    });

    return jsonResponse({ ok: true, challengeId, deviceId: payload.deviceId, message, expiresAt }, 200);
  }

  async consumeDeviceChallenge(challengeId) {
    const key = this.deviceChallengeKey(challengeId);
    // Read and remove the stored challenge.
    return this.state.storage.transaction(async () => {
      // Read and remove the stored value.
      const challenge = await this.state.storage.get(key);
      await this.state.storage.delete(key);
      return challenge || null;
    });
  }

  async scheduleSessionCleanup() {
    if (typeof this.state.storage.setAlarm !== "function") return;
    const sessions = await this.state.storage.list({ prefix: "device-session:" });
    let nextExpiry = null;
    for (const session of sessions.values()) {
      if (!session) continue;
      const expiry = Math.min(session.expiresAt || 0, session.idleExpiresAt || 0);
      if (expiry > 0 && (nextExpiry === null || expiry < nextExpiry)) nextExpiry = expiry;
    }
    if (nextExpiry === null) {
      await this.state.storage.deleteAlarm?.();
    } else {
      await this.state.storage.setAlarm(nextExpiry);
    }
  }

  async alarm() {
    return this.serialized(async () => {
      const now = Date.now();
      const sessions = await this.state.storage.list({ prefix: "device-session:" });
      for (const [key, session] of sessions) {
        if (!session || session.expiresAt <= now || session.idleExpiresAt <= now) {
          await this.state.storage.delete(key);
        }
      }
      await this.scheduleSessionCleanup();
    });
  }

  async authenticateDeviceSession(request, { touch = true } = {}) {
    const token = request.headers.get("X-Device-Session") || "";
    if (!TOKEN_PATTERN.test(token)) return null;
    const tokenHash = await sha256Hex(token);
    const key = this.deviceSessionKey(tokenHash);
    const record = await this.state.storage.get(key);
    const now = Date.now();
    if (!record || record.vaultId !== this.vaultId
        || !Number.isFinite(record.expiresAt)
        || !Number.isFinite(record.idleExpiresAt)
        || record.expiresAt <= now || record.idleExpiresAt <= now) {
      if (record) {
        await this.state.storage.delete(key);
        await this.scheduleSessionCleanup();
      }
      return null;
    }
    if (touch) {
      record.lastSeenAt = now;
      record.idleExpiresAt = Math.min(now + DEVICE_SESSION_IDLE_MS, record.expiresAt);
      await this.state.storage.put(key, record);
      await this.scheduleSessionCleanup();
    }
    return record;
  }

  async verifyDeviceChallenge(request) {
    if (!(await this.allowRateLimit("device-verify", 10, 60_000))) {
      return jsonResponse({ error: "Too many device verification attempts. Please try again in one minute." }, 429);
    }
    let payload;
    try { payload = await request.json(); }
    catch { return jsonResponse({ error: "Invalid device challenge response." }, 400); }
    if (!payload || Object.keys(payload).length !== 3
        || !DEVICE_ID_PATTERN.test(payload.challengeId || "")
        || !DEVICE_ID_PATTERN.test(payload.deviceId || "")
        || !DEVICE_SIGNATURE_PATTERN.test(payload.signature || "")) {
      return jsonResponse({ error: "Invalid device challenge response." }, 400);
    }

    let challenge;
    try {
      challenge = await this.consumeDeviceChallenge(payload.challengeId);
    } catch {
      return jsonResponse({ error: "The device challenge could not be consumed safely. Please start sign-in again." }, 503);
    }
    if (!challenge || challenge.vaultId !== this.vaultId
        || challenge.deviceId !== payload.deviceId
        || challenge.expiresAt <= Date.now()) {
      return jsonResponse({ error: "The device challenge is invalid, expired, or already used. Please sign in again." }, 401);
    }

    let signatureValid = false;
    try {
      const publicKey = await crypto.subtle.importKey(
        "spki",
        fromBase64Url(challenge.publicKeySpki),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      signatureValid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        fromBase64Url(payload.signature),
        encoder.encode(challenge.message)
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return jsonResponse({ error: "The device could not prove possession of its private signing key. The challenge was consumed; start sign-in again." }, 401);
    }

    const deviceKey = this.deviceKey(challenge.deviceId);
    const existing = await this.state.storage.get(deviceKey);
    if (existing && existing.publicKeySpki !== challenge.publicKeySpki) {
      return jsonResponse({ error: "The registered device key does not match. Contact the account owner." }, 409);
    }
    if (!existing) {
      const devices = await this.state.storage.list({ prefix: "device:" });
      if (devices.size >= MAX_DEVICES_PER_VAULT) {
        return jsonResponse({ error: "This account has reached its trusted-device limit." }, 429);
      }
    }

    const now = Date.now();
    await this.state.storage.put(deviceKey, {
      deviceId: challenge.deviceId,
      publicKeySpki: challenge.publicKeySpki,
      createdAt: existing?.createdAt || now,
      lastAuthenticatedAt: now
    });

    const sessionToken = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const sessionHash = await sha256Hex(sessionToken);
    const session = {
      vaultId: this.vaultId,
      deviceId: challenge.deviceId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + DEVICE_SESSION_MAX_MS,
      idleExpiresAt: now + DEVICE_SESSION_IDLE_MS
    };
    await this.state.storage.put(this.deviceSessionKey(sessionHash), session);
    await this.scheduleSessionCleanup();

    return jsonResponse({
      ok: true,
      deviceId: challenge.deviceId,
      sessionToken,
      sessionExpiresAt: session.expiresAt,
      sessionIdleExpiresAt: session.idleExpiresAt
    }, 200);
  }

  async listRegisteredDevices(session) {
    if (!session || session.vaultId !== this.vaultId) return this.unauthorized();
    const records = await this.state.storage.list({ prefix: "device:" });
    const devices = [...records.values()]
      .filter(record => record && DEVICE_ID_PATTERN.test(record.deviceId || ""))
      .map(record => ({
        deviceId: record.deviceId,
        createdAt: Number.isFinite(record.createdAt) ? record.createdAt : null,
        lastAuthenticatedAt: Number.isFinite(record.lastAuthenticatedAt) ? record.lastAuthenticatedAt : null,
        isCurrent: record.deviceId === session.deviceId
      }))
      .sort((left, right) => (right.lastAuthenticatedAt || right.createdAt || 0)
        - (left.lastAuthenticatedAt || left.createdAt || 0));
    return jsonResponse({ ok: true, currentDeviceId: session.deviceId, devices }, 200);
  }

  async removeRegisteredDevice(request, session) {
    if (!session || session.vaultId !== this.vaultId) return this.unauthorized();
    let payload;
    try { payload = await request.json(); }
    catch { return jsonResponse({ error: "Invalid device removal request." }, 400); }
    const deviceId = payload?.deviceId;
    if (!payload || Object.keys(payload).length !== 1 || !DEVICE_ID_PATTERN.test(deviceId || "")) {
      return jsonResponse({ error: "Invalid device removal request." }, 400);
    }
    if (deviceId === session.deviceId) {
      return jsonResponse({ error: "This device cannot remove its own active registration. Use another trusted device." }, 409);
    }

    const deviceKey = this.deviceKey(deviceId);
    const registered = await this.state.storage.get(deviceKey);
    if (!registered) return jsonResponse({ ok: true, removed: false, alreadyRemoved: true }, 200);

    await this.state.storage.delete(deviceKey);
    const sessions = await this.state.storage.list({ prefix: "device-session:" });
    let revokedSessions = 0;
    for (const [key, record] of sessions) {
      if (record?.deviceId === deviceId) {
        await this.state.storage.delete(key);
        revokedSessions += 1;
      }
    }
    const challenges = await this.state.storage.list({ prefix: "device-challenge:" });
    for (const [key, challenge] of challenges) {
      if (challenge?.deviceId === deviceId) await this.state.storage.delete(key);
    }
    await this.scheduleSessionCleanup();
    return jsonResponse({ ok: true, removed: true, deviceId, revokedSessions }, 200);
  }

  async revokeAllDeviceSessions() {
    const sessions = await this.state.storage.list({ prefix: "device-session:" });
    for (const key of sessions.keys()) {
      await this.state.storage.delete(key);
    }
    await this.scheduleSessionCleanup();
    return sessions.size;
  }

  async revokeDeviceSession(request) {
    let payload;
    try { payload = await request.json(); }
    catch { return jsonResponse({ error: "Invalid device session revocation request." }, 400); }
    const token = request.headers.get("X-Device-Session") || "";
    if (!payload || !DEVICE_ID_PATTERN.test(payload.deviceId || "") || !TOKEN_PATTERN.test(token)) {
      return jsonResponse({ error: "The device session revocation request is invalid." }, 400);
    }
    const tokenHash = await sha256Hex(token);
    const key = this.deviceSessionKey(tokenHash);
    const session = await this.state.storage.get(key);
    if (!session) {
      // Revocation is idempotent: an already-expired or previously revoked
      // token has no remaining authority and is safe to acknowledge.
      return jsonResponse({ ok: true, revoked: false, alreadyRevoked: true }, 200);
    }
    if (session.vaultId !== this.vaultId || session.deviceId !== payload.deviceId) {
      return jsonResponse({ error: "The device session is already expired or no longer valid." }, 401);
    }
    await this.state.storage.delete(key);
    await this.scheduleSessionCleanup();
    return jsonResponse({ ok: true, revoked: true }, 200);
  }

  serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async cleanupLegacyKvWriteMarkers() {
    const cursorKey = "kv-write-marker-cleanup-cursor";
    const cursor = await this.state.storage.get(cursorKey);
    const options = { prefix: "kv-write-time:", limit: 64 };
    if (typeof cursor === "string" && cursor.startsWith("kv-write-time:")) {
      options.startAfter = cursor;
    }

    const page = await this.state.storage.list(options);
    const keys = [...page.keys()];
    for (const key of keys) {
      // The bounded bucket markers are the new permanent state. Every other
      // key under this prefix was created by the previous per-record scheme.
      if (!key.startsWith("kv-write-time:bucket:")) {
        await this.state.storage.delete(key);
      }
    }

    if (keys.length === options.limit && keys.length > 0) {
      await this.state.storage.put(cursorKey, keys[keys.length - 1]);
    } else {
      await this.state.storage.delete(cursorKey);
    }
    return keys.length;
  }

  async enforceKvWriteSpacing(key) {
    // Fixed-size buckets bound permanent marker-key growth.
    const storageKey = "kv-write-time:bucket:" + getKvWriteSpacingBucket(key);
    const lastWrite = await this.state.storage.get(storageKey) || 0;
    const waitMs = Math.max(0, 1100 - (Date.now() - lastWrite));
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    await this.state.storage.put(storageKey, Date.now());

    // Migrate legacy per-record markers gradually. A cleanup error must never
    // turn an otherwise successful encrypted packet write into a failed save.
    this.legacyMarkerCleanupTicks = (this.legacyMarkerCleanupTicks || 0) + 1;
    if (this.legacyMarkerCleanupTicks >= 64) {
      this.legacyMarkerCleanupTicks = 0;
      try {
        await this.cleanupLegacyKvWriteMarkers();
      } catch (error) {
        console.warn("[Vault] Legacy write-marker cleanup will retry on a later write.", error);
      }
    }
  }

  async authenticate(request, { allowFirstClaim = false } = {}) {
    const token = request.headers.get("X-Write-Token") || "";
    const suppliedHash = await sha256Hex(token);
    const storedHash = await this.state.storage.get("write-token-sha256");
    if (!storedHash && allowFirstClaim) {
      await this.state.storage.put("write-token-sha256", suppliedHash);
      await this.state.storage.put("created-at", new Date().toISOString());
      return true;
    }
    if (!storedHash) return false;
    return constantTimeEqual(storedHash, suppliedHash);
  }

  async unauthorized() {
    const key = "auth-failures";
    const now = Date.now();
    let record = await this.state.storage.get(key);
    if (!record || !Number.isFinite(record.windowStartedAt)
        || now < record.windowStartedAt || now - record.windowStartedAt >= 60_000) {
      record = { windowStartedAt: now, count: 0 };
    }
    if (record.count >= 12) {
      return jsonResponse({ error: "Too many vault authentication attempts. Try again in one minute." }, 429);
    }
    await this.state.storage.put(key, {
      windowStartedAt: record.windowStartedAt,
      count: record.count + 1
    });
    return jsonResponse({ error: "Vault credentials were not accepted." }, 401);
  }

  async fetch(request) {
    this.vaultId = request.headers.get("X-Vault-Id") || "";
    if (!VAULT_ID_PATTERN.test(this.vaultId)) return jsonResponse({ error: "Invalid vault identifier." }, 400);

    const path = new URL(request.url).pathname;
    const requiresPacketIndex = path === "/index" || path.startsWith("/day/");
    return this.serialized(async () => {
      // Check the session before processing this request.
      if (requiresPacketIndex) {
        if (!(await this.authenticateDeviceSession(request, { touch: false }))) {
          return this.unauthorized();
        }

        if (!this.initialized) {
          this.initialized = (async () => {
            if (!(await this.state.storage.get("vault-index"))) {
              // Stop when the stored index cannot be read.
              const index = await this.env.VAULT_PACKETS.get(this.indexKey(), "json");
              await this.state.storage.put("vault-index", index || {});
            }
          })();
        }
        try {
          await this.initialized;
        } catch {
          this.initialized = null;
          return jsonResponse({
            error: "The vault index is temporarily unavailable. Please retry; no data was changed."
          }, 503);
        }
      }

      // Handle internal initialization operations.
      if (path === "/admin/initialize") {
        const token = request.headers.get("X-Write-Token") || "";
        if (!TOKEN_PATTERN.test(token)) return jsonResponse({ error: "Invalid initial write token." }, 400);
        const existing = await this.state.storage.get("write-token-sha256");
        if (existing) return jsonResponse({ error: "Vault is already initialized." }, 409);
        await this.state.storage.put("write-token-sha256", await sha256Hex(token));
        await this.state.storage.put("created-at", new Date().toISOString());
        return jsonResponse({ ok: true }, 200);
      }

      if (path === "/admin/migrate-legacy") {
        const oldToken = request.headers.get("X-Legacy-Write-Token") || "";
        const newToken = request.headers.get("X-Write-Token") || "";
        if (!TOKEN_PATTERN.test(oldToken) || !TOKEN_PATTERN.test(newToken)) {
          return jsonResponse({ error: "The legacy upgrade credentials are invalid." }, 400);
        }
        const storedHash = await this.state.storage.get("write-token-sha256");
        if (!storedHash || !constantTimeEqual(storedHash, await sha256Hex(oldToken))) {
          return this.unauthorized();
        }
        await this.state.storage.put("write-token-sha256", await sha256Hex(newToken));
        await this.state.storage.put("upgraded-at", new Date().toISOString());
        return jsonResponse({ ok: true }, 200);
      }

      if (path === "/admin/rotate-token") {
        const token = request.headers.get("X-Write-Token") || "";
        if (!TOKEN_PATTERN.test(token)) return jsonResponse({ error: "Invalid replacement token." }, 400);
        if (!(await this.state.storage.get("write-token-sha256"))) {
          return jsonResponse({ error: "Vault has not been initialized." }, 404);
        }
        // Clear active sessions before updating account metadata.
        await this.revokeAllDeviceSessions();
        await this.state.storage.put("write-token-sha256", await sha256Hex(token));
        return jsonResponse({ ok: true }, 200);
      }

      if (path === "/device/challenge") {
        return this.createDeviceChallenge(request);
      }

      if (path === "/device/verify") {
        return this.verifyDeviceChallenge(request);
      }

      if (path === "/device/session/revoke") {
        return this.revokeDeviceSession(request);
      }

      if (path === "/claim") {
        // Validate the supplied credential before completing the claim.
        if (request.headers.get("X-Device-Session")) {
          if (!(await this.authenticateDeviceSession(request))) return this.unauthorized();
        } else if (!(await this.authenticate(request))) {
          return this.unauthorized();
        }
        return jsonResponse({ ok: true, claimed: true }, 200);
      }

      const authenticatedSession = await this.authenticateDeviceSession(request);
      if (!authenticatedSession) return this.unauthorized();

      if (path === "/device/list") return this.listRegisteredDevices(authenticatedSession);
      if (path === "/device/remove") return this.removeRegisteredDevice(request, authenticatedSession);

      const voiceNoteMatch = /^\/voice-note\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2}-[a-f0-9]{32})\/(\d{1,2})$/.exec(path);
      if (voiceNoteMatch) {
        const [, voiceDate, voiceId, indexText] = voiceNoteMatch;
        const voiceIndex = Number(indexText);
        if (!validDate(voiceDate) || !validVoiceNoteId(voiceId, voiceDate)
            || !Number.isInteger(voiceIndex) || voiceIndex < 0 || voiceIndex >= MAX_VOICE_NOTE_CHUNKS) {
          return jsonResponse({ error: "Invalid voice-note reference." }, 400);
        }
        const metadataKey = "voice-note-meta:" + voiceId;
        const metadata = await this.state.storage.get(metadataKey);
        const voiceKey = this.vaultId + ":voice:" + voiceId + ":" + voiceIndex;
        if (request.method === "GET") {
          if (!metadata || metadata.dateString !== voiceDate || voiceIndex >= metadata.totalChunks) {
            return jsonResponse({ error: "The encrypted voice-note segment was not found." }, 404);
          }
          let ciphertextChunk;
          try { ciphertextChunk = await this.env.VAULT_PACKETS.get(voiceKey); }
          catch { return jsonResponse({ error: "The encrypted voice-note segment is temporarily unavailable." }, 503); }
          if (typeof ciphertextChunk !== "string") {
            return jsonResponse({ error: "The encrypted voice-note segment is still becoming available. Please retry." }, 503);
          }
          const expectedHash = metadata.chunkHashes?.[String(voiceIndex)];
          if (!expectedHash || await sha256Hex(ciphertextChunk) !== expectedHash) {
            return jsonResponse({ error: "The encrypted voice-note segment failed its integrity check." }, 503);
          }
          return jsonResponse({
            id: voiceId,
            dateString: voiceDate,
            index: voiceIndex,
            totalChunks: metadata.totalChunks,
            ciphertextLength: metadata.ciphertextLength,
            ciphertextChunk
          }, 200);
        }
        if (request.method !== "PUT") return jsonResponse({ error: "Method not allowed." }, 405);
        let upload;
        try { upload = await request.json(); }
        catch { return jsonResponse({ error: "Invalid encrypted voice-note segment upload." }, 400); }
        if (!validVoiceNoteChunkUpload(upload, voiceDate, voiceId, voiceIndex)) {
          return jsonResponse({ error: "The encrypted voice-note segment is invalid." }, 400);
        }
        if (metadata && (metadata.dateString !== voiceDate
            || metadata.totalChunks !== upload.totalChunks
            || metadata.ciphertextLength !== upload.ciphertextLength)) {
          return jsonResponse({ error: "This voice-note identifier is already bound to different attachment metadata." }, 409);
        }
        const chunkHash = await sha256Hex(upload.ciphertextChunk);
        const existingChunkHash = metadata?.chunkHashes?.[String(voiceIndex)];
        if (existingChunkHash && existingChunkHash !== chunkHash) {
          return jsonResponse({ error: "This voice-note segment is already bound to different encrypted audio." }, 409);
        }
        await this.enforceKvWriteSpacing(voiceKey);
        try { await this.env.VAULT_PACKETS.put(voiceKey, upload.ciphertextChunk); }
        catch { return jsonResponse({ error: "The encrypted voice-note segment could not be stored. Please retry." }, 503); }
        await this.state.storage.put(metadataKey, {
          dateString: voiceDate,
          totalChunks: upload.totalChunks,
          ciphertextLength: upload.ciphertextLength,
          chunkHashes: {
            ...(metadata?.chunkHashes || {}),
            [String(voiceIndex)]: chunkHash
          }
        });
        return jsonResponse({
          ok: true,
          stored: true,
          id: voiceId,
          dateString: voiceDate,
          index: voiceIndex,
          totalChunks: upload.totalChunks
        }, 200);
      }
      if (path === "/index" && request.method === "GET") {
        const index = (await this.state.storage.get("vault-index")) || {};
        return jsonResponse({ index }, 200);
      }

      const dayMatch = /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path);
      if (!dayMatch) return jsonResponse({ error: "Route not found." }, 404);
      const dateString = dayMatch[1];
      if (!validDate(dateString)) return jsonResponse({ error: "Invalid calendar date." }, 400);
      const packetStorageKey = "vault-packet:" + dateString;

      if (request.method === "GET") {
        let packet = await this.state.storage.get(packetStorageKey);
        if (!packet) {
          let stored;
          try {
            stored = await this.env.VAULT_PACKETS.get(this.packetKey(dateString), "json");
          } catch {
            return jsonResponse({
              error: "This day's cloud backup is temporarily unavailable. Please retry; no data was changed."
            }, 503);
          }
          if (stored?.packet) {
            packet = stored.packet;
            await this.state.storage.put(packetStorageKey, packet);
          }
        }
        const index = (await this.state.storage.get("vault-index")) || {};
        return jsonResponse({
          packet: packet || null,
          updatedAt: index[dateString] || null
        }, 200);
      }

      if (request.method !== "PUT") return jsonResponse({ error: "Method not allowed." }, 405);
      let update;
      try { update = await request.json(); }
      catch { return jsonResponse({ error: "Invalid JSON request body." }, 400); }
      if (!update || typeof update !== "object" || Array.isArray(update)
          || !validPacket(update.packet, dateString)
          || ![null, "none"].includes(update.baseUpdatedAt) && typeof update.baseUpdatedAt !== "string") {
        return jsonResponse({ error: "The daily packet or its version is invalid." }, 400);
      }

      const index = (await this.state.storage.get("vault-index")) || {};
      const currentVersion = index[dateString] || null;
      const suppliedBase = update.baseUpdatedAt === "none" ? null : update.baseUpdatedAt;
      if (suppliedBase !== currentVersion) {
        return jsonResponse({
          error: "This date changed on another device. Local data was kept; reload the latest version before retrying.",
          conflict: true,
          updatedAt: currentVersion
        }, 409);
      }

      await this.enforceKvWriteSpacing(this.packetKey(dateString));
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(currentVersion || "1970-01-01T00:00:00.000Z") + 1)).toISOString();
      const storedRecord = { packet: update.packet, updatedAt };

      const nextIndex = { ...index, [dateString]: updatedAt };
      // Store the updated packet.
      await this.state.storage.put(packetStorageKey, update.packet);
      await this.state.storage.put("vault-index", nextIndex);

      try {
        await this.env.VAULT_PACKETS.put(this.packetKey(dateString), JSON.stringify(storedRecord));
      } catch {
        // Preserve the stored packet while the secondary write is unavailable.
      }

      try {
        await this.enforceKvWriteSpacing(this.indexKey());
        await this.env.VAULT_PACKETS.put(this.indexKey(), JSON.stringify(nextIndex));
      } catch {
        // Refresh packet metadata from the stored value.
      }

      return jsonResponse({ ok: true, updatedAt }, 200);
    });
  }
}
