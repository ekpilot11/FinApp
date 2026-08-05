# FinApp in the browser

The same expense tracker, rebuilt as a web app so it needs no Mac, no Xcode,
no Apple Developer account, and no seven-day expiry. You publish it from
GitHub, open it in Safari on your iPhone, and add it to the home screen. From
then on it has its own icon and opens full-screen, like any other app.

Everything you spend stays in your phone's browser storage. There is no
account and no server — GitHub only ever serves the page itself.

---

## What you gain, and what you give up

**Gained**

- No Mac at any point. Your Windows PC is enough to build, test and change it.
- No expiry. The native app dies after 7 days on a free Apple ID; this does not.
- No $99/year, no TestFlight, no App Store review.
- Instant updates: push a change, refresh the page.

**Given up**

- **Siri.** "Hey Siri, log an expense" only works for installed apps.
- **Silent Apple Pay logging.** The native version could log a card tap in the
  background. Here the automation has to open the page — a second of Safari,
  then it is logged. See below.
- **Dictation is not offline.** Safari sends the audio to Apple to transcribe.
  Parsing, storage and totals still happen on the phone, but the audio itself
  leaves it. The native app could transcribe on-device.
- **Storage is the browser's.** "Clear website data" in Safari erases the
  ledger. Take a backup now and then — there is a button for it.

Everything else is the same code, decision for decision: the same parser, the
same categories, the same de-duplication, the same 72 tests.

---

## 1. Publish it (about five minutes, free)

It has to be on the public internet with an `https://` address. That is not a
preference — Safari refuses microphone access to anything else, so a page
served from your own PC over Wi-Fi cannot do voice.

Pick whichever of these two suits you.

### Option A — GitHub Pages

**This repository is currently private, and GitHub Pages does not work on
private repositories on a free plan.** So either make it public first, or use
Option B.

To make it public: **Settings** → **General** → scroll to **Danger Zone** →
**Change repository visibility** → **Make public**. (There are no passwords or
keys in this repository — it is app code and documentation.)

Then:

1. **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**.
   That is the whole configuration.
3. Go to the **Actions** tab and open the most recent **Web** run. It runs the
   tests, then publishes.
4. When it finishes, the run shows the address:

   ```
   https://ekpilot11.github.io/FinApp/
   ```

Every later push to `main` — or to the `claude/…` branch this was built on —
re-runs the tests and republishes. If the tests fail, nothing is published,
which is the point.

### Option B — Netlify Drop (keeps the repository private)

Free, takes about a minute, and needs no command line.

1. On your PC, download the repository: the green **Code** button on GitHub →
   **Download ZIP**. Unzip it.
2. Go to <https://app.netlify.com/drop>.
3. Drag the **`web` folder** (not the whole project — just `web`) onto the page.
4. Netlify gives you an address like `https://cheerful-otter-1a2b3c.netlify.app`.
   That is your app.

Make a free Netlify account when it offers, otherwise the site is temporary.
Cloudflare Pages and Vercel work the same way if you prefer one of those.

To update it later, drag the new `web` folder on again. If you would rather
have it update itself on every push, connect the repository in Netlify with
publish directory `web` and no build command — it reads private repositories
on the free plan.

---

## 2. Put it on your home screen

On your iPhone, in **Safari** (not Chrome — only Safari can install web apps
on iOS):

