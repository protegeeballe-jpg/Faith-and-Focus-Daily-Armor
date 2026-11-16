# Faith & Focus: Daily Armor

Faith & Focus is a personal daily companion that brings faith-centered reflection, wellness routines, and a little garden into one workspace.

## What’s included

- Daily Health Checklist with progress and reflections
- Personal Diary
- Voice Notes and date-based location check-ins
- Little Garden with a visual record of ongoing progress
- A local-first experience with offline support where the browser allows

## Getting started

Open the application through the project’s published page or a local development server. Use the account screens to create an account or sign in.

Keep your sign-in details private. For the best privacy, use a device and browser profile that only you can access.

## Privacy

The app uses browser storage and may use configured cloud services for backup or synchronization. It also applies a Content Security Policy to restrict browser-loaded resources.

Some Checklist checkboxes and progress information are stored in the browser and are not encrypted at rest by the app. Encrypted vault data protects supported backup and sync copies, but this does not mean every item stored by the browser is encrypted. Use a private device and browser profile, and avoid shared or public computers.

Please review the [Privacy Policy](./privacy.html) and [Terms of Service](./terms.html) before using the app.

## Encrypted JSON export and import

Settings provides an optional encrypted JSON export and import for supported daily data. Keep exported files private, and import a backup only into the account it belongs to.

## Development

The project uses standard browser technologies. To run the automated tests:

```sh
node --test tests/*.test.mjs
```

## Project links

- [Open the application](./home.html)
- [Privacy Policy](./privacy.html)
- [Terms of Service](./terms.html)


## Cloudflare abuse protection

The Worker uses Cloudflare's native Rate Limiting bindings configured in `wrangler.toml`.
These provide approximate, per-Cloudflare-location limits without writing high-frequency
counters to Workers KV or invoking a separate global rate-limiter Durable Object.

The Worker HMACs the trusted `CF-Connecting-IP` value with a domain-separated use of
`MEMBERSHIP_PEPPER` before creating edge rate-limit keys. It does not use
`X-Forwarded-For` as a fallback. The existing per-account limits and the new per-vault
packet read/write limits use Cloudflare's native rate-limit bindings keyed by the vault ID. This avoids writing a Durable Object SQLite counter on every successful packet request.

The four `ratelimits` namespace IDs in `wrangler.toml` must be unique within the
Cloudflare account. Check that IDs `94001` through `94004` are unused before deployment.
Deploy the Worker with Wrangler CLI version 4.36.0 or later. Edge limits are approximate
and local to each Cloudflare location; they are an abuse-protection layer, not a global
daily quota or an exact accounting system.

The IP-based edge limits are reserved for account-opening and sensitive authentication
routes. Authenticated vault traffic is rate-limited by vault ID rather than IP so that
unrelated people behind the same carrier, household, or public Wi-Fi address are not
unnecessarily grouped into one quota. The native limits remain approximate and local to
each Cloudflare location.
