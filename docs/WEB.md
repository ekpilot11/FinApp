# FinApp in the browser

The same expense tracker, rebuilt as a web app so it needs no Mac, no Xcode,
no Apple Developer account, and no seven-day expiry. You publish it from
GitHub, open it in Safari on your iPhone, and add it to the home screen. From
then on it has its own icon and opens full-screen, like any other app.

Everything you spend stays in your phone's browser storage. There is no
account and no server — GitHub only ever serves the page itself. The single
exception is opt-in and obvious: a screenshot you choose to send to Anthropic
to be read (section 5).

---

## What you gain, and what you give up

**Gained**

- No Mac at any point. Your Windows PC is enough to build, test and change it.
- No expiry. The native app dies after 7 days on a free Apple ID; this does not.
- No $99/year, no TestFlight, no App Store review.
- Instant updates: push a change, refresh the page.

**Given up**

- **Siri.** "Hey Siri, log an expense" only works for installed apps.
- **Dictation outside Safari.** iOS gives the microphone to Safari alone, so
  voice is unavailable in Chrome, Firefox and Edge on an iPhone. Everything
  else in FinApp works there.
- **Silent Apple Pay logging.** The native version could log a card tap in the
  background. Here the automation has to open the page — a second of Safari,
  then it is logged. See below.
- **Dictation is not offline.** Safari sends the audio to Apple to transcribe.
  Parsing, storage and totals still happen on the phone, but the audio itself
  leaves it. The native app could transcribe on-device.
- **Storage is the browser's.** "Clear website data" in Safari erases the
  ledger. Take a backup now and then — there is a button for it.

**Gained since, and only here**

- **Reading your bank's notifications.** iOS 27 added a Shortcuts trigger that
  fires on another app's notification and hands over its text. FinApp reads the
  amount and the shop straight out of your bank's alert — which Apple Wallet
  never carried for anything but Apple Card. Section 4a.
- **Screenshots.** For a day you logged nothing: screenshot the stack of
  notifications and Anthropic reads every purchase out of the picture at once.
  Costs a few cents and sends the image off the phone, so it is off until you
  paste in a key. Section 5.

Everything else is the same code, decision for decision: the same parser, the
same categories, the same de-duplication, the same tests.

---

## 1. Publish it (about five minutes, free)

It has to be on the public internet with an `https://` address. That is not a
preference — Safari refuses microphone access to anything else, so a page
served from your own PC over Wi-Fi cannot do voice.

Pick whichever of these two suits you.

### Option A — GitHub Pages

**This needs no computer.** The repository has to be public (Pages is not
available on private repositories on a free plan), and then it publishes
itself: the workflow switches Pages on over the API the first time it runs, so
there is nothing to configure by hand.

The address is:

```
https://ekpilot11.github.io/FinApp/
```

Every later push to `main` — or to the `claude/…` branch this was built on —
re-runs the tests and republishes. If the tests fail, nothing is published,
which is the point.

**If you ever need to run it manually from a phone:** github.com works fine in
mobile Safari. **Actions** tab → **Web** → **Run workflow** → pick the branch
→ **Run workflow**. Everything else about this project — reading the code,
editing a file, committing — works from the phone browser too.

To make the repository public if it is not: **Settings** → **General** →
scroll to **Danger Zone** → **Change repository visibility** → **Make
public**. There are no passwords or keys in it; it is app code and
documentation.

### Option B — Netlify, connected to the repository

Use this if GitHub Actions is unavailable to you — a spending limit, Actions
switched off, or a queue that never runs — or if you want to keep the
repository private. Free, and **all of it is web forms, so it works from a
phone**.

1. Go to <https://app.netlify.com> and sign up with your GitHub account.
2. **Add new site** → **Import an existing project** → **GitHub**.
3. Authorise Netlify and pick **FinApp**.
4. Set:
   - **Branch**: `main`, or the `claude/…` branch
   - **Build command**: leave empty — there is nothing to build
   - **Publish directory**: `web`
5. **Deploy**. About twenty seconds later you get an address like
   `https://cheerful-otter-1a2b3c.netlify.app`, and it redeploys itself on
   every push from then on.

Cloudflare Pages and Vercel work the same way, with the same two settings: no
build command, publish directory `web`.

> There is also <https://app.netlify.com/drop>, where you drag the `web`
> folder onto the page. It is quick from a desktop, but dragging a folder is
> awkward on a phone — prefer the repository connection above.

---

## 2. Put it on your home screen

Do this in **Safari** — see the note on other browsers below.

