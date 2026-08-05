# Getting FinApp onto your iPhone from a Windows PC

Apple only allows iOS apps to be compiled on macOS. There is no supported way
to build an iPhone app on Windows — not with a workaround, not with a different
toolchain. So the question is not *how to avoid a Mac*, it is *how little Mac
you can get away with*.

The good news: you can get the app onto your phone without owning one.

> **Before you spend anything, read this.** There is now a second version of
> FinApp that runs in the browser and installs to the iPhone home screen
> straight from Safari — no Mac, no Apple account, no $99, and no seven-day
> expiry. It is the same parser and the same design; what it gives up is Siri
> and silent Apple Pay logging. See **[WEB.md](WEB.md)**.
>
> This guide is for the native app. It is still the better one if you want
> Siri and background card logging, and it is the only one that can go on the
> App Store.

---

## Step 0 — Check it still compiles (free, do this first)

Every push builds the app and runs the tests on a GitHub-hosted Mac, so you
never need Mac access to find out whether the code is sound.

1. Go to your repository on GitHub.
2. Click the **Actions** tab.
3. If prompted, click the green button to enable workflows.
4. Open the most recent **Build** run.
5. Click the **Build and test** job to read the log.

Green means the app compiles and all tests pass. Red means there are errors —
use the **Search logs** box at the top right, type `error:`, and it jumps
straight to them. Fix, push, and the build re-runs by itself.

As of the latest commit this is **green**: the app builds and all 59 tests
pass. Confirm that before spending anything on Mac access.

Free on a public repository. On a private repo, macOS runners bill against your
included minutes at 10x the Linux rate — a few builds a day is fine.

---

## Then pick a path

| | Cost | Mac needed | App lasts | Difficulty |
|---|---|---|---|---|
| **A. Cloud Mac + TestFlight** | $99/yr + ~$5 | none | 90 days | Medium |
| **B. Borrow a Mac** | free | 20 min, once | 7 days | Easy |
| **C. Buy a used Mac mini** | ~$350 once | you own it | 7 days / 1 yr | Easy |
| **D. macOS in a VM on Windows** | free | none | — | Don't |

Recommended: **A** if you want it on your phone permanently and never want to
touch Mac hardware. **C** if you think you will keep building apps.

---

## Path A — Cloud Mac, then TestFlight

You rent a Mac over remote desktop for an hour, upload the app to Apple, and
then install it on your phone from the TestFlight app. After the first setup,
your phone gets updates over the air — no cable, no Mac.

**What you need:** an Apple Developer Program membership, **$99/year**
(apple.com/developer). This is unavoidable for this path; TestFlight is not
available on a free account.

### A1. Rent the Mac

Providers that rent by the hour include MacinCloud, MacStadium (Orka), and
Scaleway's Mac minis. Pay-as-you-go is roughly $1/hour — check current pricing,
it changes.

> **Avoid AWS EC2 Mac instances.** They bill a 24-hour minimum per allocation
> and work out to tens of dollars for what you need. It's a common trap.

Choose a plan with **Xcode pre-installed** if offered. Xcode is a 2.4 GB
download that expands to roughly 15 GB, and installing it yourself will eat an
hour of paid time.

Ask for **macOS Sonoma 14.5 or newer**. See "Which Macs can build this" below.

You connect with **Remote Desktop Connection**, which is already on Windows
(press Start, type "Remote Desktop"). The provider gives you an address,
username and password.

### A2. Get the code onto the Mac

Open the **Terminal** app on the rented Mac and paste:

```bash
git clone https://github.com/ekpilot11/FinApp.git
cd FinApp
open FinApp.xcodeproj
```

Xcode opens the project.

### A3. Sign in and set an identifier

1. Xcode menu → **Settings** → **Accounts** → **+** → Apple ID. Sign in with
   the Apple ID that has the Developer Program membership.
2. In the left sidebar of Xcode, click the blue **FinApp** icon at the top.
3. Select the **FinApp** target, then the **Signing & Capabilities** tab.
4. Tick **Automatically manage signing**.
5. Set **Team** to your name.
6. Check the **Bundle Identifier**. It is already set to
   `com.victorcarbone.FinApp`; change it if that isn't your name, or if Xcode
   reports it as taken. It must be globally unique across the App Store.

### A4. Create the app record

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) in the
   browser **on the rented Mac**.
2. **Apps** → **+** → **New App**.
3. Platform iOS, name "FinApp" (or anything), your language, and pick the
   **Bundle ID** you just set. SKU can be anything, e.g. `finapp1`.

### A5. Upload

In Xcode:

1. At the top of the window, next to the app name, change the run destination
   to **Any iOS Device (arm64)**.
2. Menu **Product** → **Archive**. This takes a few minutes.
3. When the Organizer window appears, click **Distribute App** →
   **TestFlight & App Store** → **Distribute**.
4. Wait for the upload to finish, then you can shut the rented Mac down.

### A6. Install on your phone

