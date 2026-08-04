# Bank sync

Bank sync pulls card and account transactions in automatically — including the
physical card in your wallet, online payments and direct debits, none of which
the [Apple Pay automation](APPLE_WALLET.md) can see.

It is entirely optional. FinApp works fully without it; you just log by voice.

## Why a server is involved

Every bank aggregator (Plaid, GoCardless, TrueLayer, Tink) issues a **secret**
that identifies your integration, plus long-lived **access tokens** for each
connected bank. Neither may be shipped inside an app: an `.ipa` is a zip file
and anyone can read what is in it.

So FinApp puts them on a small server you run:

```
iPhone  ──device token──▶  your server  ──secret + access token──▶  Plaid ──▶ bank
```

The phone never holds a bank credential. If you lose the phone, you revoke one
device token and nothing else is exposed.

`SyncBackendProvider` in the app speaks a small, provider-neutral HTTP API, so
if you would rather use GoCardless (free for UK/EU open banking) or another
aggregator, you only reimplement the server — the app does not change.

## Running the server

The reference implementation is in [`server/`](../server) — Node 18+, Express,
about 300 lines, JSON file for storage. It is built to run as one personal
instance on the cheapest thing you can find.

```bash
cd server
npm install
cp .env.example .env
# fill in PLAID_CLIENT_ID and PLAID_SECRET
npm start
```

Get keys from the [Plaid dashboard](https://dashboard.plaid.com) → Team Settings
→ Keys. Start with `PLAID_ENV=sandbox`, which uses fake banks and fake data so
you can see the whole flow working before touching a real account. Plaid grants
production access to individuals on request; pricing is per connected account
per month.

Then in FinApp: **Settings → Bank sync**, paste the server address, and tap
**Connect a bank or card**.

### Deploying it

Any host that runs Node works — Fly.io, Railway, Render, a Raspberry Pi behind
Tailscale. Two requirements:

- **HTTPS.** iOS App Transport Security blocks plain HTTP, and you should not
  send this over plain HTTP anyway.
- **Persistent disk** for `data.json`, or you lose your bank connections on
  every redeploy. Set `DB_PATH` to a mounted volume.

Set `ALLOWED_DEVICE_TOKENS` if the URL might be guessable. Left blank, the first
device to call the server claims it and every later device is rejected.

## The API the app expects

Implement these four routes and any aggregator will work.

| Route | Returns |
| --- | --- |
| `POST /link/start` | `{ linkUrl, sessionId }` — a URL to open in a browser |
| `GET /link/status?session=` | `{ status: pending\|linked\|failed, itemId, institutionName, accounts }` |
| `GET /transactions/sync?itemId=&cursor=` | `{ added, modified, removed, nextCursor, hasMore }` |
| `POST /link/remove` | `{}` |

All requests carry `Authorization: Bearer <device token>`.

A transaction looks like this:

```json
{
  "id": "txn_abc123",
  "accountId": "acc_1",
  "amount": "4.75",
  "currency": "USD",
  "date": "2026-08-04",
  "merchant": "Blue Bottle",
  "description": "SQ *BLUE BOTTLE 4471 OAKLAND CA",
  "pending": false
}
```

Two details that matter:

- **`amount` is a string, and positive means money left the account.** Refunds
  are negative. It is a string because JSON numbers are floating point, and
  `4.75` parsed as a double is not exactly 4.75 — that error would compound
  through every total the app displays. A JSON number is still accepted, but a
  string is exact.
- **`date` is `YYYY-MM-DD` or full ISO 8601.** Date-only values are anchored to
  midday so a time-zone shift cannot move a purchase onto the previous day.

## How syncing behaves

- Each account keeps a **cursor**, so a sync only fetches what is new.
- `modified` updates an existing row — this is how a pending charge becomes its
  final settled amount.
- `removed` deletes a row, but only if you have not already reviewed it. Once
  you have looked at an entry it is yours, not the bank's.
- Imported rows arrive **unreviewed** and show a dot in History.
- Rows are de-duplicated against the Apple Pay automation; see
  [APPLE_WALLET.md](APPLE_WALLET.md#wont-this-double-count).

## Currencies

FinApp never converts between currencies. Each expense keeps the currency it
was made in, and totals only sum matching ones. There is no exchange-rate source
it could consult offline, and a total computed from a stale or guessed rate
would be wrong in a way you could not see.