1. Open the address from step 1.
2. Tap the **Share** button (the square with the arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

You now have a FinApp icon. Opening it gives you the app full-screen, with no
browser chrome, and it works with no signal.

The first time you tap the microphone, iOS asks for permission. Say yes. If
you refuse by accident: **Settings → Safari → Microphone**.

---

## 3. Logging by voice

Tap the microphone and say the whole thing in one breath:

> "twelve fifty on coffee at Starbucks yesterday"

FinApp reads the amount, the merchant, the date and the category, and files it.
If it is confident, it saves and offers **Undo**. If it is not, it opens the
editor with its best guess rather than saving something wrong.

It understands spoken money ("twelve fifty", "twenty five bucks", "$45.99",
"12 dollars and 50 cents"), dates ("yesterday", "last night", "3 days ago",
"two weeks ago", "last Friday", "July 12"), merchants ("at Blue Bottle",
"from Ikea") and refunds ("got refunded 30 dollars from Zara").

**The sentence parser is English-only.** You can set dictation to Portuguese
in Settings and it will transcribe correctly, but *"Gastei 25 reais no
Starbucks ontem"* will not be understood as 25 BRL at Starbucks yesterday. If
you log in another language, turn off **Save confident entries straight away**
in Settings so every entry opens for review first.

If voice is unavailable — an older browser, a refused permission, a noisy room
— the text box under the microphone takes exactly the same sentence and runs
exactly the same parser.

---

## 4. Apple Pay purchases, logged automatically

**No app and no website can read Apple Wallet.** Apple publishes no API for
transaction history; anything claiming otherwise is reading your bank, not
your Wallet.

What iOS does offer is a **Transaction** automation in the Shortcuts app,
which fires the moment a card in Wallet is used. It can open a URL, and FinApp
logs whatever the URL carries.

### Set it up

1. Open **FinApp → Settings** and tap **Copy address**. You get something like:

   ```
   https://ekpilot11.github.io/FinApp/?add=1&amount=AMOUNT&merchant=MERCHANT
   ```

2. Open the **Shortcuts** app → **Automation** tab → **+** (top right).
3. Choose **Transaction**.
4. Pick the card you want tracked (Apple Card, Apple Cash, or a card in
   Wallet). Leave **Any Amount** unless you only want large purchases.
5. Choose **Run Immediately** so it does not ask every time.
6. Tap **Next**, then **New Blank Automation**.
7. Add the action **Open URLs**.
8. Paste the address, then replace the placeholders:
   - Delete the word `AMOUNT` and, with the cursor there, tap the
     **Transaction Amount** variable from the suggestion bar.
   - Delete `MERCHANT` and insert the **Transaction Merchant** variable the
     same way.
9. Tap **Done**.

Next time you tap to pay, Safari flashes open, FinApp records the purchase,
and a banner tells you what it logged.

### Why it opens Safari

The native app could do this silently through an App Intent. A web page cannot
run without being opened — that is a property of the platform, not something
FinApp can work around. The trade is one second of Safari against not having
to type the purchase at all.

### Duplicates

If the automation fires twice for one tap, or you also log the same purchase
by voice, FinApp merges them. Matching is on amount, currency, merchant and a
four-day window — wide enough that a card posting three days late still
matches. Two things *you* typed are always kept as two purchases, because
silently swallowing something you just logged is worse than showing you a
duplicate you can delete.

---

## 5. Your data

Everything lives in this browser's local storage on this device. It is not
synced, not backed up, and not sent anywhere.

That means one real risk: **clearing Safari's website data erases it.** So:

- **Settings → Download backup** writes a JSON file you can keep in Files or
  iCloud Drive. **Restore backup** reads it back.
- **Export CSV** opens in Numbers, Excel or anything else.

If you want the ledger on two devices, move the backup file across. There is
no sync, and adding one would mean adding a server — which is the thing this
version exists to avoid.

---

## 6. Changing it

Everything is plain HTML, CSS and ES modules. No framework, no build step, no
`npm install`. The file you edit is the file that runs.

```
web/
  index.html          the shell
  styles.css          all of it
  manifest.webmanifest, sw.js, icons/   home-screen install + offline
  js/
    app.js               screens and events
    expense-parser.js    the sentence reader
    spelled-number.js    "twelve fifty" → 12, 50
    category-classifier.js
    ledger.js            storage-independent expense logic
    storage.js           localStorage
    card-import.js       the Shortcuts bridge
    money.js  dates.js  text.js  charts.js  csv.js  speech.js
  tests/              72 tests, run by Node
```

Run the tests on Windows, macOS or Linux with Node 20 or newer:

```bash
cd web
npm test
```

No packages are installed — `npm test` just calls Node's own test runner.

### Design notes

- **Money is whole cents, never a float.** `0.1 + 0.2` is not `0.3` in
  JavaScript, and that error compounds through every total. Amounts are
  integers everywhere; a float appears once, in the formatter, at the point
  the number is already becoming a string.
- **Dates use local-time calendar arithmetic.** "Yesterday" is a calendar
  question, not a duration: subtracting 86,400,000 ms across a daylight-saving
  change lands on the wrong day. The tests run in four time zones in CI for
  this reason.
- **Parsing is deterministic and offline.** No model, no API key. A wrong
  guess costs a tap, not a bad record — `REVIEW_THRESHOLD` in
  `expense-parser.js` is the dial.
- **No currency conversion.** Each expense keeps its own currency and totals
  only sum matching ones. A total built from a guessed rate is wrong in a way
  you cannot see.

---

## Running it on your PC without publishing

Useful for trying changes before pushing. With Node installed:

```bash
cd web
npx http-server -p 8080 .
```

Then open <http://localhost:8080>.

Voice works here because browsers treat `localhost` as secure. It will **not**
work if you open the same server from your phone over Wi-Fi
(`http://192.168.…`) — that is plain `http`, and Safari gives no microphone to
plain `http`. For voice on the phone you need a real `https://` address, which
is what step 1 is for.

Opening `index.html` by double-clicking it does not work either: `file://`
pages cannot load ES modules.