1. On your iPhone, install **TestFlight** from the App Store.
2. Sign in with the same Apple ID.
3. Back in App Store Connect (any browser, Windows is fine now) → your app →
   **TestFlight** tab. Wait for the build to finish processing — usually 5–15
   minutes. You may be asked a question about export compliance; the app uses
   only standard HTTPS, so the usual answer is that it does not use
   non-exempt encryption.
4. Add yourself under **Internal Testing**.
5. TestFlight on your phone will offer the build. Install it.

**Renewal:** each TestFlight build stops working after 90 days. To refresh,
rent the Mac for another 20 minutes and repeat A5. If you want to skip even
that, see "Fully automated" below.

---

## Path B — Borrow a Mac for twenty minutes

Free, and works with a plain Apple ID — no $99. The catch is that the app
**stops working after 7 days** and you must plug into a Mac again to renew it.
Fine for trying it out, annoying as a permanent arrangement.

Any Mac works — a friend's, a library's, a university lab, or the display
machines in an Apple Store (staff are generally fine with this if you ask).

**Check the Mac first** — see "Which Macs can build this" below. A Mac that
cannot run Xcode 16 is a wasted trip.

1. Bring your iPhone and its cable.
2. On the Mac, install **Xcode** from the Mac App Store if it isn't there
   already. It is a 2.4 GB download that expands to roughly 15 GB — check
   before you travel.
3. Open Terminal and run:
   ```bash
   git clone https://github.com/ekpilot11/FinApp.git
   cd FinApp
   open FinApp.xcodeproj
   ```
4. Xcode → **Settings** → **Accounts** → **+**, sign in with your normal Apple
   ID (free is fine).
5. Click the blue **FinApp** icon → **FinApp** target →
   **Signing & Capabilities**. Tick **Automatically manage signing** and set
   **Team** to your name. The **Bundle Identifier** is already
   `com.victorcarbone.FinApp` — only change it if Xcode complains it is taken.
6. Plug in your iPhone. Tap **Trust** on the phone. Select it from the device
   menu at the top of the Xcode window.
7. Press the **▶ Play** button.
8. First run only: the app will fail to launch with an untrusted-developer
   error. On your iPhone go to **Settings → General → VPN & Device Management**,
   tap your Apple ID, and tap **Trust**. Press Play in Xcode again.

The app is now on your phone and works offline. After 7 days it refuses to
launch until you repeat steps 6–7.

---

## Path C — Buy a used Mac

If you expect to keep working on this, a second-hand **Mac mini M1** runs
around $350 and is more than enough for Xcode. Four years of Path A costs more.

With your own Mac, follow Path B's steps — the app still expires every 7 days
on a free Apple ID, or lasts a year with the $99 membership.

---

## Path D — Running macOS in a virtual machine on Windows

I'd skip this, for two reasons.

**It breaks Apple's licence.** The macOS software licence agreement permits
installation only on Apple-branded hardware. Running it in a VM on a Windows PC
is a violation. That is a fact about the licence, not a technical obstacle.

**More practically, it does not solve your problem.** The whole point is to get
the app onto your phone, which means the VM has to talk to a physical iPhone
over USB. USB passthrough to iOS devices is the single most unreliable part of
these setups — the phone connects, drops mid-transfer, or is never recognised at
all, and there is no fix you can apply from inside the guest. You would spend an
evening on a slow, unsupported macOS install and still not be able to install
the app.

If cost is the concern, Path B is free and takes twenty minutes.

---

## Fully automated (optional, later)

Once the app builds green and you have the $99 membership, the whole
build-and-upload step can move into GitHub Actions: every push builds the app on
a GitHub-hosted Mac and uploads it to TestFlight by itself, and your phone
picks up the new version. No Mac, rented or otherwise, ever again.

It needs an App Store Connect API key and your signing certificate stored as
repository secrets — worth doing once the basics work, not before.

---

## Which Macs can build this

FinApp needs **iOS 17**, which needs **Xcode 15 or newer**, which needs a
recent enough macOS. Check the Mac before you travel to it:  → **About This
Mac**.

| macOS on that Mac | Verdict |
|---|---|
| **Sonoma 14.5 or newer** | Works as-is. |
| **Ventura 13.5 – Sonoma 14.4** | Xcode 15 there has the iOS 17 SDK, so it can build the app — but this project file is in Xcode 16's format and needs converting first. Ask and it will be converted. |
| **Monterey 12 or older** | Dead end. The newest Xcode for Monterey is 14.2, whose newest SDK is iOS 16.2. |

The macOS version is not a choice — Apple stops shipping new ones for a given
model. An iMac from 2015, for instance, stops at Monterey and can never build
this, no matter how much RAM it has.

**If the only Mac you can reach is in that last row, use the
[web app](WEB.md).** It needs no Mac at all.

---

## Which do I do?

1. **Today, free, no Mac ever:** publish the [web app](WEB.md) and add it to
   your home screen.
2. **Today, free:** get the Actions build green (Step 0).
3. **To hold the native app in your hand this week, free:** Path B — borrow a
   Mac that passes the table above.
4. **To keep the native app on your phone for good:** Path A — $99 + an hour
   of a rented Mac.
