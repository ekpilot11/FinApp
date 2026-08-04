# Apple Wallet and Apple Pay

## The short version

**No third-party app can read your Apple Wallet or Apple Pay transaction history.**
Apple exposes no API for it. PassKit lets an app *create* passes and *accept*
payments; it does not let an app *read* what you spent. This is a deliberate
platform restriction, not a gap any app can work around, and any app claiming
otherwise is either linking your bank (see [BANK_SYNC.md](BANK_SYNC.md)) or
asking you to forward emails.

What iOS *does* give you is a personal automation that fires the moment a card
is used. FinApp ships an App Intent designed to be its target, so Apple Pay
purchases end up logged automatically without you doing anything.

## Setting up the automation

You do this once, in the Shortcuts app.

1. Open **Shortcuts** → **Automation** tab → **+**.
2. Scroll to **Transaction** and select it.
3. Choose which card to watch. Apple Card, Apple Cash, and any card you have
   added to Wallet all appear here.
4. Turn **Ask Before Running** *off*. Leave it on and every purchase waits for
   you to tap a notification, which defeats the purpose.
5. Tap **Next**, then search for and add the action **Log a card transaction**
   (it belongs to FinApp).
6. Map the fields:
   - **Amount** → the trigger's *Transaction Amount*
   - **Merchant** → the trigger's *Transaction Merchant*

   Tap the field, then pick the variable from **Shortcut Input**.
7. Done. Tap a card at a shop and the expense appears in FinApp within seconds.

New rows show a small dot in **History** until you have glanced at them. Swipe
right to accept, or tap to edit.

## What this does and does not cover

| Spending | Covered by |
| --- | --- |
| Apple Card, Apple Cash, Apple Pay taps | The automation above |
| Physical card, online card payments, direct debits | [Bank sync](BANK_SYNC.md) |
| Cash, splitting a bill, anything else | The microphone button |

## Won't this double-count?

No. If the Shortcuts automation logs a coffee the moment you tap, and your bank
feed reports the same coffee two days later when it settles, FinApp recognises
them as one purchase and merges them.

The matching rule is: same currency, same amount, within four days, and merchant
names that share a significant word. Statement descriptors are messy, so
`SQ *BLUE BOTTLE 4471 OAKLAND CA` still matches `Blue Bottle`.

Only automatic sources are merged this way. Anything you dictate or type is left
alone — a duplicate you can see and delete is much better than FinApp quietly
swallowing something you just logged.

## The one limitation worth knowing

The Transaction trigger does not hand over a stable transaction id. FinApp
therefore builds a fingerprint from the amount, merchant and day.

The practical consequence: if you buy the exact same amount at the exact same
merchant twice on one day, and *only* the automation sees them, they collapse
into one entry. That is the intended trade — the automation misfiring twice on
one tap is far more common than two identical purchases, and an undercount you
can spot and fix beats a silent double-count you never notice. Once your bank
feed reports both, they separate again, because the bank does supply real ids.
