# Open-source, self-hosted crypto trading bot for Binance — bring your own API keys

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Italiano](README.it.md) · [Français](README.fr.md) · [العربية](README.ar.md)

عند التعارض يُعتدّ بالنص الإنجليزي.

<div dir="rtl">

<!-- readme:intro -->
## ما هذا

`winvestour-bot` محرك تداول صغير تشغّله **على حساباتك الخاصة**: يقرأ سوق Binance الفوري بمفتاح API **الخاص بك**، ويقرر وفق قواعد يكتبها نموذج Claude مرة يومياً، ويستطيع إرسال أوامر حقيقية على حسابك. كل تثبيت نسخة مستقلة — تبقى قاعدة البيانات ومفتاح Binance ومفتاح Claude API في استضافتك، ولا شيء في هذه النسخة يتصل بالمشرف. هو لشخص واحد يريد تشغيل محرك كهذا لنفسه، ويقرأ الكود أولاً، ويبدأ بمبلغ صغير.

**المحتويات:** [ما تحتاجه](#ما-تحتاجه) · [التثبيت بمساعدة مساعد ذكاء اصطناعي](#التثبيت-بمساعدة-مساعد-ذكاء-اصطناعي) · [التثبيت](#التثبيت) · [الاستخدام الأول](#الاستخدام-الأول) · [تكلفة التشغيل الشهرية](#تكلفة-التشغيل-الشهرية) · [الأسئلة الشائعة / حل المشكلات](#الأسئلة-الشائعة--حل-المشكلات) · [المساهمة](CONTRIBUTING.md)

<!-- readme:warning -->
### ⚠️ اقرأ قبل التثبيت

1. **هذا البرنامج ليس نصيحة مالية.** لا يُوعد بأي ربح. القياسات السابقة لا تدل على النتائج المستقبلية.
2. **يستطيع هذا البرنامج إرسال أوامر حقيقية بمال حقيقي من تلقاء نفسه.** في التثبيت الجديد يكون مسار الدخول **مُفعَّلاً افتراضياً.** لا يُرسَل أي أمر حتى تضيف مفتاح Binance الخاص بك ورأس مالك وإعدادات المخاطر. يمكنك إيقافه من اللوحة في أي وقت.
3. **خطر الخسارة حقيقي ويقع عليك بالكامل.** لا تستخدم مالاً تخشى خسارته.
4. يُقدَّم البرنامج **بترخيص MIT، "كما هو"**، دون أي ضمان من أي نوع. لا يتحمل المؤلف والمساهمون أي مسؤولية عن نتائج تداولك أو خسائرك أو الأعطال أو العيوب.
5. **الامتثال للقوانين مسؤوليتك.** تداول العملات المشفرة مقيَّد أو محظور في بعض الولايات القضائية؛ الالتزام بقانونك المحلي وبشروط استخدام Binance مسؤوليتك. هذا المشروع غير مرتبط بـ Binance ولم تعتمده Binance.
6. **الضرائب مسؤوليتك.**
7. لا تشغّله دون قراءة الكود واختباره أولاً بمبلغ صغير.

<!-- readme:need -->
## ما تحتاجه

- **حساب Vercel على خطة Pro.** يُدار المحرك بمهمة مجدولة تعمل **كل دقيقة** (`vercel.json`). خطة Hobby المجانية من Vercel تسمح بمهمة مجدولة **مرة واحدة يومياً** على الأكثر، وتقول وثائقها إن الجدولة الأكثر تكراراً *تفشل أثناء النشر* — أي أن النشر على Hobby لا يصل إلى الإنتاج. اقرأ أسعار Vercel وشروطها قبل الاختيار.
- **حساب Neon** (PostgreSQL). الخطة المجانية تكفي للجداول؛ يذكر قسم التكلفة أدناه ما تم قياسه.
- **حساب Upstash** (Redis). حصة الخطة المجانية تكفي لمركز مفتوح واحد في كل مرة.
- **مفتاح API من Anthropic.** يُستدعى النموذج الكاتب للقواعد ("الدماغ") مرة يومياً افتراضياً؛ يولد التثبيت الجديد بسقف تكلفة **فارغ**، وما دام فارغاً **لا** يُستدعى الدماغ.
- **مفتاح API من Binance من نوع Ed25519، مُنشأ دون صلاحية السحب.** يُرفض المفتاح الذي يُفعِّل السحب أو التحويل الشامل ولا يُخزَّن أبداً.
- **Node.js وnpm** على جهازك لأوامر الإعداد، ونحو **ساعة واحدة** إجمالاً.

لا تحمل هذه النسخة شيئاً من المشرف: لا يقرأ الكود أي اسم نطاق، لا يوجد اسم حزمة أندرويد ولا بصمة توقيع في عقد البيئة، وتولد متغيرات Firebase الثلاثة لإضافة إشعارات الدفع الاختيارية فارغة، لذلك تكون الإشعارات متوقفة. كل ما يلي يولد فارغاً، وتملؤه أنت بقيمك الخاصة.

| متغير البيئة | من أين تأتي القيمة |
|---|---|
| `DATABASE_URL` · `DIRECT_URL` | Neon ← مشروعك ← سلاسل الاتصال (مجمَّعة · مباشرة) |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Upstash ← قاعدة بياناتك ← REST API. إذا أضفت Upstash عبر Vercel Marketplace فإنه يضبط الاسمين `KV_REST_API_URL` و`KV_REST_API_TOKEN` بدلاً منهما؛ ويقرؤهما التطبيق أيضاً. |
| `ANTHROPIC_API_KEY` | Anthropic ← مفاتيح API (يبدأ بـ `sk-ant-`) |
| `OWNER_PASSWORD_HASH` · `OWNER_TOTP_SECRET` · `SESSION_SECRET` | الملف الذي تكتبه خطوة التثبيت 4 |
| `STOP_KEY_HASH` | الملف الذي تكتبه خطوة التثبيت 5 |
| `ENCRYPTION_MASTER_KEY` | الملف الذي تكتبه خطوة التثبيت 6 |
| `ENCRYPTION_KEY_VERSION` | `1` في التثبيت الجديد (يُرفع فقط عند تدوير المفتاح الرئيسي، الخطوة 15) |
| `ENCRYPTION_MASTER_KEY_PREVIOUS` | اتركه فارغاً؛ يُستخدم فقط أثناء تدوير المفتاح الرئيسي |
| `ENGINE_MODE` | `CHEAP` (نبضة واحدة كل دقيقة من المهمة المجدولة؛ الوضع الوحيد الذي يصفه هذا الملف) |

مفتاح Binance API **ليس** متغير بيئة: يُقدَّم عبر التطبيق بعد التثبيت ويُخزَّن في قاعدة بياناتك مشفَّراً بمفتاحك الرئيسي (انظر "الاستخدام الأول").

## التثبيت بمساعدة مساعد ذكاء اصطناعي

انسخ الكتلة أدناه كما هي والصقها في مساعد ذكاء اصطناعي (Claude أو ChatGPT أو Cursor أو ما يشبهها). سيأخذك عبر الخطوات المرقّمة في قسم التثبيت واحدةً تلو الأخرى، ويطلب منك التحقق من كل نتيجة، ولن يطلب منك أبداً لصق كلمة مرور أو مفتاح أو قيمة من `.env` في المحادثة. الكتلة بالإنجليزية عمداً وهي نفسها في كل نسخة لغوية من هذه الصفحة.

<div dir="ltr">

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

</div>

<!-- readme:install -->
## التثبيت

كل خطوة من الخطوات الـ15 أدناه تُنفَّذ قبل كل إصدار في نسخة نظيفة من هذا المستودع — الخطوات 1–14 عبر فحص التثبيت الآلي، الخطوة 15 عبر فحص تدوير المفتاح. الخطوة التي لا تُنفَّذ بهذه الطريقة لا تُكتب هنا.

1. أنشئ الحسابات اللازمة (نحو 30 دقيقة إجمالاً): حساب **Neon** (قاعدة بيانات PostgreSQL)، وحساب **Upstash** (Redis)، وحساب **Vercel** على **خطة Pro** (يشغّل التطبيق مهمة مجدولة كل دقيقة؛ على خطة Hobby المجانية يفشل النشر — انظر "ما تحتاجه")، ومفتاح API من **Anthropic**، ومفتاح API من **Binance** مُنشأ **دون صلاحية السحب**.

النتيجة المتوقعة: يمكنك تسجيل الدخول إلى الخدمات الخمس، ولا تتضمن صلاحيات مفتاح Binance API الخاص بك السحب.

2. احصل على الكود على جهازك: في صفحة هذا المستودع اختر **Code → Download ZIP** (أو استنسخه بعميل git الخاص بك)، ثم فك الضغط وافتح طرفية داخل ذلك المجلد.

النتيجة المتوقعة: يحتوي المجلد على `package.json` و`.env.example`.

3. ثبّت الاعتماديات من ملف القفل الخاص بالنسخة:

<div dir="ltr">

```sh
npm ci
```

</div>

النتيجة المتوقعة: ينتهي الأمر دون خطأ ويظهر مجلد `node_modules`.

4. أنشئ كلمة مرور المالك وسر TOTP وسر الجلسة. لا تُطبع أي قيمة، بل مسارات الملفات وبصمات قصيرة فقط؛ وتُكتب القيم في مجلد خارج المستودع (افتراضياً `winvestour-backup` في مجلدك الرئيسي، و`-- --dir <مجلد>` لمكان آخر):

<div dir="ltr">

```sh
npm run owner:credentials
```

</div>

النتيجة المتوقعة: يحتوي المجلد الآن على `owner-credentials.txt`, `vercel-env-owner.txt`؛ الأول يحمل كلمة مرورك ومفتاح إعداد TOTP لتطبيق المصادقة، والثاني الأسطر الثلاثة `NAME=value` للخطوة 9. لا تُطبع أي قيمة على الشاشة، فقط مسارات الملفات وبصمات قصيرة.

5. أنشئ مفتاح الإيقاف (يُكتب في المجلد نفسه ولا يُطبع):

<div dir="ltr">

```sh
npm run stop:credential
```

</div>

النتيجة المتوقعة: يظهر في المجلد `stop-key.txt`, `vercel-env-STOP_KEY_HASH.txt`؛ الأول يحمل مفتاح الإيقاف الخام الذي ستكتبه في شاشة الإيقاف، والثاني تجزئته للخطوة 9.

6. أنشئ المفتاح الرئيسي الذي يشفّر مفاتيح المنصة الخاصة بك (يُكتب في المجلد نفسه ولا يُطبع). إذا ضاع هذا المفتاح فلن تُفتح الصفوف المشفّرة مرة أخرى أبداً؛ احتفظ بنسخة ثانية في مدير كلمات المرور لديك:

<div dir="ltr">

```sh
npm run key:encryption-master
```

</div>

النتيجة المتوقعة: يظهر في المجلد `encryption-master-key.txt`, `vercel-env-ENCRYPTION_MASTER_KEY.txt`.

7. أنشئ زوج مفاتيح Ed25519 لمفتاح Binance API الخاص بك (يُكتب في المجلد نفسه؛ ولا يُطبع المفتاح الخاص):

<div dir="ltr">

```sh
npm run key:generate
```

</div>

النتيجة المتوقعة: يظهر في المجلد `binance-private-key.pem`, `binance-public-key.pem`. في Binance اختر Profile → API Management → Create API → **Self-generated** والصق محتوى الملف الثاني (المفتاح العام)؛ وتلصق الملف الأول (المفتاح الخاص) لاحقاً في اللوحة ("الاستخدام الأول").

8. أنشئ قاعدة بيانات PostgreSQL فارغة: في Neon أنشئ مشروعاً وانسخ سلسلتي الاتصال — تصبح المجمَّعة `DATABASE_URL` والمباشرة (غير المجمَّعة) `DIRECT_URL`. اختر المنطقة **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`): تعمل دوال التطبيق في طوكيو (`hnd1`، انظر `vercel.json`) ولا توجد لدى Neon منطقة في طوكيو؛ سنغافورة هي الأقرب (قائمة مناطق Neon، قُرئت في 2026-09-26).

النتيجة المتوقعة: سلسلتان تبدآن بـ `postgresql://`؛ لا توجد جداول في قاعدة البيانات بعد.

9. أعطِ كل اسم في `.env.example` قيمته — باستثناء `ENCRYPTION_MASTER_KEY_PREVIOUS` الذي يبقى فارغاً (يُستخدم فقط أثناء تدوير المفتاح الرئيسي)، وباستثناء المتغيرات الاختيارية الثلاثة `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` التي تبقى فارغة أيضاً ما لم تُضف مشروع Firebase الخاص بك لإشعارات الدفع (راجع القسم الخاص بذلك أدناه). مصدر كل قيمة موجود في الجدول تحت "ما تحتاجه"؛ وتأتي `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET`, `SESSION_SECRET`, `STOP_KEY_HASH`, `ENCRYPTION_MASTER_KEY` من ملفات الخطوات 4–6. للنشر أدخلها في Vercel تحت **Settings → Environment Variables**؛ وللتشغيل المحلي ضع الأسماء نفسها في ملف `.env` بجانب `package.json` (يتجاهل git هذا الملف). القيم لا تدخل المستودع أبداً.

النتيجة المتوقعة: لكل اسم في `.env.example` قيمة باستثناء `ENCRYPTION_MASTER_KEY_PREVIOUS` والأسماء الاختيارية الثلاثة `FIREBASE_*`. إذا غاب اسم إلزامي يتوقف التطبيق عند بدء التشغيل ويذكر المتغير الناقص.

10. أنشئ جداول قاعدة البيانات. شغّل هذا مرة واحدة من جهازك مع ضبط `DIRECT_URL` (في `.env` أو في الطرفية)؛ يكرر Vercel الأمر نفسه عند كل نشر، وهذا غير ضار:

<div dir="ltr">

```sh
npx prisma migrate deploy
```

</div>

النتيجة المتوقعة: ينتهي الإخراج بالسطر `All migrations have been successfully applied.` تُطبَّق ترحيلة واحدة باسم `0_baslangic`؛ يبدأ كل جدول إعدادات بصف واحد؛ وإعدادات المخاطر فارغة ومعطَّلة.

11. تحقق من أن الكود يُبنى على جهازك (يُنصح به قبل النشر):

<div dir="ltr">

```sh
npm run build
```

</div>

النتيجة المتوقعة: ينتهي الأمر بقائمة المسارات دون خطأ؛ ويظهر مجلد `.next`.

12. شغّله محلياً. عندما يعمل التطبيق افتح `http://localhost:3000/api/health` في متصفحك:

<div dir="ltr">

```sh
npm start
```

</div>

النتيجة المتوقعة: تعرض الصفحة `{"ok":true,"service":"engine",...}`، ويُفتح `http://localhost:3000/panel` ويقول إن اللوحة تحتاج جلسة. يُتحقق من عقد البيئة عند بدء الخادم: إذا غاب اسم إلزامي أو كان مشوَّهاً فلا يعمل الخادم، ويذكر الخطأ المتغير الناقص دون قيمته أبداً. أوقف الخادم بـ Ctrl+C. تشغيل البوت على حاسوبك غير مدعوم بعد: يُشغَّل المحرك بواسطة Vercel Cron. التشغيل المحلي للتحقق من التثبيت فقط.

13. انشر على Vercel: ادفع نسختك إلى حساب GitHub الخاص بك، ثم في Vercel اختر **Add New → Project → Import** لذلك المستودع، وأبقِ الإعداد المسبق للإطار **Next.js**، وأضف متغيرات البيئة من الخطوة 9، ثم اضغط **Deploy**. يشغّل Vercel السكربت `vercel-build`: يرفض أولاً أي ترحيلة قد تحذف بيانات، ثم ينشئ الجداول ويبني.

النتيجة المتوقعة: يصل النشر إلى **Ready**، ويعيد `https://<مشروعك>.vercel.app/api/health` القيمة `{"ok":true,...}`. على خطة Hobby يفشل النشر بدلاً من ذلك برسالة تفيد بأن تعبيرات cron التي تعمل أكثر من مرة يومياً غير مسموح بها.

14. افتح اللوحة عبر `/panel` على عنوانك، وشاشة الإيقاف عبر `/durdur`.

النتيجة المتوقعة: تُفتح الصفحتان بلغة متصفحك إذا كانت إحدى لغات هذا الملف السبع، وإلا فبالإنجليزية؛ ويمكنك التبديل من قائمة اللغة أعلى الصفحة. تقول اللوحة إنها تحتاج جلسة؛ وتُفتح شاشة الإيقاف دون جلسة وتطلب مفتاح الإيقاف. تابع مع "الاستخدام الأول".

15. اختياري، ليس جزءاً من الإعداد — تدوير المفتاح الرئيسي. إذا تسرّب مفتاحك الرئيسي أو أردت تغييره: أزح ملف النسخة الاحتياطية القديم جانباً، وشغّل الخطوة 6 مجدداً لإنشاء مفتاح جديد، ومرّر الجديد كـ `ENCRYPTION_MASTER_KEY` والقديم كـ `ENCRYPTION_MASTER_KEY_PREVIOUS`، وزد `ENCRYPTION_KEY_VERSION` بمقدار واحد. الوضع الافتراضي تشغيل تجريبي: لا يُكتب شيء، وتُقاس فقط إمكانية فك التشفير؛ أضف `-- --write` للكتابة فعلاً:

<div dir="ltr">

```sh
npm run rotate:encryption-key
```

</div>

النتيجة: يُفك تشفير كل صف بالمفتاح القديم ويُغلَّف من جديد بالمفتاح الجديد في معاملة خاصة به، ويُرفع إصداره؛ ويُتحقق من الغلاف الجديد بالمفتاح الجديد قبل كتابة أي شيء. عندما لا يبقى أي صف على الإصدار القديم يمكن حذف `ENCRYPTION_MASTER_KEY_PREVIOUS`. لا تُطبع قيمة أي مفتاح أبداً.

<!-- readme:first-use -->
## الاستخدام الأول

اللوحة وشاشة الإيقاف متاحتان باللغات السبع لهذا الملف — **English · Türkçe · Deutsch · Русский · Italiano · Français · العربية**<!-- ad:@langs --> (العربية من اليمين إلى اليسار)؛ اختر اللغة من قائمة **اللغة**<!-- ad:langSelect.label --> في أعلى اللوحة أو في شاشة تسجيل الدخول أو في شاشة الإيقاف — دون اختيار تُفتحان بلغة متصفحك، وإلا فبالإنجليزية. أسماء الشاشات والأزرار في هذا الملف مأخوذة من النص العربي للّوحة نفسها؛ عندما تكون العربية مختارة في القائمة تعرض اللوحة الأسماء نفسها. كل ما يلي يصف بدقة ما يفعله البرنامج اليوم؛ لا شيء هنا مخطط له أو موعود به. للّوحة أربعة تبويبات — **الحالة · الإعدادات · السجل · تقني**<!-- ad:tabs.status,tabs.settings,tabs.history,tabs.technical --> — وتُفتح على **الحالة**<!-- ad:tabs.status -->. أسماء الشاشات والأزرار مكتوبة أدناه كما تظهر تماماً.

**الإعدادات**<!-- ad:tabs.settings -->: كل إعداد في اللوحة — ما الذي يفعله، وقيمته الافتراضية، وهل يحتاج إلى الرمز لمرة واحدة، ومتى يسري — موصوف في صفحة [Settings guide](https://github.com/akaytaran/winvestour-bot/wiki/Settings-guide) في الويكي (بالإنجليزية)؛ وتظهر الشاشات في صفحة [Panel guide](https://github.com/akaytaran/winvestour-bot/wiki/Panel-guide).

### 1. تسجيل الدخول (كلمة مرور المالك، ثم رمز لمرة واحدة لكل إجراء حساس)

افتح `https://<مشروعك>.vercel.app/panel`. بدون جلسة تعرض اللوحة حقلاً واحداً **كلمة المرور**<!-- ad:login.password --> وزر **تسجيل الدخول**<!-- ad:login.submit -->: اكتب كلمة المرور من `owner-credentials.txt` (خطوة التثبيت 4) واضغط الزر — فتفتح الصفحة نفسها اللوحة. تدوم الجلسة **8 ساعات**. كلمة المرور الخاطئة تُظهر "كلمة المرور خاطئة، حاول مرة أخرى."<!-- ad:login.wrong -->. بعد **5** محاولات خاطئة يُقفل تسجيل الدخول وكل إجراء حساس لمدة **15 دقيقة** ("محاولات خاطئة كثيرة: قُفل تسجيل الدخول. حاول مرة أخرى بعد 15 دقيقة على الأكثر."<!-- ad:login.locked|minutes=15 -->)؛ ولا تُقفل شاشة الإيقاف أبداً. **تسجيل الخروج**<!-- ad:panel.signOut --> في أعلى اللوحة. الإجراءات الحساسة (إضافة مفتاح، تشغيل المحرك، تغيير الدخول، رفع تكلفة) تطلب أيضاً الرمز الحالي المكوَّن من 6 أرقام من تطبيق المصادقة، في الحقل "الرمز لمرة واحدة (6 أرقام) — من تطبيق المصادقة لديك"<!-- ad:common.codeLabel -->. أضف مفتاح إعداد TOTP من `owner-credentials.txt` إلى تطبيق المصادقة مرة واحدة.

### 2. اقرأ تبويب **الحالة**<!-- ad:tabs.status -->: حالة المحرك و"قبل أن تبدأ"<!-- ad:engine.beforeYouStart -->

تعرض بطاقة **حالة المحرك**<!-- ad:engine.label --> في الأعلى إحدى أربع حالات تُقرأ من الخادم: **يعمل**<!-- ad:engine.state.RUNNING.name --> · **متوقف**<!-- ad:engine.state.STOPPED.name --> (أوقفته أنت أو قاعدة حماية) · **لا يعمل**<!-- ad:engine.state.NO_PERMIT.name --> (لم يبدأ قط، أو انتهت صلاحية إذن التشغيل) · **غير معروف**<!-- ad:engine.state.UNKNOWN.name --> (تعذّرت قراءة الحالة؛ يُعرض **إيقاف**<!-- ad:engine.stop --> ولا يُعرض **تشغيل**<!-- ad:engine.start -->). تحتها تسرد **قبل أن تبدأ**<!-- ad:engine.beforeYouStart --> ما يحتاجه المحرك: **مفتاح Binance · فاصل النبضة · سقف التكلفة · تكلفة البنية التحتية · حصة المركز الواحد · التعرض الإجمالي**<!-- ad:prereq.names.key,prereq.names.tick,prereq.names.cap,prereq.names.infra,prereq.names.single,prereq.names.total --> — كل منها ✓ (تم) أو ✗ (ناقص) أو ? (تعذّرت قراءته) — إضافة إلى سطرين للمعلومات: **مفتاح الدخول**<!-- ad:prereq.names.entry --> و **رأس المال**<!-- ad:prereq.names.capital -->. ما دام أي سطر ✗ أو ?، يبقى زر **تشغيل**<!-- ad:engine.start --> مخفياً ويأخذك رابط "أولاً: …"<!-- ad:prereq.keyFix|pre --> إلى الإعداد. تظهر التحذيرات (مثل أمر حماية مفقود) تحت "انظر إلى هذه أولاً"<!-- ad:status.alertsHeading -->، ويعرض "نظرة سريعة"<!-- ad:status.summaryHeading --> آخر تشغيل للمحرك والمراكز المفتوحة والعمولة المدفوعة في هذه الفترة.

### 3. املأ تبويب **الإعدادات**<!-- ad:tabs.settings -->

- **مفتاح Binance API**<!-- ad:key.heading -->: أنشئ المفتاح أولاً. ولّد زوج Ed25519 بالأمر `npm run key:generate` (خطوة التثبيت 7) أو بمولّد مفاتيح Binance نفسه؛ في Binance افتح Profile → API Management → Create API → **Self-generated**، والصق المفتاح العام، وأعطه اسماً وأكمل التحقق بخطوتين. الصلاحيات: القراءة **مفعّلة** (المفتاح بلا قراءة يُرفض)، والتداول الفوري **مفعّل** ليتمكن المحرك من إرسال الأوامر، والعقود الآجلة فقط إن كنت تستخدمها، والسحب والتحويل الشامل **معطّلان**. في اللوحة افتح **الإعدادات → مفتاح Binance API → أضف مفتاحاً (يحتاج إلى الرمز لمرة واحدة)**<!-- ad:tabs.settings>key.heading>key.add -->، واملأ **الاسم**<!-- ad:key.fieldName|head --> و **مفتاح API**<!-- ad:key.fieldApiKey|head --> و **المفتاح الخاص**<!-- ad:key.fieldPrivate|head --> (المحتوى الكامل لـ `binance-private-key.pem`؛ يبقى الحقل مخفياً) والرمز لمرة واحدة، ثم اضغط **تحقّق من المفتاح واحفظه**<!-- ad:key.submit -->. يتحقق التطبيق من الصلاحيات في Binance قبل حفظ أي شيء؛ المفتاح الذي يُفعّل السحب أو التحويل الشامل يُرفض ("رُفض المفتاح: …"<!-- ad:key.withdrawals|pre -->) ولا يُحفظ في أي مكان. المفتاح المقبول يُحفظ مشفّراً بمفتاحك الرئيسي ولا يُعرض مرة أخرى أبداً. مع مفتاح جديد يستخدم المحرك الأحدث؛ احذف المفاتيح القديمة في Binance بنفسك.
- **فاصل النبضة — كم مرة يعمل المحرك**<!-- ad:tick.heading -->: يولد **فارغاً**؛ ولا يبدأ المحرك بدونه. افتح **غيّر (الأقل تكراراً لا يحتاج إلى رمز؛ الأكثر تكراراً يحتاج إلى رمز)**<!-- ad:tick.change --> واختر أحد الأزرار: **كل 1 أو 2 أو 3 دقائق**. يسري التغيير **خلال 20 دقيقة على الأكثر**، أو عند تشغيل المحرك مرة أخرى.
- **سقف التكلفة الشهري**<!-- ad:cap.heading -->: يولد **فارغاً**؛ وما دام فارغاً **لا يُستدعى** محرك القرار (Claude) إطلاقاً. ليعمل، افتح **غيّر السقف (…)**<!-- ad:cap.change|paren -->، وحدّد **سقف التكلفة الإجمالي الشهري**<!-- ad:cap.fieldTotal --> و **تكلفة البنية التحتية الشهرية (مجموع فواتيرك الخاصة لـ Neon وVercel وUpstash)**<!-- ad:cap.fieldInfra -->، واكتب كليهما بالدولار شهرياً. الخفض أو الإفراغ لا يحتاج رمزاً؛ والرفع يحتاج الرمز لمرة واحدة. يعرض **محرك القرار — النموذج · التكرار · المرشحون · الشموع**<!-- ad:brain.heading --> النموذج (`claude-opus-5` افتراضياً) وعدد مرات استدعائه (كل 24 ساعة افتراضياً).
- **حصص المخاطرة — المركز الواحد · التعرض الإجمالي**<!-- ad:caps.heading -->: تولدان **فارغتين** في التثبيت الجديد، ولا يُقترح أي رقم — الأرقام قرارك. كلتاهما نسبة مئوية من **رصيد USDT الحر لديك في Binance** (عملات USDT في محفظتك الفورية الخاصة التي ليست داخل مركز بعد): **حصة المركز الواحد**<!-- ad:prereq.names.single --> هي أقصى ما يمكن أن يستخدمه مركز جديد واحد؛ **التعرض الإجمالي**<!-- ad:prereq.names.total --> هي أقصى ما يمكن أن تستخدمه جميع المراكز المفتوحة معاً؛ ولا يجوز أن تكون حصة المركز الواحد أكبر من الإجمالي. في **الإعدادات → حصص المخاطرة**<!-- ad:tabs.settings>caps.historyGroup --> اكتب كل رقم بنفسك في **حصة المركز الواحد (نسبة مئوية من رصيد USDT الحر لديك)**<!-- ad:caps.singleLabel --> و**التعرض الإجمالي (نسبة مئوية من رصيد USDT الحر لديك)**<!-- ad:caps.totalLabel -->، واكتب الرمز لمرة واحدة واضغط **احفظ حصص المخاطرة**<!-- ad:caps.apply --> — كل حفظ يحتاج رمزاً جديداً. المسموح: رقم أكبر من الصفر بثلاث منازل عشرية على الأكثر؛ والحقل المتروك فارغاً يحتفظ بقيمته. تُقرأ القيم المحفوظة من الخادم من جديد؛ ثم يُظهر سطرا "قبل أن تبدأ"<!-- ad:engine.beforeYouStart --> العلامة ✓. يسري التغيير من قرار الدخول التالي للمحرك؛ وتحتفظ المراكز المفتوحة بحجمها.
- **مفتاح الدخول**<!-- ad:entry.heading -->: يولد **مُفعّل**<!-- ad:common.on --> — يمكن للمحرك فتح مراكز جديدة بقراره الخاص بمجرد ضبط كل شيء آخر. اضغط المفتاح لتغييره؛ عند تشغيله تظهر "اقرأ قبل التفعيل"<!-- ad:entry.readFirst --> مع التحذير من أعلى هذه الصفحة ومربع اختيار، والاتجاهان كلاهما يطلبان الرمز لمرة واحدة. في وضع **مُعطّل**<!-- ad:common.off --> يستمر المحرك في العمل وتستمر عمليات الخروج والحماية، لكن لا يُفتح أي مركز جديد ولا يُستدعى محرك القرار.
- **سقف الرافعة**<!-- ad:risk.fields.leverageCap --> و**اتجاه البيع على المكشوف**<!-- ad:risk.fields.shortMode -->: في التثبيت الجديد يولد سقف الرافعة **فارغًا** ويكون اتجاه البيع على المكشوف **شراء فقط**<!-- ad:risk.modes.NONE.label -->. ما دام سقف الرافعة فارغًا يبقى مسار العقود الآجلة مغلقًا: لا تُفتح أي صفقة برافعة، والبرنامج لا يختار رقمًا ولا يقترحه أبدًا. يشرح زر **i** بجانب كل سطر الإعداد. لتغييرهما افتح **غيّر هذا الإعداد (يحتاج إلى الرمز لمرة واحدة)**<!-- ad:risk.change -->؛ كل تغيير يتطلب الرمز لمرة واحدة. هذا الإصدار لا يخطط بعد لصفقات عقود آجلة من تلقاء نفسه: يُفحَص مسار أوامر العقود الآجلة على شبكة اختبار Binance Futures (حساب تدريبي بأموال اختبار، منفصل عن حسابك الحقيقي). استخدام العقود الآجلة بأموال حقيقية يومًا ما قرارك أنت.

### 4. رأس المال

يتداول المحرك بـ **USDT الحر في محفظتك الفورية على Binance**، لذا يحتاج المفتاح إلى **Enable Spot & Margin Trading**. حجم المركز الواحد هو **حصة المركز الواحد**<!-- ad:prereq.names.single --> × رصيد USDT الحر. ترفض Binance الأمر الذي يقل عن الحد الأدنى لقيمة الأمر للزوج (مرشح NOTIONAL)؛ ويقرأ المحرك هذا الحد من Binance قبل كل أمر — وكان في حساب القائم على المشروع **5 USDT** لمعظم الأزواج المفحوصة و 1 USDT لبعضها (قيس في 2026-09-10). إذا كانت الحصة × الرصيد الحر أقل منه فلا يُفتح أي مركز؛ ويستمر المحرك في العمل والحماية. لا تتصل اللوحة بـ Binance، لذا لا يمكنها هنا مقارنة الرصيد الحر اليوم بهذا الحد: يعرض سطر **رأس المال**<!-- ad:prereq.names.capital --> آخر قيمة حساب مقيسة. مقدار ما تودعه قرارك أنت.

### 5. تشغيل المحرك

عندما يكون كل سطر في "قبل أن تبدأ"<!-- ad:engine.beforeYouStart --> ✓ يعرض تبويب **الحالة**<!-- ad:tabs.status --> زراً أخضر **تشغيل**<!-- ad:engine.start -->. اضغطه، واكتب الرمز في "الرمز لمرة واحدة (6 أرقام) — الرمز من تطبيق المصادقة لديك"<!-- ad:engine.codeLabel --> واضغط **شغّل المحرك**<!-- ad:engine.startEngine -->. تعرض البطاقة عندها **يعمل**<!-- ad:engine.state.RUNNING.name --> و "قُبل التشغيل: يمكن للمحرك العمل حتى …"<!-- ad:engine.started|upto:until --> — تُعاد قراءة الحالة من الخادم ولا تُخمَّن. إذا لم يُختر فاصل التكات يكون الرد "لم يبدأ المحرك: لم يُختر فاصل النبضة."<!-- ad:engine.notStartedTick|s1 --> ولا يتغير شيء. ترتيب حذر: اجعل **مفتاح الدخول**<!-- ad:entry.heading --> على **مُعطّل**<!-- ad:common.off --> أولاً، وشغّل المحرك وراقب **يعمل**<!-- ad:engine.state.RUNNING.name --> ليوم كامل، ثم قرّر هل تفعّل الدخول.

### 6. إيقاف المحرك

أثناء عمل المحرك تعرض البطاقة زراً أحمر **إيقاف**<!-- ad:engine.stop -->: اختر **إيقاف فقط**<!-- ad:stop.modes.HOLD.title --> (لا مراكز جديدة؛ تبقى المراكز المفتوحة وأوامر حمايتها في المنصة كما هي) أو **إيقاف مع طلب الإغلاق**<!-- ad:stop.modes.CLOSE_ALL.title --> (يُسجَّل طلب الإغلاق؛ لا يغلق البرنامج المراكز بنفسه اليوم)، واكتب **مفتاح الإيقاف** من `stop-key.txt` (خطوة التثبيت 5 — وليس الرمز لمرة واحدة) واضغط **أوقف المحرك**<!-- ad:stop.sendPanel -->. إذا تعذّر فتح اللوحة فإن **شاشة الإيقاف** على `/durdur` ("Winvestour · أوقف المحرك"<!-- ad:stop.title -->) تفعل الشيء نفسه بلا جلسة ولا رمز: اختر تحت **ماذا يجب أن يحدث؟**<!-- ad:stop.legend -->، واكتب المفتاح في **مفتاح الإيقاف**<!-- ad:stop.keyLabel --> واضغط **إيقاف**<!-- ad:stop.send -->. لا يُحفظ المفتاح في المتصفح أبداً.

### 7. **السجل**<!-- ad:tabs.history --> و **تقني**<!-- ad:tabs.technical -->

يسرد **السجل**<!-- ad:tabs.history --> المراكز الأخيرة (الدخول، الحجم، العمولة، الإجمالي والصافي) وكل تغيير في الإعدادات (من، متى، القديم ← الجديد). ويحتفظ **تقني**<!-- ad:tabs.technical --> بكل التفاصيل المقيسة التي تقرؤها اللوحة — بطاقات المحرك والتشغيل والصحة وأسطر المراكز ومصدر كل رقم؛ وتأتي جُمل الخادم هذه أيضاً بلغة اللوحة.

### 8. ما ليس في هذا الإصدار

إشعارات الدفع متوقفة افتراضياً: تحتاج إلى مشروع Firebase الخاص بك — راجع قسم «اختياري: أضف مشروع Firebase الخاص بك لإشعارات الدفع» أدناه. القفل الحيوي موجود (**الإعدادات → القفل البيومتري**<!-- ad:tabs.settings>lock.heading -->، معطّل افتراضياً) ويحتاج إلى تحقق ببصمة الإصبع أو الوجه على الجهاز الذي تستخدمه. لا يوجد تطبيق أندرويد؛ اللوحة صفحة ويب يمكنك إضافتها إلى الشاشة الرئيسية لهاتفك. تشغيل البوت على حاسوبك غير مدعوم (يُشغَّل المحرك بواسطة Vercel Cron).

<!-- readme:cost -->
## تكلفة التشغيل الشهرية

كل رقم هنا مأخوذ من قياسات هذا البرنامج نفسه على نشر المشرف؛ لا شيء منها تقدير. مع تشغيل المحرك باستمرار في الوضع الاقتصادي، ومركز مفتوح واحد، واستدعاء الدماغ مرة يومياً، يبلغ الإجمالي المقيس **≈ 9,60 – 9,90 $ شهرياً** (Neon ≈ 5,30 $ · Vercel ≈ 1,50 $ حد أعلى · Upstash 0 $ ضمن الحصة المجانية · Anthropic ≈ 2,84 $). مع إيقاف المحرك، أو في تثبيت جديد بالإعدادات الافتراضية، يكون **≈ 0,24 – 0,60 $ شهرياً**. اشتراك Vercel **Pro** نفسه (**20 $ / شهر**، السعر مقروء في 2026-06-16) يُضاف فوق ذلك وهو أكبر بند منفرد. عمولات التداول والفارق السعري ليست في هذه الأرقام: فهي تكلفة الصفقة لا تكلفة تشغيل البرنامج.

<details>
<summary>التفصيل الكامل والافتراضات وتواريخ قراءة كل سعر</summary>

**تصح هذه الأرقام تحت مجموعة واحدة من الافتراضات:** يعمل المحرك باستمرار في الوضع الاقتصادي (نبضة كل دقيقة = 43 200 نبضة/شهر)، و**مركز واحد مفتوح** في كل مرة، ويُستدعى الدماغ (Claude) **مرة يومياً** (الإعداد الافتراضي: `claude-opus-5`، 24 ساعة)، وحوسبة قاعدة البيانات **0,25 CU**، وجميع الخدمات على خطط مدفوعة.

| البند | ما يدفع مقابله | شهرياً | بكلمات بسيطة: ما تم قياسه |
|---|---|---|---|
| **Neon** (Postgres) | الأوامر، المراكز، دفتر العمولات، سجل الأحداث | **≈ 5,30 $** | لا تبقى قاعدة البيانات مستيقظة طوال الوقت: لمسة واحدة تبقيها نشطة ≈ 330 ثانية، والمحرك لا يلمسها إلا كل 20 دقيقة. زمن الاستيقاظ المقيس **≈ 27,5 % من الشهر** ⇒ 0,25 CU × 720 س × 27,5 % × 0,106 $/CU-س. إذا تُرك على 1 CU يصبح البند نفسه **≈ 21 $**. |
| **Vercel** (الاستضافة) | الدالة الخادمية التي تعمل فيها كل نبضة | **≈ 1,50 $ حد أعلى** | 43 200 استدعاء شهرياً؛ كل استدعاء مقيس بـ **≈ 1 ثانية** (الرقم محسوب على حد أعلى 3 ثوانٍ) × 2 GB ذاكرة. لا يوجد خيار أصغر: أصغر حجم لدى المزوّد هو 2 GB. |
| **Upstash** (Redis) | إذن التشغيل، قفل التنفيذ، سجل النبضة، نسخة المركز | **0 $** | **5 أوامر لكل نبضة** (+2 لكل مركز مفتوح) ⇒ **≈ 302 000 أمر/شهر**؛ الحصة المجانية **500 000/شهر**. مع 4 مراكز متزامنة أو أكثر تُتجاوز الحصة: **≈ 0,10–0,30 $**. |
| **Anthropic** (Claude، "الدماغ") | توليد القواعد اليومي | **≈ 2,84 $** | **30 استدعاءً** شهرياً × **0,094750 $** لكل استدعاء. قُرئت الرموز لكل استدعاء **من استدعاء حقيقي**: **7 794 إدخال + 1 250 إخراج**. الاستدعاء الأكثر تكراراً يزيد خطياً: كل 12 س ≈ 5,69 $، كل 6 س ≈ 11,37 $. |
| **Binance** | بيانات السوق + إرسال الأوامر | **0 $** | وزن API مجاني. **عمولة التداول ليست في هذا الجدول** — فهي تكلفة الصفقة لا تكلفة تشغيل البرنامج، ويقيسها البرنامج منفصلة في كل صفقة. |
| **الإجمالي** | | **≈ 9,60 – 9,90 $ / شهر** | مجموع البنود. الحد الأدنى: Upstash ضمن الحصة المجانية. الحد الأعلى: تجاوز الحصة. |

**مع إيقاف المحرك / في تثبيت جديد (الإعدادات الافتراضية): ≈ 0,24 – 0,60 $ / شهر.** في التثبيت الجديد لا يمكن تشغيل المحرك (يولد فاصل النبضة فارغاً ويُرفض طلب التشغيل) ويولد سقف التكلفة فارغاً (لا يُستدعى الدماغ أبداً). في هذه الحالة ينتج البرنامج (محسوب من الكود، 2026-09-24): استدعاء خادم واحداً في الدقيقة (**1 440/يوم · 43 200/شهر**)، و**أمر Upstash واحداً** لكل استدعاء (يتحقق مما إذا كان مسموحاً للمحرك بالعمل)، و**0 استعلام قاعدة بيانات** (لا يُوقَظ Neon أبداً)، و**0 استدعاء Claude**. الفاتورة: استدعاءات Vercel 43 200 × 0,60 $/M = 0,03 $ + الذاكرة 2 GB × 0,53–1,43 ث مقيسة × 43 200 ÷ 3600 = 12,7–34,3 GB-س × 0,0167 $ = 0,21–0,57 $ ⇒ **≈ 0,24–0,60 $**؛ زمن CPU النشط **لم يُقَس** (لم يُكتب له رقم هنا). قِيس أن كل فتح للوحة يضيف 5 استعلامات قاعدة بيانات، وإيقاظاً واحداً لقاعدة البيانات، وأمرَي Upstash؛ وعدد مرات فتحك لها يعود إليك.

**متى قُرئ كل سعر (الأسعار تتغير — تحقق منها بنفسك):**
- Neon `neon.com/pricing` — **2026-09-11** (Launch 0,106 $/CU-س)، أُعيدت قراءته في **2026-09-24** (دون تغيير؛ خطة Free 100 CU-ساعة/شهر/مشروع)
- Vercel `vercel.com/docs/functions/usage-and-pricing` — **2026-06-16** (الذاكرة 0,0167 $/GB-س، CPU 0,202 $/س، الاستدعاءات 0,60 $/M)، أُعيدت قراءته في **2026-09-24** (دون تغيير)؛ `vercel.com/docs/cron-jobs/usage-and-pricing` — "Last updated July 15, 2026"، Hobby "once per day"
- Upstash `upstash.com/pricing/redis` — **2026-09-11** (مجاناً 500 000 أمر/شهر، ثم 0,20 $/100K)، أُعيدت قراءته في **2026-09-24** (دون تغيير)
- Anthropic `platform.claude.com/docs/en/about-claude/pricing` — **2026-09-11** (`claude-opus-5` 5 $ / 25 $ لكل MTok)

**قياسات البناء عن بُعد (Next.js):** لا يرسل هذا البرنامج شيئاً إلى المشرف. قد يرسل إطار Next.js الذي يستخدمه بيانات استخدام مجهولة إلى Next.js/Vercel أثناء `npm run build`؛ لا تصل تلك البيانات إلى مالك هذا المستودع. لإيقافها أضف `NEXT_TELEMETRY_DISABLED=1` إلى بيئة البناء لديك (المصدر: وثائق Next.js، https://nextjs.org/telemetry).
</details>

<details>
<summary>هل يتسع في الخطط المجانية؟ (من وثائق كل مزوّد فقط، مقروءة في 2026-09-24؛ لم يُفتح حساب ولم يُجرَّب شيء)</summary>

| المزوّد | الخطة المجانية (من الوثائق) | تثبيت جديد (المحرك غير مشغَّل) | المحرك يعمل (الافتراضات أعلاه) |
|---|---|---|---|
| **Vercel Hobby** | مليون استدعاء، 360 GB-س ذاكرة، 4 س CPU نشط شهرياً مشمولة؛ **cron مرة واحدة يومياً على الأكثر** | الاستدعاءات والذاكرة ضمن الحدود؛ **لكن المهمة المجدولة تعمل كل دقيقة، لذا يفشل النشر على Hobby** (الوثائق: "Cron expressions that would run more frequently will fail during deployment") ⇒ **لا يتسع** | **لا يتسع**، للسبب نفسه |
| **Neon Free** | **100 CU-ساعة** لكل مشروع شهرياً، 0,5 GB تخزين، يخمد بعد 5 دقائق خمول، حتى 2 CU | لا تُلمس قاعدة البيانات أبداً: **0 CU-ساعة ⇒ يتسع** | 0,25 CU × 720 س × 27,5 % استيقاظ مقيس = **≈ 49,5 CU-ساعة ≤ 100 ⇒ يتسع** (مشتق؛ لم يُقَس على الخطة المجانية). إذا اتسع يصبح بند Neon أعلاه 0 $ بدلاً من 5,30 $. |
| **Upstash Free** | **500 000 أمر** شهرياً، 256 MB، 10 GB نطاق | 43 200 أمر (8,6 %) ⇒ **يتسع** | ≈ 302 000 أمر (مركز مفتوح واحد) ⇒ **يتسع**؛ 4 مراكز أو أكثر لا تتسع |
| **Anthropic** | لا خطة مجانية | 0 استدعاء ⇒ 0 $ | بند Anthropic أعلاه |
</details>

<!-- readme:update -->
## التحديث

كل خطوة من الخطوات الـ4 أدناه تُنفَّذ قبل كل إصدار على نسخة مثبّتة من الإصدار 1.0.0 وفي قاعدة بياناتها بيانات — عبر فحص التحديث الآلي. الخطوة التي لا تُنفَّذ بهذه الطريقة لا تُكتب هنا.

1. احصل على الإصدار الجديد في المجلد الذي ثبّتّ منه. إذا كنت قد استنسخت هذا المستودع باستخدام git فشغّل هذا الأمر في ذلك المجلد؛ وإذا كنت قد نزّلت ملف ZIP فنزّل ملف ZIP الجديد بدلاً من ذلك، وفك ضغطه في مجلد جديد، وانسخ إليه ملف `.env` الخاص بك (إن كنت قد أنشأته)، وتابع هناك. قيمك ليست في الكود: يتجاهل git ملف `.env`، ومجلد النسخ الاحتياطية خارج المستودع، والقيم التي أدخلتها في Vercel تبقى في Vercel:

<div dir="ltr">

```sh
git pull
```

</div>

النتيجة المتوقعة: ينتهي الأمر دون تعارض ويعرض الملفات التي تغيّرت؛ وحقل `version` في `package.json` هو رقم الإصدار الجديد؛ وملف `.env` الخاص بك ما زال موجوداً.

2. ثبّت اعتماديات الإصدار الجديد:

<div dir="ltr">

```sh
npm ci
```

</div>

النتيجة المتوقعة: ينتهي الأمر دون خطأ.

3. طبّق تغييرات قاعدة البيانات في الإصدار الجديد من جهازك مع ضبط `DIRECT_URL` كما في خطوة التثبيت 10. تُطبَّق بالترتيب التغييرات التي لا تملكها قاعدة بياناتك بعد فقط؛ لا تُعاد إنشاء الجداول وتبقى الصفوف الموجودة:

<div dir="ltr">

```sh
npx prisma migrate deploy
```

</div>

النتيجة المتوقعة: ينتهي الإخراج بالسطر `All migrations have been successfully applied.` إذا جاء الإصدار الجديد بتغييرات في قاعدة البيانات، أو يقول `No pending migrations to apply.` إذا لم يأتِ بأي تغيير. تبقى حصص المخاطرة والإعدادات والسجل كما هي؛ والتحديث لا يشغّل المحرك ولا يفعّل أي شيء. إذا فشل الأمر فانظر صفحة Troubleshooting في الويكي.

4. انشر الإصدار الجديد: ادفع المجلد المحدَّث إلى مستودع GitHub الخاص بك بالطريقة نفسها كما في خطوة التثبيت 13؛ ويبنيه Vercel تلقائياً. يرفض السكربت `vercel-build` أولاً أي ترحيلة قد تحذف بيانات، ثم يشغّل أمر الترحيل نفسه مرة أخرى (غير ضار: لا شيء معلّق) ويبني. تبقى متغيرات البيئة التي أدخلتها في Vercel كما هي.

النتيجة المتوقعة: يصل النشر إلى **Ready**، ويعيد `https://<مشروعك>.vercel.app/api/health` القيمة `{"ok":true,...}`. تعرض اللوحة حالة المحرك نفسها التي كانت قبل التحديث: المحرك المتوقف يبقى متوقفاً. إذا احتاج الإصدار الجديد متغيراً غير موجود في نشرك فلا يعمل الخادم ويذكر الخطأ المتغير الناقص.

<!-- readme:firebase -->
## اختياري: أضف مشروع Firebase الخاص بك لإشعارات الدفع

إشعارات الدفع اختيارية و**متوقفة افتراضياً**. لا تحتوي هذه النسخة على أي مشروع Firebase ولا أي مفتاح Firebase ولا أي قيمة Firebase: تولد المتغيرات الثلاثة أدناه فارغة، وما دامت فارغة يعمل البرنامج بشكل طبيعي — تقول اللوحة **الإشعارات متوقفة: لم تتم إضافة Firebase**، ويُكتب كل إيقاف أو إنذار في تبويب السجل كما هو. لتشغيلها بمشروع Firebase الخاص بك اتبع الخطوات الـ4 أدناه؛ تُنفَّذ كل واحدة منها قبل كل إصدار عبر فحص آلي يستخدم بديلاً مُنشأً محلياً لملف حساب خدمة Firebase وبديلاً محلياً لـFirebase (لا يُستخدم حساب Firebase حقيقي). لإيقاف الإشعارات مجدداً احذف المتغيرات الثلاثة وأعد النشر. لا يقيس هذا البرنامج تكلفة Firebase نفسها؛ راجع صفحة أسعار Firebase.

1. في وحدة تحكم Firebase أنشئ مشروعاً خاصاً بك (أو افتح مشروعاً لديك)، وانتقل إلى **Project settings → Service accounts** واضغط **Generate new private key**. يُنزَّل ملف JSON. احفظه خارج مجلد المستودع ولا تُضِفه إلى أي commit أبداً: إنه سرّ مثل مفتاح Binance الخاص بك.

النتيجة المتوقعة: ملف `.json` تتضمن حقوله `project_id` و`client_email` و`private_key`.

2. في Vercel افتح مشروعك ← **Settings → Environment Variables** وأضف ثلاثة متغيرات، كلٌّ منها منسوخ من حقل ملف JSON ذاك: `FIREBASE_PROJECT_ID` ← `project_id` · `FIREBASE_CLIENT_EMAIL` ← `client_email` · `FIREBASE_PRIVATE_KEY` ← `private_key`. بالنسبة إلى `private_key` انسخ القيمة كاملة بما فيها السطر الأول والأخير؛ ويمكن أن تبقى تسلسلات `\n` كما هي. اضبط الثلاثة جميعاً أو لا تضبط أياً منها: إذا ضُبط بعضها فقط تبقى الإشعارات متوقفة وتذكر اللوحة اسم المتغير الناقص أو غير الصحيح (ولا تذكر قيمته أبداً).

النتيجة المتوقعة: الأسماء الثلاثة في القائمة؛ ولا تظهر قيمها في أي مكان في اللوحة ولا في السجلات.

3. أعد نشر المشروع لكي تُقرأ المتغيرات الجديدة (Vercel ← **Deployments** ← أحدث نشر ← **Redeploy**).

النتيجة المتوقعة: في اللوحة يذكر **الإعدادات → الإشعارات** أن الإشعارات مفعّلة.

4. لا يصل الإشعار إلا إلى جهاز سجّل رمز Firebase Cloud Messaging الخاص به لدى تثبيتك: `POST /api/device` بجلسة اللوحة والمحتوى `{"token": "<رمز الجهاز>", "platform": "web"}` (أو `"android"`). لا يوجد في هذه النسخة تطبيق يقوم بذلك نيابةً عنك — لا يوجد تطبيق أندرويد —، لذا فهذه الخطوة لمطوّر يبني عميله الخاص باستخدام Firebase. من دون جهاز مسجّل لا يُرسَل شيء، ويذكر سجلّ الإيقاف أو الإنذار ذلك.

النتيجة المتوقعة: يجيب العنوان بـ`{"ok":true,"devices":1,...}`؛ ويُسلَّم الإيقاف أو الإنذار التالي إلى ذلك الجهاز، ويذكر سجلّه أنه أُرسل.

<!-- readme:faq -->
## الأسئلة الشائعة / حل المشكلات

### يفشل النشر على Vercel برسالة حول تعبيرات cron

أنت على خطة Hobby. تقول وثائق Vercel إن تعبير cron الذي يعمل أكثر من مرة يومياً *يفشل أثناء النشر*؛ وجدول هذا البرنامج كل دقيقة ولا يمكن تغييره من اللوحة. انقل المشروع إلى فريق Pro، أو لا تشغّله على Vercel Hobby.

### لا يبدأ الخادم ويطبع "ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor"

متغير بيئة مفقود أو مشوَّه (رسالة الخادم هذه ما زالت بالتركية). تذكر الأسطر تحت الرسالة كل متغير وسبب رفضه (مثلاً مفتاح رئيسي ليس 44 حرفاً بترميز base64) — ولا تذكر قيمته أبداً. قارن أسماءك بـ `.env.example` وبالجدول تحت "ما تحتاجه".

### يعيد `/api/health` القيمة `{"ok":true,...}` لكن اللوحة تطلب كلمة مرور، ونقاط نهاية الإعدادات تعيد 401 مع `{"ok":false,"reason":"NO_SESSION"}`

هذه هي الحالة المتوقعة بدون جلسة. اكتب كلمة مرور المالك في حقل **كلمة المرور**<!-- ad:login.password --> في اللوحة واضغط **تسجيل الدخول**<!-- ad:login.submit --> (انظر "الاستخدام الأول")؛ فتفتح الصفحة نفسها اللوحة دون إعادة تحميل.

### لا يظهر **تشغيل**<!-- ad:engine.start -->، أو يقول المحرك "لم يبدأ المحرك: لم يُختر فاصل النبضة."<!-- ad:engine.notStartedTick|s1 -->

لا يظهر **تشغيل**<!-- ad:engine.start --> إلا عندما يكون كل سطر في "قبل أن تبدأ"<!-- ad:engine.beforeYouStart --> ✓. اتبع روابط "أولاً: …"<!-- ad:prereq.keyFix|pre -->. إذا كان فاصل التكات فارغاً (يولد فارغاً) فاختر واحداً في **الإعدادات → فاصل النبضة**<!-- ad:tabs.settings>prereq.names.tick --> وشغّل من جديد. في التثبيت الجديد تولد حصتا المخاطرة فارغتين: أدخلهما في **الإعدادات → حصص المخاطرة**<!-- ad:tabs.settings>caps.historyGroup --> (انظر "الاستخدام الأول"، الخطوة 3).

### يُرفض مفتاح Binance الخاص بي مع **P1_WITHDRAWALS** أو **P1_UNIVERSAL_TRANSFER** أو **KEY_TYPE_NOT_ED25519**

أنشئ في Binance مفتاح API جديداً من نوع **Ed25519** مع **تعطيل** السحب والتحويل الشامل، وأضفه في اللوحة. في اللوحة يظهر الرفض بصيغة "رُفض المفتاح: …"<!-- ad:key.withdrawals|pre --> ويذكر الصلاحية الواجب تعطيلها. المفتاح المرفوض لا يُحفظ ولا يُسجَّل.

### هل يجب أن أقيّد مفتاح Binance API بعنوان IP؟

ليس بعنوان ثابت في إعداد Vercel العادي: تستخدم دوال Vercel افتراضياً عناوين IP صادرة متغيّرة، والعناوين الصادرة الثابتة هي ميزة Static IPs المدفوعة في Vercel (100 دولار شهرياً لكل مشروع، وثائق Vercel قُرئت في 2026-09-26). بدون تقييد IP تسري قاعدة Binance نفسها (إعلان Binance بتاريخ 2021-07-26): صلاحية **Enable Spot & Margin Trading** للمفتاح صالحة **90 يوماً** من التفعيل ثم تُعطَّل تلقائياً — أعد تفعيلها في Binance وإلا فلن يتمكن المحرك من إرسال الأوامر. كما أفادت Binance بأن المفاتيح غير المقيّدة بـ IP التي لا تُستخدم 30 يوماً تُحذف؛ وتعرض اللوحة عدّاداً لـ 30 يوماً تحت **الإعدادات → مفتاح Binance API → التفاصيل التقنية**<!-- ad:tabs.settings>key.heading>common.technicalDetails -->.

### فقدت كلمة المرور أو المصادِق (TOTP) أو مفتاحاً

- **كلمة المرور أو TOTP:** أزح `owner-credentials.txt` القديم جانباً، وشغّل `npm run owner:credentials` مجدداً، واستبدل `OWNER_PASSWORD_HASH` و `OWNER_TOTP_SECRET` و `SESSION_SECRET` في Vercel بالأسطر الثلاثة من `vercel-env-owner.txt` الجديد، ثم أعد النشر. تنتهي كل الجلسات المفتوحة؛ أضف مفتاح إعداد TOTP الجديد إلى تطبيق المصادقة.
- **مفتاح الإيقاف:** أزح `stop-key.txt` جانباً، وشغّل `npm run stop:credential`، وضع التجزئة الجديدة في `STOP_KEY_HASH`، ثم أعد النشر.
- **فُقد المفتاح الرئيسي** (`ENCRYPTION_MASTER_KEY`): لم يعد ممكناً فك تشفير مفتاح Binance المحفوظ ولا استعادته. احذف مفتاح API ذاك في Binance، وأزح `encryption-master-key.txt` جانباً، وشغّل `npm run key:encryption-master`، وضع القيمة الجديدة في `ENCRYPTION_MASTER_KEY`، وأعد النشر، وأضف مفتاح Binance جديداً في اللوحة. إذا كان المفتاح الرئيسي القديم ما زال لديك وتريد تغييره فقط، فاستخدم التدوير (خطوة التثبيت 15) بدلاً من ذلك.
- **فُقد المفتاح الخاص لـ Binance:** احذف مفتاح API ذاك في Binance، وأزح ملفات `.pem` القديمة جانباً، وشغّل `npm run key:generate`، وأنشئ مفتاح API جديداً بالمفتاح العام الجديد وأضفه في اللوحة.

### كيف أزيل التثبيت وأتوقف عن الدفع؟

أوقف المحرك أولاً (**إيقاف**<!-- ad:engine.stop --> في تبويب **الحالة**<!-- ad:tabs.status -->، أو `/durdur`). ثم:
- احذف مفتاح API في Binance (Profile → API Management) — وهذا وحده ينهي كل وصول للتداول؛
- احذف مشروع Vercel (Project → Settings → Delete Project) — وهذا يزيل المهمة المجدولة التي تعمل كل دقيقة؛ وإذا كان هذا المشروع سببك الوحيد لـ Vercel Pro فغيّر الخطة أو ألغها من إعدادات الفوترة في Vercel؛
- احذف مشروع Neon وقاعدة بيانات Upstash من لوحتيهما؛
- ألغِ مفتاح Anthropic API.

الملفات في `winvestour-backup` تخص هذا التثبيت وحده؛ احذفها عندما لا تحتاجها.

### تعيد Binance الرمز 451 "Service unavailable from a restricted location"

تحظر Binance الطلبات القادمة من مواقع في الولايات المتحدة. لذلك يثبّت `vercel.json` الدوال في منطقة `hnd1` (طوكيو)؛ وإذا غيّرت المنطقة إلى منطقة أمريكية فسيفشل كل استدعاء إلى Binance بالرمز 451 ويُبلغ المحرك أن المنطقة محظورة.

### هل يرسل هذا البرنامج شيئاً إلى القائم عليه؟

لا. يستدعي فقط Binance (بمفتاحك)، و Neon و Upstash الخاصين بك، و Anthropic (بمفتاحك). حركة الطرف الثالث الوحيدة التي لا يتحكم بها هي قياس بناء Next.js الموصوف في قسم التكلفة، ويمكنك إيقافه بـ `NEXT_TELEMETRY_DISABLED=1`. وفقط إذا أضفت إضافة Firebase الاختيارية فإنه يستدعي أيضاً عناوين تسجيل الدخول لدى Google (OAuth) وFirebase Cloud Messaging بحساب الخدمة الخاص بك.

### يفشل `npx prisma migrate deploy` أثناء التحديث

إذا ظهر في المخرجات `Error: Connection url is empty.` فإن `DIRECT_URL` غير مضبوط في هذه الطرفية: ضع سلسلة اتصال Neon المباشرة (غير المجمّعة) في ملف `.env` بجوار `package.json` (كما في خطوة التثبيت 10)، أو اضبطها في الطرفية، وأعد تشغيل الأمر — لم يتغير شيء في قاعدة البيانات. ولأي رسالة أخرى: لا تعدّل ولا تحذف الملفات في `prisma/migrations` ولا تغيّر الجداول يدوياً؛ شغّل `npx prisma migrate status` لترى أي تغيير ما زال معلّقاً، واسأل في GitHub **Discussions → Q&A** (لا تلصق سلسلة الاتصال أبداً).

---

لا تُقبل مساهمات الشيفرة ولا طلبات السحب؛ أما بلاغات الأخطاء وأسئلة التثبيت وبلاغات الأمان الخاصة فمفتوحة — انظر [CONTRIBUTING.md](CONTRIBUTING.md) و`SECURITY.md`. الترخيص: MIT (انظر `LICENSE`)؛ يمكنك إنشاء نسخة متفرعة وتعديل نسختك.

</div>
