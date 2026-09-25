# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

In caso di contraddizione fa fede il testo inglese.

<!-- readme:intro -->
## Cos'è

`winvestour-bot` è un piccolo motore di trading che esegui **sui tuoi account**: legge il mercato spot di Binance con la **tua** chiave API, decide con regole che un modello Claude scrive una volta al giorno e può inviare ordini reali sul tuo conto. Ogni installazione è una copia a sé — il database, la chiave Binance e la chiave API di Claude restano nel tuo hosting, e nulla in questa copia richiama il manutentore. È pensato per una persona che vuole eseguire un motore del genere per sé, leggere prima il codice e iniziare con una piccola somma.

**Indice:** [Cosa serve](#cosa-serve) · [Installazione](#installazione) · [Primo utilizzo](#primo-utilizzo) · [Costo mensile di esercizio](#costo-mensile-di-esercizio) · [FAQ / risoluzione dei problemi](#faq--risoluzione-dei-problemi) · [Contribuire](CONTRIBUTING.md)

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
| `ENCRYPTION_KEY_VERSION` | `1` in un'installazione nuova (aumentato solo quando ruoti la chiave principale, passo 14) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | lascia vuoto; usato solo durante una rotazione della chiave principale |
| `ENGINE_MODE` | `CHEAP` (un tick al minuto dall'attività pianificata; l'unica modalità che questo README descrive) |

La chiave API Binance **non** è una variabile d'ambiente: viene inviata tramite l'app dopo l'installazione e salvata nel tuo database, cifrata con la tua chiave principale (vedi "Primo utilizzo").

<!-- readme:install -->
## Installazione

Ognuno dei 14 passi qui sotto viene eseguito prima di ogni rilascio in una copia pulita di questo repository — i passi 1–13 dal controllo automatico d'installazione, il passo 14 dal controllo di rotazione della chiave. Un passo che non viene eseguito così non è scritto qui.

1. Apri gli account necessari (circa 30 minuti in totale): un account **Neon** (database PostgreSQL), un account **Upstash** (Redis), un account **Vercel** con **piano Pro** (l'app esegue un'attività pianificata ogni minuto; con il piano gratuito Hobby il deployment fallisce — vedi "Cosa serve"), una chiave API **Anthropic** e una chiave API **Binance** creata **senza permesso di prelievo**.

Risultato atteso: puoi accedere a tutti e quattro i servizi e i permessi della tua chiave API Binance non includono i prelievi.

2. Porta il codice sul tuo computer: nella pagina di questo repository scegli **Code → Download ZIP** (oppure clonalo con il tuo client git), estrailo e apri un terminale in quella cartella.

Risultato atteso: la cartella contiene `package.json` e `.env.example`.

3. Installa le dipendenze dal lock file della copia:

```sh
npm ci
```

Risultato atteso: il comando termina senza errori e compare una cartella `node_modules`.

4. Genera la password del proprietario, il segreto TOTP e il segreto di sessione. I valori non vengono stampati; vengono scritti in una cartella fuori dal repository (predefinita: `winvestour-yedek` nella tua cartella home, `-- --dir <cartella>` per un altro posto):

```sh
npm run owner:credentials
```

Risultato atteso: la cartella ora contiene `sahip-kimlik.txt`, `vercel-env-g04.json`; il primo file contiene la tua password e la chiave di configurazione TOTP per la tua app di autenticazione, il secondo i tre valori per il passo 8. Sullo schermo non viene stampato nulla.

5. Genera la chiave di arresto (scritta nella stessa cartella, non stampata):

```sh
npm run stop:credential
```

Risultato atteso: nella cartella compaiono `durdurma-anahtari.txt`, `vercel-env-STOP_KEY_HASH.txt`; il primo contiene la chiave di arresto in chiaro che digiterai nella schermata di arresto, il secondo il suo hash per il passo 8.

6. Genera la chiave principale che cifra le tue chiavi dell'exchange (scritta nella stessa cartella, non stampata). Se questa chiave va persa, le righe cifrate non potranno più essere aperte; conserva una seconda copia nel tuo gestore di password:

```sh
npm run key:encryption-master
```

Risultato atteso: nella cartella compaiono `sifreleme-ana-anahtari.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt`.

7. Crea un database PostgreSQL vuoto: in Neon crea un progetto e copia le sue due stringhe di connessione — quella con pool diventa `DATABASE_URL`, quella diretta (senza pool) diventa `DIRECT_URL`.

Risultato atteso: due stringhe che iniziano con `postgresql://`; il database non ha ancora tabelle.

8. Dai a ogni nome in `.env.example` il suo valore. Da dove viene ciascun valore è nella tabella sotto "Cosa serve"; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` vengono dai file dei passi 4–6. Per il deployment inseriscili in Vercel sotto **Settings → Environment Variables**; per un'esecuzione locale metti gli stessi nomi in un file `.env` accanto a `package.json` (git ignora quel file). I valori non entrano mai nel repository.

Risultato atteso: ogni nome in `.env.example` ha un valore. Se manca un nome obbligatorio, l'applicazione si ferma all'avvio e nomina la variabile mancante.

9. Crea le tabelle del database. Eseguilo una volta dal tuo computer con `DIRECT_URL` impostato (in `.env` o nel terminale); Vercel ripete lo stesso comando a ogni deployment, il che è innocuo:

```sh
npx prisma migrate deploy
```

Risultato atteso: l'output termina con `All migrations have been successfully applied.` Viene applicata una sola migrazione chiamata `0_baslangic`; ogni tabella di impostazioni parte con una riga; le impostazioni di rischio sono vuote e disattivate.

10. Verifica che il codice si compili sul tuo computer (consigliato prima del deployment):

```sh
npm run build
```

Risultato atteso: il comando termina con l'elenco delle route e senza errori; compare una cartella `.next`.

11. Avviala in locale. Quando l'applicazione è attiva, apri `http://localhost:3000/api/health` nel browser:

```sh
npm start
```

Risultato atteso: la pagina mostra `{"ok":true,"service":"engine",...}`, e `http://localhost:3000/panel` si apre e dice che il pannello richiede una sessione. All'avvio viene convalidato il contratto d'ambiente: se un nome obbligatorio manca o è malformato il server non parte, e l'errore nomina la variabile mancante, mai il suo valore. Ferma il server con Ctrl+C.

12. Fai il deployment su Vercel: invia la tua copia al tuo account GitHub, poi in Vercel scegli **Add New → Project → Import** per quel repository, mantieni il preset del framework **Next.js**, aggiungi le variabili d'ambiente del passo 8 e premi **Deploy**. Vercel esegue lo script `vercel-build`: prima rifiuta qualsiasi migrazione che cancellerebbe dati, poi crea le tabelle e compila.

Risultato atteso: il deployment raggiunge **Ready** e `https://<tuo-progetto>.vercel.app/api/health` restituisce `{"ok":true,...}`. Con il piano Hobby il deployment invece fallisce, con un messaggio che dice che le espressioni cron eseguite più di una volta al giorno non sono consentite.

13. Apri il pannello a `/panel` sul tuo indirizzo e la schermata di arresto a `/durdur`.

Risultato atteso: entrambe le pagine si aprono (oggi l'interfaccia è in turco). Il pannello dice che richiede una sessione; la schermata di arresto si apre senza sessione e chiede la chiave di arresto. Continua con "Primo utilizzo".

14. FACOLTATIVO, NON FA PARTE DELL'INSTALLAZIONE — ROTAZIONE DELLA CHIAVE PRINCIPALE. Se la tua chiave principale è trapelata o vuoi cambiarla: metti da parte il vecchio file di backup, esegui di nuovo il passo 6 per generare una NUOVA chiave, passa la nuova come `ENCRYPTION_MASTER_KEY`, la vecchia come `ENCRYPTION_MASTER_KEY_PREVIOUS`, e aumenta `ENCRYPTION_KEY_VERSION` di uno. Per impostazione predefinita è una PROVA A SECCO: non viene scritto nulla, si misura solo la decifrabilità; aggiungi `-- --write` per scrivere davvero:

```sh
npm run rotate:encryption-key
```

Risultato: ogni riga viene decifrata con la vecchia chiave e riavvolta con la nuova nella propria transazione, e la sua versione viene aumentata; la nuova busta viene verificata con la nuova chiave PRIMA che venga scritto qualcosa. Quando non resta nessuna riga sulla vecchia versione, `ENCRYPTION_MASTER_KEY_PREVIOUS` può essere eliminata. Nessun valore di chiave viene mai stampato.

<!-- readme:first-use -->
## Primo utilizzo

Oggi l'interfaccia è solo in **turco**. Accedi dalla pagina del pannello con la password del proprietario; aggiungere la chiave Binance e avviare il motore si fanno ancora con una richiesta HTTP ciascuno (dalla console per sviluppatori del browser o da qualsiasi client HTTP) mentre sei connesso. Ogni passo qui sotto descrive esattamente cosa fa il software oggi; nulla qui è pianificato o promesso.

### 1. Accedi (password del proprietario, poi un codice monouso per ogni azione sensibile)

Apri `https://<il-tuo-progetto>.vercel.app/panel` nel browser. Senza sessione il pannello mostra un solo campo **Parola** (password) e un pulsante **Giriş yap** (accedi): scrivi la password dal file del passo 4 e premi il pulsante — la stessa pagina apre quindi il pannello. La sessione dura **8 ore**. Una password errata mostra "Parola yanlış, yeniden dene." (password errata, riprova). Dopo **5** tentativi errati l'accesso e ogni azione sensibile vengono bloccati per **15 minuti** e il pannello mostra "Çok fazla yanlış deneme yapıldı; giriş kilitlendi, en geç 15 dakika sonra yeniden dene." (troppi tentativi errati, riprova entro al massimo 15 minuti) — durante il blocco anche la password corretta viene rifiutata; la schermata di arresto non viene mai bloccata. Per chiudere la sessione premi **Çıkış yap** (esci) in cima al pannello. Le azioni sensibili (aggiungere una chiave, avviare il motore, aprire l'interruttore di ingresso, alzare un tetto di costo) richiedono inoltre il **codice a 6 cifre** corrente della tua app di autenticazione, inviato nell'header di richiesta `x-totp-code` — i moduli del pannello lo chiedono in un campo etichettato "Tek kullanımlık kod" (codice monouso). Aggiungi una volta il segreto TOTP dal file del passo 4 alla tua app di autenticazione.

### 2. Aggiungi la tua chiave API Binance (i prelievi devono essere disattivati)

Con il cookie di sessione e l'header `x-totp-code`, invia `POST /api/exchange-key` con `{"label": "<un nome qualsiasi>", "keyType": "ed25519", "apiKey": "<la tua chiave API>", "privateKeyPem": "<la tua chiave privata Ed25519, PEM>"}`. L'app verifica i permessi della chiave su Binance prima di salvare qualsiasi cosa: una chiave con prelievi o trasferimento universale abilitati viene rifiutata con **P1_WITHDRAWALS** / **P1_UNIVERSAL_TRANSFER** (HTTP 422), una chiave che non è Ed25519 con **KEY_TYPE_NOT_ED25519** (422). Una chiave accettata viene salvata cifrata con la tua chiave principale; nessuna sua parte viene mai stampata o restituita.

### 3. Scegli l'intervallo di tick (nasce vuoto)

Apri `/panel` con la sessione e trova la sezione **"Tik aralığı — motor ne sıklıkla çalışır"** (intervallo di tick). Le scelte sono **ogni 1, 2 o 3 minuti**. In un'installazione nuova l'intervallo è **vuoto** e il motore non può essere avviato finché non ne scegli uno. Una modifica ha effetto **entro 20 minuti al più tardi**, oppure al riavvio del motore; scegliere un intervallo meno frequente non richiede codice, uno più frequente chiede il codice monouso.

### 4. Avviare e fermare il motore

**Avvio:** oggi nel pannello non c'è un pulsante di avvio. Invia `POST /api/engine/resume` con il cookie di sessione e l'header `x-totp-code`. Se l'intervallo di tick è ancora vuoto la richiesta viene rifiutata con **TICK_UNSET** (HTTP 409) e nulla cambia. **Arresto:** apri `/durdur` — **non** richiede sessione né codice. Digita la chiave di arresto in chiaro dal file del passo 5, scegli sotto **"Ne olsun?"** o **"Yalnız durdur"** (solo fermare: le posizioni aperte e i loro ordini di protezione sull'exchange restano come sono) o **"Durdur ve kapatma iste"** (fermare e registrare una richiesta di chiusura; oggi il software non chiude le posizioni da solo), e invia. La chiave non viene mai salvata nel browser.

