# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

<!-- readme:intro -->
## What this is

`winvestour-bot` is a small trading engine you run **on your own accounts**: it reads the Binance spot market with **your** API key, decides with rules that a Claude model writes once a day, and can place real orders on your account. Every installation is its own copy — the database, the Binance key and the Claude API key stay in your own hosting, and nothing in this copy calls back to the maintainer. It is for one person who wants to run such an engine for themselves, read the code first, and start with a small amount.

**Contents:** [What you need](#what-you-need) · [Install with an AI assistant](#install-with-an-ai-assistant) · [Installation](#installation) · [First use](#first-use) · [Monthly running cost](#monthly-running-cost) · [FAQ / troubleshooting](#faq--troubleshooting) · [Contributing](CONTRIBUTING.md)

<!-- readme:warning -->
### ⚠️ Read before you install

1. **This software is not financial advice.** No profit is promised. Past measurements do not indicate future results.
2. **This software can place real orders with real money on its own.** In a fresh installation the entry path is **ENABLED by default.** No order is sent until you add your own Binance key, capital and risk settings. You can switch it off from the panel at any time.
3. **The risk of loss is real and entirely yours.** Do not use money you are afraid to lose.
4. The software is provided **under the MIT licence, "AS IS"**, without warranty of any kind. The author and contributors assume no responsibility for your trading results, losses, outages or defects.
5. **Compliance is your responsibility.** Crypto trading is restricted or prohibited in some jurisdictions; complying with your local law and with Binance's terms of use is your responsibility. This project is not affiliated with or endorsed by Binance.
6. **Taxes are your responsibility.**
7. Do not run it without reading the code and testing with a small amount first.

<!-- readme:need -->
## What you need

- **A Vercel account on the Pro plan.** The engine is driven by a scheduled job that runs **every minute** (`vercel.json`). Vercel's free Hobby plan allows a scheduled job at most **once per day**, and its documentation says a more frequent schedule *fails during deployment* — so on Hobby the deployment does not go live. Read Vercel's own pricing and terms before you choose.
- **A Neon account** (PostgreSQL). The free plan is enough for the tables; the cost section below says what was measured.
- **An Upstash account** (Redis). The free plan's quota is enough for one open position at a time.
- **An Anthropic API key.** The rule-writing model (the "Brain") is called once a day by default; a fresh installation is born with the cost cap **empty**, and while it is empty the Brain is **not** called.
- **A Binance API key of type Ed25519, created without withdrawal permission.** A key with withdrawals or universal transfer enabled is rejected and never stored.
- **Node.js and npm** on your computer for the setup commands, and about **one hour** in total.

This copy carries nothing of the maintainer's: the code reads no domain name, there is no Android package name or signing fingerprint in the environment contract, and there is no Firebase/FCM configuration or variable. Everything below is born empty, and you fill it in with your own values.

| Environment variable | Where the value comes from |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → your project → connection strings (pooled · direct) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → your database → REST API. If you add Upstash through the Vercel Marketplace, it sets the names `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead; the app reads those too. |
| `ANTHROPIC_API_KEY` | Anthropic → API keys (starts with `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | the file written by installation step 4 |
| `STOP_KEY_HASH` | the file written by installation step 5 |
| `ENCRYPTION_MASTER_KEY` | the file written by installation step 6 |
| `ENCRYPTION_KEY_VERSION` | `1` on a fresh installation (raised only when you rotate the master key, step 15) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | leave empty; used only during a master-key rotation |
| `ENGINE_MODE` | `CHEAP` (one tick per minute from the scheduled job; the only mode this README covers) |

The Binance API key is **not** an environment variable: it is submitted through the app after installation and stored in your database, encrypted with your master key (see "First use").

## Install with an AI assistant

Copy the block below as it is and paste it into an AI assistant (Claude, ChatGPT, Cursor or similar). It takes you through the numbered steps of the Installation section one at a time, asks you to check each result, and never asks you to paste a password, key or `.env` value into the chat. The block is in English on purpose and is the same in every language version of this page.

```text
You are helping me install winvestour-bot, a self-hosted crypto trading bot for Binance, from its GitHub README. Follow these rules exactly and go one step at a time.

1. Warning first. This software can place real orders with real money on its own decision. No profit is promised and the risk of loss is entirely mine. Before anything else, tell me to read the whole warning at the top of the README ("Read before you install") and wait until I say I have read it.

2. Vercel Pro. The app must run on a Vercel account on the Pro plan: it runs a scheduled job every minute, and on the free Hobby plan the deployment fails. Tell me this before step 1 and ask whether I have the Pro plan.

3. Secrets. Never ask me to paste passwords, API keys, TOTP secrets or .env values into this chat; tell me which command generates them on my computer and where to paste them.

4. Steps. Take me through the README's Installation steps below, in this order, with exactly these commands. Do not add, skip, reorder or change any command. Step 15 is optional and not part of the setup.
  1. Open the accounts you will need (about 30 minutes in total)
     Check: you can sign in to all five services, and your Binance API key's permissions do not include withdrawals.
  2. Get the code onto your computer
     Check: the folder contains `package.json` and `.env.example`.
  3. Install the dependencies from the copy's lock file
     Command: `npm ci`
     Check: the command ends without an error and a `node_modules` folder appears.
  4. Generate the owner password, the TOTP secret and the session secret
     Command: `npm run owner:credentials`
     Check: the folder now contains owner-credentials.txt, vercel-env-owner.txt; the first holds your password and the TOTP setup key for your authenticator app, the second the three `NAME=value` lines for step 9. No value is printed on screen, only the file paths and short fingerprints.
  5. Generate the stop key (written to the same folder, not printed)
     Command: `npm run stop:credential`
     Check: stop-key.txt, vercel-env-STOP_KEY_HASH.txt appear in the folder; the first holds the raw stop key you will type on the stop screen, the second its hash for step 9.
  6. Generate the master key that encrypts your exchange keys (written to the same folder, not printed)
     Command: `npm run key:encryption-master`
     Check: encryption-master-key.txt, vercel-env-ENCRYPTION_MASTER_KEY.txt appear in the folder.
  7. Generate the Ed25519 key pair for your Binance API key (written to the same folder; the private key is not printed)
     Command: `npm run key:generate`
     Check: binance-private-key.pem, binance-public-key.pem appear in the folder. On Binance choose Profile → API Management → Create API → Self-generated and paste the contents of the second file (the public key); you paste the first file (the private key) into the panel later ("First use").
  8. Create an empty PostgreSQL database
     Check: two strings that start with `postgresql://`; the database has no tables yet.
  9. Give every name in `.env.example` its value — except `ENCRYPTION_MASTER_KEY_PREVIOUS`, which stays empty (it is used only during a master-key rotation)
     Check: every name in `.env.example` except `ENCRYPTION_MASTER_KEY_PREVIOUS` has a value. If a required name is missing, the application stops at startup and names the missing variable.
  10. Create the database tables
     Command: `npx prisma migrate deploy`
     Check: the output ends with `All migrations have been successfully applied.` A single migration named `0_baslangic` is applied; every settings table starts with one row; the risk settings are empty and switched off.
  11. Check that the code builds on your computer (recommended before deploying)
     Command: `npm run build`
     Check: the command ends with the list of routes and no error; a `.next` folder appears.
  12. Start it locally
     Command: `npm start`
     Check: the page shows `{"ok":true,"service":"engine",...}`, and `http://localhost:3000/panel` opens and says that the panel needs a session. The environment contract is validated as the server starts: if a required name is missing or malformed the server does not come up, and the error names the missing variable, never its value. Stop the server with Ctrl+C. Running the bot on your own computer is not supported yet: the engine is triggered by Vercel Cron. Local start is only for checking the installation.
  13. Deploy on Vercel
     Check: the deployment reaches Ready, and `https://<your-project>.vercel.app/api/health` returns `{"ok":true,...}`. On the Hobby plan the deployment fails instead, with a message that cron expressions running more often than once per day are not allowed.
  14. Open the panel at `/panel` on your address, and the stop screen at `/durdur`
     Check: both pages open in your browser's language if it is one of this README's seven languages, otherwise in English; you can switch with the language menu at the top of the page. The panel says it needs a session; the stop screen opens without a session and asks for the stop key. Continue with "First use".
  15. OPTIONAL, NOT PART OF SETUP — MASTER KEY ROTATION
     Command: `npm run rotate:encryption-key`
     Check: each row is decrypted with the old key and re-wrapped with the new one in its own transaction, and its version is raised; the new envelope is checked against the new key BEFORE anything is written. Once no row is left on the old version, `ENCRYPTION_MASTER_KEY_PREVIOUS` can be deleted. No key value is ever printed.

5. Checks. After each step, ask me to compare what I see with the Check line of that step. If it does not match, stop, do not improvise a fix, and send me to the README section "FAQ / troubleshooting" and the wiki page FAQ.

6. First use. When the deployment is Ready, guide me through the README section "First use" in this order (the panel and the stop screen open in my browser's language if it is one of the README's seven languages, otherwise in English, and can be switched with the language menu at the top; the README in my language names each screen and button as the panel shows it):
  1. Sign in (owner password, then a one-time code per sensitive action)
  2. Read the Status tab: engine status and "Before you start"
  3. Fill in the Settings tab
  4. Capital
  5. Start the engine
  6. Stop the engine
  7. History and Technical
  8. What this release does not have

7. Updating. When I later ask to update this installation to a new version, take me through the README section "Updating" one step at a time with exactly its commands, and check each step's result as in rule 5. Rule 3 still applies: the database connection string and every other value stay on my computer and in Vercel, never in this chat.
```

<!-- readme:install -->
## Installation

Every one of the 15 steps below is exercised before each release in a clean copy of this repository — steps 1–14 by the automated install check, step 15 by the key-rotation check. A step that is not exercised this way is not written here.

1. Open the accounts you will need (about 30 minutes in total): a **Neon** account (PostgreSQL database), an **Upstash** account (Redis), a **Vercel** account on the **Pro plan** (the app runs a scheduled job every minute; on the free Hobby plan the deployment fails — see "What you need"), an **Anthropic** API key, and a **Binance** API key created **without withdrawal permission**.

Expected result: you can sign in to all five services, and your Binance API key's permissions do not include withdrawals.

2. Get the code onto your computer: on this repository's page choose **Code → Download ZIP** (or clone it with your own git client), extract it, and open a terminal in that folder.

Expected result: the folder contains `package.json` and `.env.example`.

3. Install the dependencies from the copy's lock file:

```sh
npm ci
```

Expected result: the command ends without an error and a `node_modules` folder appears.

4. Generate the owner password, the TOTP secret and the session secret. No value is printed, only file paths and short fingerprints; the values are written to a folder outside the repository (default: `winvestour-backup` in your home folder, `-- --dir <folder>` for another place):

```sh
npm run owner:credentials
```

Expected result: the folder now contains `owner-credentials.txt`, `vercel-env-owner.txt`; the first holds your password and the TOTP setup key for your authenticator app, the second the three `NAME=value` lines for step 9. No value is printed on screen, only the file paths and short fingerprints.

5. Generate the stop key (written to the same folder, not printed):

```sh
npm run stop:credential
```

Expected result: `stop-key.txt`, `vercel-env-STOP_KEY_HASH.txt` appear in the folder; the first holds the raw stop key you will type on the stop screen, the second its hash for step 9.

6. Generate the master key that encrypts your exchange keys (written to the same folder, not printed). If this key is lost the encrypted rows can never be opened again; keep a second copy in your password manager:

```sh
npm run key:encryption-master
```

Expected result: `encryption-master-key.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt` appear in the folder.

7. Generate the Ed25519 key pair for your Binance API key (written to the same folder; the private key is not printed):

```sh
npm run key:generate
```

Expected result: `binance-private-key.pem`, `binance-public-key.pem` appear in the folder. On Binance choose Profile → API Management → Create API → **Self-generated** and paste the contents of the second file (the public key); you paste the first file (the private key) into the panel later ("First use").

8. Create an empty PostgreSQL database: in Neon create a project and copy its two connection strings — the pooled one becomes `DATABASE_URL`, the direct (unpooled) one becomes `DIRECT_URL`. Pick the region **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`): the app's functions run in Tokyo (`hnd1`, see `vercel.json`) and Neon has no Tokyo region; Singapore is its closest one (Neon's region list, read 2026-09-26).

