# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

Çelişkide İngilizce metin geçerlidir.

<!-- readme:intro -->
## Bu ne

`winvestour-bot`, **kendi hesaplarında** çalıştırdığın küçük bir işlem motorudur: Binance spot piyasasını **senin** API anahtarınla okur, günde bir kez bir Claude modelinin yazdığı kurallarla karar verir ve hesabına gerçek emir gönderebilir. Her kurulum kendi kopyasıdır — veritabanı, Binance anahtarı ve Claude API anahtarı senin kendi barındırmanda durur ve bu kopyadaki hiçbir şey yazarına geri çağrı yapmaz. Böyle bir motoru kendisi için çalıştırmak isteyen, önce kodu okuyan ve küçük bir tutarla başlayan tek bir kişi içindir.

**İçindekiler:** [Ne gerekir](#ne-gerekir) · [Yapay zekâ asistanıyla kurulum](#yapay-zekâ-asistanıyla-kurulum) · [Kurulum](#kurulum) · [İlk kullanım](#i̇lk-kullanım) · [Aylık çalıştırma maliyeti](#aylık-çalıştırma-maliyeti) · [SSS / sorun giderme](#sss--sorun-giderme) · [Katkı](CONTRIBUTING.md)

<!-- readme:warning -->
### ⚠️ Kurmadan önce oku

1. **Bu yazılım yatırım tavsiyesi değildir.** Kâr vaadi yoktur. Geçmiş ölçümler gelecekteki sonucu göstermez.
2. **Bu yazılım gerçek parayla kendi kararıyla emir gönderebilir.** Kurulumun ilk hâlinde giriş yolu **AÇIK** doğar. Emir çıkması için kendi Binance anahtarını, sermayeni ve risk ayarlarını girmen gerekir; bunlar boşken emir çıkmaz. Şalteri panelden her an kapatabilirsin.
3. **Kayıp riski gerçektir ve tamamı sana aittir.** Kaybetmeyi göze alamayacağın parayla kullanma.
4. Yazılım **MIT lisansıyla, "olduğu gibi"** verilir. Yazarı ve katkıcıları hiçbir garanti vermez; işlem sonuçlarından, kayıplardan, kesinti ve hatalardan sorumlu değildir.
5. **Mevzuat senin sorumluluğunda.** Kripto işlemleri bazı ülkelerde izne tabidir veya yasaktır; kendi ülkenin kurallarına ve Binance'in kullanım şartlarına uymak sana aittir. Bu proje Binance ile bağlantılı değildir, Binance tarafından onaylanmamıştır.
6. **Vergi yükümlülüğü sana aittir.**
7. Kodu okumadan, önce küçük sermayeyle denemeden kullanma.

<!-- readme:need -->
## Ne gerekir

- **Pro planında bir Vercel hesabı.** Motoru **her dakika** çalışan zamanlanmış bir iş sürer (`vercel.json`). Vercel'in ücretsiz Hobby planı zamanlanmış işe en çok **günde bir kez** izin verir ve belgesi daha sık bir zamanlamanın *dağıtım sırasında düştüğünü* yazar — yani Hobby'de dağıtım yayına çıkmaz. Seçmeden önce Vercel'in kendi fiyat ve şartlarını oku.
- **Bir Neon hesabı** (PostgreSQL). Tablolar için ücretsiz plan yeter; aşağıdaki maliyet bölümü neyin ölçüldüğünü söyler.
- **Bir Upstash hesabı** (Redis). Ücretsiz planın kotası aynı anda bir açık pozisyon için yeter.
- **Bir Anthropic API anahtarı.** Kural yazan model ("Beyin") varsayılan olarak günde bir kez çağrılır; yeni kurulum maliyet tavanı **boş** doğar ve tavan boşken Beyin **çağrılmaz**.
- **Çekim izni olmadan oluşturulmuş, Ed25519 türünde bir Binance API anahtarı.** Çekim ya da evrensel transfer izni açık bir anahtar reddedilir ve hiç saklanmaz.
- Kurulum komutları için bilgisayarında **Node.js ve npm**, toplamda yaklaşık **bir saat**.

Bu kopya yazarına ait hiçbir şey taşımaz: kod hiçbir alan adı okumaz, ortam sözleşmesinde Android paket adı ya da imza parmak izi yok ve Firebase/FCM yapılandırması ya da değişkeni yok. Aşağıdakilerin hepsi boş doğar; sen kendi değerlerinle doldurursun.

| Ortam değişkeni | Değer nereden gelir |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon → projen → bağlantı dizeleri (havuzlu · doğrudan) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash → veritabanın → REST API. Upstash'i Vercel Marketplace'ten eklersen adları `KV_REST_API_URL` ve `KV_REST_API_TOKEN` olarak yazar; uygulama onları da okur. |
| `ANTHROPIC_API_KEY` | Anthropic → API anahtarları (`sk-ant-` ile başlar) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | kurulum adımı 4'in yazdığı dosya |
| `STOP_KEY_HASH` | kurulum adımı 5'in yazdığı dosya |
| `ENCRYPTION_MASTER_KEY` | kurulum adımı 6'nın yazdığı dosya |
| `ENCRYPTION_KEY_VERSION` | yeni kurulumda `1` (yalnız ana anahtar dönüşünde artırılır, adım 15) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | boş bırak; yalnız ana anahtar dönüşü sırasında kullanılır |
| `ENGINE_MODE` | `CHEAP` (zamanlanmış işten dakikada bir tik; bu README'nin anlattığı tek kip) |

Binance API anahtarı bir ortam değişkeni **değildir**: kurulumdan sonra uygulama üzerinden verilir ve senin ana anahtarınla şifrelenmiş olarak veritabanında durur (bkz. "İlk kullanım").

## Yapay zekâ asistanıyla kurulum

Aşağıdaki bloğu olduğu gibi kopyalayıp bir yapay zekâ asistanına (Claude, ChatGPT, Cursor ya da benzeri) yapıştır. Asistan seni Kurulum bölümünün numaralı adımlarından tek tek geçirir, her adımın sonucunu kontrol ettirir ve sohbete parola, anahtar ya da `.env` değeri yapıştırmanı hiçbir zaman istemez. Blok bilerek İngilizcedir ve bu sayfanın her dil sürümünde aynıdır.

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
## Kurulum

Aşağıdaki 15 adımın her biri her yayından önce bu deponun temiz bir kopyasında sırayla denenir — 1–14. adımlar otomatik kurulum denemesiyle, 15. adım anahtar dönüşü denemesiyle. Bu şekilde denenmeyen adım buraya yazılmaz.

1. Gereken hesapları aç (toplam yaklaşık 30 dakika): bir **Neon** hesabı (PostgreSQL veritabanı), bir **Upstash** hesabı (Redis), **Pro planında** bir **Vercel** hesabı (uygulama her dakika zamanlanmış bir iş çalıştırır; ücretsiz Hobby planında dağıtım düşer — bkz. "Ne gerekir"), bir **Anthropic** API anahtarı ve **çekim izni OLMADAN** oluşturulmuş bir **Binance** API anahtarı.

Beklenen sonuç: beş hizmete de giriş yapabiliyorsun ve Binance API anahtarının izinleri arasında çekim yok.

2. Kodu bilgisayarına al: bu deponun sayfasında **Code → Download ZIP** seç (ya da kendi git istemcinle klonla), arşivi aç ve o klasörde bir terminal aç.

Beklenen sonuç: klasörde `package.json` ve `.env.example` var.

3. Bağımlılıkları kopyanın kilit dosyasıyla kur:

```sh
npm ci
```

Beklenen sonuç: komut hatasız biter ve bir `node_modules` klasörü oluşur.

4. Sahip parolasını, TOTP sırrını ve oturum sırrını üret. Ekrana hiçbir değer basılmaz, yalnız dosya yolları ve kısa parmak izleri; değerler depo dışı bir klasöre yazılır (varsayılan: ev klasöründe `winvestour-backup`, başka yer için `-- --dir <klasör>`):

```sh
npm run owner:credentials
```

Beklenen sonuç: klasörde artık `owner-credentials.txt`, `vercel-env-owner.txt` var; ilki parolanı ve doğrulayıcı uygulaman için TOTP kurulum anahtarını, ikincisi 9. adımın üç `NAME=value` satırını taşır. Ekrana hiçbir değer basılmaz; yalnız dosya yolları ve kısa parmak izleri basılır.

5. Durdurma anahtarını üret (aynı klasöre yazılır, ekrana basılmaz):

```sh
npm run stop:credential
```

Beklenen sonuç: klasörde `stop-key.txt`, `vercel-env-STOP_KEY_HASH.txt` oluşur; ilki durdurma ekranında yazacağın ham anahtarı, ikincisi 9. adım için karmasını taşır.

6. Borsa anahtarlarını şifreleyecek ana anahtarı üret (aynı klasöre yazılır, ekrana basılmaz). Bu anahtar kaybolursa şifreli satırlar bir daha açılamaz; ikinci kopyasını parola yöneticinde sakla:

```sh
npm run key:encryption-master
```

Beklenen sonuç: klasörde `encryption-master-key.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt` oluşur.

7. Binance API anahtarın için Ed25519 anahtar çiftini üret (aynı klasöre yazılır; özel anahtar ekrana basılmaz):

```sh
npm run key:generate
```

Beklenen sonuç: klasörde `binance-private-key.pem`, `binance-public-key.pem` oluşur. Binance'te Profile → API Management → Create API → **Self-generated** seç ve ikinci dosyanın (ortak anahtar) içeriğini yapıştır; ilk dosyayı (özel anahtar) sonra panele yapıştıracaksın ("İlk kullanım").

8. Boş bir PostgreSQL veritabanı aç: Neon'da bir proje oluştur ve iki bağlantı dizesini kopyala — havuzlu olan `DATABASE_URL`, doğrudan (havuzsuz) olan `DIRECT_URL` olur. Bölge olarak **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`) seç: uygulamanın fonksiyonları Tokyo'da (`hnd1`, bkz. `vercel.json`) çalışır ve Neon'un Tokyo bölgesi yok; en yakını Singapur (Neon bölge listesi, 2026-09-26'da okundu).

Beklenen sonuç: `postgresql://` ile başlayan iki dize; veritabanında henüz tablo yok.

9. `.env.example` dosyasındaki her ada değerini ver — `ENCRYPTION_MASTER_KEY_PREVIOUS` hariç; o boş kalır (yalnız ana anahtar dönüşünde kullanılır). Hangi değerin nereden geldiği "Ne gerekir" başlığındaki tabloda; `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` değerleri 4–6. adımların dosyalarından gelir. Dağıtım için bunları Vercel'de **Settings → Environment Variables** altına gir; yerel çalıştırma için aynı adları `package.json` yanındaki bir `.env` dosyasına yaz (git o dosyayı yok sayar). Değerler depoya girmez.

Beklenen sonuç: `.env.example` dosyasındaki `ENCRYPTION_MASTER_KEY_PREVIOUS` dışındaki her adın bir değeri var. Zorunlu bir ad eksikse uygulama açılışta durur ve eksik adı söyler.

10. Veritabanı tablolarını kur. Bunu bilgisayarından bir kez, `DIRECT_URL` ayarlıyken (`.env` içinde ya da terminalde) çalıştır; Vercel aynı komutu her dağıtımda yineler, bunun zararı yoktur:

```sh
npx prisma migrate deploy
```

Beklenen sonuç: çıktı `All migrations have been successfully applied.` satırıyla biter. `0_baslangic` adlı tek bir tablo kurulumu uygulanır; her ayar tablosu tek satırla doğar; risk ayarları boş ve kapalıdır.

11. Kodun bilgisayarında derlendiğini denetle (dağıtımdan önce önerilir):

```sh
npm run build
```

Beklenen sonuç: komut yol listesiyle ve hatasız biter; bir `.next` klasörü oluşur.

12. Yerelde başlat. Uygulama ayağa kalkınca tarayıcında `http://localhost:3000/api/health` adresini aç:

```sh
npm start
```

Beklenen sonuç: sayfa `{"ok":true,"service":"engine",...}` gösterir; `http://localhost:3000/panel` açılır ve panelin oturum istediğini söyler. Sunucu açılırken ortam sözleşmesi doğrulanır: zorunlu bir ad eksik ya da bozuksa sunucu açılmaz; hata eksik adı söyler, değerini söylemez. Sunucuyu Ctrl+C ile durdur. Botu kendi bilgisayarında çalıştırmak henüz desteklenmiyor: motoru Vercel Cron tetikler. Yerelde başlatmak yalnız kurulumu doğrulamak içindir.

13. Vercel'de dağıt: kopyanı kendi GitHub hesabına gönder, sonra Vercel'de **Add New → Project → Import** ile o depoyu seç, çerçeve ön ayarını **Next.js** bırak, 9. adımdaki ortam değişkenlerini ekle ve **Deploy** düğmesine bas. Vercel `vercel-build` betiğini çalıştırır: önce veri silecek her tablo değişikliğini reddeder, sonra tabloları kurar ve derler.

Beklenen sonuç: dağıtım **Ready** olur ve `https://<projen>.vercel.app/api/health` `{"ok":true,...}` döner. Hobby planında ise dağıtım, günde birden sık çalışan cron ifadelerine izin verilmediğini söyleyen bir iletiyle düşer.

14. Adresinde paneli `/panel` yolundan, durdurma ekranını `/durdur` yolundan aç.

Beklenen sonuç: iki sayfa da açılır (arayüz İngilizcedir). Panel oturum istediğini söyler; durdurma ekranı oturumsuz açılır ve durdurma anahtarını ister. "İlk kullanım" ile devam et.

15. İSTEĞE BAĞLI, KURULUMUN PARÇASI DEĞİL — ANA ANAHTAR DÖNÜŞÜ. Ana anahtarın sızdıysa ya da değiştirmek istiyorsan: eski yedek dosyasını taşı, 6. adımı yeniden koşarak YENİ bir anahtar üret, `ENCRYPTION_MASTER_KEY` olarak yeniyi, `ENCRYPTION_MASTER_KEY_PREVIOUS` olarak eskiyi ver ve `ENCRYPTION_KEY_VERSION`'ı bir artır. Varsayılan KURU koşumdur: hiçbir şey yazılmaz, yalnız çözülebilirlik ölçülür; yazmak için sonuna `-- --write` ekle:

```sh
npm run rotate:encryption-key
```

Sonuç: her satır kendi işleminde eski anahtarla çözülüp yeni anahtarla sarılır ve sürümü yükselir; yeni zarf YAZILMADAN ÖNCE yeni anahtarla açılıyor mu diye denetlenir. Eski sürümde satır kalmazsa `ENCRYPTION_MASTER_KEY_PREVIOUS` artık silinebilir. Hiçbir anahtar değeri ekrana basılmaz.

<!-- readme:first-use -->
## İlk kullanım

Panel ve durdurma ekranı bu README'nin yedi dilinde kullanılabilir — **English · Türkçe · Deutsch · Русский · Italiano · Français · العربية**<!-- ad:@langs --> (Arapça sağdan sola); dili panelin üstündeki, giriş ekranındaki ya da durdurma ekranındaki **Dil**<!-- ad:langSelect.label --> menüsünden seç — seçmezsen tarayıcının dilinde, o da yoksa İngilizce açılır. Bu README'deki ekran ve düğme adları panelin Türkçe metninden alınmıştır; menüde Türkçe seçiliyken panelde aynı adları görürsün. Aşağıdaki her şey yazılımın bugün tam olarak ne yaptığını anlatır; burada planlanan ya da vaat edilen bir şey yok. Panelin dört sekmesi var — **Durum · Ayarlar · Geçmiş · Teknik**<!-- ad:tabs.status,tabs.settings,tabs.history,tabs.technical --> — ve **Durum**<!-- ad:tabs.status --> ile açılır. Ekran ve düğme adları aşağıda ekranda göründüğü gibi yazıldı.

**Ayarlar**<!-- ad:tabs.settings -->: paneldeki her ayar — ne işe yaradığı, varsayılanı, tek kullanımlık kod isteyip istemediği, ne zaman etkili olduğu — wiki'deki [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide) sayfasında (İngilizce) anlatılır; ekranlar [Panel guide](https://github.com/akaytaran/winvestour-bot/wiki/Panel-guide) sayfasında görünür.

### 1. Giriş (sahip parolası, sonra hassas eylem başına tek kullanımlık kod)

`https://<projen>.vercel.app/panel` adresini aç. Oturum yokken panel tek bir **Parola**<!-- ad:login.password --> alanı ve **Giriş yap**<!-- ad:login.submit --> düğmesi gösterir: `owner-credentials.txt` dosyasındaki (kurulum adımı 4) parolayı yaz ve düğmeye bas — aynı sayfa paneli açar. Oturum **8 saat** sürer. Yanlış parola "Parola yanlış, yeniden dene."<!-- ad:login.wrong --> der. **5** yanlış denemeden sonra giriş ve her hassas eylem **15 dakika** kilitlenir ("Çok fazla yanlış deneme: giriş kilitlendi. En geç 15 dakika sonra yeniden dene."<!-- ad:login.locked|minutes=15 -->); durdurma ekranı hiç kilitlenmez. **Çıkış yap**<!-- ad:panel.signOut --> panelin üstündedir. Hassas eylemler (anahtar eklemek, motoru başlatmak, giriş şalterini değiştirmek, bir maliyeti yükseltmek) ayrıca doğrulayıcı uygulamandaki güncel 6 haneli kodu, "Tek kullanımlık kod (6 hane) — doğrulayıcı uygulamandan"<!-- ad:common.codeLabel --> adlı alanda ister. `owner-credentials.txt` içindeki TOTP kurulum anahtarını doğrulayıcı uygulamana bir kez ekle.

### 2. **Durum**<!-- ad:tabs.status --> sekmesini oku: motorun durumu ve "Başlamadan önce"<!-- ad:engine.beforeYouStart -->

Üstteki **MOTOR DURUMU**<!-- ad:engine.label --> kartı sunucudan okunan dört hâlden birini gösterir: **Çalışıyor**<!-- ad:engine.state.RUNNING.name --> · **Durdu**<!-- ad:engine.state.STOPPED.name --> (sen ya da bir koruma kuralı durdurdu) · **Çalışmıyor**<!-- ad:engine.state.NO_PERMIT.name --> (hiç başlatılmadı ya da çalışma izninin süresi doldu) · **Bilinmiyor**<!-- ad:engine.state.UNKNOWN.name --> (durum okunamadı; **DURDUR**<!-- ad:engine.stop --> sunulur, **BAŞLAT**<!-- ad:engine.start --> sunulmaz). Altındaki **Başlamadan önce**<!-- ad:engine.beforeYouStart --> listesi motorun ihtiyacını sayar: **Binance anahtarı · Tik aralığı · Maliyet tavanı · Altyapı maliyeti · Tek pozisyon payı · Toplam maruziyet**<!-- ad:prereq.names.key,prereq.names.tick,prereq.names.cap,prereq.names.infra,prereq.names.single,prereq.names.total --> — her biri ✓ (tamam), ✗ (eksik) ya da ? (okunamadı) — ve iki bilgi satırı: **Giriş şalteri**<!-- ad:prereq.names.entry --> ve **Sermaye**<!-- ad:prereq.names.capital -->. Bir satır ✗ ya da ? iken **BAŞLAT**<!-- ad:engine.start --> düğmesi gizlidir ve "Önce: …"<!-- ad:prereq.keyFix|pre --> bağlantısı seni o ayara götürür. Uyarılar (örneğin eksik koruma emri) "Önce bunlara bak"<!-- ad:status.alertsHeading --> altında, son motor turu, açık pozisyonlar ve bu dönem ödenen komisyon "Bir bakışta"<!-- ad:status.summaryHeading --> altında görünür.

### 3. **Ayarlar**<!-- ad:tabs.settings --> sekmesini doldur

- **Binance API anahtarı**<!-- ad:key.heading -->: önce anahtarı oluştur. Ed25519 çiftini `npm run key:generate` (kurulum adımı 7) ya da Binance'in kendi anahtar üreticisiyle üret; Binance'te Profile → API Management → Create API → **Self-generated** aç, ortak anahtarı yapıştır, bir ad ver ve iki adımlı doğrulamayı tamamla. İzinler: okuma **açık** (okuması kapalı anahtar reddedilir), motorun emir gönderebilmesi için spot işlem **açık**, futures yalnız kullanacaksan, çekim ve evrensel transfer **kapalı**. Panelde **Ayarlar → Binance API anahtarı → Anahtar ekle (tek kullanımlık kod ister)**<!-- ad:tabs.settings>key.heading>key.add --> aç, **Ad**<!-- ad:key.fieldName|head -->, **API anahtarı**<!-- ad:key.fieldApiKey|head -->, **Özel anahtar**<!-- ad:key.fieldPrivate|head --> (`binance-private-key.pem` dosyasının tamamı; alan gizli kalır) ve tek kullanımlık kodu doldur, **Anahtarı doğrula ve kaydet**<!-- ad:key.submit --> düğmesine bas. Uygulama hiçbir şey kaydetmeden önce izinleri Binance'te denetler; çekimi ya da evrensel transferi açık anahtar reddedilir ("Anahtar REDDEDİLDİ: …"<!-- ad:key.withdrawals|pre -->) ve hiçbir yere kaydedilmez. Kabul edilen anahtar ana anahtarınla şifrelenerek saklanır ve bir daha gösterilmez. Yeni anahtar eklenince motor en yenisini kullanır; eski anahtarları Binance'te kendin sil.
- **Tik aralığı — motorun ne sıklıkla çalıştığı**<!-- ad:tick.heading -->: **boş** doğar; o olmadan motor başlamaz. **Değiştir (daha seyrek kod istemez; daha sık kod ister)**<!-- ad:tick.change --> bölümünü aç ve düğmelerden birini seç: **1, 2 ya da 3 dakikada bir**. Değişiklik **en geç 20 dakikada** ya da motor yeniden başlatılınca etkili olur.
- **Aylık maliyet tavanı**<!-- ad:cap.heading -->: **boş** doğar; boşken karar motoru (Claude) hiç **çağrılmaz**. Çalışmasını istiyorsan **Tavanı değiştir (…)**<!-- ad:cap.change|paren --> bölümünü aç, **Aylık toplam maliyet tavanı**<!-- ad:cap.fieldTotal --> ve **Aylık altyapı maliyeti (kendi Neon, Vercel ve Upstash faturalarının toplamı)**<!-- ad:cap.fieldInfra --> kutularını işaretle ve ikisini aylık dolar olarak yaz. Düşürmek ya da boşaltmak kod istemez; yükseltmek tek kullanımlık kod ister. **Karar motoru — model · sıklık · adaylar · mumlar**<!-- ad:brain.heading --> modeli (varsayılan `claude-opus-5`) ve ne sıklıkla çağrıldığını (varsayılan 24 saatte bir) gösterir.
- **Risk payları — tek pozisyon · toplam maruziyet**<!-- ad:caps.heading -->: yeni kurulumda **boş** doğar ve hiçbir sayı önerilmez — sayılar senindir. İkisi de **Binance'teki serbest USDT bakiyenin** (kendi spot cüzdanındaki, henüz bir pozisyonda olmayan USDT) yüzdesidir: **Tek pozisyon payı**<!-- ad:prereq.names.single --> TEK bir yeni pozisyonun kullanabileceği en çok kısımdır; **Toplam maruziyet**<!-- ad:prereq.names.total --> açık pozisyonların HEPSİNİN birlikte kullanabileceği en çok kısımdır; tek pay toplamdan büyük olamaz. **Ayarlar → Risk payları**<!-- ad:tabs.settings>caps.historyGroup --> bölümünde her sayıyı **Tek pozisyon payı (serbest USDT bakiyenin yüzdesi)**<!-- ad:caps.singleLabel --> ve **Toplam maruziyet (serbest USDT bakiyenin yüzdesi)**<!-- ad:caps.totalLabel --> alanlarına kendin yaz, tek kullanımlık kodu yaz ve **Risk paylarını kaydet**<!-- ad:caps.apply --> düğmesine bas — her kayıt yeni bir kod ister. İzinli: sıfırdan büyük, en çok üç ondalıklı bir sayı; boş bırakılan alan değerini korur. Kaydedilen değerler sunucudan yeniden okunur; "Başlamadan önce"<!-- ad:engine.beforeYouStart --> listesinin iki satırı sonra ✓ gösterir. Değişiklik motorun bir sonraki giriş kararından itibaren geçerlidir; açık pozisyonlar büyüklüklerini korur.
- **Giriş şalteri**<!-- ad:entry.heading -->: **AÇIK**<!-- ad:common.on --> doğar — gerisi tamamlanınca motor kendi kararıyla yeni pozisyon açabilir. Değiştirmek için anahtara bas; açarken bu sayfanın başındaki uyarıyla "Açmadan önce oku"<!-- ad:entry.readFirst --> ve bir onay kutusu çıkar, iki yön de tek kullanımlık kod ister. **KAPALI**<!-- ad:common.off --> iken motor çalışır, çıkış ve koruma sürer ama yeni pozisyon açılmaz ve karar motoru çağrılmaz.

### 4. Sermaye

Motor **Binance spot cüzdanındaki serbest USDT** ile işlem yapar; bu yüzden anahtarda **Enable Spot & Margin Trading** açık olmalı. Bir pozisyonun büyüklüğü **Tek pozisyon payı**<!-- ad:prereq.names.single --> × serbest USDT bakiyesidir. Binance, çiftin asgari emir tutarının (NOTIONAL süzgeci) altındaki emri reddeder; motor bu asgari tutarı her emirden önce Binance'ten okur — yazarın hesabında denetlenen çiftlerin çoğunda **5 USDT**, bazılarında 1 USDT idi (2026-09-10'da ölçüldü). Pay × serbest bakiye bunun altındaysa pozisyon açılmaz; motor çalışmayı ve korumayı sürdürür. Panel Binance'e bağlanmaz; bu yüzden bugünkü serbest bakiyeyi bu asgari tutarla burada karşılaştıramaz: **Sermaye**<!-- ad:prereq.names.capital --> satırı son ölçülen hesap değerini gösterir. Ne kadar yatıracağın senin kararın.

