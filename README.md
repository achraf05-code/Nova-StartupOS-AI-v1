# Nova StartupOS AI — دليل التشغيل والإعداد البرمجي

> منصة **SaaS** ثابتة (Static) مبنية بـ **Vanilla JavaScript** ومدعومة بالكامل بـ **Supabase**
> (Auth + Database + Storage) مع **Edge Functions** آمنة لبث الذكاء الاصطناعي (AI Streaming).

---

## 📌 نظرة عامة على المشروع (Project Overview)

**Nova StartupOS AI** هو نظام تشغيل ذكي لمؤسّسي الشركات الناشئة (Startup Founders).
المنصّة عبارة عن **Single Page Application (SPA)** ثابتة لا تحتاج إلى أي خطوة بناء (No Build Step)،
وتعتمد كلياً على خدمات **Supabase** السحابية:

- **Authentication** — تسجيل الدخول بالبريد/كلمة المرور و **OAuth** (Google / GitHub).
- **Database (Postgres + RLS)** — تخزين الشركات، الوثائق، المستخدمين، وبيانات الإدارة.
- **Storage** — رفع شعارات الشركات (`startup-logos` bucket).
- **Edge Functions** — بث ردود الذكاء الاصطناعي عبر **SSE** بدون كشف مفاتيح الـ API في المتصفّح.

تتميّز المنصّة بوجود **Graceful Fallbacks**: إذا لم تُضبط مفاتيح Supabase بعد، يقلع التطبيق
بدون أخطاء ويبقى في الوضع التجريبي (Demo Mode).

---

## 🗂️ بنية الملفات والمعمارية (Folder & Architecture Structure)

```
StartUp Project/
├── index.html          # هيكل الـ SPA + روابط الـ CDN
├── css/                # نظام التصميم (Bootstrap + style.css + nova.css)
├── img/                # الصور والأصول الرسومية
├── webfonts/           # خطوط Font Awesome
├── js/
│   ├── api.js          # مركز الشبكة (Supabase Client + Auth + CRUD)
│   ├── main.js         # منسّق الواجهة (DOM + Auth Listener)
│   ├── admin.js        # محرّك لوحات الإدارة والتحليلات
│   ├── ai.js           # طبقة بث الذكاء الاصطناعي الآمنة (SSE)
│   ├── store.js        # طبقة التخزين المحلي (localStorage)
│   ├── wizard.js       # معالج إنشاء الشركات والـ Onboarding
│   └── export.js       # تصدير المستندات (PDF / DOCX / PPTX)
├── .env.example        # قالب متغيّرات البيئة
├── vercel.json         # إعدادات النشر على Vercel
└── README.md           # هذا الملف
```

### أدوار الملفات الأساسية (Core Files)

| الملف | الدور |
|------|-------|
| **`index.html`** | هيكل الـ **Single Page Application (SPA)** وكل اعتماديات الـ **CDN** (Bootstrap, jQuery, Chart.js, Supabase SDK). يحمّل الـ Supabase SDK في الـ `<head>` قبل أي سكربت مخصّص، ويُحمّل ملفات الـ JS في النهاية بالترتيب الصحيح. |
| **`api.js`** | **مركز الشبكة المركزي (Network Hub)**. يقوم بتهيئة عميل **Supabase Client**، وإدارة تعيينات المصادقة (**Auth Mappings**)، وكل عمليات الـ **CRUD** على الجداول (startups, profiles, generated_documents, admin tables…). |
| **`main.js`** | **منسّق الواجهة الأمامية (Frontend Coordinator)**. يدير تفاعلات الـ **DOM**، والتعديلات المحلية (**Local Mutations**)، ومستمع المصادقة الحيّ **`onAuthStateChange`** الذي يعيد بناء الجلسة تلقائياً بعد إعادة توجيه الـ OAuth. |
| **`admin.js`** | **محرّك الإدارة (Administrative Engine)**. يبني لوحات تحكّم الـ **Admin / Super Admin** ديناميكياً، ويدير الجداول، فلاتر التحليلات (Analytics Filters)، تذاكر الدعم، وإعدادات مزوّدي الـ AI والأمان. |
| **`ai.js`** | **طبقة الأمان (Security Layer)**. تتعامل مع بث **Server-Sent Events (SSE)** عبر **Edge Functions** بحيث لا يُكشف مفتاح الـ AI أبداً في المتصفّح، مع وضع تجريبي احتياطي (Demo Mode). |

---

## 🔑 إعدادات البيئة — أين تضع المفاتيح؟ (Environmental Configuration)

> المفتاح المطلوب هو **`SUPABASE_ANON_KEY`** وهو مفتاح **عام (public)** محمي بـ **Row-Level Security (RLS)**،
> لذا فوجوده في الواجهة الأمامية آمن. **لا تضع أبداً** مفتاح `service_role` في الواجهة.