Expected result: two strings that start with `postgresql://`; the database has no tables yet.

9. Give every name in `.env.example` its value — except `ENCRYPTION_MASTER_KEY_PREVIOUS`, which stays empty (it is used only during a master-key rotation). Where each value comes from is in the table under "What you need"; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` come from the files of steps 4–6. For the deployment, enter them in Vercel under **Settings → Environment Variables**; for a local run, put the same names in a `.env` file next to `package.json` (git ignores that file). Values never enter the repository.

Expected result: every name in `.env.example` except `ENCRYPTION_MASTER_KEY_PREVIOUS` has a value. If a required name is missing, the application stops at startup and names the missing variable.

10. Create the database tables. Run this once from your computer with `DIRECT_URL` set (in `.env` or in the terminal); Vercel repeats the same command on every deployment, which is harmless:

```sh
npx prisma migrate deploy
```

Expected result: the output ends with `All migrations have been successfully applied.` A single migration named `0_baslangic` is applied; every settings table starts with one row; the risk settings are empty and switched off.

11. Check that the code builds on your computer (recommended before deploying):

```sh
npm run build
```

Expected result: the command ends with the list of routes and no error; a `.next` folder appears.

12. Start it locally. Once the application is up, open `http://localhost:3000/api/health` in your browser:

```sh
npm start
```