### 5. Motoru başlat

"Başlamadan önce"<!-- ad:engine.beforeYouStart --> listesinin her satırı ✓ olunca **Durum**<!-- ad:tabs.status --> sekmesinde yeşil **BAŞLAT**<!-- ad:engine.start --> düğmesi görünür. Bas, kodu "Tek kullanımlık kod (6 hane) — doğrulayıcı uygulamandaki kod"<!-- ad:engine.codeLabel --> alanına yaz ve **Motoru başlat**<!-- ad:engine.startEngine --> düğmesine bas. Kart **Çalışıyor**<!-- ad:engine.state.RUNNING.name --> olur ve "Başlatma kabul edildi: motor …"<!-- ad:engine.started|upto:until --> der — durum tahmin edilmez, sunucudan yeniden okunur. Tik aralığı seçilmemişse yanıt "Motor başlamadı: tik aralığı seçilmedi."<!-- ad:engine.notStartedTick|s1 --> olur ve hiçbir şey değişmez. Dikkatli sıra: önce **Giriş şalteri**<!-- ad:entry.heading --> ayarını **KAPALI**<!-- ad:common.off --> yap, motoru başlat ve bir gün **Çalışıyor**<!-- ad:engine.state.RUNNING.name --> hâlini izle, sonra girişleri açıp açmayacağına karar ver.

