# FinApp

An expense tracker you talk to.

Say *"twelve fifty on coffee at Starbucks yesterday"* and it files the amount,
merchant, category and date. Apple Pay purchases log themselves. Everything
stays on the device unless you choose to connect a bank.

It exists twice, from one design:

| | Needs | Lasts | Voice | Apple Pay |
|---|---|---|---|---|
| **[Web app](docs/WEB.md)** — `web/` | a browser | forever | Safari's dictation | via a Shortcut that opens a link |
| **iPhone app** — `FinApp/` | Xcode 16 + a Mac, iOS 17+ | 7 days free / 1 year paid | on-device | silently, via an App Intent |

**No Mac? Start with the [web app](docs/WEB.md).** You host it in about a
minute (GitHub Pages, or Netlify if the repo stays private), install it to the
iPhone home screen from Safari, and it never expires. It runs the same parser — the same 15 categories, the same money handling,
the same de-duplication, tested by the same 72 assertions ported across.

## What it does

- **Voice logging.** Tap the microphone, say what you spent in one breath. The
  parser reads spoken money ("twelve fifty", "twenty five bucks", "$45.99"),
  merchants ("at Blue Bottle"), dates ("yesterday", "3 days ago", "last Friday",
  "July 12") and categories, entirely offline. A clean parse saves instantly; an
  unclear one opens for review rather than guessing.
- **Siri.** *"Hey Siri, log an expense in FinApp"* and *"Hey Siri, how much have
  I spent this month in FinApp?"* — no setup needed.
- **Apple Pay auto-logging.** A Shortcuts automation logs card taps the moment
  they happen. See below.
- **Bank sync.** Optional. Pulls in card and account transactions, including the
  physical card and direct debits.
- **Spending view.** Monthly total, daily bars, category breakdown, budget
  progress.
- **Budgets.** An overall monthly limit plus per-category limits.
- **Your data stays yours.** Stored on device; CSV export; delete everything in
  one tap.

## Running the web app

```bash
cd web
npm test          # 72 tests, no packages to install
npx http-server . # then open http://localhost:8080
```

To publish it and put it on your phone, see [docs/WEB.md](docs/WEB.md).

## Running the iPhone app

**On Windows, or without a Mac?** See
[docs/INSTALLING.md](docs/INSTALLING.md) — iOS apps can only be compiled on
macOS, but you can get this onto your phone without owning one. If the only
Mac you can reach is too old for Xcode 16, use the web app instead.

Requires **Xcode 16+** and an iPhone on **iOS 17+**.

```bash
open FinApp.xcodeproj
```

Then before you build:

1. Select the **FinApp** target → **Signing & Capabilities**.
2. Set **Team** to your Apple ID. The **Bundle Identifier** is already
   `com.victorcarbone.FinApp` — change it if that isn't you, or if Xcode says
   it's taken. It must be unique across every app Apple knows about.
3. Pick your iPhone and hit run.

Voice logging needs a real device — the Simulator has no usable microphone.

A free Apple ID works; the app expires after 7 days and you re-run it to
refresh. A paid developer account raises that to a year.

Run the tests with **⌘U**. They cover the parsing and de-duplication logic,
which is where the real complexity lives.

## About Apple Wallet

**No third-party app can read Apple Wallet or Apple Pay history — Apple exposes
no API for it.** Nothing on the App Store can do this.

What works instead is a Shortcuts **Transaction** automation, which fires when a
card is used and can hand the details to FinApp. It takes about a minute to set
up and then runs by itself:

**Shortcuts → Automation → + → Transaction → Log a card transaction**

Full walkthrough: [docs/APPLE_WALLET.md](docs/APPLE_WALLET.md).

For the physical card, online payments and direct debits — anything not tapped
through Apple Pay — use bank sync: [docs/BANK_SYNC.md](docs/BANK_SYNC.md).

If both see the same purchase, FinApp merges them into one entry.

## Project layout

```
web/             The browser version — plain ES modules, no build step
  js/            Parser, ledger, storage, screens
  tests/         The Swift test suite, ported
FinApp/
  Models/        Expense, Budget, LinkedAccount, categories
  Services/      Parsing, speech, storage, bank sync
  Intents/       Siri and Shortcuts actions
  Views/         SwiftUI screens
FinAppTests/     Parser and de-duplication tests
server/          Optional bank-sync server (Node)
tools/           Icon generator
docs/            Web, Apple Wallet and bank sync guides
```

The app icon is generated, not hand-drawn — `python3 tools/make_icon.py
FinApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png` redraws it, and a
second argument sets the size (`… web/icons/icon-192.png 192`). Edit the
colours or bar heights at the top of that script.

Built with SwiftUI, SwiftData, Swift Charts, the Speech framework and App
Intents. No third-party dependencies.

## Design notes

A few decisions worth knowing about if you plan to change things:

- **Parsing is deterministic and offline.** No model, no API key, no network on
  the logging path. Voice logging has to be faster than opening a notes app or
  nobody uses it, and purchase history should not leave the phone to be parsed.
- **A wrong guess costs a tap, not a bad record.** Anything the parser is unsure
  of opens the editor. `ExpenseParser.reviewThreshold` is the dial.
- **Money is `Decimal` everywhere.** Never `Double`. The bank server sends
  amounts as JSON strings for the same reason — `4.75` through a binary float is
  not 4.75, and that error compounds through every total.
- **No currency conversion.** Each expense keeps its own currency and totals
  only sum matching ones. A total built from a guessed rate is wrong in a way
  you cannot see.
- **De-duplication only merges automatic sources.** Two things you typed are two
  purchases. A duplicate you can delete beats FinApp silently swallowing
  something you just logged.