Expected result: the page shows `{"ok":true,"service":"engine",...}`, and `http://localhost:3000/panel` opens and says that the panel needs a session. The environment contract is validated as the server starts: if a required name is missing or malformed the server does not come up, and the error names the missing variable, never its value. Stop the server with Ctrl+C. Running the bot on your own computer is not supported yet: the engine is triggered by Vercel Cron. Local start is only for checking the installation.

13. Deploy on Vercel: push your copy to your own GitHub account, then in Vercel choose **Add New → Project → Import** that repository, keep the framework preset **Next.js**, add the environment variables from step 9, and press **Deploy**. Vercel runs the `vercel-build` script: it first refuses any migration that would delete data, then creates the tables and builds.

Expected result: the deployment reaches **Ready**, and `https://<your-project>.vercel.app/api/health` returns `{"ok":true,...}`. On the Hobby plan the deployment fails instead, with a message that cron expressions running more often than once per day are not allowed.

14. Open the panel at `/panel` on your address, and the stop screen at `/durdur`.

Expected result: both pages open in your browser's language if it is one of this README's seven languages, otherwise in English; you can switch with the language menu at the top of the page. The panel says it needs a session; the stop screen opens without a session and asks for the stop key. Continue with "First use".

15. OPTIONAL, NOT PART OF SETUP — MASTER KEY ROTATION. If your master key leaked or you want to change it: move the old backup file aside, run step 6 again to generate a NEW key, pass the new one as `ENCRYPTION_MASTER_KEY`, the old one as `ENCRYPTION_MASTER_KEY_PREVIOUS`, and raise `ENCRYPTION_KEY_VERSION` by one. It is a DRY RUN by default: nothing is written, only decryptability is measured; add `-- --write` to actually write:

```sh
npm run rotate:encryption-key
```

Result: each row is decrypted with the old key and re-wrapped with the new one in its own transaction, and its version is raised; the new envelope is checked against the new key BEFORE anything is written. Once no row is left on the old version, `ENCRYPTION_MASTER_KEY_PREVIOUS` can be deleted. No key value is ever printed.

<!-- readme:first-use -->
## First use

The panel and the stop screen are available in the seven languages of this README — **English · Türkçe · Deutsch · Русский · Italiano · Français · العربية**<!-- ad:@langs --> (Arabic right-to-left); pick the language from the **Language**<!-- ad:langSelect.label --> menu at the top of the panel, on the sign-in screen or on the stop screen — without a choice they open in your browser's language, otherwise in English. The screen and button names in each language's README are taken from the panel's own text in that language, so they are the names the panel shows in that language. Everything below describes exactly what the software does today; nothing here is planned or promised. The panel has four tabs — **Status · Settings · History · Technical**<!-- ad:tabs.status,tabs.settings,tabs.history,tabs.technical --> — and opens on **Status**<!-- ad:tabs.status -->. Screen and button names are written below exactly as they appear.

**Settings**<!-- ad:tabs.settings -->: every panel setting — what it does, its default, whether it needs the one-time code, when it takes effect — is described in the wiki's [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide); the screens are shown in the [Panel guide](https://github.com/akaytaran/winvestour-bot/wiki/Panel-guide).

### 1. Sign in (owner password, then a one-time code per sensitive action)

Open `https://<your-project>.vercel.app/panel`. Without a session the panel shows a single **Password**<!-- ad:login.password --> field and a **Sign in**<!-- ad:login.submit --> button: type the password from `owner-credentials.txt` (installation step 4) and press the button — the same page then opens the panel. A session lasts **8 hours**. A wrong password shows "Wrong password, try again."<!-- ad:login.wrong -->. After **5** wrong attempts sign-in and every sensitive action are locked for **15 minutes** ("Too many wrong attempts: sign-in is locked. Try again in at most 15 minutes."<!-- ad:login.locked|minutes=15 -->); the stop screen is never locked. **Sign out**<!-- ad:panel.signOut --> is at the top of the panel. Sensitive actions (adding a key, starting the engine, switching entries, raising a cost) also ask for the current 6-digit code from your authenticator app, in a field labelled "One-time code (6 digits) — from your authenticator app"<!-- ad:common.codeLabel -->. Add the TOTP setup key from `owner-credentials.txt` to your authenticator app once.

### 2. Read the Status tab: engine status and "Before you start"

The **ENGINE STATUS**<!-- ad:engine.label --> card at the top shows one of four states, read from the server: **Running**<!-- ad:engine.state.RUNNING.name --> · **Stopped**<!-- ad:engine.state.STOPPED.name --> (stopped by you or by a protection rule) · **Not running**<!-- ad:engine.state.NO_PERMIT.name --> (never started, or its run permit ran out) · **Unknown**<!-- ad:engine.state.UNKNOWN.name --> (the status could not be read; **STOP**<!-- ad:engine.stop --> is offered, **START**<!-- ad:engine.start --> is not). Below it, **Before you start**<!-- ad:engine.beforeYouStart --> lists what the engine needs: **Binance key · Tick interval · Cost cap · Infrastructure cost · Single position share · Total exposure**<!-- ad:prereq.names.key,prereq.names.tick,prereq.names.cap,prereq.names.infra,prereq.names.single,prereq.names.total --> — each marked ✓ (done), ✗ (missing) or ? (could not be read) — plus two information rows: **Entry switch**<!-- ad:prereq.names.entry --> and **Capital**<!-- ad:prereq.names.capital -->. While any row is ✗ or ?, the **START**<!-- ad:engine.start --> button is hidden and a "First: …"<!-- ad:prereq.keyFix|pre --> link takes you to the setting. Warnings (for example a missing protective order) appear under "Look at these first"<!-- ad:status.alertsHeading -->, and "At a glance"<!-- ad:status.summaryHeading --> shows the last engine run, open positions and the commission paid this period.

### 3. Fill in the Settings tab