### 6. Motoru durdur

Motor çalışırken kartta kırmızı **DURDUR**<!-- ad:engine.stop --> düğmesi görünür: **Yalnız durdur**<!-- ad:stop.modes.HOLD.title --> (yeni pozisyon yok; açık pozisyonlar ve borsadaki koruma emirleri olduğu gibi kalır) ya da **Durdur ve kapatma iste**<!-- ad:stop.modes.CLOSE_ALL.title --> (kapatma isteği kaydedilir; yazılım bugün pozisyonları kendisi kapatmaz) seç, `stop-key.txt` dosyasındaki **durdurma anahtarını** (kurulum adımı 5 — tek kullanımlık kod DEĞİL) yaz ve **Motoru durdur**<!-- ad:stop.sendPanel --> düğmesine bas. Panel açılamıyorsa `/durdur` adresindeki **durdurma ekranı** ("Winvestour · motoru durdur"<!-- ad:stop.title -->) aynı işi oturum ve kod olmadan yapar: **Ne olsun?**<!-- ad:stop.legend --> altında seç, anahtarı **Durdurma anahtarı**<!-- ad:stop.keyLabel --> alanına yaz ve **Durdur**<!-- ad:stop.send --> düğmesine bas. Anahtar tarayıcıda hiç saklanmaz.