1. Open the address from step 1.
2. Tap the **Share** button (the square with the arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

You now have a FinApp icon. Opening it gives you the app full-screen, with no
browser chrome, and it works with no signal.

The first time you tap the microphone, iOS asks for permission. Say yes. If
you refuse by accident: **Settings → Safari → Microphone**.

### Using Chrome, Firefox or Edge instead

Every browser on iOS is Safari underneath: Apple requires WebKit, and as of
2026 nobody ships an alternative engine even where the EU permits one. So
FinApp looks and behaves identically in Chrome, and typing, screenshots,
totals, budgets, CSV and backups all work exactly the same.

Two things do not carry over:

- **Dictation.** iOS gives the microphone to Safari and to nothing else. In a
  third-party browser `webkitSpeechRecognition` is still *exposed* but never
  returns a result ([WebKit bug 239816][webkit239816]), so feature detection
  says yes and the button does nothing. FinApp checks the browser and says so
  under the microphone rather than letting you tap a dead control. Typing the
  same sentence runs the same parser, and screenshots are unaffected.
- **Your ledger.** Each browser gets its own storage, so Chrome starts empty.
  Move it across with **Settings → Download backup** in Safari, then **Restore
  backup** in Chrome. The Anthropic key is stored separately and deliberately
  left out of backups, so paste that in again by hand.

Adding to the home screen works from Chrome too (iOS 16.4 and later). What you
get is an iOS web app, not a Chrome tab — and it has *its own* storage again,
separate from both browsers, so it needs the same backup-and-restore.

[webkit239816]: https://bugs.webkit.org/show_bug.cgi?id=239816

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

## 4. Card purchases, logged automatically

There are two automations that can feed FinApp. **Start with the first one** —
it is the one that carries the amount.

### 4a. From your bank's notification (iOS 27)

Until iOS 27, nothing on iOS could read another app's notifications. iOS 27
added a **When I receive a notification from** automation trigger that hands
the notification's Title, Subtitle and Body to the automation as **Shortcut
Input** — and it runs in the background, even locked.

That is the piece this project was missing. Your bank's alert already contains
the amount and the shop; Apple Wallet never did for anything but Apple Card and
Apple Cash.

1. **FinApp → Settings → Card automations** → **Copy address** under *From your
   bank's notification*. You get:

   ```
   https://your-site/?add=1&text=NOTIFICATION
   ```

2. **Shortcuts** → **Automation** → **+** → **When I receive a notification
   from** → pick your bank's app.
3. Optionally add a filter — **Message contains** `Compra aprovada`, or
   whatever your bank writes on a purchase — so balance and marketing alerts do
   not trigger it. FinApp refuses those anyway, but filtering saves the trip.
4. Choose **Run Immediately**.
5. Add the action **Open URLs** and paste the address.
6. Delete the word `NOTIFICATION`, and with the cursor there choose **Select
   Variable → Shortcut Input → Body**. If your bank puts the amount in the
   subtitle, pass those pieces instead — FinApp also accepts
   `?add=1&title=…&subtitle=…&body=…`.
7. **Done**.

The parser is written against a real notification, kept in the tests verbatim:

```
Compra no crédito aprovada
Compra de R$ 33,50 APROVADA em Montana Viracopos Camp, às 21:02 no cartão
Master Black final 1114. Dúvidas, entre em contato com a gente
```

From that it takes **R$ 33,50**, **Montana Viracopos Camp** and **21:02** —
ignoring `final 1114`, stopping the shop name at the time rather than running
into the sign-off, and filing the purchase at 21:02 rather than whenever FinApp
happened to open. A purchase just before midnight whose alert is read just
after still lands on the day it happened.

Next purchase, FinApp opens with the amount and shop already read out of the
message. What it does with it:

- **Amount and shop both found** → logged, and the panel shows what the bank
  said.
- **Amount but no shop** → the editor opens pre-filled so you finish it, rather
  than filing a nameless row.
- **Declined** ("não aprovada", "negada", "recusada") → refused. This one
  matters: a declined purchase says *compra* and *aprovada* in the same
  sentence, so it reads as a purchase on every other test.
- **Not a purchase** (a balance, a bill, a login code) → refused, and it says
  so. Nothing is logged.
- **No readable amount** → it says so and offers **Say it** / **Type it**.

Keep `text` as the *last* parameter in the URL. A notification body can contain
an `&`, and FinApp treats anything after it that is not a parameter it knows as
more text — but only if nothing real follows.

**Running both automations is fine.** One purchase produces the same
fingerprint from either, so the ledger merges them and counts it once.

### 4b. From Apple Pay

**No app or website can read Apple Wallet.** Apple publishes no API for
transaction history; anything claiming otherwise is reading your bank, not your
Wallet.

What iOS offers is a **Transaction** automation, which fires the moment a card
in Wallet is used and can open a URL.

Be warned: **iOS only fills in the amount for Apple Card and Apple Cash.** Every
other card — including every Brazilian bank card — fires the automation with an
empty amount. Tested twice on real purchases; both arrived as `R$` with no
number. So this automation can tell you a card was used and when, and nothing
more. Section 4a is the one that works.

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

Next time you tap to pay, FinApp opens, records the purchase, and a banner
tells you what it logged. If you added FinApp to the home screen, iOS usually
opens the installed app rather than a Safari tab, because the address is
inside the app's scope.

### Why it has to open at all

The native app could do this silently through an App Intent. A web page cannot
run without being opened — that is a property of the platform, not something
FinApp can work around. The trade is a second of screen against not having to
type the purchase at all.

### What to check on the first purchase

This part could not be tested without a real iPhone and a real card, so treat
the first tap as the test:

- **If nothing happens**, the automation is probably still set to ask before
  running. Shortcuts → Automation → your automation → turn **Run Immediately**
  on and **Notify When Run** off.
- **If it opens but logs nothing**, the variables did not get inserted — the
  address still has the literal words `AMOUNT` or `MERCHANT` in it. Open the
  automation and re-insert them from the suggestion bar rather than typing
  them.
- **If the phone was locked when you paid**, iOS may hold the automation until
  you next unlock. That is iOS deciding, not FinApp.
- **If it logs the wrong category**, open the entry and change it — the
  category is guessed from the merchant name alone here, which is less to go
  on than a spoken sentence.

If the automatic route turns out to be more trouble than it is worth, the same
link works as a manual shortcut: put it on your home screen and tap it after a
purchase, or just say the purchase into the app, which is what most of this
was built for.

### Duplicates

If the automation fires twice for one tap, or you also log the same purchase
by voice, FinApp merges them. Matching is on amount, currency, merchant and a
four-day window — wide enough that a card posting three days late still
matches. Two things *you* typed are always kept as two purchases, because
silently swallowing something you just logged is worse than showing you a
duplicate you can delete.

---

## 5. Screenshots — a day's purchases in one go

Every card purchase puts a notification on your lock screen. Nothing on iOS can
read those notifications — no app, no website, no shortcut; Apple exposes no
API for it. But *you* can screenshot them, and by evening a whole day is
usually sitting there in one picture.

**Add from screenshot** on the Log tab sends that picture to Anthropic's API,
which reads every purchase in it and hands them back as a list. You check the
list, fix anything wrong, untick anything you do not want, and tap Add.

### Set it up

1. Go to <https://console.anthropic.com>, sign in, and create an API key under
   **API keys**. It starts with `sk-ant-`.
2. In FinApp: **Settings → Screenshots**, paste the key, tap elsewhere to save.

The key is stored in this browser and sent to nobody but Anthropic. It is kept
in its own storage slot, deliberately outside **Download backup**, so a backup
file stays safe to email to yourself.

### Using it

1. Screenshot your notifications — the lock screen, Notification Centre, or
   your bank's own transaction list. Several purchases in one picture is the
   point.
2. **Log → Add from screenshot**, pick the picture.
3. A few seconds later you get one row per purchase, each with amount,
   merchant, time and a guessed category, all editable.
4. Rows that look like something you already logged that day arrive
   **unticked**, with a note saying which. Tick one anyway if it really is a
   second, separate purchase — two coffees at the same place on one day is a
   real thing, and only you can tell.
5. **Add**. Undo takes the whole batch back if you were too quick.

Portuguese notifications work as well as English ones — "compra aprovada",
"estorno", "R$" and the rest are all understood, which the sentence parser
does not manage.

### What it costs, and what it gives up

- **Money.** Roughly a few cents per screenshot, billed to your own Anthropic
  account. Screenshots are downscaled to 1568px and re-encoded before sending,
  which keeps both the bill and the wait down.
- **Privacy.** This is the one part of FinApp that leaves your phone. The whole
  picture goes to Anthropic — including anything else that happened to be on
  that screen. Typing and dictation are unchanged: still local, still yours.
  If that trade is not worth it, leave the key blank and the button does
  nothing.

Nothing from a screenshot is ever saved without you seeing it first. The model
is reading blurry banners, half of them clipped by the one above, and a wrong
number sitting in your totals looks exactly like a right one — so the review
sheet is not a formality, and there is no setting to skip it.

---

## 6. Your data

Everything lives in this browser's local storage on this device. It is not
synced, not backed up, and not sent anywhere — except a screenshot you
explicitly send, as above.

That means one real risk: **clearing Safari's website data erases it.** So:

- **Settings → Download backup** writes a JSON file you can keep in Files or
  iCloud Drive. **Restore backup** reads it back.
- **Export CSV** opens in Numbers, Excel or anything else.

If you want the ledger on two devices, move the backup file across. There is
no sync, and adding one would mean adding a server — which is the thing this
version exists to avoid.

---

## 7. Changing it

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
    vision.js            the screenshot reader: request, reply, error text
    image.js             downscale + re-encode before sending
    notification-parser.js  reads your bank's alert (iOS 27 automation)
    money.js  dates.js  text.js  charts.js  csv.js  speech.js
  tests/              165 tests, run by Node
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
- **The screenshot reader is the one exception, and it is walled off.**
  Everything above `readScreenshot` in `vision.js` is a pure function over
  plain data, so the request FinApp builds and the reply it will accept are
  both tested without a network or a key. Nothing it returns is saved without
  a human tick.
- **Sentence parsing is deterministic and offline.** No model, no API key. A wrong
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