- **Binance API key**<!-- ad:key.heading -->: create the key first. Generate the Ed25519 pair with `npm run key:generate` (installation step 7) or Binance's own key generator; on Binance open Profile → API Management → Create API → **Self-generated**, paste the public key, give it a name and finish the two-factor check. Permissions: reading **on** (a key without it is refused), spot trading **on** so the engine can place orders, futures only if you use futures, withdrawals and universal transfer **off**. In the panel open **Settings → Binance API key → Add a key (needs the one-time code)**<!-- ad:tabs.settings>key.heading>key.add -->, fill in **Name**<!-- ad:key.fieldName|head -->, **API key**<!-- ad:key.fieldApiKey|head -->, **Private key**<!-- ad:key.fieldPrivate|head --> (the whole contents of `binance-private-key.pem`; the field stays hidden) and the one-time code, and press **Verify and save the key**<!-- ad:key.submit -->. The app checks the permissions on Binance before storing anything; a key with withdrawals or universal transfer on is refused ("Key REFUSED: …"<!-- ad:key.withdrawals|pre -->) and stored nowhere. An accepted key is stored encrypted with your master key and never shown again. A new key makes the engine use the newest one; delete old keys on Binance yourself.
- **Tick interval — how often the engine runs**<!-- ad:tick.heading -->: born **empty**; the engine cannot start without it. Open **Change (less frequent needs no code; more frequent needs a code)**<!-- ad:tick.change --> and pick one of the buttons: **every 1, 2 or 3 minutes**. A change takes effect **within 20 minutes at the latest**, or when the engine is started again.
- **Monthly cost cap**<!-- ad:cap.heading -->: born **empty**; while it is empty the decision engine (Claude) is **not** called at all. To let it run, open **Change the cap (…)**<!-- ad:cap.change|paren -->, tick **Monthly total cost cap**<!-- ad:cap.fieldTotal --> and **Monthly infrastructure cost (the sum of your own Neon, Vercel and Upstash bills)**<!-- ad:cap.fieldInfra -->, and type both in dollars per month. Lowering or clearing needs no code; raising needs the one-time code. **Decision engine — model · frequency · candidates · candles**<!-- ad:brain.heading --> shows the model (`claude-opus-5` by default) and how often it is called (every 24 hours by default).
- **Risk shares — single position · total exposure**<!-- ad:caps.heading -->: born **empty** on a fresh installation, and nothing is suggested — the numbers are yours. Both are a percent of your **free USDT balance on Binance** (the USDT in your own spot wallet that is not already in a position): **Single position share**<!-- ad:prereq.names.single --> is the most ONE new position may use; **Total exposure**<!-- ad:prereq.names.total --> is the most ALL open positions together may use; the single share may not be larger than the total. In **Settings → Risk shares**<!-- ad:tabs.settings>caps.historyGroup --> type each number into **Single position share (percent of your free USDT balance)**<!-- ad:caps.singleLabel --> and **Total exposure (percent of your free USDT balance)**<!-- ad:caps.totalLabel -->, type the one-time code and press **Save the risk shares**<!-- ad:caps.apply --> — every save needs a new code. Allowed: a number above zero with at most three decimals; a field left empty keeps its value. The saved values are read again from the server; the two rows of "Before you start"<!-- ad:engine.beforeYouStart --> then show ✓. A change applies from the engine's next entry decision; positions already open keep their size.
- **Entry switch**<!-- ad:entry.heading -->: born **ON**<!-- ad:common.on --> — the engine may open new positions on its own decision once everything else is set. Press the switch to change it; turning it on shows "Read before turning it on"<!-- ad:entry.readFirst --> with the warning from the top of this page and a checkbox, and both directions ask for the one-time code. When it is **OFF**<!-- ad:common.off --> the engine keeps running, exits and protection continue, but no new position is opened and the decision engine is not called.

### 4. Capital

The engine trades the **free USDT in your Binance spot wallet**, so the key needs **Enable Spot & Margin Trading**. One position's size is the **Single position share**<!-- ad:prereq.names.single --> × the free USDT balance. Binance refuses an order below the pair's minimum order value (its NOTIONAL filter); the engine reads that minimum from Binance before every order — on the maintainer's account it was **5 USDT** for most pairs checked and 1 USDT for some (measured 2026-09-10). If share × free balance is below it, no position is opened; the engine keeps running and protecting. The panel does not connect to Binance, so it cannot compare today's free balance with that minimum here: its **Capital**<!-- ad:prereq.names.capital --> row shows the last measured account value. How much to deposit is your decision.

### 5. Start the engine

When every row of "Before you start"<!-- ad:engine.beforeYouStart --> is ✓, the **Status**<!-- ad:tabs.status --> tab shows a green **START**<!-- ad:engine.start --> button. Press it, type the code into "One-time code (6 digits) — the code from your authenticator app"<!-- ad:engine.codeLabel --> and press **Start the engine**<!-- ad:engine.startEngine -->. The card then reads **Running**<!-- ad:engine.state.RUNNING.name --> and says "Start accepted: the engine may run until …"<!-- ad:engine.started|upto:until --> — the status is read again from the server, not guessed. If no tick interval is chosen the answer is "The engine did not start: no tick interval is chosen."<!-- ad:engine.notStartedTick|s1 --> and nothing changes. A careful order: switch the **Entry switch**<!-- ad:entry.heading --> **OFF**<!-- ad:common.off --> first, start the engine and watch **Running**<!-- ad:engine.state.RUNNING.name --> for a day, then decide whether to switch entries on.

### 6. Stop the engine