صمّمنا داخل `api.js` ثلاث طرق مرنة لربط المفاتيح، وتُقرأ بالترتيب التالي حسب الأولوية:

### الطريقة 1️⃣ — متغيّرات النافذة (Window Globals) — موصى بها للإنتاج

أضف سكربت **Inline** داخل `index.html` **قبل** سطر تحميل `api.js`:

```html
<script>
  window.SUPABASE_URL = "https://your-project-id.supabase.co";
  window.SUPABASE_ANON_KEY = "your-anon-public-key";
</script>
<!-- ... ثم لاحقاً في نهاية الـ body ... -->
<script src="js/api.js"></script>
```

### الطريقة 2️⃣ — مفاتيح LocalStorage — مفيدة للاختبار المحلي

من خلال **DevTools Console** في المتصفّح:

```js
localStorage.setItem('nova.supabase_url', 'https://your-project-id.supabase.co');
localStorage.setItem('nova.supabase_anon_key', 'your-anon-public-key');
location.reload();
```

### الطريقة 3️⃣ — الثوابت داخل `api.js` (Inline Constants) — أبسط طريقة

عدّل القيم مباشرةً في أعلى ملف `js/api.js`:

```js
const SUPABASE_URL = global.SUPABASE_URL
  || localStorage.getItem('nova.supabase_url')
  || "https://your-project-id.supabase.co";   // ← ضع رابط مشروعك هنا

const SUPABASE_ANON_KEY = global.SUPABASE_ANON_KEY
  || localStorage.getItem('nova.supabase_anon_key')
  || "your-anon-public-key";                   // ← ضع المفتاح العام هنا
```

> 💡 **ملاحظة:** إذا بقيت القيم على شكل Placeholders، يُظهر التطبيق تحذيراً في الـ Console
> ويبقى يعمل في الوضع التجريبي دون انهيار.

---

## 🚀 دليل النشر (Deployment Guide)

### الخطوة 1 — تهيئة Git والـ Commit

```bash
cd "StartUp Project"
git init
git branch -M main
git add .
git status                 # تأكّد أنه لا يوجد ملف .env أو مفاتيح حقيقية في الـ staging
git commit -m "Nova StartupOS AI - production launch (Supabase static SPA)"
```

### الخطوة 2 — الرفع إلى مستودع GitHub خاص (Private)

باستخدام **GitHub CLI** (الأسهل):

```bash
gh auth login
gh repo create nova-startupos-ai --private --source=. --remote=origin --push
```

أو يدوياً (بعد إنشاء مستودع فارغ من واجهة GitHub):

```bash
git remote add origin https://github.com/<your-username>/nova-startupos-ai.git
git push -u origin main
```

### الخطوة 3 — الاستيراد إلى Vercel (Static Preset)

من لوحة تحكّم **Vercel → Add New… → Project → Import** ثم اضبط:

| الإعداد | القيمة |
|---------|--------|
| **Framework Preset** | `Other` |
| **Root Directory** | `./` |
| **Build Command** | (اتركه فارغاً — Override → blank) |
| **Output Directory** | (الافتراضي — Override → blank) |
| **Install Command** | (فارغ) |
| **Environment Variables** | لا حاجة لها (المفتاح العام مضمّن في الواجهة) |

ثم اضغط **Deploy**. يحترم Vercel ملف `vercel.json` (cleanUrls + Security Headers).

### الخطوة 4 — ربط Supabase بالدومين المباشر

في **Supabase Dashboard → Authentication → URL Configuration**:

- **Site URL:** `https://nova-startupos-ai.vercel.app`
- **Redirect URLs:** أضف `https://nova-startupos-ai.vercel.app` و `https://nova-startupos-ai.vercel.app/**`

> هذا ضروري لكي يعمل إعادة توجيه الـ **OAuth** (Google / GitHub) بشكل صحيح عبر `onAuthStateChange`.

### النشر المستقبلي (Continuous Deployment)

كل `git push` إلى فرع `main` يُطلق نشراً تلقائياً:

```bash
git add .
git commit -m "وصف التعديل"
git push
```

---

## ✅ التحقّق بعد النشر (Post-Deployment Verification)

1. افتح رابط الإنتاج وتأكّد من عدم وجود أخطاء في الـ **Console**.
2. سجّل الدخول، ثم **حدّث الصفحة (F5)** — يجب أن تبقى الجلسة محفوظة عبر `NovaApi.me()`.
3. جرّب الأمر التالي في الـ Console للتأكّد من الجلسة:

```js
await NovaApi.me();
(await NovaApi.supabase.auth.getSession()).data.session;
```

4. اختبر المسارات الحيّة: إنشاء شركة + رفع شعار، توليد خطة عمل (تظهر في Documents Center)،
   ولوحة الإدارة (Users / Tickets) للتأكّد من عمل قراءات Supabase تحت الـ RLS.

---

<div align="center">

**Nova StartupOS AI** — صُنع بشغف لمؤسّسي الشركات الناشئة 🚀

</div>
