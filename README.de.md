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

Diese Kopie trägt nichts vom Betreuer: der Code liest keinen Domainnamen, es gibt kein Android-Paketname und kein Signatur-Fingerabdruck im Umgebungsvertrag, und es gibt keine Firebase/FCM-Konfiguration und keine Variable. Alles unten kommt leer zur Welt, und du füllst es mit deinen eigenen Werten.

| Umgebungsvariable | Woher der Wert kommt |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → dein Projekt → Verbindungszeichenfolgen (gepoolt · direkt) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → deine Datenbank → REST API. Fügst du Upstash über den Vercel Marketplace hinzu, setzt er stattdessen die Namen `KV_REST_API_URL` und `KV_REST_API_TOKEN`; die App liest auch diese. |
| `ANTHROPIC_API_KEY` | Anthropic → API-Schlüssel (beginnt mit `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | die Datei aus Installationsschritt 4 |
| `STOP_KEY_HASH` | die Datei aus Installationsschritt 5 |
| `ENCRYPTION_MASTER_KEY` | die Datei aus Installationsschritt 6 |
| `ENCRYPTION_KEY_VERSION` | `1` bei einer frischen Installation (nur bei einer Rotation des Hauptschlüssels erhöht, Schritt 14) |
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

4. Steps. Take me through the README's Installation steps below, in this order, with exactly these commands. Do not add, skip, reorder or change any command. Step 14 is optional and not part of the setup.
  1. Open the accounts you will need (about 30 minutes in total)
     Check: you can sign in to all four services, and your Binance API key's permissions do not include withdrawals.
  2. Get the code onto your computer
     Check: the folder contains `package.json` and `.env.example`.
  3. Install the dependencies from the copy's lock file
     Command: `npm ci`
     Check: the command ends without an error and a `node_modules` folder appears.
  4. Generate the owner password, the TOTP secret and the session secret
     Command: `npm run owner:credentials`
     Check: the folder now contains sahip-kimlik.txt, vercel-env-sahip.json; the first holds your password and the TOTP setup key for your authenticator app, the second the three values for step 8. Nothing is printed on screen.
  5. Generate the stop key (written to the same folder, not printed)
     Command: `npm run stop:credential`
     Check: durdurma-anahtari.txt, vercel-env-STOP_KEY_HASH.txt appear in the folder; the first holds the raw stop key you will type on the stop screen, the second its hash for step 8.
  6. Generate the master key that encrypts your exchange keys (written to the same folder, not printed)
     Command: `npm run key:encryption-master`
     Check: sifreleme-ana-anahtari.txt, vercel-env-ENCRYPTION_MASTER_KEY.txt appear in the folder.
  7. Create an empty PostgreSQL database
     Check: two strings that start with `postgresql://`; the database has no tables yet.
  8. Give every name in `.env.example` its value
     Check: every name in `.env.example` has a value. If a required name is missing, the application stops at startup and names the missing variable.
  9. Create the database tables
     Command: `npx prisma migrate deploy`
     Check: the output ends with `All migrations have been successfully applied.` A single migration named `0_baslangic` is applied; every settings table starts with one row; the risk settings are empty and switched off.
  10. Check that the code builds on your computer (recommended before deploying)
     Command: `npm run build`
     Check: the command ends with the list of routes and no error; a `.next` folder appears.
  11. Start it locally
     Command: `npm start`
     Check: the page shows `{"ok":true,"service":"engine",...}`, and `http://localhost:3000/panel` opens and says that the panel needs a session. The environment contract is validated as the server starts: if a required name is missing or malformed the server does not come up, and the error names the missing variable, never its value. Stop the server with Ctrl+C. Running the bot on your own computer is not supported yet: the engine is triggered by Vercel Cron. Local start is only for checking the installation.
  12. Deploy on Vercel
     Check: the deployment reaches Ready, and `https://<your-project>.vercel.app/api/health` returns `{"ok":true,...}`. On the Hobby plan the deployment fails instead, with a message that cron expressions running more often than once per day are not allowed.
  13. Open the panel at `/panel` on your address, and the stop screen at `/durdur`
     Check: both pages open (today the interface is in Turkish). The panel says it needs a session; the stop screen opens without a session and asks for the stop key. Continue with "First use".
  14. OPTIONAL, NOT PART OF SETUP — MASTER KEY ROTATION
     Command: `npm run rotate:encryption-key`
     Check: each row is decrypted with the old key and re-wrapped with the new one in its own transaction, and its version is raised; the new envelope is checked against the new key BEFORE anything is written. Once no row is left on the old version, `ENCRYPTION_MASTER_KEY_PREVIOUS` can be deleted. No key value is ever printed.

5. Checks. After each step, ask me to compare what I see with the Check line of that step. If it does not match, stop, do not improvise a fix, and send me to the README section "FAQ / troubleshooting" and the wiki page FAQ.

6. First use. When the deployment is Ready, guide me through the README section "First use" in this order (the panel is in Turkish; the README gives each button's name):
  1. Sign in (owner password, then a one-time code per sensitive action)
  2. Add your Binance API key (withdrawals must be off)
  3. Choose the tick interval (born empty)
  4. Start and stop the engine
  5. The entry switch (born ENABLED)
  6. The cost cap and the Brain (born empty)
```

<!-- readme:install -->
## Installation

Jeder der 14 Schritte unten wird vor jeder Veröffentlichung in einer sauberen Kopie dieses Repositorys durchlaufen — die Schritte 1–13 durch die automatische Installationsprüfung, Schritt 14 durch die Schlüsselrotationsprüfung. Ein Schritt, der so nicht durchlaufen wird, steht hier nicht.

1. Lege die nötigen Konten an (insgesamt etwa 30 Minuten): ein **Neon**-Konto (PostgreSQL-Datenbank), ein **Upstash**-Konto (Redis), ein **Vercel**-Konto im **Pro-Plan** (die App führt jede Minute einen geplanten Job aus; im kostenlosen Hobby-Plan schlägt das Deployment fehl — siehe "Was du brauchst"), einen **Anthropic**-API-Schlüssel und einen **Binance**-API-Schlüssel, der **ohne Auszahlungsberechtigung** erstellt wurde.

Erwartetes Ergebnis: du kannst dich bei allen vier Diensten anmelden, und die Berechtigungen deines Binance-API-Schlüssels enthalten keine Auszahlungen.

2. Hole den Code auf deinen Rechner: wähle auf der Seite dieses Repositorys **Code → Download ZIP** (oder klone es mit deinem eigenen Git-Client), entpacke es und öffne ein Terminal in diesem Ordner.

Erwartetes Ergebnis: der Ordner enthält `package.json` und `.env.example`.

3. Installiere die Abhängigkeiten aus der Lock-Datei der Kopie:

```sh
npm ci
```

Erwartetes Ergebnis: der Befehl endet ohne Fehler, und ein Ordner `node_modules` erscheint.

4. Erzeuge das Eigentümer-Passwort, das TOTP-Geheimnis und das Sitzungsgeheimnis. Die Werte werden nicht angezeigt; sie werden in einen Ordner außerhalb des Repositorys geschrieben (Standard: `winvestour-yedek` in deinem Home-Ordner, `-- --dir <Ordner>` für einen anderen Ort):

```sh
npm run owner:credentials
```

Erwartetes Ergebnis: der Ordner enthält jetzt `sahip-kimlik.txt`, `vercel-env-sahip.json`; die erste Datei enthält dein Passwort und den TOTP-Einrichtungsschlüssel für deine Authenticator-App, die zweite die drei Werte für Schritt 8. Auf dem Bildschirm wird nichts ausgegeben.

5. Erzeuge den Stopp-Schlüssel (wird in denselben Ordner geschrieben, nicht angezeigt):

```sh
npm run stop:credential
```

Erwartetes Ergebnis: `durdurma-anahtari.txt`, `vercel-env-STOP_KEY_HASH.txt` erscheinen im Ordner; die erste Datei enthält den rohen Stopp-Schlüssel, den du auf dem Stopp-Bildschirm eingibst, die zweite seinen Hash für Schritt 8.

6. Erzeuge den Hauptschlüssel, der deine Börsenschlüssel verschlüsselt (wird in denselben Ordner geschrieben, nicht angezeigt). Geht dieser Schlüssel verloren, lassen sich die verschlüsselten Zeilen nie wieder öffnen; bewahre eine zweite Kopie in deinem Passwort-Manager auf:

```sh
npm run key:encryption-master
```

Erwartetes Ergebnis: `sifreleme-ana-anahtari.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt` erscheinen im Ordner.

7. Lege eine leere PostgreSQL-Datenbank an: erstelle in Neon ein Projekt und kopiere seine beiden Verbindungszeichenfolgen — die gepoolte wird `DATABASE_URL`, die direkte (ungepoolte) wird `DIRECT_URL`.

Erwartetes Ergebnis: zwei Zeichenfolgen, die mit `postgresql://` beginnen; die Datenbank hat noch keine Tabellen.

8. Gib jedem Namen in `.env.example` seinen Wert. Woher jeder Wert kommt, steht in der Tabelle unter "Was du brauchst"; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` stammen aus den Dateien der Schritte 4–6. Für das Deployment trägst du sie in Vercel unter **Settings → Environment Variables** ein; für einen lokalen Lauf schreibst du dieselben Namen in eine Datei `.env` neben `package.json` (Git ignoriert diese Datei). Werte gelangen nie ins Repository.

Erwartetes Ergebnis: jeder Name in `.env.example` hat einen Wert. Fehlt ein Pflichtname, stoppt die Anwendung beim Start und nennt die fehlende Variable.

9. Lege die Datenbanktabellen an. Führe dies einmal von deinem Rechner aus, mit gesetztem `DIRECT_URL` (in `.env` oder im Terminal); Vercel wiederholt denselben Befehl bei jedem Deployment, das ist unschädlich:

```sh
npx prisma migrate deploy
```

Erwartetes Ergebnis: die Ausgabe endet mit `All migrations have been successfully applied.` Eine einzelne Migration namens `0_baslangic` wird angewendet; jede Einstellungstabelle beginnt mit einer Zeile; die Risikoeinstellungen sind leer und ausgeschaltet.

10. Prüfe, dass der Code auf deinem Rechner baut (vor dem Deployment empfohlen):

```sh
npm run build
```

Erwartetes Ergebnis: der Befehl endet mit der Routenliste und ohne Fehler; ein Ordner `.next` erscheint.

11. Starte sie lokal. Sobald die Anwendung läuft, öffne `http://localhost:3000/api/health` in deinem Browser:

```sh
npm start
```

Erwartetes Ergebnis: die Seite zeigt `{"ok":true,"service":"engine",...}`, und `http://localhost:3000/panel` öffnet sich und sagt, dass das Panel eine Sitzung braucht. Beim Start wird der Umgebungsvertrag geprüft: fehlt ein Pflichtname oder ist er fehlerhaft, startet der Server nicht, und der Fehler nennt die fehlende Variable, nie ihren Wert. Beende den Server mit Strg+C. Den Bot auf deinem eigenen Computer zu betreiben wird noch nicht unterstützt: die Engine wird von Vercel Cron ausgelöst. Der lokale Start dient nur zur Prüfung der Installation.

12. Deploye auf Vercel: pushe deine Kopie in dein eigenes GitHub-Konto, wähle dann in Vercel **Add New → Project → Import** für dieses Repository, behalte die Framework-Voreinstellung **Next.js**, füge die Umgebungsvariablen aus Schritt 8 hinzu und drücke **Deploy**. Vercel führt das Skript `vercel-build` aus: es lehnt zuerst jede Migration ab, die Daten löschen würde, dann legt es die Tabellen an und baut.

Erwartetes Ergebnis: das Deployment erreicht **Ready**, und `https://<dein-projekt>.vercel.app/api/health` liefert `{"ok":true,...}`. Im Hobby-Plan schlägt das Deployment stattdessen fehl, mit der Meldung, dass Cron-Ausdrücke, die öfter als einmal täglich laufen, nicht erlaubt sind.

13. Öffne das Panel unter `/panel` auf deiner Adresse und den Stopp-Bildschirm unter `/durdur`.

Erwartetes Ergebnis: beide Seiten öffnen sich (heute ist die Oberfläche auf Türkisch). Das Panel sagt, es brauche eine Sitzung; der Stopp-Bildschirm öffnet sich ohne Sitzung und fragt nach dem Stopp-Schlüssel. Weiter mit "Erste Nutzung".

14. OPTIONAL, NICHT TEIL DER EINRICHTUNG — ROTATION DES HAUPTSCHLÜSSELS. Wenn dein Hauptschlüssel geleakt ist oder du ihn ändern willst: lege die alte Sicherungsdatei beiseite, führe Schritt 6 erneut aus, um einen NEUEN Schlüssel zu erzeugen, übergib den neuen als `ENCRYPTION_MASTER_KEY`, den alten als `ENCRYPTION_MASTER_KEY_PREVIOUS`, und erhöhe `ENCRYPTION_KEY_VERSION` um eins. Standardmäßig ist es ein TROCKENLAUF: nichts wird geschrieben, nur die Entschlüsselbarkeit wird gemessen; füge `-- --write` an, um wirklich zu schreiben:

```sh
npm run rotate:encryption-key
```

Ergebnis: jede Zeile wird in ihrer eigenen Transaktion mit dem alten Schlüssel entschlüsselt und mit dem neuen neu verpackt, und ihre Version wird erhöht; der neue Umschlag wird gegen den neuen Schlüssel geprüft, BEVOR etwas geschrieben wird. Sobald keine Zeile mehr auf der alten Version steht, kann `ENCRYPTION_MASTER_KEY_PREVIOUS` gelöscht werden. Kein Schlüsselwert wird je ausgegeben.

<!-- readme:first-use -->
## Erste Nutzung

Heute ist die Oberfläche nur auf **Türkisch**. Du meldest dich auf der Panel-Seite mit dem Eigentümer-Passwort an und fügst den Binance-Schlüssel im Panel hinzu; das Starten der Engine geschieht weiterhin mit einer HTTP-Anfrage (aus der Entwicklerkonsole deines Browsers oder einem beliebigen HTTP-Client), während du angemeldet bist. Jeder Schritt unten beschreibt genau, was die Software heute tut; nichts hier ist geplant oder versprochen.

**Einstellungen:** jede Einstellung im Panel — was sie tut, ihr Standardwert, ob sie den Einmalcode braucht, wann sie wirkt — ist im [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide) des Wikis beschrieben (auf Englisch).

### 1. Anmelden (Eigentümer-Passwort, dann ein Einmalcode pro sensibler Aktion)

Öffne `https://<dein-projekt>.vercel.app/panel` im Browser. Ohne Sitzung zeigt das Panel ein einziges Feld **Parola** (Passwort) und eine Schaltfläche **Giriş yap** (anmelden): Gib das Passwort aus der Datei von Schritt 4 ein und drücke die Schaltfläche — dieselbe Seite öffnet dann das Panel. Die Sitzung gilt **8 Stunden**. Ein falsches Passwort zeigt „Parola yanlış, yeniden dene.“ (Passwort falsch, versuche es erneut). Nach **5** falschen Versuchen sind die Anmeldung und jede sensible Aktion **15 Minuten** gesperrt und das Panel zeigt „Çok fazla yanlış deneme yapıldı; giriş kilitlendi, en geç 15 dakika sonra yeniden dene.“ (zu viele Fehlversuche, versuche es spätestens in 15 Minuten erneut) — während der Sperre wird auch das richtige Passwort abgelehnt; der Stopp-Bildschirm wird nie gesperrt. Zum Beenden der Sitzung drücke oben im Panel **Çıkış yap** (abmelden). Sensible Aktionen (Schlüssel hinzufügen, Engine starten, Einstiegsschalter öffnen, Kostenobergrenze erhöhen) verlangen zusätzlich den aktuellen **6-stelligen Code** aus deiner Authenticator-App im Anfrage-Header `x-totp-code` — die Panel-Formulare fragen ihn im Feld „Tek kullanımlık kod“ (Einmalcode) ab. Füge das TOTP-Geheimnis aus der Datei von Schritt 4 einmal deiner Authenticator-App hinzu.

### 2. Deinen Binance-API-Schlüssel hinzufügen (Auszahlungen müssen aus sein)

Erstelle zuerst den Schlüssel bei Binance: Erzeuge mit dem Schlüsselgenerator von Binance auf deinem eigenen Computer ein **Ed25519**-Schlüsselpaar (der private Schlüssel bleibt bei dir), öffne dann bei Binance Profil → API Management → Create API → **Self-generated**, füge den öffentlichen Schlüssel ein, gib einen Namen an und schließe die Zwei-Faktor-Prüfung ab; Binance zeigt dir dann den API key. Berechtigungen: Lesen **an** (ein Schlüssel ohne Lesen wird abgelehnt), Spot-Handel **an**, damit die Engine Orders senden kann, Futures nur wenn du Futures nutzt, Auszahlungen und universeller Transfer **aus**. Öffne dann im Panel den Abschnitt **"Binance API anahtarı"** (Binance-API-Schlüssel) → **"Anahtar ekle (tek kullanımlık kod ister)"** (Schlüssel hinzufügen, braucht den Einmalcode), fülle **Ad** (ein Name nur für dich), **API key**, **Özel anahtar** (der ganze private Ed25519-Schlüssel im PEM-Format — das Feld bleibt verdeckt) und **Tek kullanımlık kod** aus und drücke **"Anahtarı doğrula ve kaydet"** (prüfen und speichern). Die App prüft die Berechtigungen des Schlüssels bei Binance, bevor sie etwas speichert: ein Schlüssel mit aktivierten Auszahlungen oder universellem Transfer wird abgelehnt und nirgends gespeichert, und das Panel sagt, welche Berechtigung auszuschalten ist; ein privater Schlüssel, der kein Ed25519-PEM ist, wird ebenfalls abgelehnt. Ein akzeptierter Schlüssel wird mit deinem Hauptschlüssel verschlüsselt gespeichert; kein Teil davon wird je angezeigt, ausgegeben oder zurückgegeben. Derselbe Abschnitt zeigt danach, ob ein Schlüssel gespeichert ist, seine Berechtigungen laut Binance, wann er zuletzt geändert wurde, und den 30-Tage-Zähler (Binance löscht einen Schlüssel ohne IP-Beschränkung nach 30 Tagen ohne Orders — gemessen). Mit einem neuen Schlüssel nutzt die Engine den neuesten; der alte wird bei Binance nicht geschlossen — lösche ihn dort selbst.

### 3. Das Tick-Intervall wählen (kommt leer zur Welt)

Öffne `/panel` mit der Sitzung und suche den Abschnitt **„Tik aralığı — motor ne sıklıkla çalışır“** (Tick-Intervall). Die Auswahl ist **alle 1, 2 oder 3 Minuten**. Bei einer frischen Installation ist das Intervall **leer**, und die Engine kann nicht gestartet werden, bis du eines wählst. Eine Änderung wird **spätestens innerhalb von 20 Minuten** wirksam oder beim Neustart der Engine; ein selteneres Intervall braucht keinen Code, ein häufigeres verlangt den Einmalcode.

### 4. Die Engine starten und stoppen

**Start:** heute gibt es im Panel keinen Start-Knopf. Sende `POST /api/engine/resume` mit dem Sitzungs-Cookie und dem Header `x-totp-code`. Ist das Tick-Intervall noch leer, wird die Anfrage mit **TICK_UNSET** (HTTP 409) abgelehnt und nichts ändert sich. **Stopp:** öffne `/durdur` — es braucht **keine** Sitzung und keinen Code. Gib den rohen Stopp-Schlüssel aus der Datei von Schritt 5 ein, wähle unter **„Ne olsun?“** entweder **„Yalnız durdur“** (nur stoppen: offene Positionen und ihre Schutzaufträge an der Börse bleiben, wie sie sind) oder **„Durdur ve kapatma iste“** (stoppen und eine Schließanfrage aufzeichnen; die Software schließt Positionen heute nicht selbst), und sende. Der Schlüssel wird nie im Browser gespeichert.

### 5. Der Einstiegsschalter (kommt AKTIV zur Welt)

Der Panel-Abschnitt **„Giriş şalteri“** zeigt, ob die Engine **Einstiegs**aufträge senden darf. Bei einer frischen Installation ist er **AKTIV**, aber solange der Binance-Schlüssel, das Kapital und die Risikoeinstellungen leer sind, wird kein Auftrag gesendet. Das Öffnen von **„Bu ayarı değiştir (tek kullanımlık kod ister)“** lässt dich umschalten; das **Einschalten** zeigt den Warntext vom Anfang dieser Seite mit einem Kästchen, das du ankreuzen musst, und verlangt den Einmalcode. Das Ausschalten schließt keine offenen Positionen und stoppt die Engine nicht — nutze dafür `/durdur`.

### 6. Die Kostenobergrenze und das Gehirn (kommt leer zur Welt)

Der Abschnitt **„Aylık maliyet tavanı“** hält die monatliche Kostenobergrenze in Dollar. Sie kommt **leer** zur Welt, und solange sie leer ist, wird das Gehirn (Claude) überhaupt **nicht** aufgerufen („Tavan boşken davranış“: das Gehirn ist aus). Trage eine Obergrenze ein, wenn die tägliche Regelerzeugung laufen soll; eine Obergrenze zu senken oder zu leeren braucht keinen Code, sie zu erhöhen verlangt den Einmalcode. Der Abschnitt **„Karar motoru ayarı“** zeigt das Modell (standardmäßig `claude-opus-5`), die Aufrufhäufigkeit (standardmäßig alle 24 Stunden) sowie die Anzahl der Kandidaten und Kerzen.

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

**Bei gestoppter Engine / bei einer FRISCHEN INSTALLATION (Standardeinstellungen): ≈ 0,24 – 0,60 $ / Monat.** Bei einer frischen Installation kann die Engine nicht gestartet werden (das Tick-Intervall kommt leer zur Welt, und die Startanfrage wird abgelehnt), und die Kostenobergrenze kommt leer zur Welt (das Gehirn wird nie aufgerufen). In diesem Zustand erzeugt die Software (aus dem Code gezählt, 2026-09-24): einen Serveraufruf pro Minute (**1 440/Tag · 43 200/Monat**), **1 Upstash-Befehl** pro Aufruf (er liest die Kopie der Laufgenehmigung), **0 Datenbankabfragen** (Neon wird nie geweckt), **0 Claude-Aufrufe**. Die Rechnung: Vercel-Aufrufe 43 200 × 0,60 $/M = 0,03 $ + Speicher 2 GB × gemessene 0,53–1,43 s × 43 200 ÷ 3600 = 12,7–34,3 GB-h × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $**; aktive CPU-Zeit wurde **nicht gemessen** (dafür steht hier keine Zahl). Jedes Öffnen des Panels erzeugt gemessen 5 Datenbankabfragen, 1 Datenbank-Aufwachen und 2 Upstash-Befehle; wie oft du es öffnest, liegt bei dir.

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

<!-- readme:faq -->
## FAQ / Fehlerbehebung

### Das Vercel-Deployment schlägt mit einer Meldung über Cron-Ausdrücke fehl

Du bist im Hobby-Plan. Vercels Dokumentation sagt, ein Cron-Ausdruck, der öfter als einmal pro Tag läuft, *schlägt beim Deployment fehl*; der Zeitplan dieser Software ist jede Minute und lässt sich nicht im Panel ändern. Verschiebe das Projekt in ein Pro-Team, oder betreibe es nicht auf Vercel Hobby.

### Der Server startet nicht und gibt „ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor“ aus

Eine Umgebungsvariable fehlt oder ist fehlerhaft. Die Zeilen unter dieser Meldung nennen jede Variable und warum sie abgelehnt wurde (zum Beispiel ein Hauptschlüssel, der nicht 44 Zeichen Base64 ist) — nie ihren Wert. Vergleiche deine Namen mit `.env.example` und der Tabelle unter „Was du brauchst“.

### `/api/health` antwortet `{"ok":true,...}`, aber das Panel fragt nach einem Passwort, und die Einstellungs-Endpunkte antworten 401 mit `{"ok":false,"reason":"NO_SESSION"}`

Das ist der erwartete Zustand ohne Sitzung. Gib das Eigentümer-Passwort in das Feld **Parola** des Panels ein und drücke **Giriş yap** (siehe „Erste Nutzung“); dieselbe Seite öffnet dann das Panel, kein Neuladen nötig.

### Das Starten der Engine antwortet 409 mit dem Grund **TICK_UNSET**

Das Tick-Intervall ist leer (es kommt leer zur Welt). Wähle zuerst ein Intervall im Panel-Abschnitt „Tik aralığı“ und sende die Startanfrage dann erneut.

### Mein Binance-Schlüssel wird mit **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** oder **KEY_TYPE_NOT_ED25519** abgelehnt

Erstelle bei Binance einen neuen API-Schlüssel vom Typ **Ed25519** mit **deaktivierten** Auszahlungen und universellen Transfers und füge diesen im Panel hinzu. Im Panel lautet die Ablehnung "Anahtar REDDEDİLDİ: …" (Schlüssel abgelehnt) und nennt die auszuschaltende Berechtigung. Ein abgelehnter Schlüssel wird nicht gespeichert und nicht protokolliert.

### Binance antwortet 451 „Service unavailable from a restricted location“

Binance blockiert Anfragen aus US-Standorten. `vercel.json` legt die Funktionen deshalb auf die Region `hnd1` (Tokio) fest; änderst du die Region auf eine US-Region, schlägt jeder Aufruf an Binance mit 451 fehl, und die Engine meldet die Region als blockiert.

### Sendet diese Software etwas an ihren Betreuer?

Nein. Sie ruft nur Binance (mit deinem Schlüssel), dein eigenes Neon und Upstash sowie Anthropic (mit deinem Schlüssel) auf. Der einzige Drittverkehr, den sie nicht kontrolliert, ist die im Kostenabschnitt beschriebene Next.js-Build-Telemetrie, die du mit `NEXT_TELEMETRY_DISABLED=1` abschalten kannst.

---

Code-Beiträge und Pull Requests werden nicht angenommen; Fehlerberichte, Installationsfragen und vertrauliche Sicherheitsmeldungen sind offen — siehe [CONTRIBUTING.md](CONTRIBUTING.md) und `SECURITY.md`. Lizenz: MIT (siehe `LICENSE`); du darfst forken und deine eigene Kopie ändern.