While the engine runs, the card shows a red **STOP**<!-- ad:engine.stop --> button: choose **Stop only**<!-- ad:stop.modes.HOLD.title --> (no new position; open positions and their protective orders on the exchange stay as they are) or **Stop and request closing**<!-- ad:stop.modes.CLOSE_ALL.title --> (the close request is recorded; the software does not close positions itself today), type the **stop key** from `stop-key.txt` (installation step 5 — not the one-time code) and press **Stop the engine**<!-- ad:stop.sendPanel -->. If the panel cannot be opened, the **stop screen** at `/durdur` ("Winvestour · stop the engine"<!-- ad:stop.title -->) does the same without a session or code: choose under **What should happen?**<!-- ad:stop.legend -->, type the key into **Stop key**<!-- ad:stop.keyLabel --> and press **Stop**<!-- ad:stop.send -->. The key is never stored in the browser.

### 7. History and Technical

**History**<!-- ad:tabs.history --> lists recent positions (entry, size, commission, gross and net) and every setting change (who, when, old → new). **Technical**<!-- ad:tabs.technical --> keeps the full measured detail the panel reads — engine, run and health cards, position lines and where each number comes from; these server sentences follow the panel's language too.

### 8. What this release does not have

No push notifications: this copy has no notification carrier configured (no Firebase/FCM). The biometric lock exists (**Settings → Biometric lock**<!-- ad:tabs.settings>lock.heading -->, off by default) and needs a fingerprint or face check on the device you use. There is no Android app; the panel is a web page you can add to your phone's home screen. Running the bot on your own computer is not supported (the engine is triggered by Vercel Cron).

<!-- readme:cost -->
## Monthly running cost

Every number here comes from this software's own measurements on the maintainer's deployment; none is an estimate. With the engine running continuously in cheap mode, one open position, and the Brain called once a day, the measured total is **≈ $9.60 – $9.90 per month** (Neon ≈ $5.30 · Vercel ≈ $1.50 upper bound · Upstash $0 within the free quota · Anthropic ≈ $2.84). With the engine stopped, or on a fresh installation with default settings, it is **≈ $0.24 – $0.60 per month**. The Vercel **Pro** membership itself (**$20 / month**, price read 2026-06-16) is on top of that and is the largest single item. Trading commission and spread are not in these numbers: they are the cost of a trade, not of running the software.

<details>
<summary>Full breakdown, assumptions and the dates each price was read</summary>

**These numbers hold under one set of assumptions:** the engine runs continuously in cheap mode (one tick per minute = 43,200 ticks/month), **one position is open** at a time, the Brain (Claude) is called **once per day** (default setting: `claude-opus-5`, 24 hours), the database compute is **0.25 CU**, and all services are on paid plans.

| Item | What it pays for | Per month | In plain terms: what was measured |
|---|---|---|---|
| **Neon** (Postgres) | orders, positions, fee ledger, event log | **≈ $5.30** | The database is not awake all the time: one touch keeps it up for ≈ 330 seconds, and the engine only touches it every 20 minutes. Measured wake time is **≈ 27.5% of the month** ⇒ 0.25 CU × 720 h × 27.5% × $0.106/CU-h. Left at 1 CU, the same line becomes **≈ $21**. |
| **Vercel** (hosting) | the serverless function each tick runs in | **≈ $1.50 upper bound** | 43,200 invocations per month; each measured at **≈ 1 second** (the figure is computed against a 3-second upper bound) × 2 GB of memory. There is no smaller option: the provider's smallest size is 2 GB. |
| **Upstash** (Redis) | run permit, execution lock, tick record, position copy | **$0** | **5 commands per tick** (+2 per open position) ⇒ **≈ 302,000 commands/month**; the free quota is **500,000/month**. With 4 or more concurrent positions the quota is exceeded: **≈ $0.10–0.30**. |
| **Anthropic** (Claude, the "Brain") | the daily rule generation | **≈ $2.84** | **30 calls** per month × **$0.094750** per call. Tokens per call were read **from a real call**: **7,794 in + 1,250 out**. Calling more often scales linearly: every 12 h ≈ $5.69, every 6 h ≈ $11.37. |
| **Binance** | market data + order placement | **$0** | API weight is free. **Trading commission is not in this table** — that is the cost of a trade, not of running the software, and the software measures it separately on every trade. |
| **TOTAL** | | **≈ $9.60 – $9.90 / month** | The sum of the lines. Lower end: Upstash within the free quota. Upper end: quota exceeded. |

**With the engine stopped / on a FRESH INSTALL (default settings): ≈ $0.24 – $0.60 / month.** On a fresh install the engine cannot be started (the tick interval is born empty and the start request is refused) and the cost cap is born empty (the Brain is never called). In that state the software produces (counted from the code, 2026-09-24): one server invocation per minute (**1,440/day · 43,200/month**), **1 Upstash command** per invocation (it checks whether the engine may run), **0 database queries** (Neon is never woken), **0 Claude calls**. The bill: Vercel invocations 43,200 × $0.60/M = $0.03 + memory 2 GB × measured 0.53–1.43 s × 43,200 ÷ 3600 = 12.7–34.3 GB-h × $0.0167 = $0.21–0.57 ⇒ **≈ $0.24–0.60**; active CPU time was **not measured** (no number is written for it). Each opening of the panel was measured to add 5 database queries, 1 database wake-up and 2 Upstash commands; how often you open it is up to you.

