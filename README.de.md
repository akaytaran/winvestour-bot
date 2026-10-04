# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

Bei Widersprüchen gilt der englische Text.

<!-- readme:intro -->
## Was das ist

`winvestour-bot` ist eine kleine Handels-Engine, die du **auf deinen eigenen Konten** betreibst: sie liest den Binance-Spotmarkt mit **deinem** API-Schlüssel, entscheidet nach Regeln, die ein Claude-Modell einmal täglich schreibt, und kann echte Aufträge auf deinem Konto erteilen. Jede Installation ist ihre eigene Kopie — die Datenbank, der Binance-Schlüssel und der Claude-API-Schlüssel bleiben in deinem eigenen Hosting, und nichts in dieser Kopie ruft beim Betreuer an. Sie ist für eine Person gedacht, die so eine Engine für sich selbst betreiben, zuerst den Code lesen und mit einem kleinen Betrag beginnen will.

**Inhalt:** [Was du brauchst](#was-du-brauchst) · [Mit einem KI-Assistenten installieren](#mit-einem-ki-assistenten-installieren) · [Installation](#installation) · [Erste Nutzung](#erste-nutzung) · [Monatliche Betriebskosten](#monatliche-betriebskosten) · [FAQ / Fehlerbehebung](#faq--fehlerbehebung) · [Mitwirken](CONTRIBUTING.md)

<!-- readme:warning -->
### ⚠️ Vor der Installation lesen

1. **Diese Software ist keine Anlageberatung.** Es wird kein Gewinn versprochen. Vergangene Messungen sagen nichts über zukünftige Ergebnisse aus.
2. **Diese Software kann eigenständig echte Aufträge mit echtem Geld erteilen.** In einer frischen Installation ist der Einstiegspfad **standardmäßig AKTIV.** Es wird kein Auftrag gesendet, bis du deinen eigenen Binance-Schlüssel, dein Kapital und deine Risikoeinstellungen eingetragen hast. Du kannst ihn jederzeit im Panel abschalten.
3. **Das Verlustrisiko ist real und liegt vollständig bei dir.** Verwende kein Geld, dessen Verlust du dir nicht leisten kannst.
4. Die Software wird **unter der MIT-Lizenz, "WIE BESEHEN"**, ohne jede Gewährleistung bereitgestellt. Der Autor und die Mitwirkenden übernehmen keine Verantwortung für deine Handelsergebnisse, Verluste, Ausfälle oder Fehler.
5. **Die Einhaltung von Vorschriften liegt in deiner Verantwortung.** Der Kryptohandel ist in manchen Rechtsordnungen eingeschränkt oder verboten; die Einhaltung deines lokalen Rechts und der Nutzungsbedingungen von Binance liegt bei dir. Dieses Projekt ist weder mit Binance verbunden noch von Binance gebilligt.
6. **Steuern liegen in deiner Verantwortung.**
7. Betreibe sie nicht, ohne den Code gelesen und zuerst mit einem kleinen Betrag getestet zu haben.

<!-- readme:need -->
## Was du brauchst

- **Ein Vercel-Konto im Pro-Plan.** Die Engine wird von einem geplanten Job angetrieben, der **jede Minute** läuft (`vercel.json`). Vercels kostenloser Hobby-Plan erlaubt einen geplanten Job höchstens **einmal pro Tag**, und die Dokumentation sagt, ein häufigerer Zeitplan *schlägt beim Deployment fehl* — auf Hobby geht das Deployment also nicht live. Lies Vercels eigene Preise und Bedingungen, bevor du wählst.
- **Ein Neon-Konto** (PostgreSQL). Der kostenlose Plan reicht für die Tabellen; der Kostenabschnitt unten sagt, was gemessen wurde.
- **Ein Upstash-Konto** (Redis). Das Kontingent des kostenlosen Plans reicht für eine offene Position zur Zeit.
- **Ein Anthropic-API-Schlüssel.** Das regelschreibende Modell (das „Gehirn“) wird standardmäßig einmal täglich aufgerufen; eine frische Installation kommt mit **leerer** Kostenobergrenze zur Welt, und solange sie leer ist, wird das Gehirn **nicht** aufgerufen.
- **Ein Binance-API-Schlüssel vom Typ Ed25519, erstellt ohne Auszahlungsberechtigung.** Ein Schlüssel mit aktivierten Auszahlungen oder universellen Transfers wird abgelehnt und nie gespeichert.
- **Node.js und npm** auf deinem Rechner für die Einrichtungsbefehle, und insgesamt etwa **eine Stunde**.

Diese Kopie trägt nichts vom Betreuer: der Code liest keinen Domainnamen, es gibt kein Android-Paketname und kein Signatur-Fingerabdruck im Umgebungsvertrag, und die drei Firebase-Variablen der optionalen Push-Benachrichtigungs-Erweiterung entstehen leer, die Benachrichtigungen sind also aus. Alles unten kommt leer zur Welt, und du füllst es mit deinen eigenen Werten.

| Umgebungsvariable | Woher der Wert kommt |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → dein Projekt → Verbindungszeichenfolgen (gepoolt · direkt) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → deine Datenbank → REST API. Fügst du Upstash über den Vercel Marketplace hinzu, setzt er stattdessen die Namen `KV_REST_API_URL` und `KV_REST_API_TOKEN`; die App liest auch diese. |
| `ANTHROPIC_API_KEY` | Anthropic → API-Schlüssel (beginnt mit `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | die Datei aus Installationsschritt 4 |
| `STOP_KEY_HASH` | die Datei aus Installationsschritt 5 |
| `ENCRYPTION_MASTER_KEY` | die Datei aus Installationsschritt 6 |
| `ENCRYPTION_KEY_VERSION` | `1` bei einer frischen Installation (nur bei einer Rotation des Hauptschlüssels erhöht, Schritt 15) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | leer lassen; nur während einer Rotation des Hauptschlüssels verwendet |
| `ENGINE_MODE` | `CHEAP` (ein Tick pro Minute aus dem geplanten Job; der einzige Modus, den diese README beschreibt) |

Der Binance-API-Schlüssel ist **keine** Umgebungsvariable: er wird nach der Installation über die App übermittelt und in deiner Datenbank gespeichert, verschlüsselt mit deinem Hauptschlüssel (siehe „Erste Nutzung“).

## Mit einem KI-Assistenten installieren

Kopiere den Block unten unverändert und füge ihn in einen KI-Assistenten ein (Claude, ChatGPT, Cursor oder ähnlich). Er führt dich Schritt für Schritt durch die nummerierten Schritte des Abschnitts Installation, lässt dich jedes Ergebnis prüfen und bittet dich nie, ein Passwort, einen Schlüssel oder einen `.env`-Wert in den Chat einzufügen. Der Block ist absichtlich auf Englisch und in jeder Sprachfassung dieser Seite gleich.

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
  9. Give every name in `.env.example` its value — except `ENCRYPTION_MASTER_KEY_PREVIOUS`, which stays empty (it is used only during a master-key rotation), and the three optional `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, which also stay empty unless you add your own Firebase for push notifications (see that section below)
     Check: every name in `.env.example` except `ENCRYPTION_MASTER_KEY_PREVIOUS` and the three optional `FIREBASE_*` names has a value. If a required name is missing, the application stops at startup and names the missing variable.
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

Jeder der 15 Schritte unten wird vor jeder Veröffentlichung in einer sauberen Kopie dieses Repositorys durchlaufen — die Schritte 1–14 durch die automatische Installationsprüfung, Schritt 15 durch die Schlüsselrotationsprüfung. Ein Schritt, der so nicht durchlaufen wird, steht hier nicht.

1. Lege die nötigen Konten an (insgesamt etwa 30 Minuten): ein **Neon**-Konto (PostgreSQL-Datenbank), ein **Upstash**-Konto (Redis), ein **Vercel**-Konto im **Pro-Plan** (die App führt jede Minute einen geplanten Job aus; im kostenlosen Hobby-Plan schlägt das Deployment fehl — siehe "Was du brauchst"), einen **Anthropic**-API-Schlüssel und einen **Binance**-API-Schlüssel, der **ohne Auszahlungsberechtigung** erstellt wurde.

Erwartetes Ergebnis: du kannst dich bei allen fünf Diensten anmelden, und die Berechtigungen deines Binance-API-Schlüssels enthalten keine Auszahlungen.

2. Hole den Code auf deinen Rechner: wähle auf der Seite dieses Repositorys **Code → Download ZIP** (oder klone es mit deinem eigenen Git-Client), entpacke es und öffne ein Terminal in diesem Ordner.

Erwartetes Ergebnis: der Ordner enthält `package.json` und `.env.example`.

3. Installiere die Abhängigkeiten aus der Lock-Datei der Kopie:

```sh
npm ci
```

Erwartetes Ergebnis: der Befehl endet ohne Fehler, und ein Ordner `node_modules` erscheint.

4. Erzeuge das Eigentümer-Passwort, das TOTP-Geheimnis und das Sitzungsgeheimnis. Es wird kein Wert angezeigt, nur Dateipfade und kurze Fingerabdrücke; die Werte werden in einen Ordner außerhalb des Repositorys geschrieben (Standard: `winvestour-backup` in deinem Home-Ordner, `-- --dir <Ordner>` für einen anderen Ort):

```sh
npm run owner:credentials
```

Erwartetes Ergebnis: der Ordner enthält jetzt `owner-credentials.txt`, `vercel-env-owner.txt`; die erste Datei enthält dein Passwort und den TOTP-Einrichtungsschlüssel für deine Authenticator-App, die zweite die drei `NAME=value`-Zeilen für Schritt 9. Auf dem Bildschirm wird kein Wert ausgegeben, nur die Dateipfade und kurze Fingerabdrücke.

5. Erzeuge den Stopp-Schlüssel (wird in denselben Ordner geschrieben, nicht angezeigt):

```sh
npm run stop:credential
```

Erwartetes Ergebnis: `stop-key.txt`, `vercel-env-STOP_KEY_HASH.txt` erscheinen im Ordner; die erste Datei enthält den rohen Stopp-Schlüssel, den du auf dem Stopp-Bildschirm eingibst, die zweite seinen Hash für Schritt 9.

6. Erzeuge den Hauptschlüssel, der deine Börsenschlüssel verschlüsselt (wird in denselben Ordner geschrieben, nicht angezeigt). Geht dieser Schlüssel verloren, lassen sich die verschlüsselten Zeilen nie wieder öffnen; bewahre eine zweite Kopie in deinem Passwort-Manager auf:

```sh
npm run key:encryption-master
```

Erwartetes Ergebnis: `encryption-master-key.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt` erscheinen im Ordner.

7. Erzeuge das Ed25519-Schlüsselpaar für deinen Binance-API-Schlüssel (wird in denselben Ordner geschrieben; der private Schlüssel wird nicht angezeigt):

```sh
npm run key:generate
```

Erwartetes Ergebnis: `binance-private-key.pem`, `binance-public-key.pem` erscheinen im Ordner. Wähle auf Binance Profile → API Management → Create API → **Self-generated** und füge den Inhalt der zweiten Datei (öffentlicher Schlüssel) ein; die erste Datei (privater Schlüssel) fügst du später im Panel ein ("Erste Nutzung").

8. Lege eine leere PostgreSQL-Datenbank an: erstelle in Neon ein Projekt und kopiere seine beiden Verbindungszeichenfolgen — die gepoolte wird `DATABASE_URL`, die direkte (ungepoolte) wird `DIRECT_URL`. Wähle die Region **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`): die Funktionen der App laufen in Tokio (`hnd1`, siehe `vercel.json`), und Neon hat keine Region in Tokio; Singapur ist die nächstgelegene (Neon-Regionsliste, gelesen am 2026-09-26).

Erwartetes Ergebnis: zwei Zeichenfolgen, die mit `postgresql://` beginnen; die Datenbank hat noch keine Tabellen.

9. Gib jedem Namen in `.env.example` seinen Wert — außer `ENCRYPTION_MASTER_KEY_PREVIOUS`, das leer bleibt (es wird nur bei einer Rotation des Hauptschlüssels verwendet), und außer den drei optionalen `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, die ebenfalls leer bleiben, solange du kein eigenes Firebase für Push-Benachrichtigungen hinzufügst (siehe den Abschnitt dazu unten). Woher jeder Wert kommt, steht in der Tabelle unter "Was du brauchst"; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` stammen aus den Dateien der Schritte 4–6. Für das Deployment trägst du sie in Vercel unter **Settings → Environment Variables** ein; für einen lokalen Lauf schreibst du dieselben Namen in eine Datei `.env` neben `package.json` (Git ignoriert diese Datei). Werte gelangen nie ins Repository.

Erwartetes Ergebnis: jeder Name in `.env.example` außer `ENCRYPTION_MASTER_KEY_PREVIOUS` und den drei optionalen `FIREBASE_*`-Namen hat einen Wert. Fehlt ein Pflichtname, stoppt die Anwendung beim Start und nennt die fehlende Variable.

10. Lege die Datenbanktabellen an. Führe dies einmal von deinem Rechner aus, mit gesetztem `DIRECT_URL` (in `.env` oder im Terminal); Vercel wiederholt denselben Befehl bei jedem Deployment, das ist unschädlich:

```sh
npx prisma migrate deploy
```

Erwartetes Ergebnis: die Ausgabe endet mit `All migrations have been successfully applied.` Eine einzelne Migration namens `0_baslangic` wird angewendet; jede Einstellungstabelle beginnt mit einer Zeile; die Risikoeinstellungen sind leer und ausgeschaltet.

11. Prüfe, dass der Code auf deinem Rechner baut (vor dem Deployment empfohlen):

```sh
npm run build
```

Erwartetes Ergebnis: der Befehl endet mit der Routenliste und ohne Fehler; ein Ordner `.next` erscheint.

12. Starte sie lokal. Sobald die Anwendung läuft, öffne `http://localhost:3000/api/health` in deinem Browser:

```sh
npm start
```

Erwartetes Ergebnis: die Seite zeigt `{"ok":true,"service":"engine",...}`, und `http://localhost:3000/panel` öffnet sich und sagt, dass das Panel eine Sitzung braucht. Beim Start wird der Umgebungsvertrag geprüft: fehlt ein Pflichtname oder ist er fehlerhaft, startet der Server nicht, und der Fehler nennt die fehlende Variable, nie ihren Wert. Beende den Server mit Strg+C. Den Bot auf deinem eigenen Computer zu betreiben wird noch nicht unterstützt: die Engine wird von Vercel Cron ausgelöst. Der lokale Start dient nur zur Prüfung der Installation.

13. Deploye auf Vercel: pushe deine Kopie in dein eigenes GitHub-Konto, wähle dann in Vercel **Add New → Project → Import** für dieses Repository, behalte die Framework-Voreinstellung **Next.js**, füge die Umgebungsvariablen aus Schritt 9 hinzu und drücke **Deploy**. Vercel führt das Skript `vercel-build` aus: es lehnt zuerst jede Migration ab, die Daten löschen würde, dann legt es die Tabellen an und baut.

Erwartetes Ergebnis: das Deployment erreicht **Ready**, und `https://<dein-projekt>.vercel.app/api/health` liefert `{"ok":true,...}`. Im Hobby-Plan schlägt das Deployment stattdessen fehl, mit der Meldung, dass Cron-Ausdrücke, die öfter als einmal täglich laufen, nicht erlaubt sind.

14. Öffne das Panel unter `/panel` auf deiner Adresse und den Stopp-Bildschirm unter `/durdur`.

Erwartetes Ergebnis: beide Seiten öffnen sich in der Sprache deines Browsers, wenn sie eine der sieben Sprachen dieses README ist, sonst auf Englisch; über das Sprachmenü oben auf der Seite kannst du wechseln. Das Panel sagt, es brauche eine Sitzung; der Stopp-Bildschirm öffnet sich ohne Sitzung und fragt nach dem Stopp-Schlüssel. Weiter mit "Erste Nutzung".

15. OPTIONAL, NICHT TEIL DER EINRICHTUNG — ROTATION DES HAUPTSCHLÜSSELS. Wenn dein Hauptschlüssel geleakt ist oder du ihn ändern willst: lege die alte Sicherungsdatei beiseite, führe Schritt 6 erneut aus, um einen NEUEN Schlüssel zu erzeugen, übergib den neuen als `ENCRYPTION_MASTER_KEY`, den alten als `ENCRYPTION_MASTER_KEY_PREVIOUS`, und erhöhe `ENCRYPTION_KEY_VERSION` um eins. Standardmäßig ist es ein TROCKENLAUF: nichts wird geschrieben, nur die Entschlüsselbarkeit wird gemessen; füge `-- --write` an, um wirklich zu schreiben:

```sh
npm run rotate:encryption-key
```

Ergebnis: jede Zeile wird in ihrer eigenen Transaktion mit dem alten Schlüssel entschlüsselt und mit dem neuen neu verpackt, und ihre Version wird erhöht; der neue Umschlag wird gegen den neuen Schlüssel geprüft, BEVOR etwas geschrieben wird. Sobald keine Zeile mehr auf der alten Version steht, kann `ENCRYPTION_MASTER_KEY_PREVIOUS` gelöscht werden. Kein Schlüsselwert wird je ausgegeben.

<!-- readme:first-use -->
## Erste Nutzung

Panel und Stopp-Bildschirm gibt es in den sieben Sprachen dieses README — **English · Türkçe · Deutsch · Русский · Italiano · Français · العربية**<!-- ad:@langs --> (Arabisch von rechts nach links); die Sprache wählst du im Menü **Sprache**<!-- ad:langSelect.label --> oben im Panel, auf dem Anmeldebildschirm oder auf dem Stopp-Bildschirm — ohne Auswahl öffnen sie sich in der Sprache deines Browsers, sonst auf Englisch. Die Bildschirm- und Schaltflächennamen in diesem README stammen aus dem deutschen Text des Panels selbst; ist im Menü Deutsch gewählt, zeigt das Panel genau diese Namen. Alles unten beschreibt genau, was die Software heute tut; nichts hier ist geplant oder versprochen. Das Panel hat vier Tabs — **Status · Einstellungen · Verlauf · Technik**<!-- ad:tabs.status,tabs.settings,tabs.history,tabs.technical --> — und öffnet mit **Status**<!-- ad:tabs.status -->. Bildschirm- und Schaltflächennamen stehen unten genau so, wie sie erscheinen.

**Einstellungen**<!-- ad:tabs.settings -->: jede Panel-Einstellung — was sie tut, ihr Standardwert, ob sie den Einmalcode braucht, wann sie wirkt — ist im [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide) des Wikis beschrieben (Englisch); die Bildschirme zeigt der [Panel guide](https://github.com/akaytaran/winvestour-bot/wiki/Panel-guide).

**Erklärungen liegen hinter (i).** Jeder Bereich des Panels zeigt nur den Namen der Einstellung, ihren Wert, eine einzeilige Statuszeile und die Bedienelemente. Was eine Einstellung tut, wann eine Änderung wirkt und was jede Auswahl bedeutet, steht hinter der runden Schaltfläche **i** neben dem Namen des Bereichs: Sie öffnet ein kleines Fenster, das du mit **Schließen**<!-- ad:info.close --> oder der Esc-Taste schließt; Schaltfläche und Fenster funktionieren mit Tastatur und Screenreader.

### 1. Anmelden (Eigentümer-Passwort, dann ein Einmalcode pro sensibler Aktion)

Öffne `https://<dein-projekt>.vercel.app/panel`. Ohne Sitzung zeigt das Panel ein einziges Feld **Passwort**<!-- ad:login.password --> und eine Schaltfläche **Anmelden**<!-- ad:login.submit -->: gib das Passwort aus `owner-credentials.txt` (Installationsschritt 4) ein und drücke die Schaltfläche — dieselbe Seite öffnet dann das Panel. Eine Sitzung dauert **8 Stunden**. Ein falsches Passwort zeigt "Falsches Passwort, versuche es erneut."<!-- ad:login.wrong -->. Nach **5** Fehlversuchen sind Anmeldung und jede sensible Aktion **15 Minuten** gesperrt ("Zu viele Fehlversuche: Die Anmeldung ist gesperrt. Versuche es in spätestens 15 Minuten erneut."<!-- ad:login.locked|minutes=15 -->); der Stopp-Bildschirm wird nie gesperrt. **Abmelden**<!-- ad:panel.signOut --> steht oben im Panel. Sensible Aktionen (Schlüssel hinzufügen, Engine starten, Einstiegsschalter ändern, Kosten erhöhen) verlangen zusätzlich den aktuellen 6-stelligen Code deiner Authenticator-App im Feld "Einmalcode (6 Stellen) — aus deiner Authenticator-App"<!-- ad:common.codeLabel -->. Füge den TOTP-Einrichtungsschlüssel aus `owner-credentials.txt` einmal zu deiner Authenticator-App hinzu.

### 2. Den Tab **Status**<!-- ad:tabs.status --> lesen: Engine-Status und "Vor dem Start"<!-- ad:engine.beforeYouStart -->

Die Karte **ENGINE-STATUS**<!-- ad:engine.label --> oben zeigt einen von vier Zuständen, vom Server gelesen: **Läuft**<!-- ad:engine.state.RUNNING.name --> · **Gestoppt**<!-- ad:engine.state.STOPPED.name --> (von dir oder einer Schutzregel gestoppt) · **Läuft nicht**<!-- ad:engine.state.NO_PERMIT.name --> (nie gestartet, oder die Laufgenehmigung ist abgelaufen) · **Unbekannt**<!-- ad:engine.state.UNKNOWN.name --> (Status nicht lesbar; **STOPP**<!-- ad:engine.stop --> wird angeboten, **STARTEN**<!-- ad:engine.start --> nicht). Darunter zählt **Vor dem Start**<!-- ad:engine.beforeYouStart --> auf, was die Engine braucht: **Binance-Schlüssel · Tick-Intervall · Kostenobergrenze · Infrastrukturkosten · Einzelpositionsanteil · Gesamtengagement**<!-- ad:prereq.names.key,prereq.names.tick,prereq.names.cap,prereq.names.infra,prereq.names.single,prereq.names.total --> — jeweils ✓ (erledigt), ✗ (fehlt) oder ? (nicht lesbar) — plus zwei Informationszeilen: **Einstiegsschalter**<!-- ad:prereq.names.entry --> und **Kapital**<!-- ad:prereq.names.capital -->. Solange eine Zeile ✗ oder ? ist, ist die Schaltfläche **STARTEN**<!-- ad:engine.start --> verborgen, und ein Link "Zuerst: …"<!-- ad:prereq.keyFix|pre --> führt zur Einstellung. Warnungen (zum Beispiel eine fehlende Schutzorder) erscheinen unter "Zuerst ansehen"<!-- ad:status.alertsHeading -->; "Auf einen Blick"<!-- ad:status.summaryHeading --> zeigt den letzten Engine-Lauf, offene Positionen und die in diesem Zeitraum gezahlte Kommission.

![Tab Status — mobile 390](images/panel-status-mobile-390.png) ![Tab Status — desktop 1280](images/panel-status-desktop-1280.png)

### 3. Den Tab **Einstellungen**<!-- ad:tabs.settings --> ausfüllen

![Tab Einstellungen mit fertigen Profilen — mobile 390](images/settings-profiles-mobile-390.png) ![Tab Einstellungen mit fertigen Profilen — desktop 1280](images/settings-profiles-desktop-1280.png)

- **Binance-API-Schlüssel**<!-- ad:key.heading -->: erstelle zuerst den Schlüssel. Erzeuge das Ed25519-Paar mit `npm run key:generate` (Installationsschritt 7) oder mit Binances eigenem Schlüsselgenerator; öffne auf Binance Profile → API Management → Create API → **Self-generated**, füge den öffentlichen Schlüssel ein, vergib einen Namen und schließe die Zwei-Faktor-Prüfung ab. Berechtigungen: Lesen **an** (ein Schlüssel ohne Lesen wird abgelehnt), Spot-Handel **an**, damit die Engine Orders platzieren kann, Futures nur, wenn du Futures nutzt, Auszahlungen und Universal Transfer **aus**. Öffne im Panel **Einstellungen → Binance-API-Schlüssel → Schlüssel hinzufügen (braucht den Einmalcode)**<!-- ad:tabs.settings>key.heading>key.add -->, fülle **Name**<!-- ad:key.fieldName|head -->, **API-Schlüssel**<!-- ad:key.fieldApiKey|head -->, **Privater Schlüssel**<!-- ad:key.fieldPrivate|head --> (den gesamten Inhalt von `binance-private-key.pem`; das Feld bleibt verdeckt) und den Einmalcode aus und drücke **Schlüssel prüfen und speichern**<!-- ad:key.submit -->. Die App prüft die Berechtigungen bei Binance, bevor sie etwas speichert; ein Schlüssel mit aktivierten Auszahlungen oder Universal Transfer wird abgelehnt ("Schlüssel ABGELEHNT: …"<!-- ad:key.withdrawals|pre -->) und nirgends gespeichert. Ein akzeptierter Schlüssel wird mit deinem Hauptschlüssel verschlüsselt gespeichert und nie wieder angezeigt. Mit einem neuen Schlüssel nutzt die Engine den neuesten; lösche alte Schlüssel selbst auf Binance.
- **Tick-Intervall — wie oft die Engine läuft**<!-- ad:tick.heading -->: kommt **leer** zur Welt; ohne es startet die Engine nicht. Öffne **Ändern (seltener ohne Code; häufiger braucht einen Code)**<!-- ad:tick.change --> und wähle eine der Schaltflächen: **alle 1, 2 oder 3 Minuten**. Eine Änderung wirkt **spätestens innerhalb von 20 Minuten** oder beim nächsten Start der Engine.
- **Monatliche Kostenobergrenze**<!-- ad:cap.heading -->: kommt **leer** zur Welt; solange sie leer ist, wird die Entscheidungs-Engine (Claude) **gar nicht** aufgerufen. Damit sie läuft, öffne **Obergrenze ändern (…)**<!-- ad:cap.change|paren -->, hake **Monatliche Gesamtkostenobergrenze**<!-- ad:cap.fieldTotal --> und **Monatliche Infrastrukturkosten (Summe deiner eigenen Rechnungen von Neon, Vercel und Upstash)**<!-- ad:cap.fieldInfra --> an und gib beide in Dollar pro Monat ein. Senken oder Leeren braucht keinen Code; Erhöhen verlangt den Einmalcode. **Entscheidungs-Engine — Modell · Häufigkeit · Kandidaten · Kerzen**<!-- ad:brain.heading --> zeigt das Modell (standardmäßig `claude-opus-5`) und wie oft es aufgerufen wird (standardmäßig alle 24 Stunden).
- **Fertige Profile — Vorsichtig · Ausgewogen · Riskant**<!-- ad:preset.heading -->: ganz oben im Einstellungen-Tab. Eine Auswahl füllt alle Risikoeinstellungen auf einmal — Risikoanteile, Futures, Hebelobergrenze, Short-Richtung und das Tick-Intervall. Bei einer frischen Installation ist nichts ausgewählt, und die Profilwahl braucht den Einmalcode. Ein Profil speichert Prozentsätze, keine Beträge: Das Panel berechnet die USDT-Beträge bei jedem Öffnen aus deinem freien USDT-Guthaben, und ein Profil, dessen Einzelposition unter dem Mindestauftragswert von Binance läge, wird nicht angeboten — seine Karte sagt warum. Futures-Felder werden nur gefüllt, wenn dein Schlüssel eine Futures-Berechtigung hat; der Leerverkauf bleibt in jedem Profil aus. Die monatliche Kostenobergrenze ist nicht Teil eines Profils. Nach der Wahl kannst du jede Einstellung weiter von Hand ändern; das Profil wird dann als eigene Werte angezeigt. Die Schaltfläche **i** erklärt die Profile. Diese Software ist keine Anlageberatung.
- **Risikoanteile — Einzelposition · Gesamtengagement**<!-- ad:caps.heading -->: kommen bei einer frischen Installation **leer** zur Welt; du trägst die Zahlen selbst ein oder wählst ein fertiges Profil — dieses Formular selbst schlägt nichts vor. Beide sind ein Prozentsatz deines **freien USDT-Guthabens bei Binance** (die USDT in deiner eigenen Spot-Wallet, die noch in keiner Position stecken): **Einzelpositionsanteil**<!-- ad:prereq.names.single --> ist das Höchste, was EINE neue Position nutzen darf; **Gesamtengagement**<!-- ad:prereq.names.total --> ist das Höchste, was ALLE offenen Positionen zusammen nutzen dürfen; der Einzelanteil darf nicht größer als die Gesamtgrenze sein. Trage in **Einstellungen → Risikoanteile**<!-- ad:tabs.settings>caps.historyGroup --> jede Zahl selbst in **Einzelpositionsanteil (Prozent deines freien USDT-Guthabens)**<!-- ad:caps.singleLabel --> und **Gesamtengagement (Prozent deines freien USDT-Guthabens)**<!-- ad:caps.totalLabel --> ein, gib den Einmalcode ein und drücke **Risikoanteile speichern**<!-- ad:caps.apply --> — jedes Speichern braucht einen neuen Code. Erlaubt: eine Zahl über null mit höchstens drei Nachkommastellen; ein leer gelassenes Feld behält seinen Wert. Die gespeicherten Werte werden erneut vom Server gelesen; die zwei Zeilen von "Vor dem Start"<!-- ad:engine.beforeYouStart --> zeigen dann ✓. Eine Änderung gilt ab der nächsten Einstiegsentscheidung der Engine; bereits offene Positionen behalten ihre Größe.
- **Einstiegsschalter**<!-- ad:entry.heading -->: kommt **AN**<!-- ad:common.on --> zur Welt — die Engine darf aus eigener Entscheidung neue Positionen eröffnen, sobald alles andere eingestellt ist. Drücke den Schalter, um ihn zu ändern; beim Einschalten erscheinen "Vor dem Einschalten lesen"<!-- ad:entry.readFirst --> mit der Warnung vom Anfang dieser Seite und ein Kontrollkästchen, und beide Richtungen verlangen den Einmalcode. Bei **AUS**<!-- ad:common.off --> läuft die Engine weiter, Ausstiege und Schutz gehen weiter, aber keine neue Position wird eröffnet und die Entscheidungs-Engine wird nicht aufgerufen.
- **Hebelobergrenze**<!-- ad:risk.fields.leverageCap --> und **Short-Richtung**<!-- ad:risk.fields.shortMode -->: Bei einer neuen Installation ist die Hebelobergrenze **leer** und die Short-Richtung **Nur Long**<!-- ad:risk.modes.NONE.label -->. Solange die Hebelobergrenze leer ist, bleibt der Futures-Pfad geschlossen: Es wird kein gehebelter Trade eröffnet, und die Software wählt nie von sich aus eine Zahl — ein fertiges Profil füllt sie nur, wenn du dieses Profil wählst und dein Schlüssel eine Futures-Berechtigung hat. Die Schaltfläche **i** neben jeder Zeile erklärt die Einstellung. Zum Ändern öffne **Diese Einstellung ändern (braucht den Einmalcode)**<!-- ad:risk.change -->; jede Änderung verlangt den Einmalcode. Diese Version plant noch keine Futures-Trades von sich aus: Der Futures-Orderpfad wird im Binance-Futures-Testnet geprüft (ein Übungskonto mit Testgeld, getrennt von deinem echten Konto). Ob du Futures jemals mit echtem Geld nutzt, entscheidest du selbst.

### 4. Kapital

Die Engine handelt mit dem **freien USDT in deiner Binance-Spot-Wallet**, daher braucht der Schlüssel **Enable Spot & Margin Trading**. Die Größe einer Position ist **Einzelpositionsanteil**<!-- ad:prereq.names.single --> × freies USDT-Guthaben. Binance lehnt eine Order unter dem Mindestorderwert des Paares ab (sein NOTIONAL-Filter); die Engine liest dieses Minimum vor jeder Order von Binance — auf dem Konto des Betreuers waren es **5 USDT** bei den meisten geprüften Paaren und 1 USDT bei einigen (gemessen am 2026-09-10). Liegt Anteil × freies Guthaben darunter, wird keine Position eröffnet; die Engine läuft und schützt weiter. Das Panel verbindet sich nicht mit Binance und kann deshalb das heutige freie Guthaben hier nicht mit diesem Minimum vergleichen: seine Zeile **Kapital**<!-- ad:prereq.names.capital --> zeigt den zuletzt gemessenen Kontowert. Wie viel du einzahlst, entscheidest du.

### 5. Die Engine starten

Wenn jede Zeile von "Vor dem Start"<!-- ad:engine.beforeYouStart --> ✓ ist, zeigt der Tab **Status**<!-- ad:tabs.status --> eine grüne Schaltfläche **STARTEN**<!-- ad:engine.start -->. Drücke sie, gib den Code in "Einmalcode (6 Stellen) — der Code aus deiner Authenticator-App"<!-- ad:engine.codeLabel --> ein und drücke **Engine starten**<!-- ad:engine.startEngine -->. Die Karte zeigt dann **Läuft**<!-- ad:engine.state.RUNNING.name --> und "Start akzeptiert: Die Engine darf bis …"<!-- ad:engine.started|upto:until --> — der Status wird vom Server neu gelesen, nicht geraten. Ist kein Tick-Intervall gewählt, lautet die Antwort "Die Engine wurde nicht gestartet: Kein Tick-Intervall gewählt."<!-- ad:engine.notStartedTick|s1 --> und nichts ändert sich. Eine vorsichtige Reihenfolge: stelle zuerst den **Einstiegsschalter**<!-- ad:entry.heading --> auf **AUS**<!-- ad:common.off -->, starte die Engine und beobachte **Läuft**<!-- ad:engine.state.RUNNING.name --> einen Tag lang, dann entscheide, ob du Einstiege einschaltest.

### 6. Die Engine stoppen

Während die Engine läuft, zeigt die Karte eine rote Schaltfläche **STOPP**<!-- ad:engine.stop -->: wähle **Nur stoppen**<!-- ad:stop.modes.HOLD.title --> (keine neue Position; offene Positionen und ihre Schutzorders an der Börse bleiben, wie sie sind) oder **Stoppen und Schließen anfordern**<!-- ad:stop.modes.CLOSE_ALL.title --> (der Schließwunsch wird gespeichert; die Software schließt Positionen heute nicht selbst), gib den **Stopp-Schlüssel** aus `stop-key.txt` ein (Installationsschritt 5 — nicht der Einmalcode) und drücke **Engine stoppen**<!-- ad:stop.sendPanel -->. Lässt sich das Panel nicht öffnen, erledigt der **Stopp-Bildschirm** unter `/durdur` ("Winvestour · Engine stoppen"<!-- ad:stop.title -->) dasselbe ohne Sitzung und Code: wähle unter **Was soll passieren?**<!-- ad:stop.legend -->, gib den Schlüssel in **Stopp-Schlüssel**<!-- ad:stop.keyLabel --> ein und drücke **Stoppen**<!-- ad:stop.send -->. Der Schlüssel wird nie im Browser gespeichert.

![Stopp-Seite — mobile 390](images/stop-screen-mobile-390.png) ![Stopp-Seite — desktop 1280](images/stop-screen-desktop-1280.png)

### 7. **Verlauf**<!-- ad:tabs.history --> und **Technik**<!-- ad:tabs.technical -->

**Verlauf**<!-- ad:tabs.history --> listet die letzten Positionen (Einstieg, Größe, Kommission, brutto und netto) und jede Einstellungsänderung (wer, wann, alt → neu). **Technik**<!-- ad:tabs.technical --> bewahrt die vollständigen gemessenen Details, die das Panel liest — Engine-, Lauf- und Gesundheitskarten, Positionszeilen und woher jede Zahl kommt; auch diese Server-Sätze folgen der Sprache des Panels.

Im Tab **Status**<!-- ad:tabs.status --> zeigt **Auf einen Blick**<!-- ad:status.summaryHeading --> auch das in der laufenden Periode gezahlte und erhaltene Funding in USDT oder sagt, dass es keinen Funding-Eintrag gibt (ein Konto ohne Futures-Handel hat keinen). Gründe für Stopps und übersprungene Einstiege stehen als klare Sätze in der Sprache des Panels.

### 8. Was diese Version nicht hat

Push-Benachrichtigungen sind standardmäßig aus: sie brauchen ein eigenes Firebase-Projekt — siehe den Abschnitt "Optional: eigenes Firebase für Push-Benachrichtigungen hinzufügen" unten. Die biometrische Sperre gibt es (**Einstellungen → Biometrische Sperre**<!-- ad:tabs.settings>lock.heading -->, standardmäßig aus); sie braucht eine Fingerabdruck- oder Gesichtsprüfung auf deinem Gerät. Es gibt keine Android-App; das Panel ist eine Webseite, die du zum Startbildschirm deines Telefons hinzufügen kannst. Den Bot auf deinem eigenen Computer zu betreiben wird nicht unterstützt (die Engine wird von Vercel Cron ausgelöst).

<!-- readme:cost -->
## Monatliche Betriebskosten

Jede Zahl hier stammt aus den eigenen Messungen dieser Software auf dem Deployment des Betreuers; keine ist eine Schätzung. Läuft die Engine durchgehend im günstigen Modus, mit einer offenen Position und einem Gehirn-Aufruf pro Tag, beträgt die gemessene Summe **≈ 9,60 – 9,90 $ pro Monat** (Neon ≈ 5,30 $ · Vercel ≈ 1,50 $ Obergrenze · Upstash 0 $ innerhalb des kostenlosen Kontingents · Anthropic ≈ 2,84 $). Bei gestoppter Engine oder bei einer frischen Installation mit Standardeinstellungen sind es **≈ 0,24 – 0,60 $ pro Monat**. Die Vercel-**Pro**-Mitgliedschaft selbst (**20 $ / Monat**, Preis gelesen am 2026-06-16) kommt obendrauf und ist der größte Einzelposten. Handelsgebühren und Spread sind nicht in diesen Zahlen: sie sind die Kosten eines Handels, nicht des Betriebs der Software.

<details>
<summary>Vollständige Aufschlüsselung, Annahmen und die Daten, an denen jeder Preis gelesen wurde</summary>

**Diese Zahlen gelten unter einem Satz von Annahmen:** die Engine läuft durchgehend im günstigen Modus (ein Tick pro Minute = 43 200 Ticks/Monat), **eine Position ist offen** zur Zeit, das Gehirn (Claude) wird **einmal pro Tag** aufgerufen (Standardeinstellung: `claude-opus-5`, 24 Stunden), die Datenbank-Rechenleistung beträgt **0,25 CU**, und alle Dienste sind auf bezahlten Plänen.

| Posten | Wofür er zahlt | Pro Monat | In einfachen Worten: was gemessen wurde |
|---|---|---|---|
| **Neon** (Postgres) | Aufträge, Positionen, Gebührenbuch, Ereignisprotokoll | **≈ 5,30 $** | Die Datenbank ist nicht dauernd wach: eine Berührung hält sie ≈ 330 Sekunden wach, und die Engine berührt sie nur alle 20 Minuten. Gemessene Wachzeit **≈ 27,5 % des Monats** ⇒ 0,25 CU × 720 h × 27,5 % × 0,106 $/CU-h. Bei 1 CU belassen wird derselbe Posten **≈ 21 $**. |
| **Vercel** (Hosting) | die Serverless-Funktion, in der jeder Tick läuft | **≈ 1,50 $ Obergrenze** | 43 200 Aufrufe pro Monat; jeder gemessen mit **≈ 1 Sekunde** (die Zahl ist gegen eine Obergrenze von 3 Sekunden gerechnet) × 2 GB Speicher. Es gibt keine kleinere Option: die kleinste Größe des Anbieters ist 2 GB. |
| **Upstash** (Redis) | Laufgenehmigung, Ausführungssperre, Tick-Aufzeichnung, Positionskopie | **0 $** | **5 Befehle pro Tick** (+2 pro offener Position) ⇒ **≈ 302 000 Befehle/Monat**; das kostenlose Kontingent ist **500 000/Monat**. Bei 4 oder mehr gleichzeitigen Positionen wird das Kontingent überschritten: **≈ 0,10–0,30 $**. |
| **Anthropic** (Claude, das „Gehirn“) | die tägliche Regelerzeugung | **≈ 2,84 $** | **30 Aufrufe** pro Monat × **0,094750 $** pro Aufruf. Die Token pro Aufruf wurden **aus einem echten Aufruf** gelesen: **7 794 rein + 1 250 raus**. Häufigere Aufrufe skalieren linear: alle 12 h ≈ 5,69 $, alle 6 h ≈ 11,37 $. |
| **Binance** | Marktdaten + Auftragserteilung | **0 $** | API-Gewicht ist kostenlos. **Handelsgebühren sind nicht in dieser Tabelle** — das sind die Kosten eines Handels, nicht des Betriebs der Software, und die Software misst sie bei jedem Handel getrennt. |
| **SUMME** | | **≈ 9,60 – 9,90 $ / Monat** | Die Summe der Zeilen. Unteres Ende: Upstash im kostenlosen Kontingent. Oberes Ende: Kontingent überschritten. |

**Bei gestoppter Engine / bei einer FRISCHEN INSTALLATION (Standardeinstellungen): ≈ 0,24 – 0,60 $ / Monat.** Bei einer frischen Installation kann die Engine nicht gestartet werden (das Tick-Intervall kommt leer zur Welt, und die Startanfrage wird abgelehnt), und die Kostenobergrenze kommt leer zur Welt (das Gehirn wird nie aufgerufen). In diesem Zustand erzeugt die Software (aus dem Code gezählt, 2026-09-24): einen Serveraufruf pro Minute (**1 440/Tag · 43 200/Monat**), **1 Upstash-Befehl** pro Aufruf (er prüft, ob die Engine laufen darf), **0 Datenbankabfragen** (Neon wird nie geweckt), **0 Claude-Aufrufe**. Die Rechnung: Vercel-Aufrufe 43 200 × 0,60 $/M = 0,03 $ + Speicher 2 GB × gemessene 0,53–1,43 s × 43 200 ÷ 3600 = 12,7–34,3 GB-h × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $**; aktive CPU-Zeit wurde **nicht gemessen** (dafür steht hier keine Zahl). Jedes Öffnen des Panels erzeugt gemessen 5 Datenbankabfragen, 1 Datenbank-Aufwachen und 2 Upstash-Befehle; wie oft du es öffnest, liegt bei dir.

**Wann jeder Preis gelesen wurde (Preise ändern sich — prüfe diese selbst):**
- Neon `neon.com/pricing` — **2026-09-11** (Launch 0,106 $/CU-h), erneut gelesen **2026-09-24** (unverändert; Free-Plan 100 CU-Stunden/Monat/Projekt)
- Vercel `vercel.com/docs/functions/usage-and-pricing` — **2026-06-16** (Speicher 0,0167 $/GB-h, CPU 0,202 $/h, Aufrufe 0,60 $/M), erneut gelesen **2026-09-24** (unverändert); `vercel.com/docs/cron-jobs/usage-and-pricing` — „Last updated July 15, 2026“, Hobby „once per day“
- Upstash `upstash.com/pricing/redis` — **2026-09-11** (kostenlos 500 000 Befehle/Monat, danach 0,20 $/100K), erneut gelesen **2026-09-24** (unverändert)
- Anthropic `platform.claude.com/docs/en/about-claude/pricing` — **2026-09-11** (`claude-opus-5` 5 $ / 25 $ pro MTok)

**Build-Telemetrie (Next.js):** diese Software sendet nichts an den Betreuer. Das verwendete Next.js-Framework kann während `npm run build` anonyme Nutzungsdaten an Next.js/Vercel senden; diese Daten erreichen den Besitzer dieses Repositorys nicht. Zum Abschalten füge `NEXT_TELEMETRY_DISABLED=1` zu deiner Build-Umgebung hinzu (Quelle: die Next.js-Dokumentation, https://nextjs.org/telemetry).
</details>

<details>
<summary>Passt es in die kostenlosen Stufen? (nur aus der eigenen Dokumentation jedes Anbieters, gelesen am 2026-09-24; kein Konto wurde eröffnet, nichts wurde ausprobiert)</summary>

| Anbieter | kostenlose Stufe (aus der Dokumentation) | frische Installation (Engine nicht gestartet) | Engine läuft (Annahmen oben) |
|---|---|---|---|
| **Vercel Hobby** | 1 Million Aufrufe, 360 GB-h Speicher, 4 h aktive CPU pro Monat inklusive; **Cron höchstens einmal pro Tag** | Aufrufe und Speicher liegen in den Grenzen; **aber der geplante Job läuft jede Minute, also SCHLÄGT das Deployment auf Hobby FEHL** (Dokumentation: „Cron expressions that would run more frequently will fail during deployment“) ⇒ **PASST NICHT** | **PASST NICHT**, gleicher Grund |
| **Neon Free** | **100 CU-Stunden** pro Projekt und Monat, 0,5 GB Speicher, skaliert nach 5 Minuten Leerlauf auf null, bis zu 2 CU | die Datenbank wird nie berührt: **0 CU-Stunden ⇒ PASST** | 0,25 CU × 720 h × gemessene 27,5 % wach = **≈ 49,5 CU-Stunden ≤ 100 ⇒ PASST** (abgeleitet; nicht auf dem kostenlosen Plan gemessen). Wenn es passt, wird der Neon-Posten oben 0 $ statt 5,30 $. |
| **Upstash Free** | **500 000 Befehle** pro Monat, 256 MB, 10 GB Bandbreite | 43 200 Befehle (8,6 %) ⇒ **PASST** | ≈ 302 000 Befehle (1 offene Position) ⇒ **PASST**; 4 oder mehr Positionen passen nicht |
| **Anthropic** | keine kostenlose Stufe | 0 Aufrufe ⇒ 0 $ | der Anthropic-Posten oben |
</details>

<!-- readme:update -->
## Aktualisieren

Jeder der 4 Schritte unten wird vor jeder Veröffentlichung an einer Kopie durchlaufen, die aus Version 1.0.0 installiert wurde und Daten in ihrer Datenbank hat — durch die automatische Update-Prüfung. Ein Schritt, der so nicht durchlaufen wird, steht hier nicht.

1. Hole die neue Version in den Ordner, aus dem du installiert hast. Wenn du dieses Repository mit git geklont hast, führe dies in diesem Ordner aus; wenn du das ZIP heruntergeladen hast, lade stattdessen das neue ZIP herunter, entpacke es in einen neuen Ordner, kopiere deine Datei `.env` (falls du eine angelegt hast) hinein und mache dort weiter. Deine Werte stehen nicht im Code: git ignoriert die Datei `.env`, der Sicherungsordner liegt außerhalb des Repositorys, und die Werte, die du in Vercel eingetragen hast, bleiben in Vercel:

```sh
git pull
```

Erwartetes Ergebnis: der Befehl endet ohne Konflikt und listet die geänderten Dateien auf; das Feld `version` in `package.json` ist die Nummer der neuen Version; deine Datei `.env` ist noch da.

2. Installiere die Abhängigkeiten der neuen Version:

```sh
npm ci
```

Erwartetes Ergebnis: der Befehl endet ohne Fehler.

3. Wende die Datenbankänderungen der neuen Version an, von deinem Rechner aus mit gesetztem `DIRECT_URL` wie in Installationsschritt 10. Es werden nur die Änderungen angewendet, die deine Datenbank noch nicht hat, der Reihe nach; die Tabellen werden nicht neu angelegt, und vorhandene Zeilen bleiben erhalten:

```sh
npx prisma migrate deploy
```

Erwartetes Ergebnis: die Ausgabe endet mit `All migrations have been successfully applied.`, wenn die neue Version Datenbankänderungen mitbringt, oder meldet `No pending migrations to apply.`, wenn sie keine mitbringt. Deine Risikoanteile, Einstellungen und dein Verlauf bleiben unverändert; ein Update startet die Engine nicht und schaltet nichts ein. Schlägt der Befehl fehl, siehe die Wiki-Seite Troubleshooting.

4. Deploye die neue Version: pushe den aktualisierten Ordner in dein eigenes GitHub-Repository, genauso wie in Installationsschritt 13; Vercel baut ihn automatisch. Sein Skript `vercel-build` lehnt zuerst jede Migration ab, die Daten löschen würde, führt dann denselben Migrationsbefehl erneut aus (unschädlich: nichts steht aus) und baut. Die Umgebungsvariablen, die du in Vercel eingetragen hast, bleiben, wie sie sind.

Erwartetes Ergebnis: das Deployment erreicht **Ready**, und `https://<dein-projekt>.vercel.app/api/health` liefert `{"ok":true,...}`. Das Panel zeigt denselben Engine-Zustand wie vor dem Update: eine gestoppte Engine bleibt gestoppt. Braucht die neue Version eine Variable, die dein Deployment nicht hat, startet der Server nicht, und der Fehler nennt die fehlende Variable.

<!-- readme:firebase -->
## Optional: eigenes Firebase für Push-Benachrichtigungen hinzufügen

Push-Benachrichtigungen sind optional und **standardmäßig aus**. Diese Kopie enthält kein Firebase-Projekt, keinen Firebase-Schlüssel und keinen Firebase-Wert: die drei Variablen unten entstehen leer, und solange sie leer sind, läuft die Software normal — das Panel sagt **Benachrichtigungen sind aus: Firebase wurde nicht hinzugefügt**, und jeder Stopp und jeder Alarm wird weiterhin in den Tab Verlauf geschrieben. Um sie mit deinem eigenen Firebase-Projekt einzuschalten, folge den 4 Schritten unten; jeder davon wird vor jeder Veröffentlichung durch eine automatische Prüfung durchlaufen, die eine lokal erzeugte Nachbildung der Firebase-Dienstkontodatei und eine lokale Nachbildung von Firebase verwendet (es wird kein echtes Firebase-Konto benutzt). Um die Benachrichtigungen wieder auszuschalten, lösche die drei Variablen und stelle neu bereit. Diese Software misst die Kosten von Firebase selbst nicht; sieh auf der Preisseite von Firebase nach.

1. Lege in der Firebase-Konsole ein eigenes Projekt an (oder öffne ein vorhandenes), gehe zu **Project settings → Service accounts** und drücke **Generate new private key**. Eine JSON-Datei wird heruntergeladen. Bewahre sie außerhalb des Repository-Ordners auf und committe sie nie: sie ist ein Geheimnis wie dein Binance-Schlüssel.

Erwartetes Ergebnis: eine `.json`-Datei, deren Felder `project_id`, `client_email` und `private_key` enthalten.

2. Öffne in Vercel dein Projekt → **Settings → Environment Variables** und füge drei Variablen hinzu, jede aus dem Feld dieser JSON-Datei kopiert: `FIREBASE_PROJECT_ID` ← `project_id` · `FIREBASE_CLIENT_EMAIL` ← `client_email` · `FIREBASE_PRIVATE_KEY` ← `private_key`. Kopiere bei `private_key` den ganzen Wert, einschließlich der ersten und letzten Zeile; die Folgen `\n` dürfen bleiben, wie sie sind. Setze alle drei oder keine: mit nur einigen bleiben die Benachrichtigungen aus, und das Panel nennt die fehlende oder fehlerhafte Variable (nie ihren Wert).

Erwartetes Ergebnis: die drei Namen stehen in der Liste; ihre Werte erscheinen nirgends im Panel oder in den Protokollen.

3. Stelle das Projekt neu bereit, damit die neuen Variablen gelesen werden (Vercel → **Deployments** → die neueste Bereitstellung → **Redeploy**).

Erwartetes Ergebnis: im Panel sagt **Einstellungen → Benachrichtigungen**, dass die Benachrichtigungen an sind.

4. Eine Benachrichtigung erreicht nur ein Gerät, das sein Firebase-Cloud-Messaging-Token bei deiner Installation registriert hat: `POST /api/device` mit deiner Panel-Sitzung und dem Inhalt `{"token": "<Token des Geräts>", "platform": "web"}` (oder `"android"`). Diese Kopie hat keine App, die das für dich erledigt — es gibt keine Android-App —, dieser Schritt ist also für Entwickler, die mit Firebase einen eigenen Client bauen. Ohne registriertes Gerät wird nichts gesendet, und der Eintrag des Stopps oder Alarms sagt das.

Erwartetes Ergebnis: der Endpunkt antwortet `{"ok":true,"devices":1,...}`; der nächste Stopp oder Alarm wird an dieses Gerät zugestellt, und sein Eintrag sagt, dass er gesendet wurde.

<!-- readme:faq -->
## FAQ / Fehlerbehebung

### Das Vercel-Deployment schlägt mit einer Meldung über Cron-Ausdrücke fehl

Du bist im Hobby-Plan. Laut Vercels Dokumentation *schlägt* ein Cron-Ausdruck, der öfter als einmal täglich läuft, *beim Deployment fehl*; der Zeitplan dieser Software ist jede Minute und lässt sich im Panel nicht ändern. Verschiebe das Projekt in ein Pro-Team oder betreibe es nicht auf Vercel Hobby.

### Der Server startet nicht und gibt „ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor“ aus

Eine Umgebungsvariable fehlt oder ist fehlerhaft (diese Server-Meldung ist noch auf Türkisch). Die Zeilen darunter nennen jede Variable und warum sie abgelehnt wurde (zum Beispiel ein Hauptschlüssel, der nicht aus 44 Zeichen Base64 besteht) — nie ihren Wert. Vergleiche deine Namen mit `.env.example` und der Tabelle unter „Was du brauchst“.

### `/api/health` antwortet `{"ok":true,...}`, aber das Panel fragt nach einem Passwort, und die Einstellungs-Endpunkte antworten 401 mit `{"ok":false,"reason":"NO_SESSION"}`

Das ist der erwartete Zustand ohne Sitzung. Gib das Eigentümer-Passwort in das Feld **Passwort**<!-- ad:login.password --> des Panels ein und drücke **Anmelden**<!-- ad:login.submit --> (siehe „Erste Nutzung“); dieselbe Seite öffnet dann das Panel, kein Neuladen nötig.

### **STARTEN**<!-- ad:engine.start --> wird nicht angezeigt, oder die Engine meldet "Die Engine wurde nicht gestartet: Kein Tick-Intervall gewählt."<!-- ad:engine.notStartedTick|s1 -->

**STARTEN**<!-- ad:engine.start --> erscheint nur, wenn jede Zeile von "Vor dem Start"<!-- ad:engine.beforeYouStart --> ✓ ist. Folge den Links "Zuerst: …"<!-- ad:prereq.keyFix|pre -->. Ist das Tick-Intervall leer (es kommt leer zur Welt), wähle eines unter **Einstellungen → Tick-Intervall**<!-- ad:tabs.settings>prereq.names.tick --> und starte erneut. Bei einer frischen Installation kommen die zwei Risikoanteile leer zur Welt: trage sie unter **Einstellungen → Risikoanteile**<!-- ad:tabs.settings>caps.historyGroup --> ein (siehe „Erste Nutzung“, Schritt 3).

### Mein Binance-Schlüssel wird mit **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** oder **KEY_TYPE_NOT_ED25519** abgelehnt

Erstelle auf Binance einen neuen API-Schlüssel vom Typ **Ed25519** mit **deaktivierten** Auszahlungen und Universal Transfer und füge diesen im Panel hinzu. Im Panel lautet die Ablehnung "Schlüssel ABGELEHNT: …"<!-- ad:key.withdrawals|pre --> und nennt die auszuschaltende Berechtigung. Ein abgelehnter Schlüssel wird weder gespeichert noch protokolliert.

### Soll ich meinen Binance-API-Schlüssel auf eine IP-Adresse beschränken?

Mit einer festen Adresse nicht bei einem normalen Vercel-Setup: Vercel-Funktionen nutzen standardmäßig dynamische ausgehende IP-Adressen, feste ausgehende Adressen sind Vercels kostenpflichtige Funktion Static IPs (100 $ pro Monat und Projekt, Vercel-Dokumentation gelesen am 2026-09-26). Ohne IP-Beschränkung gilt Binances eigene Regel (Binance-Ankündigung vom 2021-07-26): die Berechtigung **Enable Spot & Margin Trading** des Schlüssels gilt **90 Tage** ab Aktivierung und wird dann automatisch ausgeschaltet — schalte sie auf Binance wieder ein, sonst kann die Engine keine Orders platzieren. Binance hat außerdem mitgeteilt, dass Schlüssel ohne IP-Beschränkung, die 30 Tage ungenutzt bleiben, entfernt werden; das Panel zeigt einen 30-Tage-Zähler unter **Einstellungen → Binance-API-Schlüssel → Technische Details**<!-- ad:tabs.settings>key.heading>common.technicalDetails -->.

### Ich habe das Passwort, den Authenticator (TOTP) oder einen Schlüssel verloren

- **Passwort oder TOTP:** lege die alte `owner-credentials.txt` beiseite, führe `npm run owner:credentials` erneut aus, ersetze `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET` und `SESSION_SECRET` in Vercel durch die drei Zeilen der neuen `vercel-env-owner.txt` und deploye neu. Alle offenen Sitzungen enden; füge den neuen TOTP-Einrichtungsschlüssel zu deiner Authenticator-App hinzu.
- **Stopp-Schlüssel:** lege `stop-key.txt` beiseite, führe `npm run stop:credential` aus, trage den neuen Hash in `STOP_KEY_HASH` ein und deploye neu.
- **Hauptschlüssel verloren** (`ENCRYPTION_MASTER_KEY`): der gespeicherte Binance-Schlüssel lässt sich nicht mehr entschlüsseln und nicht wiederherstellen. Lösche diesen API-Schlüssel auf Binance, lege `encryption-master-key.txt` beiseite, führe `npm run key:encryption-master` aus, trage den neuen Wert in `ENCRYPTION_MASTER_KEY` ein, deploye neu und füge im Panel einen neuen Binance-Schlüssel hinzu. Hast du den alten Hauptschlüssel noch und willst ihn nur ändern, nutze stattdessen die Rotation (Installationsschritt 15).
- **Privater Binance-Schlüssel verloren:** lösche diesen API-Schlüssel auf Binance, lege die alten `.pem`-Dateien beiseite, führe `npm run key:generate` aus, erstelle mit dem neuen öffentlichen Schlüssel einen neuen API-Schlüssel und füge ihn im Panel hinzu.

### Wie deinstalliere ich und höre auf zu zahlen?

Stoppe zuerst die Engine (**STOPP**<!-- ad:engine.stop --> im Tab **Status**<!-- ad:tabs.status --> oder `/durdur`). Dann:
- lösche den API-Schlüssel auf Binance (Profile → API Management) — das allein beendet jeden Handelszugriff;
- lösche das Vercel-Projekt (Project → Settings → Delete Project) — das entfernt den geplanten Job, der jede Minute läuft; war dieses Projekt dein einziger Grund für Vercel Pro, ändere oder kündige den Plan in Vercels Abrechnungseinstellungen;
- lösche das Neon-Projekt und die Upstash-Datenbank in ihren eigenen Konsolen;
- widerrufe den Anthropic-API-Schlüssel.

Die Dateien in `winvestour-backup` gehören nur zu dieser Installation; lösche sie, wenn du sie nicht mehr brauchst.

### Binance antwortet 451 „Service unavailable from a restricted location“

Binance blockiert Anfragen aus US-Standorten. `vercel.json` bindet die Funktionen deshalb an die Region `hnd1` (Tokio); änderst du die Region auf eine US-Region, schlägt jeder Aufruf an Binance mit 451 fehl und die Engine meldet die Region als gesperrt.

### Sendet diese Software etwas an ihren Betreuer?

Nein. Sie ruft nur Binance (mit deinem Schlüssel), dein eigenes Neon und Upstash sowie Anthropic (mit deinem Schlüssel) auf. Der einzige Drittverkehr, den sie nicht steuert, ist die im Kostenabschnitt beschriebene Next.js-Build-Telemetrie, die du mit `NEXT_TELEMETRY_DISABLED=1` abschalten kannst. Nur wenn du die optionale Firebase-Erweiterung hinzufügst, ruft sie außerdem die Anmelde- (OAuth) und Firebase-Cloud-Messaging-Endpunkte von Google mit deinem eigenen Dienstkonto auf.

### `npx prisma migrate deploy` schlägt bei einem Update fehl

Wenn die Ausgabe `Error: Connection url is empty.` lautet, ist `DIRECT_URL` in diesem Terminal nicht gesetzt: trage die direkte (nicht gepoolte) Neon-Verbindungszeichenfolge in die Datei `.env` neben `package.json` ein (wie in Installationsschritt 10) oder setze sie im Terminal, und führe den Befehl erneut aus — an der Datenbank wurde nichts geändert. Bei jeder anderen Meldung: bearbeite oder lösche keine Dateien in `prisma/migrations` und ändere keine Tabellen von Hand; führe `npx prisma migrate status` aus, um zu sehen, welche Änderung noch aussteht, und frage in GitHub **Discussions → Q&A** (füge nie die Verbindungszeichenfolge ein).

---

Code-Beiträge und Pull Requests werden nicht angenommen; Fehlerberichte, Installationsfragen und vertrauliche Sicherheitsmeldungen sind offen — siehe [CONTRIBUTING.md](CONTRIBUTING.md) und `SECURITY.md`. Lizenz: MIT (siehe `LICENSE`); du darfst forken und deine eigene Kopie ändern.