### 7. **Geçmiş**<!-- ad:tabs.history --> ve **Teknik**<!-- ad:tabs.technical -->

**Geçmiş**<!-- ad:tabs.history --> son pozisyonları (giriş, büyüklük, komisyon, brüt ve net) ve her ayar değişikliğini (kim, ne zaman, eski → yeni) listeler. **Teknik**<!-- ad:tabs.technical --> panelin okuduğu ölçülmüş ayrıntının tamamını saklar — motor, tur ve sağlık kartları, pozisyon satırları ve her sayının nereden geldiği; bu sunucu cümleleri de panelin dilinde gelir.

### 8. Bu sürümde olmayanlar

Anlık bildirim yok: bu kopyada bildirim taşıyıcısı yapılandırılmadı (Firebase/FCM yok). Biyometrik kilit var (**Ayarlar → Biyometrik kilit**<!-- ad:tabs.settings>lock.heading -->, varsayılan kapalı) ve kullandığın cihazda parmak izi ya da yüz doğrulaması ister. Android uygulaması yok; panel, telefonunun ana ekranına ekleyebileceğin bir web sayfasıdır. Botu kendi bilgisayarında çalıştırmak desteklenmiyor (motoru Vercel Cron tetikler).

<!-- readme:cost -->
## Aylık çalıştırma maliyeti

