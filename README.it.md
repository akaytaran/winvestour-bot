# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

In caso di contraddizione fa fede il testo inglese.

<!-- readme:intro -->
## Cos'è

`winvestour-bot` è un piccolo motore di trading che esegui **sui tuoi account**: legge il mercato spot di Binance con la **tua** chiave API, decide con regole che un modello Claude scrive una volta al giorno e può inviare ordini reali sul tuo conto. Ogni installazione è una copia a sé — il database, la chiave Binance e la chiave API di Claude restano nel tuo hosting, e nulla in questa copia richiama il manutentore. È pensato per una persona che vuole eseguire un motore del genere per sé, leggere prima il codice e iniziare con una piccola somma.

**Indice:** [Cosa serve](#cosa-serve) · [Installare con un assistente IA](#installare-con-un-assistente-ia) · [Installazione](#installazione) · [Primo utilizzo](#primo-utilizzo) · [Costo mensile di esercizio](#costo-mensile-di-esercizio) · [FAQ / risoluzione dei problemi](#faq--risoluzione-dei-problemi) · [Contribuire](CONTRIBUTING.md)

<!-- readme:warning -->
### ⚠️ Leggi prima di installare

1. **Questo software non è una consulenza finanziaria.** Nessun profitto è promesso. Le misurazioni passate non indicano risultati futuri.
2. **Questo software può inviare da solo ordini reali con denaro reale.** In un'installazione nuova il percorso di ingresso è **ABILITATO per impostazione predefinita.** Nessun ordine viene inviato finché non aggiungi la tua chiave Binance, il tuo capitale e le tue impostazioni di rischio. Puoi disattivarlo dal pannello in qualsiasi momento.
3. **Il rischio di perdita è reale ed è interamente tuo.** Non usare denaro che hai paura di perdere.
4. Il software è fornito **con licenza MIT, "COSÌ COM'È"**, senza alcuna garanzia. L'autore e i collaboratori non si assumono alcuna responsabilità per i tuoi risultati di trading, perdite, interruzioni o difetti.
5. **La conformità è tua responsabilità.** Il trading di criptovalute è limitato o vietato in alcune giurisdizioni; rispettare la legge locale e le condizioni d'uso di Binance è tua responsabilità. Questo progetto non è affiliato a Binance né approvato da Binance.
6. **Le tasse sono tua responsabilità.**
7. Non eseguirlo senza aver letto il codice e averlo provato prima con una piccola somma.

<!-- readme:need -->
## Cosa serve

- **Un account Vercel con piano Pro.** Il motore è guidato da un'attività pianificata che gira **ogni minuto** (`vercel.json`). Il piano gratuito Hobby di Vercel consente un'attività pianificata al massimo **una volta al giorno**, e la sua documentazione dice che una pianificazione più frequente *fallisce durante il deployment* — quindi con Hobby il deployment non va online. Leggi prezzi e condizioni di Vercel prima di scegliere.
- **Un account Neon** (PostgreSQL). Il piano gratuito basta per le tabelle; la sezione sui costi qui sotto dice cosa è stato misurato.
- **Un account Upstash** (Redis). La quota del piano gratuito basta per una posizione aperta alla volta.
- **Una chiave API Anthropic.** Il modello che scrive le regole (il "Cervello") viene chiamato una volta al giorno per impostazione predefinita; un'installazione nuova nasce con il tetto di costo **vuoto**, e finché è vuoto il Cervello **non** viene chiamato.
- **Una chiave API Binance di tipo Ed25519, creata senza permesso di prelievo.** Una chiave con prelievi o trasferimento universale abilitati viene rifiutata e mai salvata.
- **Node.js e npm** sul tuo computer per i comandi di installazione, e circa **un'ora** in totale.

Questa copia non porta nulla del manutentore: il codice non legge alcun nome di dominio, non c'è nessun nome di pacchetto Android né impronta di firma nel contratto d'ambiente, e non c'è nessuna configurazione o variabile Firebase/FCM. Tutto ciò che segue nasce vuoto, e lo riempi con i tuoi valori.

| Variabile d'ambiente | Da dove viene il valore |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → il tuo progetto → stringhe di connessione (con pool · diretta) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → il tuo database → REST API. Se aggiungi Upstash dal Vercel Marketplace, imposta invece i nomi `KV_REST_API_URL` e `KV_REST_API_TOKEN`; l'app legge anche quelli. |
| `ANTHROPIC_API_KEY` | Anthropic → chiavi API (inizia con `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | il file scritto dal passo d'installazione 4 |
| `STOP_KEY_HASH` | il file scritto dal passo d'installazione 5 |
| `ENCRYPTION_MASTER_KEY` | il file scritto dal passo d'installazione 6 |
| `ENCRYPTION_KEY_VERSION` | `1` in un'installazione nuova (aumentato solo quando ruoti la chiave principale, passo 15) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | lascia vuoto; usato solo durante una rotazione della chiave principale |
| `ENGINE_MODE` | `CHEAP` (un tick al minuto dall'attività pianificata; l'unica modalità che questo README descrive) |

La chiave API Binance **non** è una variabile d'ambiente: viene inviata tramite l'app dopo l'installazione e salvata nel tuo database, cifrata con la tua chiave principale (vedi "Primo utilizzo").

## Installare con un assistente IA

Copia il blocco qui sotto così com'è e incollalo in un assistente IA (Claude, ChatGPT, Cursor o simili). Ti guida uno alla volta nei passi numerati della sezione Installazione, ti fa controllare ogni risultato e non ti chiede mai di incollare nella chat una password, una chiave o un valore di `.env`. Il blocco è in inglese di proposito ed è uguale in ogni versione linguistica di questa pagina.

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
     Check: both pages open (the interface is in English). The panel says it needs a session; the stop screen opens without a session and asks for the stop key. Continue with "First use".
  15. OPTIONAL, NOT PART OF SETUP — MASTER KEY ROTATION
     Command: `npm run rotate:encryption-key`
     Check: each row is decrypted with the old key and re-wrapped with the new one in its own transaction, and its version is raised; the new envelope is checked against the new key BEFORE anything is written. Once no row is left on the old version, `ENCRYPTION_MASTER_KEY_PREVIOUS` can be deleted. No key value is ever printed.

5. Checks. After each step, ask me to compare what I see with the Check line of that step. If it does not match, stop, do not improvise a fix, and send me to the README section "FAQ / troubleshooting" and the wiki page FAQ.

6. First use. When the deployment is Ready, guide me through the README section "First use" in this order (the panel and the stop screen are in English; the README gives each screen's and button's name):
  1. Sign in (owner password, then a one-time code per sensitive action)
  2. Read the Status tab: engine status and "Before you start"
  3. Fill in the Settings tab
  4. Capital
  5. Start the engine
  6. Stop the engine
  7. History and Technical
  8. What this release does not have
```

<!-- readme:install -->
## Installazione

Ognuno dei 15 passi qui sotto viene eseguito prima di ogni rilascio in una copia pulita di questo repository — i passi 1–14 dal controllo automatico d'installazione, il passo 15 dal controllo di rotazione della chiave. Un passo che non viene eseguito così non è scritto qui.

1. Apri gli account necessari (circa 30 minuti in totale): un account **Neon** (database PostgreSQL), un account **Upstash** (Redis), un account **Vercel** con **piano Pro** (l'app esegue un'attività pianificata ogni minuto; con il piano gratuito Hobby il deployment fallisce — vedi "Cosa serve"), una chiave API **Anthropic** e una chiave API **Binance** creata **senza permesso di prelievo**.

Risultato atteso: puoi accedere a tutti e cinque i servizi e i permessi della tua chiave API Binance non includono i prelievi.

2. Porta il codice sul tuo computer: nella pagina di questo repository scegli **Code → Download ZIP** (oppure clonalo con il tuo client git), estrailo e apri un terminale in quella cartella.

Risultato atteso: la cartella contiene `package.json` e `.env.example`.

3. Installa le dipendenze dal lock file della copia:

```sh
npm ci
```

Risultato atteso: il comando termina senza errori e compare una cartella `node_modules`.

4. Genera la password del proprietario, il segreto TOTP e il segreto di sessione. Nessun valore viene stampato, solo percorsi dei file e brevi impronte; i valori vengono scritti in una cartella fuori dal repository (predefinita: `winvestour-backup` nella tua cartella home, `-- --dir <cartella>` per un altro posto):

```sh
npm run owner:credentials
```

Risultato atteso: la cartella ora contiene `owner-credentials.txt`, `vercel-env-owner.txt`; il primo file contiene la tua password e la chiave di configurazione TOTP per la tua app di autenticazione, il secondo le tre righe `NAME=value` per il passo 9. Sullo schermo non viene stampato alcun valore, solo i percorsi dei file e brevi impronte.

5. Genera la chiave di arresto (scritta nella stessa cartella, non stampata):

```sh
npm run stop:credential
```

Risultato atteso: nella cartella compaiono `stop-key.txt`, `vercel-env-STOP_KEY_HASH.txt`; il primo contiene la chiave di arresto in chiaro che digiterai nella schermata di arresto, il secondo il suo hash per il passo 9.

6. Genera la chiave principale che cifra le tue chiavi dell'exchange (scritta nella stessa cartella, non stampata). Se questa chiave va persa, le righe cifrate non potranno più essere aperte; conserva una seconda copia nel tuo gestore di password:

```sh
npm run key:encryption-master
```

Risultato atteso: nella cartella compaiono `encryption-master-key.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt`.

7. Genera la coppia di chiavi Ed25519 per la tua chiave API Binance (scritta nella stessa cartella; la chiave privata non viene stampata):

```sh
npm run key:generate
```

Risultato atteso: nella cartella compaiono `binance-private-key.pem`, `binance-public-key.pem`. Su Binance scegli Profile → API Management → Create API → **Self-generated** e incolla il contenuto del secondo file (la chiave pubblica); il primo file (la chiave privata) lo incolli più tardi nel pannello ("Primo utilizzo").

8. Crea un database PostgreSQL vuoto: in Neon crea un progetto e copia le sue due stringhe di connessione — quella con pool diventa `DATABASE_URL`, quella diretta (senza pool) diventa `DIRECT_URL`. Scegli la regione **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`): le funzioni dell'app girano a Tokyo (`hnd1`, vedi `vercel.json`) e Neon non ha una regione a Tokyo; Singapore è la più vicina (elenco regioni di Neon, letto il 2026-09-26).

Risultato atteso: due stringhe che iniziano con `postgresql://`; il database non ha ancora tabelle.

9. Dai a ogni nome in `.env.example` il suo valore — tranne `ENCRYPTION_MASTER_KEY_PREVIOUS`, che resta vuoto (si usa solo durante una rotazione della chiave principale). Da dove viene ciascun valore è nella tabella sotto "Cosa serve"; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` vengono dai file dei passi 4–6. Per il deployment inseriscili in Vercel sotto **Settings → Environment Variables**; per un'esecuzione locale metti gli stessi nomi in un file `.env` accanto a `package.json` (git ignora quel file). I valori non entrano mai nel repository.

Risultato atteso: ogni nome in `.env.example` tranne `ENCRYPTION_MASTER_KEY_PREVIOUS` ha un valore. Se manca un nome obbligatorio, l'applicazione si ferma all'avvio e nomina la variabile mancante.

10. Crea le tabelle del database. Eseguilo una volta dal tuo computer con `DIRECT_URL` impostato (in `.env` o nel terminale); Vercel ripete lo stesso comando a ogni deployment, il che è innocuo:

```sh
npx prisma migrate deploy
```

Risultato atteso: l'output termina con `All migrations have been successfully applied.` Viene applicata una sola migrazione chiamata `0_baslangic`; ogni tabella di impostazioni parte con una riga; le impostazioni di rischio sono vuote e disattivate.

11. Verifica che il codice si compili sul tuo computer (consigliato prima del deployment):

```sh
npm run build
```

Risultato atteso: il comando termina con l'elenco delle route e senza errori; compare una cartella `.next`.

12. Avviala in locale. Quando l'applicazione è attiva, apri `http://localhost:3000/api/health` nel browser:

```sh
npm start
```

Risultato atteso: la pagina mostra `{"ok":true,"service":"engine",...}`, e `http://localhost:3000/panel` si apre e dice che il pannello richiede una sessione. All'avvio viene convalidato il contratto d'ambiente: se un nome obbligatorio manca o è malformato il server non parte, e l'errore nomina la variabile mancante, mai il suo valore. Ferma il server con Ctrl+C. Far girare il bot sul tuo computer non è ancora supportato: il motore è attivato da Vercel Cron. L'avvio locale serve solo a verificare l'installazione.

13. Fai il deployment su Vercel: invia la tua copia al tuo account GitHub, poi in Vercel scegli **Add New → Project → Import** per quel repository, mantieni il preset del framework **Next.js**, aggiungi le variabili d'ambiente del passo 9 e premi **Deploy**. Vercel esegue lo script `vercel-build`: prima rifiuta qualsiasi migrazione che cancellerebbe dati, poi crea le tabelle e compila.

Risultato atteso: il deployment raggiunge **Ready** e `https://<tuo-progetto>.vercel.app/api/health` restituisce `{"ok":true,...}`. Con il piano Hobby il deployment invece fallisce, con un messaggio che dice che le espressioni cron eseguite più di una volta al giorno non sono consentite.

14. Apri il pannello a `/panel` sul tuo indirizzo e la schermata di arresto a `/durdur`.

Risultato atteso: entrambe le pagine si aprono (l'interfaccia è in inglese). Il pannello dice che richiede una sessione; la schermata di arresto si apre senza sessione e chiede la chiave di arresto. Continua con "Primo utilizzo".

15. FACOLTATIVO, NON FA PARTE DELL'INSTALLAZIONE — ROTAZIONE DELLA CHIAVE PRINCIPALE. Se la tua chiave principale è trapelata o vuoi cambiarla: metti da parte il vecchio file di backup, esegui di nuovo il passo 6 per generare una NUOVA chiave, passa la nuova come `ENCRYPTION_MASTER_KEY`, la vecchia come `ENCRYPTION_MASTER_KEY_PREVIOUS`, e aumenta `ENCRYPTION_KEY_VERSION` di uno. Per impostazione predefinita è una PROVA A SECCO: non viene scritto nulla, si misura solo la decifrabilità; aggiungi `-- --write` per scrivere davvero:

```sh
npm run rotate:encryption-key
```

Risultato: ogni riga viene decifrata con la vecchia chiave e riavvolta con la nuova nella propria transazione, e la sua versione viene aumentata; la nuova busta viene verificata con la nuova chiave PRIMA che venga scritto qualcosa. Quando non resta nessuna riga sulla vecchia versione, `ENCRYPTION_MASTER_KEY_PREVIOUS` può essere eliminata. Nessun valore di chiave viene mai stampato.

<!-- readme:first-use -->
## Primo utilizzo

Il pannello e la schermata di arresto sono disponibili in **inglese, turco e arabo** (l'arabo da destra a sinistra); scegli la lingua dal menu **Language** in alto nel pannello, nella schermata di accesso o nella schermata di arresto — senza una scelta si aprono nella lingua del tuo browser, altrimenti in inglese (tedesco, russo, italiano e francese sono previsti). I nomi di schermate e pulsanti in questo README sono quelli inglesi; per seguirli parola per parola, scegli **English** in quel menu. Tutto quello che segue descrive esattamente ciò che il software fa oggi; niente qui è previsto o promesso. Il pannello ha quattro schede — **Status · Settings · History · Technical** — e si apre su **Status**. I nomi di schermate e pulsanti sono scritti sotto esattamente come appaiono (in inglese).

**Impostazioni:** ogni impostazione del pannello — cosa fa, il suo valore predefinito, se richiede il codice monouso, quando ha effetto — è descritta nella pagina [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide) del wiki (in inglese); le schermate sono mostrate nella [Panel guide](https://github.com/akaytaran/winvestour-bot/wiki/Panel-guide).

### 1. Accesso (password del proprietario, poi un codice monouso per ogni azione sensibile)

Apri `https://<tuo-progetto>.vercel.app/panel`. Senza sessione il pannello mostra un solo campo **Password** e un pulsante **Sign in**: scrivi la password di `owner-credentials.txt` (passo di installazione 4) e premi il pulsante — la stessa pagina apre poi il pannello. Una sessione dura **8 ore**. Una password sbagliata mostra "Wrong password, try again.". Dopo **5** tentativi sbagliati l'accesso e ogni azione sensibile sono bloccati per **15 minuti** ("Too many wrong attempts: sign-in is locked. Try again in at most 15 minutes."); la schermata di arresto non viene mai bloccata. **Sign out** è in alto nel pannello. Le azioni sensibili (aggiungere una chiave, avviare il motore, cambiare le entrate, aumentare un costo) chiedono anche il codice a 6 cifre attuale della tua app di autenticazione, nel campo "One-time code (6 digits) — from your authenticator app". Aggiungi una volta la chiave di configurazione TOTP di `owner-credentials.txt` alla tua app di autenticazione.

### 2. Leggi la scheda Status: stato del motore e "Before you start"

La scheda **ENGINE STATUS** in alto mostra uno di quattro stati, letto dal server: **Running** (in funzione) · **Stopped** (fermato da te o da una regola di protezione) · **Not running** (mai avviato, o il permesso di funzionamento è scaduto) · **Unknown** (lo stato non è leggibile; viene offerto STOP, non START). Sotto, **Before you start** elenca ciò che serve al motore: Binance key · Tick interval · Cost cap · Infrastructure cost · Single position share · Total exposure — ciascuna ✓ (fatto), ✗ (manca) o ? (non leggibile) — più due righe informative: Entry switch e Capital. Finché una riga è ✗ o ?, il pulsante **START** è nascosto e un link "First: …" porta all'impostazione. Gli avvisi (ad esempio un ordine di protezione mancante) compaiono sotto "Look at these first"; "At a glance" mostra l'ultimo giro del motore, le posizioni aperte e la commissione pagata nel periodo.

### 3. Compila la scheda Settings

- **Binance API key:** crea prima la chiave. Genera la coppia Ed25519 con `npm run key:generate` (passo di installazione 7) o con il generatore di chiavi di Binance; su Binance apri Profile → API Management → Create API → **Self-generated**, incolla la chiave pubblica, dai un nome e completa la verifica a due fattori. Permessi: lettura **attiva** (una chiave senza lettura viene rifiutata), trading spot **attivo** perché il motore possa inviare ordini, futures solo se li usi, prelievi e trasferimento universale **disattivati**. Nel pannello apri **Settings → Binance API key → Add a key (needs the one-time code)**, compila **Name**, **API key**, **Private key** (tutto il contenuto di `binance-private-key.pem`; il campo resta nascosto) e il codice monouso, e premi **Verify and save the key**. L'app controlla i permessi su Binance prima di salvare qualsiasi cosa; una chiave con prelievi o trasferimento universale attivi viene rifiutata ("Key REFUSED: …") e non viene salvata da nessuna parte. Una chiave accettata viene salvata cifrata con la tua chiave principale e non viene mai più mostrata. Con una chiave nuova il motore usa la più recente; elimina tu le vecchie chiavi su Binance.
- **Tick interval — how often the engine runs:** nasce **vuoto**; senza di esso il motore non si avvia. Apri **Change (less frequent needs no code; more frequent needs a code)** e scegli uno dei pulsanti: **ogni 1, 2 o 3 minuti**. Una modifica ha effetto **entro 20 minuti al più tardi** o al successivo avvio del motore.
- **Monthly cost cap:** nasce **vuoto**; finché è vuoto il motore decisionale (Claude) **non** viene chiamato affatto. Per farlo funzionare apri **Change the cap (…)**, spunta **Monthly total cost cap** e **Monthly infrastructure cost (the sum of your own Neon, Vercel and Upstash bills)** e scrivi entrambi in dollari al mese. Abbassare o svuotare non richiede codice; aumentare richiede il codice monouso. **Decision engine — model · frequency · candidates · candles** mostra il modello (`claude-opus-5` per impostazione predefinita) e ogni quanto viene chiamato (ogni 24 ore per impostazione predefinita).
- **Risk shares — single position · total exposure:** nascono **vuote** in una nuova installazione e non viene proposto nulla — i numeri sono tuoi. Entrambe sono una percentuale del tuo **saldo USDT libero su Binance** (gli USDT nel tuo portafoglio spot che non sono già in una posizione): **Single position share** è il massimo che UNA nuova posizione può usare; **Total exposure** è il massimo che TUTTE le posizioni aperte insieme possono usare; la quota singola non può superare il totale. In **Settings → Risk shares** scrivi tu ogni numero in **Single position share (percent of your free USDT balance)** e **Total exposure (percent of your free USDT balance)**, scrivi il codice monouso e premi **Save the risk shares** — ogni salvataggio richiede un codice nuovo. Consentito: un numero maggiore di zero con al massimo tre decimali; un campo lasciato vuoto mantiene il suo valore. I valori salvati vengono riletti dal server; le due righe di "Before you start" mostrano allora ✓. Una modifica vale dalla prossima decisione di ingresso del motore; le posizioni già aperte mantengono la loro dimensione.
- **Entry switch:** nasce **ON** — il motore può aprire nuove posizioni di sua iniziativa una volta impostato tutto il resto. Premi l'interruttore per cambiarlo; accenderlo mostra "Read before turning it on" con l'avviso in cima a questa pagina e una casella di spunta, ed entrambe le direzioni chiedono il codice monouso. Su OFF il motore continua a funzionare, uscite e protezione proseguono, ma non viene aperta alcuna nuova posizione e il motore decisionale non viene chiamato.

### 4. Capitale

Il motore opera con gli **USDT liberi nel tuo portafoglio spot Binance**, quindi la chiave richiede **Enable Spot & Margin Trading**. La dimensione di una posizione è **Single position share** × il saldo USDT libero. Binance rifiuta un ordine sotto il valore minimo d'ordine della coppia (il suo filtro NOTIONAL); il motore legge questo minimo da Binance prima di ogni ordine — sull'account del manutentore era **5 USDT** per la maggior parte delle coppie verificate e 1 USDT per alcune (misurato il 2026-09-10). Se quota × saldo libero è inferiore, nessuna posizione viene aperta; il motore continua a funzionare e a proteggere. Il pannello non si collega a Binance, quindi qui non può confrontare il saldo libero di oggi con quel minimo: la sua riga **Capital** mostra l'ultimo valore del conto misurato. Quanto depositare lo decidi tu.

### 5. Avvia il motore

Quando ogni riga di "Before you start" è ✓, la scheda Status mostra un pulsante verde **START**. Premilo, scrivi il codice in "One-time code (6 digits) — the code from your authenticator app" e premi **Start the engine**. La scheda mostra poi **Running** e "Start accepted: the run permit was granted until …" — lo stato viene riletto dal server, non indovinato. Se non è scelto alcun intervallo di tick, la risposta è "The engine did not start: no tick interval is chosen." e nulla cambia. Un ordine prudente: prima metti l'**Entry switch** su OFF, avvia il motore e osserva **Running** per un giorno, poi decidi se attivare le entrate.

### 6. Ferma il motore

Mentre il motore funziona, la scheda mostra un pulsante rosso **STOP**: scegli **Stop only** (nessuna nuova posizione; le posizioni aperte e i loro ordini di protezione sulla borsa restano come sono) o **Stop and request closing** (la richiesta di chiusura viene registrata; oggi il software non chiude le posizioni da solo), scrivi la **chiave di arresto** di `stop-key.txt` (passo di installazione 5 — non il codice monouso) e premi **Stop the engine**. Se il pannello non si apre, la **schermata di arresto** su `/durdur` ("Winvestour · stop the engine") fa lo stesso senza sessione né codice: scegli sotto **What should happen?**, scrivi la chiave in **Stop key** e premi **Stop**. La chiave non viene mai salvata nel browser.

### 7. History e Technical

**History** elenca le posizioni recenti (entrata, dimensione, commissione, lordo e netto) e ogni modifica delle impostazioni (chi, quando, vecchio → nuovo). **Technical** conserva tutto il dettaglio misurato che il pannello legge — schede di motore, giro e salute, righe delle posizioni e da dove viene ogni numero; anche queste frasi del server seguono la lingua del pannello.

### 8. Cosa non c'è in questa versione

Nessuna notifica push: in questa copia non è configurato alcun canale di notifica (niente Firebase/FCM). Il blocco biometrico esiste (**Settings → Biometric lock**, disattivato per impostazione predefinita) e richiede un controllo di impronta o volto sul dispositivo che usi. Non c'è un'app Android; il pannello è una pagina web che puoi aggiungere alla schermata principale del telefono. Far girare il bot sul tuo computer non è supportato (il motore è attivato da Vercel Cron).

<!-- readme:cost -->
## Costo mensile di esercizio

Ogni numero qui viene dalle misurazioni di questo software sul deployment del manutentore; nessuno è una stima. Con il motore in esecuzione continua in modalità economica, una posizione aperta e il Cervello chiamato una volta al giorno, il totale misurato è **≈ 9,60 – 9,90 $ al mese** (Neon ≈ 5,30 $ · Vercel ≈ 1,50 $ limite superiore · Upstash 0 $ entro la quota gratuita · Anthropic ≈ 2,84 $). Con il motore fermo, o in un'installazione nuova con le impostazioni predefinite, è **≈ 0,24 – 0,60 $ al mese**. L'abbonamento Vercel **Pro** stesso (**20 $ / mese**, prezzo letto il 2026-06-16) si aggiunge ed è la voce singola più grande. Commissioni di trading e spread non sono in questi numeri: sono il costo di un'operazione, non dell'esecuzione del software.

<details>
<summary>Dettaglio completo, ipotesi e date in cui ogni prezzo è stato letto</summary>

**Questi numeri valgono sotto un insieme di ipotesi:** il motore gira in continuo in modalità economica (un tick al minuto = 43 200 tick/mese), **una posizione è aperta** alla volta, il Cervello (Claude) viene chiamato **una volta al giorno** (impostazione predefinita: `claude-opus-5`, 24 ore), il calcolo del database è **0,25 CU**, e tutti i servizi sono su piani a pagamento.

| Voce | Cosa paga | Al mese | In parole semplici: cosa è stato misurato |
|---|---|---|---|
| **Neon** (Postgres) | ordini, posizioni, registro commissioni, log eventi | **≈ 5,30 $** | Il database non è sveglio tutto il tempo: un tocco lo tiene attivo ≈ 330 secondi, e il motore lo tocca solo ogni 20 minuti. Il tempo di veglia misurato è **≈ 27,5 % del mese** ⇒ 0,25 CU × 720 h × 27,5 % × 0,106 $/CU-h. Lasciato a 1 CU, la stessa voce diventa **≈ 21 $**. |
| **Vercel** (hosting) | la funzione serverless in cui gira ogni tick | **≈ 1,50 $ limite superiore** | 43 200 invocazioni al mese; ciascuna misurata a **≈ 1 secondo** (la cifra è calcolata su un limite superiore di 3 secondi) × 2 GB di memoria. Non c'è un'opzione più piccola: la taglia minima del provider è 2 GB. |
| **Upstash** (Redis) | permesso di esecuzione, blocco di esecuzione, registro dei tick, copia della posizione | **0 $** | **5 comandi per tick** (+2 per posizione aperta) ⇒ **≈ 302 000 comandi/mese**; la quota gratuita è **500 000/mese**. Con 4 o più posizioni simultanee la quota viene superata: **≈ 0,10–0,30 $**. |
| **Anthropic** (Claude, il "Cervello") | la generazione giornaliera delle regole | **≈ 2,84 $** | **30 chiamate** al mese × **0,094750 $** per chiamata. I token per chiamata sono stati letti **da una chiamata reale**: **7 794 in ingresso + 1 250 in uscita**. Chiamare più spesso scala linearmente: ogni 12 h ≈ 5,69 $, ogni 6 h ≈ 11,37 $. |
| **Binance** | dati di mercato + invio ordini | **0 $** | Il peso API è gratuito. **La commissione di trading non è in questa tabella** — è il costo di un'operazione, non dell'esecuzione del software, e il software la misura separatamente a ogni operazione. |
| **TOTALE** | | **≈ 9,60 – 9,90 $ / mese** | La somma delle righe. Estremo inferiore: Upstash entro la quota gratuita. Estremo superiore: quota superata. |

**Con il motore fermo / in un'INSTALLAZIONE NUOVA (impostazioni predefinite): ≈ 0,24 – 0,60 $ / mese.** In un'installazione nuova il motore non può essere avviato (l'intervallo di tick nasce vuoto e la richiesta di avvio viene rifiutata) e il tetto di costo nasce vuoto (il Cervello non viene mai chiamato). In quello stato il software produce (contato dal codice, 2026-09-24): un'invocazione del server al minuto (**1 440/giorno · 43 200/mese**), **1 comando Upstash** per invocazione (controlla se il motore può funzionare), **0 query al database** (Neon non viene mai svegliato), **0 chiamate Claude**. Il conto: invocazioni Vercel 43 200 × 0,60 $/M = 0,03 $ + memoria 2 GB × 0,53–1,43 s misurati × 43 200 ÷ 3600 = 12,7–34,3 GB-h × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $**; il tempo CPU attivo **non è stato misurato** (qui non è scritto alcun numero). Ogni apertura del pannello, misurata, aggiunge 5 query al database, 1 risveglio del database e 2 comandi Upstash; quanto spesso lo apri dipende da te.

**Quando ogni prezzo è stato letto (i prezzi cambiano — verificali tu stesso):**
- Neon `neon.com/pricing` — **2026-09-11** (Launch 0,106 $/CU-h), riletto il **2026-09-24** (invariato; piano Free 100 CU-ore/mese/progetto)
- Vercel `vercel.com/docs/functions/usage-and-pricing` — **2026-06-16** (memoria 0,0167 $/GB-h, CPU 0,202 $/h, invocazioni 0,60 $/M), riletto il **2026-09-24** (invariato); `vercel.com/docs/cron-jobs/usage-and-pricing` — "Last updated July 15, 2026", Hobby "once per day"
- Upstash `upstash.com/pricing/redis` — **2026-09-11** (gratis 500 000 comandi/mese, poi 0,20 $/100K), riletto il **2026-09-24** (invariato)
- Anthropic `platform.claude.com/docs/en/about-claude/pricing` — **2026-09-11** (`claude-opus-5` 5 $ / 25 $ per MTok)

**Telemetria di build (Next.js):** questo software non invia nulla al manutentore. Il framework Next.js che usa può inviare dati d'uso anonimi a Next.js/Vercel durante `npm run build`; quei dati non raggiungono il proprietario di questo repository. Per disattivarla, aggiungi `NEXT_TELEMETRY_DISABLED=1` al tuo ambiente di build (fonte: la documentazione Next.js, https://nextjs.org/telemetry).
</details>

<details>
<summary>Rientra nei piani gratuiti? (solo dalla documentazione di ciascun provider, letta il 2026-09-24; nessun account aperto, nulla provato)</summary>

| provider | piano gratuito (dalla documentazione) | installazione nuova (motore non avviato) | motore in esecuzione (ipotesi sopra) |
|---|---|---|---|
| **Vercel Hobby** | 1 milione di invocazioni, 360 GB-h di memoria, 4 h di CPU attiva al mese inclusi; **cron al massimo una volta al giorno** | invocazioni e memoria entro i limiti; **ma l'attività pianificata gira ogni minuto, quindi il deployment FALLISCE su Hobby** (documentazione: "Cron expressions that would run more frequently will fail during deployment") ⇒ **NON RIENTRA** | **NON RIENTRA**, stesso motivo |
| **Neon Free** | **100 CU-ore** per progetto al mese, 0,5 GB di spazio, va a zero dopo 5 minuti di inattività, fino a 2 CU | il database non viene mai toccato: **0 CU-ore ⇒ RIENTRA** | 0,25 CU × 720 h × 27,5 % di veglia misurata = **≈ 49,5 CU-ore ≤ 100 ⇒ RIENTRA** (derivato; non misurato sul piano gratuito). Se rientra, la voce Neon sopra diventa 0 $ invece di 5,30 $. |
| **Upstash Free** | **500 000 comandi** al mese, 256 MB, 10 GB di banda | 43 200 comandi (8,6 %) ⇒ **RIENTRA** | ≈ 302 000 comandi (1 posizione aperta) ⇒ **RIENTRA**; 4 o più posizioni non rientrano |
| **Anthropic** | nessun piano gratuito | 0 chiamate ⇒ 0 $ | la voce Anthropic sopra |
</details>

<!-- readme:faq -->
## FAQ / risoluzione dei problemi

### Il deployment su Vercel fallisce con un messaggio sulle espressioni cron

Sei sul piano Hobby. La documentazione di Vercel dice che un'espressione cron eseguita più di una volta al giorno *fallisce durante il deployment*; la pianificazione di questo software è ogni minuto e non si può cambiare dal pannello. Sposta il progetto in un team Pro, oppure non eseguirlo su Vercel Hobby.

### Il server non parte e stampa "ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor"

Una variabile d'ambiente manca o è malformata (questo messaggio del server è ancora in turco). Le righe sotto il messaggio nominano ogni variabile e il motivo del rifiuto (ad esempio una chiave principale che non è di 44 caratteri base64) — mai il suo valore. Confronta i tuoi nomi con `.env.example` e con la tabella sotto "Cosa serve".

### `/api/health` risponde `{"ok":true,...}` ma il pannello chiede una password, e gli endpoint delle impostazioni rispondono 401 con `{"ok":false,"reason":"NO_SESSION"}`

È lo stato atteso senza sessione. Scrivi la password del proprietario nel campo **Password** del pannello e premi **Sign in** (vedi "Primo utilizzo"); la stessa pagina apre poi il pannello, senza ricaricare.

### START non compare, oppure il motore dice "did not start: no tick interval is chosen"

START compare solo quando ogni riga di "Before you start" è ✓. Segui i link "First: …". Se l'intervallo di tick è vuoto (nasce vuoto), scegline uno in **Settings → Tick interval** e riavvia. In una nuova installazione le due quote di rischio nascono vuote: inseriscile in **Settings → Risk shares** (vedi "Primo utilizzo", passo 3).

### La mia chiave Binance viene rifiutata con **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** o **KEY_TYPE_NOT_ED25519**

Crea su Binance una nuova chiave API di tipo **Ed25519** con prelievi e trasferimento universale **disattivati**, e aggiungi quella nel pannello. Nel pannello il rifiuto si legge "Key REFUSED: …" e nomina il permesso da disattivare. Una chiave rifiutata non viene salvata né registrata.

### Devo limitare la mia chiave API Binance a un indirizzo IP?

Non con un indirizzo fisso in una normale configurazione Vercel: le funzioni Vercel usano per impostazione predefinita indirizzi IP in uscita dinamici, e gli indirizzi fissi in uscita sono la funzione a pagamento Static IPs di Vercel (100 $ al mese per progetto, documentazione Vercel letta il 2026-09-26). Senza limitazione IP vale la regola di Binance (annuncio Binance del 2021-07-26): il permesso **Enable Spot & Margin Trading** della chiave vale **90 giorni** dall'attivazione e poi viene disattivato automaticamente — riattivalo su Binance, altrimenti il motore non può inviare ordini. Binance ha inoltre comunicato che le chiavi senza limitazione IP inutilizzate per 30 giorni vengono rimosse; il pannello mostra un contatore di 30 giorni in **Settings → Binance API key → Technical details**.

### Ho perso la password, l'autenticatore (TOTP) o una chiave

- **Password o TOTP:** sposta il vecchio `owner-credentials.txt`, esegui di nuovo `npm run owner:credentials`, sostituisci `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET` e `SESSION_SECRET` in Vercel con le tre righe del nuovo `vercel-env-owner.txt` e rifai il deployment. Tutte le sessioni aperte terminano; aggiungi la nuova chiave di configurazione TOTP alla tua app di autenticazione.
- **Chiave di arresto:** sposta `stop-key.txt`, esegui `npm run stop:credential`, metti il nuovo hash in `STOP_KEY_HASH` e rifai il deployment.
- **Chiave principale persa** (`ENCRYPTION_MASTER_KEY`): la chiave Binance salvata non può più essere decifrata né recuperata. Elimina quella chiave API su Binance, sposta `encryption-master-key.txt`, esegui `npm run key:encryption-master`, metti il nuovo valore in `ENCRYPTION_MASTER_KEY`, rifai il deployment e aggiungi una nuova chiave Binance nel pannello. Se hai ancora la vecchia chiave principale e vuoi solo cambiarla, usa invece la rotazione (passo di installazione 15).
- **Chiave privata Binance persa:** elimina quella chiave API su Binance, sposta i vecchi file `.pem`, esegui `npm run key:generate`, crea una nuova chiave API con la nuova chiave pubblica e aggiungila nel pannello.

### Come disinstallo e smetto di pagare?

Prima ferma il motore (**STOP** nella scheda Status, oppure `/durdur`). Poi:
- elimina la chiave API su Binance (Profile → API Management) — da solo questo chiude ogni accesso al trading;
- elimina il progetto Vercel (Project → Settings → Delete Project) — questo rimuove l'attività pianificata che gira ogni minuto; se questo progetto era il tuo unico motivo per Vercel Pro, cambia o annulla il piano nelle impostazioni di fatturazione di Vercel;
- elimina il progetto Neon e il database Upstash nelle loro console;
- revoca la chiave API di Anthropic.

I file in `winvestour-backup` appartengono solo a questa installazione; eliminali quando non ti servono più.

### Binance risponde 451 "Service unavailable from a restricted location"

Binance blocca le richieste dagli Stati Uniti. Per questo `vercel.json` fissa le funzioni nella regione `hnd1` (Tokyo); se cambi la regione con una statunitense, ogni chiamata a Binance fallisce con 451 e il motore segnala la regione come bloccata.

### Questo software invia qualcosa al suo manutentore?

No. Chiama solo Binance (con la tua chiave), i tuoi Neon e Upstash e Anthropic (con la tua chiave). L'unico traffico di terze parti che non controlla è la telemetria di build di Next.js descritta nella sezione dei costi, che puoi disattivare con `NEXT_TELEMETRY_DISABLED=1`.

---

Contributi al codice e pull request non sono accettati; segnalazioni di bug, domande di installazione e segnalazioni di sicurezza private sono aperte — vedi [CONTRIBUTING.md](CONTRIBUTING.md) e `SECURITY.md`. Licenza: MIT (vedi `LICENSE`); puoi fare un fork e modificare la tua copia.
