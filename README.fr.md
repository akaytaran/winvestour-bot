# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

En cas de contradiction, le texte anglais fait foi.

<!-- readme:intro -->
## Ce que c'est

`winvestour-bot` est un petit moteur de trading que tu fais tourner **sur tes propres comptes** : il lit le marché spot de Binance avec **ta** clé API, décide selon des règles qu'un modèle Claude écrit une fois par jour, et peut passer de vrais ordres sur ton compte. Chaque installation est sa propre copie — la base de données, la clé Binance et la clé API Claude restent dans ton propre hébergement, et rien dans cette copie ne rappelle le mainteneur. Il s'adresse à une personne qui veut faire tourner un tel moteur pour elle-même, lire d'abord le code et commencer avec un petit montant.

**Sommaire :** [Ce qu'il te faut](#ce-quil-te-faut) · [Installation](#installation) · [Première utilisation](#première-utilisation) · [Coût mensuel de fonctionnement](#coût-mensuel-de-fonctionnement) · [FAQ / dépannage](#faq--dépannage) · [Contribuer](CONTRIBUTING.md)

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

Cette copie ne porte rien du mainteneur : le code ne lit aucun nom de domaine, il n'y a aucun nom de paquet Android ni empreinte de signature dans le contrat d'environnement, et il n'y a aucune configuration ni variable Firebase/FCM. Tout ce qui suit naît vide, et tu le remplis avec tes propres valeurs.

| Variable d'environnement | D'où vient la valeur |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → ton projet → chaînes de connexion (avec pool · directe) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → ta base → REST API. Si tu ajoutes Upstash via le Vercel Marketplace, il définit à la place les noms `KV_REST_API_URL` et `KV_REST_API_TOKEN` ; l'application les lit aussi. |
| `ANTHROPIC_API_KEY` | Anthropic → clés API (commence par `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | le fichier écrit par l'étape d'installation 4 |
| `STOP_KEY_HASH` | le fichier écrit par l'étape d'installation 5 |
| `ENCRYPTION_MASTER_KEY` | le fichier écrit par l'étape d'installation 6 |
| `ENCRYPTION_KEY_VERSION` | `1` sur une installation neuve (augmenté seulement lors d'une rotation de la clé maîtresse, étape 14) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | laisser vide ; utilisé seulement pendant une rotation de la clé maîtresse |
| `ENGINE_MODE` | `CHEAP` (un tick par minute depuis la tâche planifiée ; le seul mode que ce README décrit) |

La clé API Binance n'est **pas** une variable d'environnement : elle est transmise via l'application après l'installation et stockée dans ta base de données, chiffrée avec ta clé maîtresse (voir « Première utilisation »).

<!-- readme:install -->
## Installation

Chacune des 14 étapes ci-dessous est exécutée avant chaque publication dans une copie propre de ce dépôt — les étapes 1–13 par la vérification automatique d'installation, l'étape 14 par la vérification de rotation de clé. Une étape qui n'est pas exécutée ainsi n'est pas écrite ici.

1. Ouvre les comptes nécessaires (environ 30 minutes au total) : un compte **Neon** (base de données PostgreSQL), un compte **Upstash** (Redis), un compte **Vercel** avec le **plan Pro** (l'application exécute une tâche planifiée chaque minute ; avec le plan gratuit Hobby le déploiement échoue — voir « Ce qu'il te faut »), une clé API **Anthropic** et une clé API **Binance** créée **sans autorisation de retrait**.

Résultat attendu : tu peux te connecter aux quatre services, et les permissions de ta clé API Binance n'incluent pas les retraits.

2. Récupère le code sur ton ordinateur : sur la page de ce dépôt, choisis **Code → Download ZIP** (ou clone-le avec ton propre client git), décompresse-le et ouvre un terminal dans ce dossier.

Résultat attendu : le dossier contient `package.json` et `.env.example`.

3. Installe les dépendances à partir du fichier de verrouillage de la copie :

```sh
npm ci
```

Résultat attendu : la commande se termine sans erreur et un dossier `node_modules` apparaît.

4. Génère le mot de passe du propriétaire, le secret TOTP et le secret de session. Les valeurs ne sont pas affichées ; elles sont écrites dans un dossier hors du dépôt (par défaut `winvestour-yedek` dans ton dossier personnel, `-- --dir <dossier>` pour un autre emplacement) :

```sh
npm run owner:credentials
```

Résultat attendu : le dossier contient maintenant `sahip-kimlik.txt`, `vercel-env-g04.json` ; le premier fichier contient ton mot de passe et la clé de configuration TOTP pour ton application d'authentification, le second les trois valeurs pour l'étape 8. Rien n'est affiché à l'écran.

5. Génère la clé d'arrêt (écrite dans le même dossier, non affichée) :

```sh
npm run stop:credential
```

Résultat attendu : `durdurma-anahtari.txt`, `vercel-env-STOP_KEY_HASH.txt` apparaissent dans le dossier ; le premier contient la clé d'arrêt brute que tu saisiras sur l'écran d'arrêt, le second son empreinte pour l'étape 8.

6. Génère la clé maîtresse qui chiffre tes clés d'échange (écrite dans le même dossier, non affichée). Si cette clé est perdue, les lignes chiffrées ne pourront plus jamais être ouvertes ; garde une seconde copie dans ton gestionnaire de mots de passe :

```sh
npm run key:encryption-master
```

Résultat attendu : `sifreleme-ana-anahtari.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt` apparaissent dans le dossier.

7. Crée une base de données PostgreSQL vide : dans Neon, crée un projet et copie ses deux chaînes de connexion — celle avec pool devient `DATABASE_URL`, la directe (sans pool) devient `DIRECT_URL`.

Résultat attendu : deux chaînes commençant par `postgresql://` ; la base de données n'a pas encore de tables.

8. Donne une valeur à chaque nom de `.env.example`. La provenance de chaque valeur est dans le tableau sous « Ce qu'il te faut » ; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` viennent des fichiers des étapes 4–6. Pour le déploiement, saisis-les dans Vercel sous **Settings → Environment Variables** ; pour une exécution locale, mets les mêmes noms dans un fichier `.env` à côté de `package.json` (git ignore ce fichier). Les valeurs n'entrent jamais dans le dépôt.

Résultat attendu : chaque nom de `.env.example` a une valeur. S'il manque un nom obligatoire, l'application s'arrête au démarrage et nomme la variable manquante.

9. Crée les tables de la base de données. Exécute ceci une fois depuis ton ordinateur avec `DIRECT_URL` défini (dans `.env` ou dans le terminal) ; Vercel répète la même commande à chaque déploiement, ce qui est sans danger :

```sh
npx prisma migrate deploy
```

Résultat attendu : la sortie se termine par `All migrations have been successfully applied.` Une seule migration nommée `0_baslangic` est appliquée ; chaque table de réglages démarre avec une ligne ; les réglages de risque sont vides et désactivés.

10. Vérifie que le code se compile sur ton ordinateur (recommandé avant le déploiement) :

```sh
npm run build
```

Résultat attendu : la commande se termine par la liste des routes et sans erreur ; un dossier `.next` apparaît.

11. Lance-la en local. Une fois l'application démarrée, ouvre `http://localhost:3000/api/health` dans ton navigateur :

```sh
npm start
```

Résultat attendu : la page affiche `{"ok":true,"service":"engine",...}`, et `http://localhost:3000/panel` s'ouvre en indiquant que le panneau demande une session. Le contrat d'environnement est validé au démarrage : s'il manque un nom obligatoire ou s'il est mal formé, le serveur ne démarre pas, et l'erreur nomme la variable manquante, jamais sa valeur. Arrête le serveur avec Ctrl+C.

12. Déploie sur Vercel : pousse ta copie sur ton propre compte GitHub, puis dans Vercel choisis **Add New → Project → Import** pour ce dépôt, garde le préréglage de framework **Next.js**, ajoute les variables d'environnement de l'étape 8 et appuie sur **Deploy**. Vercel exécute le script `vercel-build` : il refuse d'abord toute migration qui supprimerait des données, puis crée les tables et compile.

Résultat attendu : le déploiement atteint **Ready**, et `https://<ton-projet>.vercel.app/api/health` renvoie `{"ok":true,...}`. Avec le plan Hobby, le déploiement échoue à la place, avec un message indiquant que les expressions cron s'exécutant plus d'une fois par jour ne sont pas autorisées.

13. Ouvre le panneau à `/panel` sur ton adresse, et l'écran d'arrêt à `/durdur`.

Résultat attendu : les deux pages s'ouvrent (aujourd'hui l'interface est en turc). Le panneau indique qu'il demande une session ; l'écran d'arrêt s'ouvre sans session et demande la clé d'arrêt. Continue avec « Première utilisation ».

14. FACULTATIF, NE FAIT PAS PARTIE DE L'INSTALLATION — ROTATION DE LA CLÉ MAÎTRESSE. Si ta clé maîtresse a fuité ou si tu veux la changer : mets de côté l'ancien fichier de sauvegarde, relance l'étape 6 pour générer une NOUVELLE clé, passe la nouvelle comme `ENCRYPTION_MASTER_KEY`, l'ancienne comme `ENCRYPTION_MASTER_KEY_PREVIOUS`, et augmente `ENCRYPTION_KEY_VERSION` de un. Par défaut c'est une SIMULATION : rien n'est écrit, seule la possibilité de déchiffrer est mesurée ; ajoute `-- --write` pour écrire réellement :

```sh
npm run rotate:encryption-key
```

Résultat : chaque ligne est déchiffrée avec l'ancienne clé et ré-enveloppée avec la nouvelle dans sa propre transaction, et sa version est augmentée ; la nouvelle enveloppe est vérifiée avec la nouvelle clé AVANT toute écriture. Quand plus aucune ligne ne reste sur l'ancienne version, `ENCRYPTION_MASTER_KEY_PREVIOUS` peut être supprimée. Aucune valeur de clé n'est jamais affichée.

<!-- readme:first-use -->
## Première utilisation

Aujourd'hui l'interface est uniquement en **turc**. Tu te connectes sur la page du panneau avec le mot de passe du propriétaire ; ajouter la clé Binance et démarrer le moteur se font toujours avec une requête HTTP chacun (depuis la console de développement de ton navigateur ou n'importe quel client HTTP) pendant que tu es connecté. Chaque étape ci-dessous décrit exactement ce que le logiciel fait aujourd'hui ; rien ici n'est planifié ni promis.

### 1. Se connecter (mot de passe du propriétaire, puis un code à usage unique par action sensible)

Ouvre `https://<ton-projet>.vercel.app/panel` dans ton navigateur. Sans session, le panneau affiche un seul champ **Parola** (mot de passe) et un bouton **Giriş yap** (se connecter) : saisis le mot de passe du fichier de l'étape 4 et appuie sur le bouton — la même page ouvre alors le panneau. La session dure **8 heures**. Un mauvais mot de passe affiche « Parola yanlış, yeniden dene. » (mot de passe incorrect, réessaie). Après **5** tentatives erronées, la connexion et toutes les actions sensibles sont verrouillées pendant **15 minutes** et le panneau affiche « Çok fazla yanlış deneme yapıldı; giriş kilitlendi, en geç 15 dakika sonra yeniden dene. » (trop de tentatives erronées, réessaie dans 15 minutes au plus) — pendant le verrouillage même le bon mot de passe est refusé ; l'écran d'arrêt n'est jamais verrouillé. Pour fermer la session, appuie sur **Çıkış yap** (se déconnecter) en haut du panneau. Les actions sensibles (ajouter une clé, démarrer le moteur, ouvrir l'interrupteur d'entrée, relever un plafond de coût) exigent en plus le **code à 6 chiffres** courant de ton application d'authentification, envoyé dans l'en-tête de requête `x-totp-code` — les formulaires du panneau le demandent dans un champ intitulé « Tek kullanımlık kod » (code à usage unique). Ajoute une fois le secret TOTP du fichier de l'étape 4 à ton application d'authentification.

### 2. Ajouter ta clé API Binance (les retraits doivent être désactivés)

Avec le cookie de session et l'en-tête `x-totp-code`, envoie `POST /api/exchange-key` avec `{"label": "<un nom quelconque>", "keyType": "ed25519", "apiKey": "<ta clé API>", "privateKeyPem": "<ta clé privée Ed25519, PEM>"}`. L'application vérifie les permissions de la clé sur Binance avant d'enregistrer quoi que ce soit : une clé avec retraits ou transfert universel activés est refusée avec **P1_WITHDRAWALS** / **P1_UNIVERSAL_TRANSFER** (HTTP 422), une clé qui n'est pas Ed25519 avec **KEY_TYPE_NOT_ED25519** (422). Une clé acceptée est stockée chiffrée avec ta clé maîtresse ; aucune partie n'en est jamais affichée ni renvoyée.

### 3. Choisir l'intervalle de tick (naît vide)

Ouvre `/panel` avec la session et trouve la section **« Tik aralığı — motor ne sıklıkla çalışır »** (intervalle de tick). Les choix sont **toutes les 1, 2 ou 3 minutes**. Sur une installation neuve, l'intervalle est **vide** et le moteur ne peut pas être démarré tant que tu n'en as pas choisi un. Un changement prend effet **au plus tard dans les 20 minutes**, ou au redémarrage du moteur ; choisir un intervalle moins fréquent ne demande pas de code, un plus fréquent demande le code à usage unique.

### 4. Démarrer et arrêter le moteur

**Démarrage :** il n'y a pas de bouton de démarrage dans le panneau aujourd'hui. Envoie `POST /api/engine/resume` avec le cookie de session et l'en-tête `x-totp-code`. Si l'intervalle de tick est encore vide, la requête est refusée avec **TICK_UNSET** (HTTP 409) et rien ne change. **Arrêt :** ouvre `/durdur` — il ne demande **ni** session **ni** code. Saisis la clé d'arrêt brute du fichier de l'étape 5, choisis sous **« Ne olsun? »** soit **« Yalnız durdur »** (arrêter seulement : les positions ouvertes et leurs ordres de protection sur l'échange restent tels quels), soit **« Durdur ve kapatma iste »** (arrêter et enregistrer une demande de clôture ; le logiciel ne ferme pas les positions lui-même aujourd'hui), et envoie. La clé n'est jamais stockée dans le navigateur.

### 5. L'interrupteur d'entrée (naît ACTIVÉ)

La section du panneau **« Giriş şalteri »** montre si le moteur peut envoyer des ordres d'**entrée**. Sur une installation neuve, il naît **ACTIVÉ**, mais aucun ordre n'est envoyé tant que la clé Binance, le capital et les réglages de risque sont vides. Ouvrir **« Bu ayarı değiştir (tek kullanımlık kod ister) »** te permet de le basculer ; l'**activer** affiche le texte d'avertissement du haut de cette page avec une case que tu dois cocher, et demande le code à usage unique. Le désactiver ne ferme pas les positions ouvertes et n'arrête pas le moteur — utilise `/durdur` pour cela.

### 6. Le plafond de coût et le Cerveau (naît vide)

La section **« Aylık maliyet tavanı »** contient le plafond de coût mensuel en dollars. Il naît **vide**, et tant qu'il est vide, le Cerveau (Claude) n'est **pas** appelé du tout (« Tavan boşken davranış » : le Cerveau est éteint). Saisis un plafond quand tu veux que la génération quotidienne des règles tourne ; baisser ou vider un plafond ne demande pas de code, le relever demande le code à usage unique. La section **« Karar motoru ayarı »** montre le modèle (`claude-opus-5` par défaut), la fréquence d'appel (toutes les 24 heures par défaut), ainsi que le nombre de candidats et de bougies.

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

**Moteur arrêté / sur une INSTALLATION NEUVE (réglages par défaut) : ≈ 0,24 – 0,60 $ / mois.** Sur une installation neuve, le moteur ne peut pas être démarré (l'intervalle de tick naît vide et la requête de démarrage est refusée) et le plafond de coût naît vide (le Cerveau n'est jamais appelé). Dans cet état, le logiciel produit (compté d'après le code, 2026-09-24) : une invocation serveur par minute (**1 440/jour · 43 200/mois**), **1 commande Upstash** par invocation (elle lit la copie du permis d'exécution), **0 requête base de données** (Neon n'est jamais réveillé), **0 appel Claude**. La facture : invocations Vercel 43 200 × 0,60 $/M = 0,03 $ + mémoire 2 Go × 0,53–1,43 s mesurées × 43 200 ÷ 3600 = 12,7–34,3 Go-h × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $** ; le temps CPU actif **n'a pas été mesuré** (aucun nombre n'est écrit ici pour lui). Chaque ouverture du panneau ajoute, mesuré, 5 requêtes base, 1 réveil de la base et 2 commandes Upstash ; la fréquence d'ouverture dépend de toi.

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

<!-- readme:faq -->
## FAQ / dépannage

### Le déploiement Vercel échoue avec un message sur les expressions cron

Tu es sur le plan Hobby. La documentation de Vercel dit qu'une expression cron qui s'exécute plus d'une fois par jour *échoue au déploiement* ; la planification de ce logiciel est chaque minute et ne peut pas être changée depuis le panneau. Déplace le projet dans une équipe Pro, ou ne le fais pas tourner sur Vercel Hobby.

### Le serveur ne démarre pas et affiche « ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor »

Une variable d'environnement manque ou est mal formée. Les lignes sous ce message nomment chaque variable et la raison du rejet (par exemple une clé maîtresse qui ne fait pas 44 caractères en base64) — jamais sa valeur. Compare tes noms avec `.env.example` et le tableau sous « Ce qu'il te faut ».

### `/api/health` répond `{"ok":true,...}` mais le panneau demande un mot de passe, et les points de réglage répondent 401 avec `{"ok":false,"reason":"NO_SESSION"}`

C'est l'état attendu sans session. Saisis le mot de passe du propriétaire dans le champ **Parola** du panneau et appuie sur **Giriş yap** (voir « Première utilisation ») ; la même page ouvre le panneau, sans rechargement.

### Démarrer le moteur répond 409 avec la raison **TICK_UNSET**

L'intervalle de tick est vide (il naît vide). Choisis d'abord un intervalle dans la section du panneau « Tik aralığı », puis renvoie la requête de démarrage.

### Ma clé Binance est refusée avec **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** ou **KEY_TYPE_NOT_ED25519**

Crée sur Binance une nouvelle clé API de type **Ed25519** avec retraits et transfert universel **désactivés**, et transmets celle-là. Une clé refusée n'est ni stockée ni journalisée.

### Binance répond 451 « Service unavailable from a restricted location »

Binance bloque les requêtes venant des États-Unis. `vercel.json` épingle pour cela les fonctions à la région `hnd1` (Tokyo) ; si tu changes la région pour une région américaine, chaque appel à Binance échoue avec 451 et le moteur signale la région comme bloquée.

### Ce logiciel envoie-t-il quelque chose à son mainteneur ?

Non. Il n'appelle que Binance (avec ta clé), tes propres Neon et Upstash, et Anthropic (avec ta clé). Le seul trafic tiers qu'il ne contrôle pas est la télémétrie de build de Next.js décrite dans la section sur les coûts, que tu peux couper avec `NEXT_TELEMETRY_DISABLED=1`.

---

Les contributions de code et les pull requests ne sont pas acceptées ; les rapports de bug, les questions d'installation et les signalements de sécurité privés sont ouverts — voir [CONTRIBUTING.md](CONTRIBUTING.md) et `SECURITY.md`. Licence : MIT (voir `LICENSE`) ; tu peux forker et modifier ta propre copie.