Buradaki her sayı bu yazılımın yazarının kendi dağıtımındaki ölçümünden gelir; tahmin yoktur. Motor ucuz kipte kesintisiz çalışırken, bir açık pozisyonla ve Beyin günde bir çağrılırken ölçülen toplam **≈ ayda 9,60 – 9,90 $** (Neon ≈ 5,30 $ · Vercel ≈ 1,50 $ üst sınır · Upstash ücretsiz kotada 0 $ · Anthropic ≈ 2,84 $). Motor durmuşken ya da varsayılan ayarlarla yeni kurulumda **≈ ayda 0,24 – 0,60 $**. Vercel **Pro** üyeliği (**ayda 20 $**, fiyat okuma 2026-06-16) bunun üstüne gelir ve en büyük tek kalemdir. İşlem komisyonu ve yayılma bu sayılarda yoktur: onlar işlemin maliyetidir, yazılımı çalıştırmanın değil.

<details>
<summary>Tam döküm, varsayımlar ve her fiyatın okunduğu tarih</summary>

**Bu sayılar şu varsayımla geçerlidir:** motor ucuz kipte kesintisiz çalışır (dakikada bir tik = ayda 43 200 tik), aynı anda **1 açık pozisyon** vardır, Beyin (Claude) **günde bir kez** çağrılır (varsayılan ayar: `claude-opus-5`, 24 saat), veritabanı ucu **0,25 CU**'dur ve hepsi ücretli planlardadır.

