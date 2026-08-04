# FinApp

An iPhone expense tracker you talk to.

Say *"twelve fifty on coffee at Starbucks yesterday"* and it files the amount,
merchant, category and date. Apple Pay purchases log themselves. Everything
stays on the device unless you choose to connect a bank.

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

## Running it

Requires **Xcode 16+** and an iPhone on **iOS 17+**.

```bash
open FinApp.xcodeproj
```

Then before you build:

1. Select the **FinApp** target → **Signing & Capabilities**.
2. Set **Team** to your Apple ID, and change the **Bundle Identifier** from
   `com.example.FinApp` to something of your own (`com.yourname.FinApp`).
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
FinApp/
  Models/        Expense, Budget, LinkedAccount, categories
  Services/      Parsing, speech, storage, bank sync
  Intents/       Siri and Shortcuts actions
  Views/         SwiftUI screens
FinAppTests/     Parser and de-duplication tests
server/          Optional bank-sync server (Node)
docs/            Apple Wallet and bank sync guides
```

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
