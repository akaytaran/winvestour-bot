# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

En cas de contradiction, le texte anglais fait foi.

<!-- readme:intro -->
## Ce que c'est

`winvestour-bot` est un petit moteur de trading que tu fais tourner **sur tes propres comptes** : il lit le marché spot de Binance avec **ta** clé API, décide selon des règles qu'un modèle Claude écrit une fois par jour, et peut passer de vrais ordres sur ton compte. Chaque installation est sa propre copie — la base de données, la clé Binance et la clé API Claude restent dans ton propre hébergement, et rien dans cette copie ne rappelle le mainteneur. Il s'adresse à une personne qui veut faire tourner un tel moteur pour elle-même, lire d'abord le code et commencer avec un petit montant.

**Sommaire :** [Ce qu'il te faut](#ce-quil-te-faut) · [Installer avec un assistant IA](#installer-avec-un-assistant-ia) · [Installation](#installation) · [Première utilisation](#première-utilisation) · [Coût mensuel de fonctionnement](#coût-mensuel-de-fonctionnement) · [FAQ / dépannage](#faq--dépannage) · [Contribuer](CONTRIBUTING.md)

<!-- readme:warning -->
### ⚠️ À lire avant d'installer

1. **Ce logiciel n'est pas un conseil financier.** Aucun profit n'est promis. Les mesures passées ne préjugent pas des résultats futurs.
2. **Ce logiciel peut passer de lui-même de vrais ordres avec de l'argent réel.** Dans une installation neuve, le chemin d'entrée est **ACTIVÉ par défaut.** Aucun ordre n'est envoyé tant que tu n'as pas ajouté ta propre clé Binance, ton capital et tes réglages de risque. Tu peux le désactiver depuis le panneau à tout moment.
3. **Le risque de perte est réel et t'incombe entièrement.** N'utilise pas d'argent que tu as peur de perdre.
4. Le logiciel est fourni **sous licence MIT, « EN L'ÉTAT »**, sans aucune garantie. L'auteur et les contributeurs n'assument aucune responsabilité pour tes résultats de trading, pertes, pannes ou défauts.
5. **La conformité est ta responsabilité.** Le trading de cryptomonnaies est restreint ou interdit dans certaines juridictions ; respecter ta loi locale et les conditions d'utilisation de Binance t'incombe. Ce projet n'est ni affilié à Binance ni approuvé par Binance.
6. **Les impôts sont ta responsabilité.**
7. Ne l'exécute pas sans avoir lu le code et testé d'abord avec un petit montant.

<!-- readme:need -->
## Ce qu'il te faut

- **Un compte Vercel avec le plan Pro.** Le moteur est piloté par une tâche planifiée qui s'exécute **chaque minute** (`vercel.json`). Le plan gratuit Hobby de Vercel n'autorise une tâche planifiée qu'**une fois par jour** au maximum, et sa documentation dit qu'une planification plus fréquente *échoue au déploiement* — sur Hobby, le déploiement ne se met donc pas en ligne. Lis les tarifs et conditions de Vercel avant de choisir.
- **Un compte Neon** (PostgreSQL). Le plan gratuit suffit pour les tables ; la section sur les coûts ci-dessous dit ce qui a été mesuré.
- **Un compte Upstash** (Redis). Le quota du plan gratuit suffit pour une position ouverte à la fois.
- **Une clé API Anthropic.** Le modèle qui écrit les règles (le « Cerveau ») est appelé une fois par jour par défaut ; une installation neuve naît avec un plafond de coût **vide**, et tant qu'il est vide le Cerveau n'est **pas** appelé.
- **Une clé API Binance de type Ed25519, créée sans autorisation de retrait.** Une clé avec retraits ou transfert universel activés est refusée et jamais enregistrée.
- **Node.js et npm** sur ton ordinateur pour les commandes d'installation, et environ **une heure** au total.

Cette copie ne porte rien du mainteneur : le code ne lit aucun nom de domaine, il n'y a aucun nom de paquet Android ni empreinte de signature dans le contrat d'environnement, et les trois variables Firebase de l'extension facultative de notifications push naissent vides, donc les notifications sont désactivées. Tout ce qui suit naît vide, et tu le remplis avec tes propres valeurs.

| Variable d'environnement | D'où vient la valeur |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → ton projet → chaînes de connexion (avec pool · directe) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → ta base → REST API. Si tu ajoutes Upstash via le Vercel Marketplace, il définit à la place les noms `KV_REST_API_URL` et `KV_REST_API_TOKEN` ; l'application les lit aussi. |
| `ANTHROPIC_API_KEY` | Anthropic → clés API (commence par `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | le fichier écrit par l'étape d'installation 4 |
| `STOP_KEY_HASH` | le fichier écrit par l'étape d'installation 5 |
| `ENCRYPTION_MASTER_KEY` | le fichier écrit par l'étape d'installation 6 |
| `ENCRYPTION_KEY_VERSION` | `1` sur une installation neuve (augmenté seulement lors d'une rotation de la clé maîtresse, étape 15) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | laisser vide ; utilisé seulement pendant une rotation de la clé maîtresse |
| `ENGINE_MODE` | `CHEAP` (un tick par minute depuis la tâche planifiée ; le seul mode que ce README décrit) |

La clé API Binance n'est **pas** une variable d'environnement : elle est transmise via l'application après l'installation et stockée dans ta base de données, chiffrée avec ta clé maîtresse (voir « Première utilisation »).

## Installer avec un assistant IA

Copie le bloc ci-dessous tel quel et colle-le dans un assistant IA (Claude, ChatGPT, Cursor ou similaire). Il te fait passer une à une les étapes numérotées de la section Installation, te fait vérifier chaque résultat et ne te demande jamais de coller dans la conversation un mot de passe, une clé ou une valeur de `.env`. Le bloc est volontairement en anglais et identique dans chaque version linguistique de cette page.

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

Chacune des 15 étapes ci-dessous est exécutée avant chaque publication dans une copie propre de ce dépôt — les étapes 1–14 par la vérification automatique d'installation, l'étape 15 par la vérification de rotation de clé. Une étape qui n'est pas exécutée ainsi n'est pas écrite ici.

1. Ouvre les comptes nécessaires (environ 30 minutes au total) : un compte **Neon** (base de données PostgreSQL), un compte **Upstash** (Redis), un compte **Vercel** avec le **plan Pro** (l'application exécute une tâche planifiée chaque minute ; avec le plan gratuit Hobby le déploiement échoue — voir « Ce qu'il te faut »), une clé API **Anthropic** et une clé API **Binance** créée **sans autorisation de retrait**.

Résultat attendu : tu peux te connecter aux cinq services, et les permissions de ta clé API Binance n'incluent pas les retraits.

2. Récupère le code sur ton ordinateur : sur la page de ce dépôt, choisis **Code → Download ZIP** (ou clone-le avec ton propre client git), décompresse-le et ouvre un terminal dans ce dossier.

Résultat attendu : le dossier contient `package.json` et `.env.example`.

3. Installe les dépendances à partir du fichier de verrouillage de la copie :

```sh
npm ci
```

Résultat attendu : la commande se termine sans erreur et un dossier `node_modules` apparaît.

4. Génère le mot de passe du propriétaire, le secret TOTP et le secret de session. Aucune valeur n'est affichée, seulement les chemins des fichiers et de courtes empreintes ; les valeurs sont écrites dans un dossier hors du dépôt (par défaut `winvestour-backup` dans ton dossier personnel, `-- --dir <dossier>` pour un autre emplacement) :

```sh
npm run owner:credentials
```

Résultat attendu : le dossier contient maintenant `owner-credentials.txt`, `vercel-env-owner.txt` ; le premier fichier contient ton mot de passe et la clé de configuration TOTP pour ton application d'authentification, le second les trois lignes `NAME=value` pour l'étape 9. Aucune valeur n'est affichée à l'écran, seulement les chemins des fichiers et de courtes empreintes.

5. Génère la clé d'arrêt (écrite dans le même dossier, non affichée) :

```sh
npm run stop:credential
```

Résultat attendu : `stop-key.txt`, `vercel-env-STOP_KEY_HASH.txt` apparaissent dans le dossier ; le premier contient la clé d'arrêt brute que tu saisiras sur l'écran d'arrêt, le second son empreinte pour l'étape 9.

6. Génère la clé maîtresse qui chiffre tes clés d'échange (écrite dans le même dossier, non affichée). Si cette clé est perdue, les lignes chiffrées ne pourront plus jamais être ouvertes ; garde une seconde copie dans ton gestionnaire de mots de passe :

```sh
npm run key:encryption-master
```

Résultat attendu : `encryption-master-key.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt` apparaissent dans le dossier.

7. Génère la paire de clés Ed25519 pour ta clé API Binance (écrite dans le même dossier ; la clé privée n'est pas affichée) :

```sh
npm run key:generate
```

Résultat attendu : `binance-private-key.pem`, `binance-public-key.pem` apparaissent dans le dossier. Sur Binance, choisis Profile → API Management → Create API → **Self-generated** et colle le contenu du second fichier (la clé publique) ; tu colles le premier fichier (la clé privée) plus tard dans le panneau (« Première utilisation »).

8. Crée une base de données PostgreSQL vide : dans Neon, crée un projet et copie ses deux chaînes de connexion — celle avec pool devient `DATABASE_URL`, la directe (sans pool) devient `DIRECT_URL`. Choisis la région **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`) : les fonctions de l'application tournent à Tokyo (`hnd1`, voir `vercel.json`) et Neon n'a pas de région à Tokyo ; Singapour est la plus proche (liste des régions Neon, lue le 2026-09-26).

Résultat attendu : deux chaînes commençant par `postgresql://` ; la base de données n'a pas encore de tables.

9. Donne une valeur à chaque nom de `.env.example` — sauf `ENCRYPTION_MASTER_KEY_PREVIOUS`, qui reste vide (il ne sert que pendant une rotation de la clé maîtresse), et sauf les trois facultatives `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, qui restent vides elles aussi tant que tu n'ajoutes pas ton propre Firebase pour les notifications push (voir la section plus bas). La provenance de chaque valeur est dans le tableau sous « Ce qu'il te faut » ; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` viennent des fichiers des étapes 4–6. Pour le déploiement, saisis-les dans Vercel sous **Settings → Environment Variables** ; pour une exécution locale, mets les mêmes noms dans un fichier `.env` à côté de `package.json` (git ignore ce fichier). Les valeurs n'entrent jamais dans le dépôt.

Résultat attendu : chaque nom de `.env.example` sauf `ENCRYPTION_MASTER_KEY_PREVIOUS` et les trois noms facultatifs `FIREBASE_*` a une valeur. S'il manque un nom obligatoire, l'application s'arrête au démarrage et nomme la variable manquante.

10. Crée les tables de la base de données. Exécute ceci une fois depuis ton ordinateur avec `DIRECT_URL` défini (dans `.env` ou dans le terminal) ; Vercel répète la même commande à chaque déploiement, ce qui est sans danger :

```sh
npx prisma migrate deploy
```

Résultat attendu : la sortie se termine par `All migrations have been successfully applied.` Une seule migration nommée `0_baslangic` est appliquée ; chaque table de réglages démarre avec une ligne ; les réglages de risque sont vides et désactivés.

11. Vérifie que le code se compile sur ton ordinateur (recommandé avant le déploiement) :

```sh
npm run build
```

Résultat attendu : la commande se termine par la liste des routes et sans erreur ; un dossier `.next` apparaît.

12. Lance-la en local. Une fois l'application démarrée, ouvre `http://localhost:3000/api/health` dans ton navigateur :

```sh
npm start
```

Résultat attendu : la page affiche `{"ok":true,"service":"engine",...}`, et `http://localhost:3000/panel` s'ouvre en indiquant que le panneau demande une session. Le contrat d'environnement est validé au démarrage : s'il manque un nom obligatoire ou s'il est mal formé, le serveur ne démarre pas, et l'erreur nomme la variable manquante, jamais sa valeur. Arrête le serveur avec Ctrl+C. Faire tourner le bot sur ton propre ordinateur n'est pas encore pris en charge : le moteur est déclenché par Vercel Cron. Le démarrage local sert seulement à vérifier l'installation.

13. Déploie sur Vercel : pousse ta copie sur ton propre compte GitHub, puis dans Vercel choisis **Add New → Project → Import** pour ce dépôt, garde le préréglage de framework **Next.js**, ajoute les variables d'environnement de l'étape 9 et appuie sur **Deploy**. Vercel exécute le script `vercel-build` : il refuse d'abord toute migration qui supprimerait des données, puis crée les tables et compile.

Résultat attendu : le déploiement atteint **Ready**, et `https://<ton-projet>.vercel.app/api/health` renvoie `{"ok":true,...}`. Avec le plan Hobby, le déploiement échoue à la place, avec un message indiquant que les expressions cron s'exécutant plus d'une fois par jour ne sont pas autorisées.

14. Ouvre le panneau à `/panel` sur ton adresse, et l'écran d'arrêt à `/durdur`.

Résultat attendu : les deux pages s'ouvrent dans la langue de ton navigateur si c'est l'une des sept langues de ce README, sinon en anglais ; tu peux changer avec le menu des langues en haut de la page. Le panneau indique qu'il demande une session ; l'écran d'arrêt s'ouvre sans session et demande la clé d'arrêt. Continue avec « Première utilisation ».

15. FACULTATIF, NE FAIT PAS PARTIE DE L'INSTALLATION — ROTATION DE LA CLÉ MAÎTRESSE. Si ta clé maîtresse a fuité ou si tu veux la changer : mets de côté l'ancien fichier de sauvegarde, relance l'étape 6 pour générer une NOUVELLE clé, passe la nouvelle comme `ENCRYPTION_MASTER_KEY`, l'ancienne comme `ENCRYPTION_MASTER_KEY_PREVIOUS`, et augmente `ENCRYPTION_KEY_VERSION` de un. Par défaut c'est une SIMULATION : rien n'est écrit, seule la possibilité de déchiffrer est mesurée ; ajoute `-- --write` pour écrire réellement :

```sh
npm run rotate:encryption-key
```

Résultat : chaque ligne est déchiffrée avec l'ancienne clé et ré-enveloppée avec la nouvelle dans sa propre transaction, et sa version est augmentée ; la nouvelle enveloppe est vérifiée avec la nouvelle clé AVANT toute écriture. Quand plus aucune ligne ne reste sur l'ancienne version, `ENCRYPTION_MASTER_KEY_PREVIOUS` peut être supprimée. Aucune valeur de clé n'est jamais affichée.

<!-- readme:first-use -->
## Première utilisation

Le panneau et l'écran d'arrêt sont disponibles dans les sept langues de ce README — **English · Türkçe · Deutsch · Русский · Italiano · Français · العربية**<!-- ad:@langs --> (l'arabe de droite à gauche) ; choisis la langue dans le menu **Langue**<!-- ad:langSelect.label --> en haut du panneau, sur l'écran de connexion ou sur l'écran d'arrêt — sans choix, ils s'ouvrent dans la langue de ton navigateur, sinon en anglais. Les noms d'écrans et de boutons de ce README viennent du texte français du panneau lui-même ; avec le français choisi dans le menu, le panneau affiche les mêmes noms. Tout ce qui suit décrit exactement ce que le logiciel fait aujourd'hui ; rien ici n'est prévu ni promis. Le panneau a quatre onglets — **État · Réglages · Historique · Technique**<!-- ad:tabs.status,tabs.settings,tabs.history,tabs.technical --> — et s'ouvre sur **État**<!-- ad:tabs.status -->. Les noms des écrans et des boutons sont écrits ci-dessous tels qu'ils apparaissent.

**Réglages**<!-- ad:tabs.settings --> : chaque réglage du panneau — ce qu'il fait, sa valeur par défaut, s'il demande le code à usage unique, quand il prend effet — est décrit dans la page [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide) du wiki (en anglais) ; les écrans sont montrés dans le [Panel guide](https://github.com/akaytaran/winvestour-bot/wiki/Panel-guide).

### 1. Connexion (mot de passe du propriétaire, puis un code à usage unique par action sensible)

Ouvre `https://<ton-projet>.vercel.app/panel`. Sans session, le panneau affiche un seul champ **Mot de passe**<!-- ad:login.password --> et un bouton **Se connecter**<!-- ad:login.submit --> : saisis le mot de passe de `owner-credentials.txt` (étape d'installation 4) et appuie sur le bouton — la même page ouvre alors le panneau. Une session dure **8 heures**. Un mauvais mot de passe affiche "Mot de passe erroné, réessaie."<!-- ad:login.wrong -->. Après **5** tentatives erronées, la connexion et toute action sensible sont bloquées pendant **15 minutes** ("Trop de tentatives erronées : la connexion est bloquée. Réessaie dans 15 minutes au plus."<!-- ad:login.locked|minutes=15 -->) ; l'écran d'arrêt n'est jamais bloqué. **Se déconnecter**<!-- ad:panel.signOut --> est en haut du panneau. Les actions sensibles (ajouter une clé, démarrer le moteur, changer les entrées, augmenter un coût) demandent aussi le code à 6 chiffres actuel de ton application d'authentification, dans le champ "Code à usage unique (6 chiffres) — de ton application d'authentification"<!-- ad:common.codeLabel -->. Ajoute une fois la clé de configuration TOTP de `owner-credentials.txt` à ton application d'authentification.

### 2. Lire l'onglet **État**<!-- ad:tabs.status --> : état du moteur et "Avant de démarrer"<!-- ad:engine.beforeYouStart -->

La carte **ÉTAT DU MOTEUR**<!-- ad:engine.label --> en haut affiche l'un de quatre états, lu sur le serveur : **En marche**<!-- ad:engine.state.RUNNING.name --> · **Arrêté**<!-- ad:engine.state.STOPPED.name --> (arrêté par toi ou par une règle de protection) · **Pas en marche**<!-- ad:engine.state.NO_PERMIT.name --> (jamais démarré, ou son permis de fonctionnement a expiré) · **Inconnu**<!-- ad:engine.state.UNKNOWN.name --> (l'état n'a pas pu être lu ; **ARRÊTER**<!-- ad:engine.stop --> est proposé, **DÉMARRER**<!-- ad:engine.start --> non). En dessous, **Avant de démarrer**<!-- ad:engine.beforeYouStart --> liste ce dont le moteur a besoin : **Clé Binance · Intervalle de tick · Plafond de coût · Coût d'infrastructure · Part par position · Exposition totale**<!-- ad:prereq.names.key,prereq.names.tick,prereq.names.cap,prereq.names.infra,prereq.names.single,prereq.names.total --> — chacun ✓ (fait), ✗ (manquant) ou ? (illisible) — plus deux lignes d'information : **Interrupteur d'entrée**<!-- ad:prereq.names.entry --> et **Capital**<!-- ad:prereq.names.capital -->. Tant qu'une ligne est ✗ ou ?, le bouton **DÉMARRER**<!-- ad:engine.start --> est masqué et un lien "D'abord : …"<!-- ad:prereq.keyFix|pre --> mène au réglage. Les alertes (par exemple un ordre de protection manquant) apparaissent sous "À regarder d'abord"<!-- ad:status.alertsHeading --> ; "En un coup d'œil"<!-- ad:status.summaryHeading --> montre le dernier passage du moteur, les positions ouvertes et la commission payée sur la période.

### 3. Remplir l'onglet **Réglages**<!-- ad:tabs.settings -->

- **Clé API Binance**<!-- ad:key.heading --> : crée d'abord la clé. Génère la paire Ed25519 avec `npm run key:generate` (étape d'installation 7) ou avec le générateur de clés de Binance ; sur Binance ouvre Profile → API Management → Create API → **Self-generated**, colle la clé publique, donne un nom et termine la vérification à deux facteurs. Permissions : lecture **activée** (une clé sans lecture est refusée), trading spot **activé** pour que le moteur puisse passer des ordres, futures seulement si tu les utilises, retraits et transfert universel **désactivés**. Dans le panneau ouvre **Réglages → Clé API Binance → Ajouter une clé (demande le code à usage unique)**<!-- ad:tabs.settings>key.heading>key.add -->, remplis **Nom**<!-- ad:key.fieldName|head -->, **Clé API**<!-- ad:key.fieldApiKey|head -->, **Clé privée**<!-- ad:key.fieldPrivate|head --> (tout le contenu de `binance-private-key.pem` ; le champ reste masqué) et le code à usage unique, puis appuie sur **Vérifier et enregistrer la clé**<!-- ad:key.submit -->. L'application vérifie les permissions sur Binance avant d'enregistrer quoi que ce soit ; une clé avec retraits ou transfert universel activés est refusée ("Clé REFUSÉE : …"<!-- ad:key.withdrawals|pre -->) et n'est enregistrée nulle part. Une clé acceptée est enregistrée chiffrée avec ta clé maîtresse et n'est plus jamais affichée. Avec une nouvelle clé, le moteur utilise la plus récente ; supprime toi-même les anciennes clés sur Binance.
- **Intervalle de tick — fréquence de fonctionnement du moteur**<!-- ad:tick.heading --> : naît **vide** ; sans lui le moteur ne démarre pas. Ouvre **Modifier (moins fréquent ne demande pas de code ; plus fréquent demande un code)**<!-- ad:tick.change --> et choisis l'un des boutons : **toutes les 1, 2 ou 3 minutes**. Un changement prend effet **au plus tard dans les 20 minutes**, ou au prochain démarrage du moteur.
- **Plafond de coût mensuel**<!-- ad:cap.heading --> : naît **vide** ; tant qu'il est vide, le moteur de décision (Claude) **n'est pas** appelé du tout. Pour le faire fonctionner, ouvre **Modifier le plafond (…)**<!-- ad:cap.change|paren -->, coche **Plafond de coût total mensuel**<!-- ad:cap.fieldTotal --> et **Coût d'infrastructure mensuel (la somme de tes propres factures Neon, Vercel et Upstash)**<!-- ad:cap.fieldInfra -->, et saisis les deux en dollars par mois. Baisser ou vider ne demande pas de code ; augmenter demande le code à usage unique. **Moteur de décision — modèle · fréquence · candidats · bougies**<!-- ad:brain.heading --> affiche le modèle (`claude-opus-5` par défaut) et sa fréquence d'appel (toutes les 24 heures par défaut).
- **Parts de risque — position unique · exposition totale**<!-- ad:caps.heading --> : naissent **vides** sur une nouvelle installation, et rien n'est proposé — les nombres sont les tiens. Les deux sont un pourcentage de ton **solde USDT libre sur Binance** (les USDT de ton propre portefeuille spot qui ne sont pas déjà dans une position) : **Part par position**<!-- ad:prereq.names.single --> est le maximum qu'UNE nouvelle position peut utiliser ; **Exposition totale**<!-- ad:prereq.names.total --> est le maximum que TOUTES les positions ouvertes ensemble peuvent utiliser ; la part unique ne peut pas dépasser le total. Dans **Réglages → Parts de risque**<!-- ad:tabs.settings>caps.historyGroup -->, saisis toi-même chaque nombre dans **Part par position (pourcentage de ton solde USDT libre)**<!-- ad:caps.singleLabel --> et **Exposition totale (pourcentage de ton solde USDT libre)**<!-- ad:caps.totalLabel -->, saisis le code à usage unique et appuie sur **Enregistrer les parts de risque**<!-- ad:caps.apply --> — chaque enregistrement demande un nouveau code. Autorisé : un nombre supérieur à zéro avec au plus trois décimales ; un champ laissé vide garde sa valeur. Les valeurs enregistrées sont relues depuis le serveur ; les deux lignes de "Avant de démarrer"<!-- ad:engine.beforeYouStart --> affichent alors ✓. Un changement s'applique à partir de la prochaine décision d'entrée du moteur ; les positions déjà ouvertes gardent leur taille.
- **Interrupteur d'entrée**<!-- ad:entry.heading --> : naît **ACTIVÉ**<!-- ad:common.on --> — le moteur peut ouvrir de nouvelles positions de sa propre décision une fois tout le reste réglé. Appuie sur l'interrupteur pour le changer ; l'activer affiche "À lire avant de l'activer"<!-- ad:entry.readFirst --> avec l'avertissement du haut de cette page et une case à cocher, et les deux sens demandent le code à usage unique. Sur **DÉSACTIVÉ**<!-- ad:common.off -->, le moteur continue de tourner, les sorties et la protection continuent, mais aucune nouvelle position n'est ouverte et le moteur de décision n'est pas appelé.
- **Plafond de levier**<!-- ad:risk.fields.leverageCap --> et **Sens de vente à découvert**<!-- ad:risk.fields.shortMode --> : sur une nouvelle installation, le plafond de levier naît **vide** et le sens de vente à découvert est **Long uniquement**<!-- ad:risk.modes.NONE.label -->. Tant que le plafond de levier est vide, le chemin futures reste fermé : aucune opération à effet de levier n'est ouverte, et le logiciel ne choisit ni ne suggère jamais de nombre. Le bouton **i** à côté de chaque ligne explique le réglage. Pour les modifier, ouvre **Modifier ce réglage (demande le code à usage unique)**<!-- ad:risk.change --> ; chaque modification demande le code à usage unique. Cette version ne planifie pas encore d'elle-même d'opérations futures : le chemin des ordres futures est vérifié sur le testnet Binance Futures (un compte d'entraînement avec de l'argent de test, séparé de ton vrai compte). Utiliser un jour les futures avec de l'argent réel est ta propre décision.

### 4. Capital

Le moteur opère avec les **USDT libres de ton portefeuille spot Binance**, donc la clé doit avoir **Enable Spot & Margin Trading**. La taille d'une position est **Part par position**<!-- ad:prereq.names.single --> × le solde USDT libre. Binance refuse un ordre sous la valeur minimale d'ordre de la paire (son filtre NOTIONAL) ; le moteur lit ce minimum sur Binance avant chaque ordre — sur le compte du mainteneur il était de **5 USDT** pour la plupart des paires vérifiées et de 1 USDT pour certaines (mesuré le 2026-09-10). Si part × solde libre est inférieur, aucune position n'est ouverte ; le moteur continue de tourner et de protéger. Le panneau ne se connecte pas à Binance, il ne peut donc pas comparer ici le solde libre du jour avec ce minimum : sa ligne **Capital**<!-- ad:prereq.names.capital --> affiche la dernière valeur de compte mesurée. Le montant à déposer est ta décision.

### 5. Démarrer le moteur

Quand chaque ligne de "Avant de démarrer"<!-- ad:engine.beforeYouStart --> est ✓, l'onglet **État**<!-- ad:tabs.status --> affiche un bouton vert **DÉMARRER**<!-- ad:engine.start -->. Appuie dessus, saisis le code dans "Code à usage unique (6 chiffres) — le code de ton application d'authentification"<!-- ad:engine.codeLabel --> et appuie sur **Démarrer le moteur**<!-- ad:engine.startEngine -->. La carte affiche alors **En marche**<!-- ad:engine.state.RUNNING.name --> et "Démarrage accepté : le moteur peut tourner jusqu'au …"<!-- ad:engine.started|upto:until --> — l'état est relu sur le serveur, pas deviné. Si aucun intervalle de tick n'est choisi, la réponse est "Le moteur n'a pas démarré : aucun intervalle de tick n'est choisi."<!-- ad:engine.notStartedTick|s1 --> et rien ne change. Un ordre prudent : mets d'abord l'**Interrupteur d'entrée**<!-- ad:entry.heading --> sur **DÉSACTIVÉ**<!-- ad:common.off -->, démarre le moteur et observe **En marche**<!-- ad:engine.state.RUNNING.name --> pendant une journée, puis décide d'activer ou non les entrées.

### 6. Arrêter le moteur

Pendant que le moteur tourne, la carte affiche un bouton rouge **ARRÊTER**<!-- ad:engine.stop --> : choisis **Arrêter seulement**<!-- ad:stop.modes.HOLD.title --> (aucune nouvelle position ; les positions ouvertes et leurs ordres de protection sur la plateforme restent tels quels) ou **Arrêter et demander la fermeture**<!-- ad:stop.modes.CLOSE_ALL.title --> (la demande de fermeture est enregistrée ; aujourd'hui le logiciel ne ferme pas lui-même les positions), saisis la **clé d'arrêt** de `stop-key.txt` (étape d'installation 5 — pas le code à usage unique) et appuie sur **Arrêter le moteur**<!-- ad:stop.sendPanel -->. Si le panneau ne s'ouvre pas, l'**écran d'arrêt** à `/durdur` ("Winvestour · arrêter le moteur"<!-- ad:stop.title -->) fait la même chose sans session ni code : choisis sous **Que doit-il se passer ?**<!-- ad:stop.legend -->, saisis la clé dans **Clé d'arrêt**<!-- ad:stop.keyLabel --> et appuie sur **Arrêter**<!-- ad:stop.send -->. La clé n'est jamais enregistrée dans le navigateur.

### 7. **Historique**<!-- ad:tabs.history --> et **Technique**<!-- ad:tabs.technical -->

**Historique**<!-- ad:tabs.history --> liste les positions récentes (entrée, taille, commission, brut et net) et chaque changement de réglage (qui, quand, ancien → nouveau). **Technique**<!-- ad:tabs.technical --> conserve tout le détail mesuré que le panneau lit — cartes du moteur, du passage et de la santé, lignes de positions et provenance de chaque chiffre ; ces phrases du serveur suivent aussi la langue du panneau.

### 8. Ce que cette version n'a pas

Les notifications push sont désactivées par défaut : elles demandent ton propre projet Firebase — voir la section « Facultatif : ajoute ton propre Firebase pour les notifications push » plus bas. Le verrou biométrique existe (**Réglages → Verrou biométrique**<!-- ad:tabs.settings>lock.heading -->, désactivé par défaut) et demande une vérification d'empreinte ou de visage sur l'appareil que tu utilises. Il n'y a pas d'application Android ; le panneau est une page web que tu peux ajouter à l'écran d'accueil de ton téléphone. Faire tourner le bot sur ton propre ordinateur n'est pas pris en charge (le moteur est déclenché par Vercel Cron).

<!-- readme:cost -->
## Coût mensuel de fonctionnement

Chaque nombre ici vient des propres mesures de ce logiciel sur le déploiement du mainteneur ; aucun n'est une estimation. Avec le moteur tournant en continu en mode économique, une position ouverte et le Cerveau appelé une fois par jour, le total mesuré est **≈ 9,60 – 9,90 $ par mois** (Neon ≈ 5,30 $ · Vercel ≈ 1,50 $ borne supérieure · Upstash 0 $ dans le quota gratuit · Anthropic ≈ 2,84 $). Moteur arrêté, ou sur une installation neuve avec les réglages par défaut, c'est **≈ 0,24 – 0,60 $ par mois**. L'abonnement Vercel **Pro** lui-même (**20 $ / mois**, prix lu le 2026-06-16) s'y ajoute et est le plus gros poste. Les commissions de trading et le spread ne sont pas dans ces nombres : ce sont les coûts d'une opération, pas du fonctionnement du logiciel.

<details>
<summary>Détail complet, hypothèses et dates de lecture de chaque prix</summary>

**Ces nombres valent sous un jeu d'hypothèses :** le moteur tourne en continu en mode économique (un tick par minute = 43 200 ticks/mois), **une position est ouverte** à la fois, le Cerveau (Claude) est appelé **une fois par jour** (réglage par défaut : `claude-opus-5`, 24 heures), le calcul de la base de données est de **0,25 CU**, et tous les services sont sur des plans payants.

| Poste | Ce qu'il paie | Par mois | En clair : ce qui a été mesuré |
|---|---|---|---|
| **Neon** (Postgres) | ordres, positions, registre des commissions, journal des événements | **≈ 5,30 $** | La base n'est pas éveillée en permanence : un contact la maintient active ≈ 330 secondes, et le moteur ne la touche que toutes les 20 minutes. Temps d'éveil mesuré **≈ 27,5 % du mois** ⇒ 0,25 CU × 720 h × 27,5 % × 0,106 $/CU-h. Laissé à 1 CU, le même poste devient **≈ 21 $**. |
| **Vercel** (hébergement) | la fonction serverless dans laquelle tourne chaque tick | **≈ 1,50 $ borne supérieure** | 43 200 invocations par mois ; chacune mesurée à **≈ 1 seconde** (le chiffre est calculé sur une borne supérieure de 3 secondes) × 2 Go de mémoire. Il n'y a pas d'option plus petite : la plus petite taille du fournisseur est 2 Go. |
| **Upstash** (Redis) | permis d'exécution, verrou d'exécution, enregistrement du tick, copie de position | **0 $** | **5 commandes par tick** (+2 par position ouverte) ⇒ **≈ 302 000 commandes/mois** ; le quota gratuit est de **500 000/mois**. Avec 4 positions simultanées ou plus, le quota est dépassé : **≈ 0,10–0,30 $**. |
| **Anthropic** (Claude, le « Cerveau ») | la génération quotidienne des règles | **≈ 2,84 $** | **30 appels** par mois × **0,094750 $** par appel. Les jetons par appel ont été lus **sur un appel réel** : **7 794 en entrée + 1 250 en sortie**. Appeler plus souvent croît linéairement : toutes les 12 h ≈ 5,69 $, toutes les 6 h ≈ 11,37 $. |
| **Binance** | données de marché + passage d'ordres | **0 $** | Le poids API est gratuit. **La commission de trading n'est pas dans ce tableau** — c'est le coût d'une opération, pas du fonctionnement du logiciel, et le logiciel la mesure séparément à chaque opération. |
| **TOTAL** | | **≈ 9,60 – 9,90 $ / mois** | La somme des lignes. Bas de fourchette : Upstash dans le quota gratuit. Haut de fourchette : quota dépassé. |

**Moteur arrêté / sur une INSTALLATION NEUVE (réglages par défaut) : ≈ 0,24 – 0,60 $ / mois.** Sur une installation neuve, le moteur ne peut pas être démarré (l'intervalle de tick naît vide et la requête de démarrage est refusée) et le plafond de coût naît vide (le Cerveau n'est jamais appelé). Dans cet état, le logiciel produit (compté d'après le code, 2026-09-24) : une invocation serveur par minute (**1 440/jour · 43 200/mois**), **1 commande Upstash** par invocation (elle vérifie si le moteur peut tourner), **0 requête base de données** (Neon n'est jamais réveillé), **0 appel Claude**. La facture : invocations Vercel 43 200 × 0,60 $/M = 0,03 $ + mémoire 2 Go × 0,53–1,43 s mesurées × 43 200 ÷ 3600 = 12,7–34,3 Go-h × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $** ; le temps CPU actif **n'a pas été mesuré** (aucun nombre n'est écrit ici pour lui). Chaque ouverture du panneau ajoute, mesuré, 5 requêtes base, 1 réveil de la base et 2 commandes Upstash ; la fréquence d'ouverture dépend de toi.

**Quand chaque prix a été lu (les prix changent — vérifie-les toi-même) :**
- Neon `neon.com/pricing` — **2026-09-11** (Launch 0,106 $/CU-h), relu le **2026-09-24** (inchangé ; plan Free 100 CU-heures/mois/projet)
- Vercel `vercel.com/docs/functions/usage-and-pricing` — **2026-06-16** (mémoire 0,0167 $/Go-h, CPU 0,202 $/h, invocations 0,60 $/M), relu le **2026-09-24** (inchangé) ; `vercel.com/docs/cron-jobs/usage-and-pricing` — « Last updated July 15, 2026 », Hobby « once per day »
- Upstash `upstash.com/pricing/redis` — **2026-09-11** (gratuit 500 000 commandes/mois, puis 0,20 $/100K), relu le **2026-09-24** (inchangé)
- Anthropic `platform.claude.com/docs/en/about-claude/pricing` — **2026-09-11** (`claude-opus-5` 5 $ / 25 $ par MTok)

**Télémétrie de build (Next.js) :** ce logiciel n'envoie rien au mainteneur. Le framework Next.js qu'il utilise peut envoyer des données d'usage anonymes à Next.js/Vercel pendant `npm run build` ; ces données n'atteignent pas le propriétaire de ce dépôt. Pour la désactiver, ajoute `NEXT_TELEMETRY_DISABLED=1` à ton environnement de build (source : la documentation Next.js, https://nextjs.org/telemetry).
</details>

<details>
<summary>Tient-il dans les offres gratuites ? (d'après la seule documentation de chaque fournisseur, lue le 2026-09-24 ; aucun compte ouvert, rien essayé)</summary>

| fournisseur | offre gratuite (d'après la documentation) | installation neuve (moteur non démarré) | moteur en marche (hypothèses ci-dessus) |
|---|---|---|---|
| **Vercel Hobby** | 1 million d'invocations, 360 Go-h de mémoire, 4 h de CPU actif inclus par mois ; **cron au plus une fois par jour** | invocations et mémoire dans les limites ; **mais la tâche planifiée tourne chaque minute, donc le déploiement ÉCHOUE sur Hobby** (documentation : « Cron expressions that would run more frequently will fail during deployment ») ⇒ **NE TIENT PAS** | **NE TIENT PAS**, même raison |
| **Neon Free** | **100 CU-heures** par projet et par mois, 0,5 Go de stockage, mise à zéro après 5 minutes d'inactivité, jusqu'à 2 CU | la base n'est jamais touchée : **0 CU-heure ⇒ TIENT** | 0,25 CU × 720 h × 27,5 % d'éveil mesuré = **≈ 49,5 CU-heures ≤ 100 ⇒ TIENT** (déduit ; non mesuré sur le plan gratuit). Si cela tient, le poste Neon ci-dessus devient 0 $ au lieu de 5,30 $. |
| **Upstash Free** | **500 000 commandes** par mois, 256 Mo, 10 Go de bande passante | 43 200 commandes (8,6 %) ⇒ **TIENT** | ≈ 302 000 commandes (1 position ouverte) ⇒ **TIENT** ; 4 positions ou plus ne tiennent pas |
| **Anthropic** | pas d'offre gratuite | 0 appel ⇒ 0 $ | le poste Anthropic ci-dessus |
</details>

<!-- readme:update -->
## Mise à jour

Chacune des 4 étapes ci-dessous est exécutée avant chaque publication sur une copie installée depuis la version 1.0.0 avec des données dans sa base — par la vérification automatique de mise à jour. Une étape qui n'est pas exécutée ainsi n'est pas écrite ici.

1. Récupère la nouvelle version dans le dossier depuis lequel tu as installé. Si tu as cloné ce dépôt avec git, exécute ceci dans ce dossier ; si tu as téléchargé le ZIP, télécharge plutôt le nouveau ZIP, décompresse-le dans un nouveau dossier, copies-y ton fichier `.env` (si tu en as créé un) et continue là. Tes valeurs ne sont pas dans le code : git ignore le fichier `.env`, le dossier de sauvegarde est hors du dépôt, et les valeurs saisies dans Vercel restent dans Vercel :

```sh
git pull
```

Résultat attendu : la commande se termine sans conflit et liste les fichiers modifiés ; le champ `version` de `package.json` est le numéro de la nouvelle version ; ton fichier `.env` est toujours là.

2. Installe les dépendances de la nouvelle version :

```sh
npm ci
```

Résultat attendu : la commande se termine sans erreur.

3. Applique les modifications de base de données de la nouvelle version, depuis ton ordinateur avec `DIRECT_URL` défini comme à l'étape d'installation 10. Seules les modifications que ta base n'a pas encore sont appliquées, dans l'ordre ; les tables ne sont pas recréées et les lignes existantes sont conservées :

```sh
npx prisma migrate deploy
```

Résultat attendu : la sortie se termine par `All migrations have been successfully applied.` si la nouvelle version apporte des modifications de base de données, ou indique `No pending migrations to apply.` si elle n'en apporte aucune. Tes parts de risque, tes réglages et ton historique sont inchangés ; la mise à jour ne démarre pas le moteur et n'active rien. Si la commande échoue, voir la page Troubleshooting du wiki.

4. Déploie la nouvelle version : pousse le dossier mis à jour sur ton propre dépôt GitHub comme à l'étape d'installation 13 ; Vercel le compile automatiquement. Son script `vercel-build` refuse d'abord toute migration qui supprimerait des données, puis relance la même commande de migration (sans danger : rien n'est en attente) et compile. Les variables d'environnement saisies dans Vercel restent telles quelles.

Résultat attendu : le déploiement atteint **Ready**, et `https://<ton-projet>.vercel.app/api/health` renvoie `{"ok":true,...}`. Le panneau montre le même état du moteur qu'avant la mise à jour : un moteur arrêté reste arrêté. Si la nouvelle version demande une variable que ton déploiement n'a pas, le serveur ne démarre pas et l'erreur nomme la variable manquante.

<!-- readme:firebase -->
## Facultatif : ajoute ton propre Firebase pour les notifications push

Les notifications push sont facultatives et **désactivées par défaut**. Cette copie ne contient aucun projet Firebase, aucune clé Firebase et aucune valeur Firebase : les trois variables ci-dessous naissent vides, et tant qu'elles sont vides le logiciel fonctionne normalement — le panneau indique **Les notifications sont désactivées : Firebase n'a pas été ajouté**, et chaque arrêt ou alarme est toujours écrit dans l'onglet Historique. Pour les activer avec ton propre projet Firebase, suis les 4 étapes ci-dessous ; chacune est exécutée avant chaque publication par une vérification automatique qui utilise un substitut, généré localement, du fichier de compte de service Firebase et un substitut local de Firebase (aucun vrai compte Firebase n'est utilisé). Pour désactiver à nouveau les notifications, supprime les trois variables et redéploie. Ce logiciel ne mesure pas le coût propre de Firebase ; consulte la page de tarifs de Firebase.

1. Dans la console Firebase, crée un projet à toi (ou ouvre un projet existant), va dans **Project settings → Service accounts** et appuie sur **Generate new private key**. Un fichier JSON est téléchargé. Garde-le hors du dossier du dépôt et ne le commite jamais : c'est un secret, comme ta clé Binance.

Résultat attendu : un fichier `.json` dont les champs comprennent `project_id`, `client_email` et `private_key`.

2. Dans Vercel, ouvre ton projet → **Settings → Environment Variables** et ajoute trois variables, chacune copiée depuis le champ de ce fichier JSON : `FIREBASE_PROJECT_ID` ← `project_id` · `FIREBASE_CLIENT_EMAIL` ← `client_email` · `FIREBASE_PRIVATE_KEY` ← `private_key`. Pour `private_key`, copie toute la valeur, y compris la première et la dernière ligne ; les séquences `\n` peuvent rester telles quelles. Renseigne les trois ou aucune : avec seulement certaines, les notifications restent désactivées et le panneau nomme la variable manquante ou mal formée (jamais sa valeur).

Résultat attendu : les trois noms sont dans la liste ; leurs valeurs n'apparaissent nulle part dans le panneau ni dans les journaux.

3. Redéploie le projet pour que les nouvelles variables soient lues (Vercel → **Deployments** → le dernier déploiement → **Redeploy**).

Résultat attendu : dans le panneau, **Réglages → Notifications** indique que les notifications sont activées.

4. Une notification n'atteint qu'un appareil qui a enregistré son jeton Firebase Cloud Messaging auprès de ton installation : `POST /api/device` avec ta session du panneau et le corps `{"token": "<jeton de l'appareil>", "platform": "web"}` (ou `"android"`). Cette copie n'a aucune application qui le fait pour toi — il n'y a pas d'application Android —, cette étape s'adresse donc à un développeur qui construit son propre client avec Firebase. Sans appareil enregistré, rien n'est envoyé, et l'enregistrement de l'arrêt ou de l'alarme l'indique.

Résultat attendu : le point d'accès répond `{"ok":true,"devices":1,...}` ; le prochain arrêt ou la prochaine alarme est livré à cet appareil, et son enregistrement indique qu'il a été envoyé.

<!-- readme:faq -->
## FAQ / dépannage

### Le déploiement Vercel échoue avec un message sur les expressions cron

Tu es sur le plan Hobby. La documentation de Vercel dit qu'une expression cron exécutée plus d'une fois par jour *échoue pendant le déploiement* ; le planning de ce logiciel est toutes les minutes et ne peut pas être changé depuis le panneau. Déplace le projet dans une équipe Pro, ou ne l'exécute pas sur Vercel Hobby.

### Le serveur ne démarre pas et affiche « ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor »

Une variable d'environnement manque ou est mal formée (ce message du serveur est encore en turc). Les lignes sous ce message nomment chaque variable et la raison du refus (par exemple une clé maîtresse qui ne fait pas 44 caractères base64) — jamais sa valeur. Compare tes noms avec `.env.example` et le tableau sous « Ce qu'il te faut ».

### `/api/health` répond `{"ok":true,...}` mais le panneau demande un mot de passe, et les points d'accès des réglages répondent 401 avec `{"ok":false,"reason":"NO_SESSION"}`

C'est l'état attendu sans session. Saisis le mot de passe du propriétaire dans le champ **Mot de passe**<!-- ad:login.password --> du panneau et appuie sur **Se connecter**<!-- ad:login.submit --> (voir « Première utilisation ») ; la même page ouvre alors le panneau, sans rechargement.

### **DÉMARRER**<!-- ad:engine.start --> n'apparaît pas, ou le moteur indique "Le moteur n'a pas démarré : aucun intervalle de tick n'est choisi."<!-- ad:engine.notStartedTick|s1 -->

**DÉMARRER**<!-- ad:engine.start --> n'apparaît que lorsque chaque ligne de "Avant de démarrer"<!-- ad:engine.beforeYouStart --> est ✓. Suis les liens "D'abord : …"<!-- ad:prereq.keyFix|pre -->. Si l'intervalle de tick est vide (il naît vide), choisis-en un dans **Réglages → Intervalle de tick**<!-- ad:tabs.settings>prereq.names.tick --> et redémarre. Sur une nouvelle installation, les deux parts de risque naissent vides : saisis-les dans **Réglages → Parts de risque**<!-- ad:tabs.settings>caps.historyGroup --> (voir « Première utilisation », étape 3).

### Ma clé Binance est refusée avec **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** ou **KEY_TYPE_NOT_ED25519**

Crée sur Binance une nouvelle clé API de type **Ed25519** avec retraits et transfert universel **désactivés**, et ajoute celle-ci dans le panneau. Dans le panneau le refus s'affiche "Clé REFUSÉE : …"<!-- ad:key.withdrawals|pre --> et nomme la permission à désactiver. Une clé refusée n'est ni enregistrée ni journalisée.

### Dois-je restreindre ma clé API Binance à une adresse IP ?

Pas avec une adresse fixe sur une installation Vercel normale : les fonctions Vercel utilisent par défaut des adresses IP sortantes dynamiques, et les adresses sortantes fixes sont la fonction payante Static IPs de Vercel (100 $ par mois et par projet, documentation Vercel lue le 2026-09-26). Sans restriction IP, la règle de Binance s'applique (annonce Binance du 2021-07-26) : la permission **Enable Spot & Margin Trading** de la clé est valable **90 jours** à partir de l'activation, puis désactivée automatiquement — réactive-la sur Binance, sinon le moteur ne peut pas passer d'ordres. Binance a aussi indiqué que les clés sans restriction IP inutilisées pendant 30 jours sont supprimées ; le panneau affiche un compteur de 30 jours sous **Réglages → Clé API Binance → Détails techniques**<!-- ad:tabs.settings>key.heading>common.technicalDetails -->.

### J'ai perdu le mot de passe, l'authentificateur (TOTP) ou une clé

- **Mot de passe ou TOTP :** mets de côté l'ancien `owner-credentials.txt`, relance `npm run owner:credentials`, remplace `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET` et `SESSION_SECRET` dans Vercel par les trois lignes du nouveau `vercel-env-owner.txt`, et redéploie. Toutes les sessions ouvertes se terminent ; ajoute la nouvelle clé de configuration TOTP à ton application d'authentification.
- **Clé d'arrêt :** mets de côté `stop-key.txt`, lance `npm run stop:credential`, mets la nouvelle empreinte dans `STOP_KEY_HASH`, et redéploie.
- **Clé maîtresse perdue** (`ENCRYPTION_MASTER_KEY`) : la clé Binance enregistrée ne peut plus être déchiffrée ni récupérée. Supprime cette clé API sur Binance, mets de côté `encryption-master-key.txt`, lance `npm run key:encryption-master`, mets la nouvelle valeur dans `ENCRYPTION_MASTER_KEY`, redéploie, et ajoute une nouvelle clé Binance dans le panneau. Si tu as encore l'ancienne clé maîtresse et veux seulement la changer, utilise plutôt la rotation (étape d'installation 15).
- **Clé privée Binance perdue :** supprime cette clé API sur Binance, mets de côté les anciens fichiers `.pem`, lance `npm run key:generate`, crée une nouvelle clé API avec la nouvelle clé publique et ajoute-la dans le panneau.

### Comment désinstaller et arrêter de payer ?

Arrête d'abord le moteur (**ARRÊTER**<!-- ad:engine.stop --> dans l'onglet **État**<!-- ad:tabs.status -->, ou `/durdur`). Ensuite :
- supprime la clé API sur Binance (Profile → API Management) — cela seul met fin à tout accès au trading ;
- supprime le projet Vercel (Project → Settings → Delete Project) — cela retire la tâche planifiée qui tourne chaque minute ; si ce projet était ta seule raison d'avoir Vercel Pro, change ou résilie le plan dans les réglages de facturation de Vercel ;
- supprime le projet Neon et la base de données Upstash dans leurs propres consoles ;
- révoque la clé API Anthropic.

Les fichiers de `winvestour-backup` n'appartiennent qu'à cette installation ; supprime-les quand tu n'en as plus besoin.

### Binance répond 451 « Service unavailable from a restricted location »

Binance bloque les requêtes depuis les États-Unis. `vercel.json` fixe donc les fonctions dans la région `hnd1` (Tokyo) ; si tu changes la région pour une région américaine, chaque appel à Binance échoue avec 451 et le moteur signale la région comme bloquée.

### Ce logiciel envoie-t-il quelque chose à son mainteneur ?

Non. Il appelle seulement Binance (avec ta clé), tes propres Neon et Upstash, et Anthropic (avec ta clé). Le seul trafic tiers qu'il ne contrôle pas est la télémétrie de build de Next.js décrite dans la section des coûts, que tu peux désactiver avec `NEXT_TELEMETRY_DISABLED=1`. Seulement si tu ajoutes l'extension facultative Firebase, il appelle aussi les points d'accès de connexion de Google (OAuth) et de Firebase Cloud Messaging, avec ton propre compte de service.

### `npx prisma migrate deploy` échoue pendant une mise à jour

Si la sortie indique `Error: Connection url is empty.`, `DIRECT_URL` n'est pas définie dans ce terminal : mets la chaîne de connexion Neon directe (sans pool) dans le fichier `.env` à côté de `package.json` (comme à l'étape d'installation 10), ou définis-la dans le terminal, puis relance la commande — rien n'a été modifié dans la base de données. Pour tout autre message : ne modifie ni ne supprime les fichiers de `prisma/migrations` et ne change pas les tables à la main ; lance `npx prisma migrate status` pour voir quelle modification est encore en attente, et pose ta question dans GitHub **Discussions → Q&A** (ne colle jamais la chaîne de connexion).

---

Les contributions de code et les pull requests ne sont pas acceptées ; les rapports de bug, les questions d'installation et les signalements de sécurité privés sont ouverts — voir [CONTRIBUTING.md](CONTRIBUTING.md) et `SECURITY.md`. Licence : MIT (voir `LICENSE`) ; tu peux forker et modifier ta propre copie.