### 5. L'interruttore di ingresso (nasce ABILITATO)

La sezione del pannello **"Giriş şalteri"** mostra se il motore può inviare ordini di **ingresso**. In un'installazione nuova nasce **ABILITATO**, ma nessun ordine viene inviato finché la chiave Binance, il capitale e le impostazioni di rischio sono vuoti. Aprendo **"Bu ayarı değiştir (tek kullanımlık kod ister)"** puoi cambiarlo; **attivarlo** mostra il testo di avvertimento in cima a questa pagina con una casella che devi spuntare, e chiede il codice monouso. Disattivarlo non chiude le posizioni aperte e non ferma il motore — per quello usa `/durdur`.

### 6. Il tetto di costo e il Cervello (nasce vuoto)

La sezione **"Aylık maliyet tavanı"** contiene il tetto di costo mensile in dollari. Nasce **vuoto**, e finché è vuoto il Cervello (Claude) **non** viene chiamato affatto ("Tavan boşken davranış": il Cervello è spento). Inserisci un tetto quando vuoi che la generazione giornaliera delle regole funzioni; abbassare o svuotare un tetto non richiede codice, alzarlo chiede il codice monouso. La sezione **"Karar motoru ayarı"** mostra il modello (`claude-opus-5` per impostazione predefinita), la frequenza delle chiamate (ogni 24 ore per impostazione predefinita) e il numero di candidati e di candele.

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