| Kalem | Neyin karşılığı | Aylık | İnsan birimiyle: neyi ölçtük |
|---|---|---|---|
| **Neon** (Postgres) | emirler, pozisyonlar, komisyon defteri, olay kaydı | **≈ 5,30 $** | Veritabanı sürekli açık durmaz: bir dokunuş onu ≈ 330 saniye uyanık tutar, motor ise ancak 20 dakikada bir dokunur. Ölçülen uyanıklık **ayın ≈ %27,5'i** ⇒ 0,25 CU × 720 sa × %27,5 × 0,106 $/CU-sa. Uç 1 CU bırakılırsa aynı kalem **≈ 21 $** olur. |
| **Vercel** (barındırma) | tik başına çalışan sunucu işlevi | **≈ 1,50 $ üst sınır** | Ayda 43 200 çağrı; her çağrı ölçülen **≈ 1 saniye** sürüyor (sayı 3 saniye üst sınırı üzerinden hesaplandı) × 2 GB bellek. Düşük bellek seçeneği YOK: sağlayıcı en küçük boy olarak 2 GB veriyor. |
| **Upstash** (Redis) | çalışma izni, icra kilidi, tik kaydı, pozisyon kopyası | **0 $** | Tik başına **5 komut** (+ her açık pozisyon için 2) ⇒ ayda **≈ 302 000 komut**; ücretsiz kota **500 000/ay**. 4 ve üzeri eşzamanlı pozisyonda kota aşılır: **≈ 0,10–0,30 $**. |
| **Anthropic** (Claude = "Beyin") | günlük kural üretimi | **≈ 2,84 $** | Ayda **30 çağrı** × çağrı başına **0,094750 $**. Çağrı başına jeton **gerçek bir çağrıdan** okundu: **7 794 giriş + 1 250 çıkış**. Daha sık çağırırsan doğrusal artar: 12 saatte bir ≈ 5,69 $, 6 saatte bir ≈ 11,37 $. |
| **Binance** | piyasa verisi + emir gönderme | **0 $** | API ağırlığı ücretsizdir. **İşlem komisyonu bu tabloda yoktur** — o, işlemin maliyetidir, yazılımı çalıştırmanın değil; yazılım onu her işlemde ayrıca ölçer. |
| **TOPLAM** | | **≈ ayda 9,60 – 9,90 $** | Kalemlerin toplamı. Alt uç: Upstash ücretsiz kotada. Üst uç: kota aşılmış hâli. |