**When each price was read (prices change — verify these yourself):**
- Neon `neon.com/pricing` — **2026-09-11** (Launch $0.106/CU-h), re-read **2026-09-24** (unchanged; Free plan 100 CU-hours/month/project)
- Vercel `vercel.com/docs/functions/usage-and-pricing` — **2026-06-16** (memory $0.0167/GB-h, CPU $0.202/h, invocations $0.60/M), re-read **2026-09-24** (unchanged); `vercel.com/docs/cron-jobs/usage-and-pricing` — "Last updated July 15, 2026", Hobby "once per day"
- Upstash `upstash.com/pricing/redis` — **2026-09-11** (free 500,000 commands/month, then $0.20/100K), re-read **2026-09-24** (unchanged)
- Anthropic `platform.claude.com/docs/en/about-claude/pricing` — **2026-09-11** (`claude-opus-5` $5 / $25 per MTok)

**Build telemetry (Next.js):** this software sends nothing to the maintainer. The Next.js framework it uses may send anonymous usage data to Next.js/Vercel during `npm run build`; that data does not reach this repository's owner. To turn it off, add `NEXT_TELEMETRY_DISABLED=1` to your build environment (source: the Next.js documentation, https://nextjs.org/telemetry).
</details>

<details>
<summary>Does it fit the free tiers? (from each provider's own documentation only, read 2026-09-24; no account was opened, nothing was tried)</summary>

| provider | free tier (from the documentation) | fresh install (engine not started) | engine running (assumptions above) |
|---|---|---|---|
| **Vercel Hobby** | 1 million invocations, 360 GB-h memory, 4 h active CPU included per month; **cron at most once per day** | invocations and memory are within the limits; **but the scheduled job runs every minute, so the deployment FAILS on Hobby** (documentation: "Cron expressions that would run more frequently will fail during deployment") ⇒ **DOES NOT FIT** | **DOES NOT FIT**, same reason |
| **Neon Free** | **100 CU-hours** per project per month, 0.5 GB storage, scales to zero after 5 minutes idle, up to 2 CU | the database is never touched: **0 CU-hours ⇒ FITS** | 0.25 CU × 720 h × measured 27.5% awake = **≈ 49.5 CU-hours ≤ 100 ⇒ FITS** (derived; not measured on the free plan). If it fits, the Neon line above becomes $0 instead of $5.30. |
| **Upstash Free** | **500,000 commands** per month, 256 MB, 10 GB bandwidth | 43,200 commands (8.6%) ⇒ **FITS** | ≈ 302,000 commands (1 open position) ⇒ **FITS**; 4 or more positions do not fit |
| **Anthropic** | no free tier | 0 calls ⇒ $0 | the Anthropic line above |
</details>

<!-- readme:update -->
## Updating

Every one of the 4 steps below is exercised before each release on a copy installed from version 1.0.0 with data in its database — by the automated update check. A step that is not exercised this way is not written here.

1. Get the new version into the folder you installed from. If you cloned this repository with git, run this in that folder; if you downloaded the ZIP, download the new ZIP instead, extract it into a new folder, copy your `.env` file (if you made one) into it and continue there. Your values are not in the code: git ignores the `.env` file, the backup folder is outside the repository, and the values you entered in Vercel stay in Vercel:

```sh
git pull
```

Expected result: the command ends without a conflict and lists the changed files; the `version` field in `package.json` is the new release's number; your `.env` file is still there.

2. Install the dependencies of the new version:

```sh
npm ci
```

Expected result: the command ends without an error.

3. Apply the new version's database changes, from your computer with `DIRECT_URL` set as in installation step 10. Only the changes your database does not have yet are applied, in order; the tables are not re-created and existing rows are kept:

```sh
npx prisma migrate deploy
```

Expected result: the output ends with `All migrations have been successfully applied.` if the new version brings database changes, or says `No pending migrations to apply.` if it brings none. Your risk shares, settings and history are unchanged; updating does not start the engine and switches nothing on. If the command fails, see the wiki page Troubleshooting.

4. Deploy the new version: push the updated folder to your own GitHub repository the same way as in installation step 13; Vercel builds it automatically. Its `vercel-build` script first refuses any migration that would delete data, then runs the same migration command again (harmless: nothing is pending) and builds. The environment variables you entered in Vercel stay as they are.

Expected result: the deployment reaches **Ready** and `https://<your-project>.vercel.app/api/health` returns `{"ok":true,...}`. The panel shows the same engine state as before the update: a stopped engine stays stopped. If the new version needs a variable your deployment does not have, the server does not start and the error names the missing variable.

<!-- readme:faq -->
## FAQ / troubleshooting

### The Vercel deployment fails with a message about cron expressions

You are on the Hobby plan. Vercel's documentation says a cron expression that runs more often than once per day *fails during deployment*; this software's schedule is every minute and cannot be changed from the panel. Move the project to a Pro team, or do not run it on Vercel Hobby.

### The server does not start and prints "ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor"

An environment variable is missing or malformed (this server message is still in Turkish). The lines below that message name each variable and why it was rejected (for example a master key that is not 44 characters of base64) — never its value. Compare your names with `.env.example` and the table under "What you need".

### `/api/health` answers `{"ok":true,...}` but the panel asks for a password, and the settings endpoints answer 401 with `{"ok":false,"reason":"NO_SESSION"}`

That is the expected state without a session. Type the owner password into the panel's **Password**<!-- ad:login.password --> field and press **Sign in**<!-- ad:login.submit --> (see "First use"); the same page then opens the panel, no reload needed.

### **START**<!-- ad:engine.start --> is not shown, or the answer is "The engine did not start: no tick interval is chosen."<!-- ad:engine.notStartedTick|s1 -->

**START**<!-- ad:engine.start --> appears only when every row of "Before you start"<!-- ad:engine.beforeYouStart --> is ✓. Follow the "First: …"<!-- ad:prereq.keyFix|pre --> links. If the tick interval is empty (it is born empty), choose one in **Settings → Tick interval**<!-- ad:tabs.settings>prereq.names.tick --> and start again. On a fresh installation the two risk shares are born empty: enter them in **Settings → Risk shares**<!-- ad:tabs.settings>caps.historyGroup --> (see "First use", step 3).

### My Binance key is refused with **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** or **KEY_TYPE_NOT_ED25519**

Create a new API key on Binance of type **Ed25519** with withdrawals and universal transfer **disabled**, and add that one in the panel. In the panel the refusal reads "Key REFUSED: …"<!-- ad:key.withdrawals|pre --> and names the permission to turn off. A refused key is not stored and not logged.

### Should I restrict my Binance API key to an IP address?

Not with a fixed address on a normal Vercel setup: Vercel functions use dynamic outbound IP addresses by default, and fixed outbound addresses are Vercel's paid Static IPs feature ($100 per month per project, Vercel documentation read 2026-09-26). Without an IP restriction Binance's own rule applies (Binance announcement of 2021-07-26): the key's **Enable Spot & Margin Trading** permission is valid for **90 days** from activation and is then switched off automatically — switch it on again on Binance, otherwise the engine cannot place orders. Binance has also reported that keys without an IP restriction that stay unused for 30 days are removed; the panel shows a 30-day counter under **Settings → Binance API key → Technical details**<!-- ad:tabs.settings>key.heading>common.technicalDetails -->.

### I lost the password, the authenticator (TOTP) or a key

- **Password or TOTP:** move the old `owner-credentials.txt` away, run `npm run owner:credentials` again, replace `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET` and `SESSION_SECRET` in Vercel with the three lines of the new `vercel-env-owner.txt`, and redeploy. Every open session ends; add the new TOTP setup key to your authenticator app.
- **Stop key:** move `stop-key.txt` away, run `npm run stop:credential`, put the new hash into `STOP_KEY_HASH`, and redeploy.
- **Master key lost** (`ENCRYPTION_MASTER_KEY`): the stored Binance key cannot be decrypted any more and cannot be recovered. Delete that API key on Binance, move `encryption-master-key.txt` away, run `npm run key:encryption-master`, put the new value into `ENCRYPTION_MASTER_KEY`, redeploy, and add a new Binance key in the panel. If you still have the old master key and only want to change it, use the rotation (installation step 15) instead.
- **Binance private key lost:** delete that API key on Binance, move the old `.pem` files away, run `npm run key:generate`, create a new API key with the new public key and add it in the panel.

### How do I uninstall and stop paying?

Stop the engine first (**STOP**<!-- ad:engine.stop --> on the **Status**<!-- ad:tabs.status --> tab, or `/durdur`). Then:
- delete the API key on Binance (Profile → API Management) — this alone ends all trading access;
- delete the Vercel project (Project → Settings → Delete Project) — this removes the scheduled job that runs every minute; if this project was your only reason for Vercel Pro, change or cancel the plan in Vercel's billing settings;
- delete the Neon project and the Upstash database in their own consoles;
- revoke the Anthropic API key.

The files in `winvestour-backup` belong only to this installation; delete them when you no longer need them.

### Binance answers 451 "Service unavailable from a restricted location"

Binance blocks requests from US locations. `vercel.json` pins the functions to the `hnd1` (Tokyo) region for that reason; if you change the region to a US one, every call to Binance fails with 451 and the engine reports the region as blocked.

### Does this software send anything to its maintainer?

No. It calls only Binance (with your key), your own Neon and Upstash, and Anthropic (with your key). The only third-party traffic it does not control is the Next.js build telemetry described in the cost section, which you can switch off with `NEXT_TELEMETRY_DISABLED=1`.

---

Code contributions and pull requests are not accepted; bug reports, installation questions and private security reports are open — see [CONTRIBUTING.md](CONTRIBUTING.md) and `SECURITY.md`. Licence: MIT (see `LICENSE`); you may fork and change your own copy.