**Con il motore fermo / in un'INSTALLAZIONE NUOVA (impostazioni predefinite): ≈ 0,24 – 0,60 $ / mese.** In un'installazione nuova il motore non può essere avviato (l'intervallo di tick nasce vuoto e la richiesta di avvio viene rifiutata) e il tetto di costo nasce vuoto (il Cervello non viene mai chiamato). In quello stato il software produce (contato dal codice, 2026-09-24): un'invocazione del server al minuto (**1 440/giorno · 43 200/mese**), **1 comando Upstash** per invocazione (legge la copia del permesso di esecuzione), **0 query al database** (Neon non viene mai svegliato), **0 chiamate Claude**. Il conto: invocazioni Vercel 43 200 × 0,60 $/M = 0,03 $ + memoria 2 GB × 0,53–1,43 s misurati × 43 200 ÷ 3600 = 12,7–34,3 GB-h × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $**; il tempo CPU attivo **non è stato misurato** (qui non è scritto alcun numero). Ogni apertura del pannello, misurata, aggiunge 5 query al database, 1 risveglio del database e 2 comandi Upstash; quanto spesso lo apri dipende da te.

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

Sei sul piano Hobby. La documentazione di Vercel dice che un'espressione cron che gira più di una volta al giorno *fallisce durante il deployment*; la pianificazione di questo software è ogni minuto e non può essere cambiata dal pannello. Sposta il progetto in un team Pro, oppure non eseguirlo su Vercel Hobby.

### Il server non parte e stampa "ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor"

Una variabile d'ambiente manca o è malformata. Le righe sotto quel messaggio nominano ogni variabile e il motivo del rifiuto (per esempio una chiave principale che non è di 44 caratteri base64) — mai il suo valore. Confronta i tuoi nomi con `.env.example` e con la tabella sotto "Cosa serve".

### `/api/health` risponde `{"ok":true,...}` ma il pannello chiede una password, e gli endpoint delle impostazioni rispondono 401 con `{"ok":false,"reason":"NO_SESSION"}`

È lo stato atteso senza sessione. Scrivi la password del proprietario nel campo **Parola** del pannello e premi **Giriş yap** (vedi "Primo utilizzo"); la stessa pagina apre il pannello, senza ricaricare.

### Avviare il motore risponde 409 con il motivo **TICK_UNSET**

L'intervallo di tick è vuoto (nasce vuoto). Scegli prima un intervallo nella sezione del pannello "Tik aralığı", poi invia di nuovo la richiesta di avvio.

### La mia chiave Binance viene rifiutata con **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** o **KEY_TYPE_NOT_ED25519**

Crea su Binance una nuova chiave API di tipo **Ed25519** con prelievi e trasferimento universale **disattivati**, e invia quella. Una chiave rifiutata non viene salvata né registrata nei log.

### Binance risponde 451 "Service unavailable from a restricted location"

Binance blocca le richieste da località statunitensi. `vercel.json` fissa per questo le funzioni alla regione `hnd1` (Tokyo); se cambi la regione in una statunitense, ogni chiamata a Binance fallisce con 451 e il motore segnala la regione come bloccata.

### Questo software invia qualcosa al suo manutentore?

No. Chiama solo Binance (con la tua chiave), i tuoi Neon e Upstash, e Anthropic (con la tua chiave). L'unico traffico di terze parti che non controlla è la telemetria di build di Next.js descritta nella sezione sui costi, che puoi disattivare con `NEXT_TELEMETRY_DISABLED=1`.

---

Contributi al codice e pull request non sono accettati; segnalazioni di bug, domande di installazione e segnalazioni di sicurezza private sono aperte — vedi [CONTRIBUTING.md](CONTRIBUTING.md) e `SECURITY.md`. Licenza: MIT (vedi `LICENSE`); puoi fare un fork e modificare la tua copia.