**Motor durdurulmuşken / YENİ KURULUMDA (varsayılan ayarlar): ≈ ayda 0,24 – 0,60 $.** Yeni kurulumda motor başlatılamaz (tik aralığı boş doğar, başlatma isteği reddedilir) ve maliyet tavanı boş doğar (Beyin hiç çağrılmaz). Bu hâlde yazılım şunu üretir (koddan sayıldı, 2026-09-24): dakikada bir sunucu çağrısı (**günde 1 440 · ayda 43 200**), her çağrıda **1 Upstash komutu** (motorun çalışıp çalışamayacağına bakar), **0 veritabanı sorgusu** (Neon uyandırılmaz), **0 Claude çağrısı**. Faturası: Vercel çağrı 43 200 × 0,60 $/M = 0,03 $ + bellek 2 GB × ölçülen 0,53–1,43 s × 43 200 ÷ 3600 = 12,7–34,3 GB-sa × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $**; etkin CPU süresi **ölçülmedi** (buraya sayı yazılmadı). Paneli her açışın ayrıca 5 veritabanı sorgusu, 1 veritabanı uyanışı ve 2 Upstash komutu ürettiği ölçüldü; kaç kez açacağın sana bağlıdır.

**Fiyatların okunduğu tarihler (fiyat değişir, bu satırları kendin doğrula):**
- Neon `neon.com/pricing` — **2026-09-11** (Launch 0,106 $/CU-sa), yeniden okundu **2026-09-24** (değişmedi; ücretsiz plan proje başına ayda 100 CU-saat)
- Vercel `vercel.com/docs/functions/usage-and-pricing` — **2026-06-16** (bellek 0,0167 $/GB-sa, CPU 0,202 $/sa, çağrı 0,60 $/M), yeniden okundu **2026-09-24** (değişmedi); `vercel.com/docs/cron-jobs/usage-and-pricing` — "Last updated July 15, 2026", Hobby "günde bir kez"
- Upstash `upstash.com/pricing/redis` — **2026-09-11** (ücretsiz ayda 500 000 komut, sonrası 0,20 $/100 K), yeniden okundu **2026-09-24** (değişmedi)
- Anthropic `platform.claude.com/docs/en/about-claude/pricing` — **2026-09-11** (`claude-opus-5` 5 $ / 25 $ per MTok)

**Derleme telemetrisi (Next.js):** bu yazılım yazarına hiçbir şey göndermez. Kullandığı Next.js çerçevesi `npm run build` sırasında anonim kullanım verisini Next.js/Vercel'e gönderebilir; bu veri bu deponun sahibine gitmez. Kapatmak için derleme ortamına `NEXT_TELEMETRY_DISABLED=1` ekle (kaynak: Next.js belgesi, https://nextjs.org/telemetry).
</details>

<details>
<summary>Ücretsiz katmanlara sığar mı? (yalnız sağlayıcının kendi belgesinden, okunma tarihi 2026-09-24; hesap açılmadı, denenmedi)</summary>

| sağlayıcı | ücretsiz katman (belgeden) | yeni kurulum (motor başlatılmamış) | motor çalışırken (yukarıdaki varsayımlar) |
|---|---|---|---|
| **Vercel Hobby** | ayda 1 milyon çağrı, 360 GB-sa bellek, 4 sa etkin CPU dahil; **cron günde en çok bir kez** | çağrı ve bellek sınırın içinde; **ama zamanlanmış iş dakikada bir olduğu için dağıtım Hobby'de DÜŞER** (belge: "Cron expressions that would run more frequently will fail during deployment") ⇒ **SIĞMAZ** | aynı sebeple **SIĞMAZ** |
| **Neon Free** | proje başına ayda **100 CU-saat**, 0,5 GB depolama, 5 dakika boşta kalınca uyur, en çok 2 CU | veritabanına dokunulmaz: **0 CU-saat ⇒ SIĞAR** | 0,25 CU × 720 sa × ölçülen %27,5 uyanıklık = **≈ 49,5 CU-saat ≤ 100 ⇒ SIĞAR** (türetildi; ücretsiz planda ölçülmedi). Sığarsa yukarıdaki Neon kalemi 5,30 $ yerine 0 $ olur. |
| **Upstash Free** | ayda **500 000 komut**, 256 MB, 10 GB bant | 43 200 komut (%8,6) ⇒ **SIĞAR** | ≈ 302 000 komut (1 açık pozisyon) ⇒ **SIĞAR**; 4 ve üzeri pozisyonda sığmaz |
| **Anthropic** | ücretsiz katman yok | çağrı 0 ⇒ 0 $ | yukarıdaki Anthropic satırı |
</details>

<!-- readme:faq -->
## SSS / sorun giderme

### Vercel dağıtımı cron ifadesiyle ilgili bir iletiyle düşüyor

Hobby planındasın. Vercel belgesi, günde birden sık çalışan bir cron ifadesinin *dağıtım sırasında düştüğünü* söyler; bu yazılımın zamanlaması dakikada birdir ve panelden değiştirilemez. Projeyi bir Pro ekibine taşı ya da Vercel Hobby'de çalıştırma.

### Sunucu açılmıyor ve "ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor" basıyor

Bir ortam değişkeni eksik ya da bozuk. Bu iletinin altındaki satırlar her değişkeni ve neden reddedildiğini adıyla söyler (örneğin 44 karakterlik base64 olmayan bir ana anahtar) — değerini asla söylemez. Adlarını `.env.example` ve "Ne gerekir" altındaki tabloyla karşılaştır.

### `/api/health` `{"ok":true,...}` döndürüyor ama panel parola istiyor ve ayar uçları `{"ok":false,"reason":"NO_SESSION"}` ile 401 dönüyor

Oturum yokken beklenen hâl budur. Sahip parolasını panelin **Parola**<!-- ad:login.password --> alanına yaz ve **Giriş yap**<!-- ad:login.submit --> düğmesine bas (bkz. "İlk kullanım"); aynı sayfa paneli açar, yenilemeye gerek yok.

### **BAŞLAT**<!-- ad:engine.start --> görünmüyor ya da motor "Motor başlamadı: tik aralığı seçilmedi."<!-- ad:engine.notStartedTick|s1 --> diyor

**BAŞLAT**<!-- ad:engine.start --> yalnız "Başlamadan önce"<!-- ad:engine.beforeYouStart --> listesinin her satırı ✓ iken görünür. "Önce: …"<!-- ad:prereq.keyFix|pre --> bağlantılarını izle. Tik aralığı boşsa (boş doğar) **Ayarlar → Tik aralığı**<!-- ad:tabs.settings>prereq.names.tick --> bölümünden birini seç ve yeniden başlat. Yeni kurulumda iki risk payı boş doğar: onları **Ayarlar → Risk payları**<!-- ad:tabs.settings>caps.historyGroup --> bölümünden gir (bkz. "İlk kullanım", adım 3).

### Binance anahtarım **P1_WITHDRAWALS**, **P1_UNIVERSAL_TRANSFER** ya da **KEY_TYPE_NOT_ED25519** ile reddediliyor

Binance'te **Ed25519** türünde, çekim ve evrensel transferi **kapalı** yeni bir API anahtarı oluştur ve onu panelden ekle. Panelde ret "Anahtar REDDEDİLDİ: …"<!-- ad:key.withdrawals|pre --> diye okunur ve kapatılacak izni adıyla söyler. Reddedilen anahtar saklanmaz ve kütüğe yazılmaz.

### Binance API anahtarımı bir IP adresine kısıtlamalı mıyım?

Normal bir Vercel kurulumunda sabit bir adresle kısıtlayamazsın: Vercel fonksiyonları varsayılan olarak değişken çıkış IP adresleri kullanır; sabit çıkış adresi Vercel'in ücretli Static IPs özelliğidir (proje başına ayda 100 $, Vercel belgesi 2026-09-26'da okundu). IP kısıtı yoksa Binance'in kendi kuralı geçerlidir (Binance duyurusu, 2021-07-26): anahtarın **Enable Spot & Margin Trading** izni etkinleştirmeden itibaren **90 gün** geçerlidir, sonra kendiliğinden kapanır — Binance'te yeniden aç, yoksa motor emir gönderemez. Binance ayrıca IP kısıtı olmayan ve 30 gün kullanılmayan anahtarların silindiğini bildirdi; panel **Ayarlar → Binance API anahtarı → Teknik ayrıntılar**<!-- ad:tabs.settings>key.heading>common.technicalDetails --> altında 30 günlük bir sayaç gösterir.

### Parolayı, doğrulayıcıyı (TOTP) ya da bir anahtarı kaybettim

- **Parola ya da TOTP:** eski `owner-credentials.txt` dosyasını kenara taşı, `npm run owner:credentials` komutunu yeniden koş, Vercel'deki `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET` ve `SESSION_SECRET` değerlerini yeni `vercel-env-owner.txt` dosyasının üç satırıyla değiştir ve yeniden dağıt. Açık oturumların hepsi kapanır; yeni TOTP kurulum anahtarını doğrulayıcı uygulamana ekle.
- **Durdurma anahtarı:** `stop-key.txt` dosyasını kenara taşı, `npm run stop:credential` koş, yeni karmayı `STOP_KEY_HASH` değerine yaz ve yeniden dağıt.
- **Ana anahtar kayboldu** (`ENCRYPTION_MASTER_KEY`): kayıtlı Binance anahtarı artık çözülemez ve kurtarılamaz. O API anahtarını Binance'te sil, `encryption-master-key.txt` dosyasını kenara taşı, `npm run key:encryption-master` koş, yeni değeri `ENCRYPTION_MASTER_KEY` olarak yaz, yeniden dağıt ve panelden yeni bir Binance anahtarı ekle. Eski ana anahtar hâlâ sende ve yalnız değiştirmek istiyorsan bunun yerine dönüşü (kurulum adımı 15) kullan.
- **Binance özel anahtarı kayboldu:** o API anahtarını Binance'te sil, eski `.pem` dosyalarını kenara taşı, `npm run key:generate` koş, yeni ortak anahtarla yeni bir API anahtarı oluştur ve panelden ekle.

### Nasıl kaldırırım ve ödemeyi nasıl durdururum?

Önce motoru durdur (**Durum**<!-- ad:tabs.status --> sekmesinde **DURDUR**<!-- ad:engine.stop --> ya da `/durdur`). Sonra:
- Binance'teki API anahtarını sil (Profile → API Management) — bu tek başına bütün işlem erişimini bitirir;
- Vercel projesini sil (Project → Settings → Delete Project) — bu dakikada bir çalışan zamanlanmış işi kaldırır; Vercel Pro'nun tek sebebi bu projeyse planı Vercel'in faturalama ayarlarından değiştir ya da iptal et;
- Neon projesini ve Upstash veritabanını kendi konsollarından sil;
- Anthropic API anahtarını iptal et.

`winvestour-backup` klasöründeki dosyalar yalnız bu kuruluma aittir; gerekmediğinde sil.

### Binance 451 "Service unavailable from a restricted location" dönüyor

Binance ABD konumlarından gelen istekleri engeller. `vercel.json` fonksiyonları bu yüzden `hnd1` (Tokyo) bölgesine sabitler; bölgeyi ABD'deki bir bölgeye çevirirsen Binance'e yapılan her çağrı 451 ile düşer ve motor bölgeyi engelli olarak bildirir.

### Bu yazılım yazarına bir şey gönderiyor mu?

Hayır. Yalnız Binance'i (senin anahtarınla), kendi Neon ve Upstash'ini ve Anthropic'i (senin anahtarınla) çağırır. Denetlemediği tek üçüncü taraf trafiği, maliyet bölümünde anlatılan Next.js derleme telemetrisidir; `NEXT_TELEMETRY_DISABLED=1` ile kapatabilirsin.

---

Kod katkısı ve pull request kabul edilmiyor; hata bildirimi, kurulum sorusu ve gizli güvenlik bildirimi açık — bkz. [CONTRIBUTING.md](CONTRIBUTING.md) ve `SECURITY.md`. Lisans: MIT (bkz. `LICENSE`); çatallayıp kendi kopyanı değiştirebilirsin.
