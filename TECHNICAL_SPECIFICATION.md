# Nova StartupOS AI — وثيقة المواصفات التقنية الرئيسية (Master Technical Specification)

> **النوع:** منصّة **SaaS** ثابتة (Static SPA) بـ **Vanilla JavaScript** — بدون خطوة بناء (No Build Step).
> **الخلفية (Backend):** **Supabase** (Auth + Postgres/RLS + Storage) + **Edge Functions** لبثّ الذكاء الاصطناعي.
> **الواجهة (Frontend):** Bootstrap 5.3 + نظام تصميم مخصّص (`style.css` / `nova.css`) + Chart.js.

هذه الوثيقة تشرح **منطق الأعمال (Business Logic)** و**آليات التنفيذ (Implementation Mechanics)** للطبقات التشغيلية الثلاث:
المستخدم (User)، المدير (Admin)، والمدير الأعلى (Super Admin).

---

## 🧭 المعمارية العامة (Global Architecture)

تعتمد المنصّة على نمط **Single Page Application** يُدار عبر تبديل أقسام `.db-section` بواسطة الدالة `dbNav(section, btn)`.
جميع نداءات الشبكة تمرّ عبر كائن مركزي واحد **`NovaApi`** (في `api.js`)، بينما تُدار الحالة المحلية عبر **`NovaStore`** (في `store.js`).

```
المستخدم → DOM (index.html)
        → main.js (تنسيق الواجهة + Auth Listener)
        → NovaApi (api.js) → Supabase (Auth / DB / Storage)
                            → Edge Function (nova-ai-stream) عبر ai.js
        → NovaStore (store.js) كطبقة عرض/احتياطي محلي
```

**التهيئة وإقلاع الجلسة:** عند `DOMContentLoaded` يستدعي `main.js` الدالة `NovaApi.me()` لاستعادة أي جلسة قائمة،
ثم يُسجّل مستمع المصادقة الحيّ **`onAuthStateChange`** الذي يلتقط أحداث `SIGNED_IN` / `TOKEN_REFRESHED` / `SIGNED_OUT`
لإكمال إعادة توجيه الـ **OAuth** وإعادة بناء الجلسة تلقائياً دون تحديث يدوي.

---

# القسم الأول: المواصفات التقنية للوحة المستخدم (User Dashboard)

## 1.1 إدارة الشركات (My Startups)

### دورة حياة بيانات معالج الإنشاء (Creation Wizard Data Lifecycle)

معالج الإنشاء (`NovaWizard` في `wizard.js`) يعمل على 4 خطوات (الأساسيات → السوق → المشكلة/الحل → المراجعة).
محدّد المرحلة (Stage Selector) مُوحّد على القيم التالية حصراً:

```js
['Idea', 'MVP', 'Early Stage', 'Growth', 'Scale']
```

**رفع الشعار (Logo Upload):** عند اختيار صورة، تلتقط `previewWizardLogo(input)` ملف الصورة الخام وتحتفظ به في
متغيّر النافذة `window._wzLogoFile` (للرفع لاحقاً)، مع توليد معاينة فورية عبر `FileReader`:

```js
function previewWizardLogo(input) {
  const file = input.files && input.files[0];
  window._wzLogoFile = file;                 // الملف الخام للرفع إلى Storage
  const reader = new FileReader();
  reader.onload = e => { box.innerHTML = `<img src="${e.target.result}" ...>`; window._wzLogoData = e.target.result; };
  reader.readAsDataURL(file);
}
```

عند الضغط على "Create Startup" تستدعي `wzFinish()` → `onStartupCreated(startup)` في `main.js`، التي ترسل البيانات إلى Supabase:

```js
NovaApi.createStartup({
  name, industry, country,
  current_stage: startup.stage,             // توحيد اسم العمود
  logoFile: window._wzLogoFile || null      // الملف الخام
});
```

**آلية الرفع `_uploadLogo` (في `api.js`):** تولّد اسم ملف فريد ثم ترفعه إلى الـ bucket `startup-logos`
وتُرجع الرابط العام (Public URL):

```js
async _uploadLogo(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png';
  const uniq = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
  const path = uniq + '.' + ext;
  await supabase.storage.from('startup-logos').upload(path, file, { cacheControl: '3600', upsert: false });
  const { data } = supabase.storage.from('startup-logos').getPublicUrl(path);
  return data ? data.publicUrl : null;       // يُحفظ في عمود logo_url
}
```

ثم تُدرَج الصفّة في جدول `startups` مع `user_id` المستخرج من `(await supabase.auth.getUser()).data.user.id`.

### توحيد البيانات (Normalization) عبر `mapStartupRow()`

نظراً لاختلاف تسمية الأعمدة بين قاعدة البيانات والواجهة القديمة، تُترجم كل صفّة عبر `mapStartupRow()`:

```js
function mapStartupRow(s) {
  return {
    name: s.name, industry: s.industry, country: s.country,
    stage: s.current_stage || s.stage || 'Idea',          // current_stage → stage
    logo:  s.logo_url || s.logo || null,                  // logo_url      → logo
    score: s.startup_score != null ? s.startup_score : 0, // startup_score → score
    scores: s.scores || {}, market: s.target_market || '', problem: s.problem || '', solution: s.solution || ''
  };
}
```

عند عرض البطاقة (`renderStartupCards`) يتم التراجع الآمن (Fallback) لأيقونة الصاروخ إذا كان `logo` فارغاً،
وتُطبع المرحلة من الحقل الموحّد `stage`.

### إجراءات التعديل (Edit) والحذف (Delete)

- **Edit (قلم):** `editStartup(id)` يضبط الشركة النشطة ويفتح نموذج تفاصيلها لإعادة التوليد.
- **Delete (سلّة):** `removeStartup(id)` يطلب تأكيداً، وفي وضع الـ Backend يحذف الصفّة من Supabase أولاً
  ثم محلياً ثم يعيد العرض:

```js
NovaApi.deleteStartup(remoteId).then(() => {
  NovaStore.deleteStartup(id); delete remoteMap.startups[id];
  renderWorkspaceUI(); renderStartupCards(); novaToast('Startup deleted.');
});
```

---

## 1.2 مركز الوثائق (Documents Center)

يُعرض القسم من جدول **`generated_documents`** عبر `NovaApi.getDocuments()`، ويُرسم بواسطة `paintBackendDocuments(rows, type)`.
تُصنّف الوثائق إلى ثلاثة أنواع (`doc_type`): خطة عمل (`plan`)، عرض تقديمي (`deck`)، ومحادثة (`chat`)، لكلٍّ منها أيقونته ولونه:

```js
const DOC_META = {
  plan: { ico: 'fa-file-lines',     color: '#a78bfa', label: 'Business Plan' },
  deck: { ico: 'fa-chalkboard-user', color: '#fbbf24', label: 'Pitch Deck' },
  chat: { ico: 'fa-robot',          color: '#34d399', label: 'Copilot Chat' }
};
```

**فلاتر الواجهة (Filter Pills):** أزرار `All / Business Plans / Pitch Decks` تستدعي `filterDocuments(type, btn)`
التي تخزّن `docFilter` وتعيد الرسم. كل بطاقة تحوي زر حذف يستدعي `deleteBackendDocument(id)` → `NovaApi.deleteDocument(id)`،
وبعد كل توليد جديد تُستدعى `refreshDocumentsCenter()` ليظهر الأصل فوراً.

**الحفظ التلقائي:** عند نجاح أي توليد (خطة/عرض/محادثة) تُستدعى `persistGeneratedDocument(docType, title, content)`:

```js
function persistGeneratedDocument(docType, title, content) {
  if (!(NOVA_BACKEND && NovaApi.saveDocument)) return;
  const startupRemote = remoteMap.startups[NovaStore.raw().activeStartupId] || null;
  NovaApi.saveDocument({ startup_id: startupRemote, doc_type: docType, title, content })
    .then(() => refreshDocumentsCenter());
}
```

---

## 1.3 مساعد الذكاء الاصطناعي (AI Copilot — Streaming)

البثّ يتمّ عبر **`NovaAI.generateStream`** (في `ai.js`) الذي **لا يكشف مفتاح الـ AI أبداً** في المتصفّح؛
بل يستخدم رمز جلسة المستخدم (Supabase JWT) لاستدعاء الـ **Edge Function** الآمنة:

```js
const token = (await supabase.auth.getSession()).data.session?.access_token;
if (!token) { onError(new Error('No active session.')); return; }

const res = await fetch(SUPABASE_URL + '/functions/v1/nova-ai-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
  body: JSON.stringify({ prompt, systemPrompt, model: defaultModel() }) // default: google/gemini-flash-1.5
});
```

**قراءة التدفّق (ReadableStream):** يُقرأ جسم الرد عبر `getReader()` و `TextDecoder`، وتُفكّك أسطر الـ **SSE** (`data: {...}`)
لاستخراج `choices[0].delta.content` وتغذيتها فوراً إلى `onChunk(delta)`:

```js
const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '', full = '';
while (true) {
  const { done, value } = await reader.read(); if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n'); buffer = lines.pop();
  for (const line of lines) {
    if (line.indexOf('data:') !== 0) continue;
    const data = line.slice(5).trim(); if (data === '[DONE]') continue;
    const json = JSON.parse(data);
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) { full += delta; onChunk(delta); }
  }
}
onDone(full);
```

**الرسوم المتحرّكة للفقاعة (Caret Bubble):** في `main.js` تُنشئ `startStreamBubble()` فقاعة تحمل صنف `.stream-caret`
(مؤشّر وامض عبر CSS)، ومع كل `delta` يُعاد عرض النص بـ `mdLite(acc)` (Markdown مبسّط: عريض، أكواد، أسطر) مع التمرير التلقائي.
عند `onDone` يُزال صنف الـ caret، ويُحفظ نصّ المحادثة في قاعدة البيانات كـ `doc_type: 'chat'`:

```js
const transcript = 'User: ' + msg + '\n\nNova: ' + (full || acc);
NovaApi.saveDocument({ startup_id: startupRemote, doc_type: 'chat', title: msg.slice(0,48), content: transcript })
  .then(() => refreshDocumentsCenter());
```

---

## 1.4 الفوترة والترقيات (Billing & Upgrades)

تُعرّف الباقات الثلاث في مصفوفة `BILLING_PLANS` (Free / Pro / Startup) مع السعر الشهري والميزات وعلامة `popular`.
تُرسم شبكة الترقية عبر `renderBilling()` التي:

- تحدّد الباقة النشطة من `currentUser.plan` لتعطيل زرّها وعرض "Current Plan".
- تعرض جدول **سجلّ المدفوعات** (`#billingHistoryTable`) من `BILLING_HISTORY`.
- تربط زر **"Select Plan"** بالدالة `selectPlan(id, name, price)` التي تحدّث شارات الباقة وتُشعر بأن الدفع
  مُدار من الخلفية (Checkout backend-driven).

**إلغاء الاشتراك:** `cancelPlan()` يطلب تأكيداً ثم يضبط حالة الباقة إلى "Cancels …" مع إبقاء الوصول حتى نهاية الدورة.

---

# القسم الثاني: المواصفات التقنية للوحة المدير (Admin Dashboard)

> تُحقَن أقسام المدير ديناميكياً عبر `admin.js` بدالة `NovaAdmin.applyRole(user)` عند توفّر `is_admin`،
> وتُبنى الروابط بادئتها `a-*`، وتُحمّل بياناتها عبر `NovaAdmin.load(section)`.

## 2.1 إدارة المستخدمين (User Management)

تُسحب الحسابات من جدول **`profiles`** عبر `adminGetUsers()`:

```js
async adminGetUsers() {
  const { data } = await supabase.from('profiles')
    .select('id, name, email, role, plan_tier, is_active, created_at')
    .order('created_at', { ascending: false });
  return data || [];
}
```

**التفعيل/التعليق (Activate/Suspend):** يُبدّل عبر `adminUpdateUserStatus(userId, isActive)` الذي يحدّث العمود المنطقي `is_active`.
أمّا زرّ الجدول فيستخدم `toggleUser(id)` الذي يقرأ الحالة الحالية ثم يعكسها. تقييم الأدوار يتمّ من العمود `role`
('User' / 'Admin' / 'Super Admin') ويُعرض كمصفوفة `roles` متوافقة مع نظام البوّابات القديم.
كما تتوفّر إجراءات **Edit** و **Delete** عبر `editUser` / `delUser`.

## 2.2 نظام تذاكر الدعم (Support Tickets — JSONB Schema)

كل تذكرة في جدول **`support_tickets`** تحوي حقل محادثة من نوع **JSONB** باسم `messages` على الشكل:

```json
[
  { "role": "user",  "content": "نص استفسار العميل", "at": "2026-06-05T..." },
  { "role": "admin", "content": "ردّ فريق الدعم",      "at": "2026-06-06T..." }
]
```

**جلب التذاكر:** `adminGetTickets()` تحاول جلب علاقة `profiles` لحلّ اسم/بريد العميل، مع تراجع آمن إلى اختيار عادي،
ثم تُمرّر كل صفّة عبر `normTicketRow` لتطبيع `user_name` / `user_email` وفكّ مصفوفة `messages`.

**دورة حياة الرد:** الضغط على **"Respond"** يستدعي `openTicket(index)` الذي يفتح النافذة الأصيلة `#ticketModal`،
يعرض المحادثة القائمة من `messages`، ثم `sendTicketReply()` يُلحق ردّ المدير بالمصفوفة ويحدّث الحالة:

```js
const messages = (activeTicket.messages || []).concat([{ role: 'admin', content: reply, at: new Date().toISOString() }]);
const status = close ? 'closed' : 'open';
NovaApi.adminReplyToTicket(activeTicket.id, messages, status).then(finish);
```

ودالة `adminReplyToTicket(ticketId, messageArray, status)` تحدّث حقلي `messages` و`status` معاً في الصفّة.

## 2.3 واجهة إدارة البيانات (CRUD Modals)

تمّ استبدال نوافذ المتصفّح القديمة `prompt()` بالكامل بنافذة أصيلة موحّدة **`#adminCrudModal`** بنمط `.nova-modal`.
تبني الدالة `openCrud(title, fields, onSubmit)` الحقول ديناميكياً (نص/قائمة/منطقة نص)، وعند الإرسال تجمع `submitCrud(e)` القيم
وتمرّرها للمعالج. تُستخدم هذه الآلية لإدارة:

- **المدوّنة (`blog_posts`)** — `newBlog` / `editBlog` (مع حقول العنوان، المقتطف، المتن، الحالة، وتاريخ الجدولة).
- **مصادر التمويل (`funding_sources`)** — `newFunding` (الاسم، النوع، الدولة، حجم التذكرة).
- **برامج التأشيرات (`visa_programs`)** — `newVisa` (الدولة، اسم البرنامج، درجة الملاءمة).

كل عملية حفظ تستدعي طرق Supabase المقابلة (`saveBlog` تدعم Insert/Update حسب وجود `id`).

## 2.4 مخطّط الإيرادات الحيّ (Real-time Revenue Chart)

يُلحق `<canvas id="adminRevenueChart">` أسفل بطاقات الإحصاء، ويُهيّأ عبر `drawRevenueChart(history)` بـ **Chart.js**
كمخطّط خطّي بتدرّج لوني (Gradient). يقرأ البيانات الحيّة من `d.revenue_history` ويتراجع إلى بيانات افتراضية لـ 12 شهراً:

```js
const data = (Array.isArray(history) && history.length) ? history
           : [4200, 5100, 6300, 5900, 7200, 8100, 9400, 10200, 11800, 12600, 13900, 15200];
revChart = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ data, borderColor: '#8b5cf6', fill: true, ... }] }, ... });
```

**إحصاءات اللوحة:** تُحسب أرقام البطاقات حيّاً عبر `adminGetStats()` التي تَعُدّ صفوف `profiles` و`startups` و`support_tickets`
باستخدام `{ count: 'exact', head: true }`، وتشتقّ الاشتراكات النشطة والإيراد التقديري.

---

# القسم الثالث: لوحة المدير الأعلى وضوابط بنية الذكاء الاصطناعي (Super Admin & AI Infrastructure)

> تُحقَن أقسام المدير الأعلى عند `is_super_admin` ببادئة `s-*`، ويهبط المدير الأعلى افتراضياً على قسم `s-ai`.

## 3.1 لوحة بوّابات الدفع (Payment Gateways — `#sec-s-gateways`)

تبني `loadGateways()` نموذجين (Stripe و PayPal) بنمط `.nova-panel`، يلتقطان مفاتيح الـ API والـ Client Secrets
ونقاط الـ Webhook، مع مفتاح تبديل **Sandbox/Live** (`.nova-switch`). عند الحفظ تجمع `saveGateway(name)` الحمولة وتدفعها إلى قاعدة البيانات:

```js
payload = { provider: 'stripe', publishable_key, secret_key, webhook_url, webhook_secret, live: liveToggle };
NovaApi.superAdminSaveGateway(payload);   // upsert على عمود provider في جدول payment_gateways
```

وتقوم `superAdminSaveGateway` بعملية **upsert** على جدول `payment_gateways` باستخدام `onConflict: 'provider'`.

## 3.2 محرّك DeepSeek وتتبّع التكلفة (Cost Tracking Engine)

شبكة مزوّدي الـ AI تشمل خمسة مزوّدين:

```js
const AI_PROVIDERS = ['openrouter', 'openai', 'anthropic', 'gemini', 'deepseek'];
```

تُقرأ الإعدادات من جدول **`ai_providers_config`** عبر `superAdminGetAIConfig()` ثم تُطبَّع بـ `normAiConfigRow`
(لتفادي قيم `undefined` في المفاتيح التبديلية). لكل مزوّد بطاقة تحوي: مفتاح تفعيل (`.nova-switch`)، حقل **Priority Order**،
و**Input Cost per 1K Tokens** و**Output Cost per 1K Tokens**. عند الحفظ تُحدّث `saveAi()` كل صفّ مزوّد على حدة:

```js
const fields = {
  enabled: !!checkbox.checked,
  priority: parseInt(prio),
  input_cost_per_1k:  parseFloat(cin),
  output_cost_per_1k: parseFloat(cout),
  is_default: (p === defaultProvider),
  default_model: (p === defaultProvider ? defaultModel : undefined)
};
NovaApi.superAdminUpdateAIConfig(p, fields);  // UPDATE ... WHERE provider_name = p
```

هذه القيم (التكلفة والأولوية والتفعيل) هي التي **تحكم منطق التوجيه (Routing Priority)** في دوال الـ AI الخلفية:
المزوّد ذو الأولوية الأعلى والتكلفة المناسبة يُختار أولاً لخدمة طلبات البثّ.

## 3.3 ضوابط الأمان وحركة المرور (Security & Traffic Controls)

**قوائم حظر الـ IP (`blocked_ips`):** تُحمّل عبر `superAdminGetBlockedIPs()`، ويُضاف عنوان جديد عبر `addBlockedIp()`
الذي يطبّق **تحقّقاً حيّاً (Live Validation)** لصيغة IPv4 قبل الإدراج:

```js
if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return novaToast('Enter a valid IPv4 address.');
NovaApi.superAdminBlockIP(ip, reason);   // insert { ip_address, reason, created_by }
```

ويُزال الحظر عبر `unblockIp(id)` → `superAdminUnblockIP(id)` (مع تجاهل العناصر المحلية/التجريبية).

**تحديد المعدّل (Rate Limiting):** نموذج يربط حدوداً لكل دور: **Free** مقابل **Pro**، بقيم عددية لكل دقيقة/ساعة
(`rlFreeMin`, `rlFreeHour`, `rlProMin`, `rlProHour`)، تُجمَع في `saveRateLimits()` استعداداً للربط مع قاعدة البيانات.

## 3.4 معمارية المراقبة الحيّة (Real-time Monitoring)

استُبدل النصّ الثابت "Operational" بأربع لوحات **Chart.js** حيّة يبنيها `drawMonitors()` داخل `#superMonitors`،
لمراقبة: **Database** و**AI Providers** و**Email Gateway** و**Storage**:

```js
const monitors = [
  { id: 'monDb',      label: 'Database',      color: '#a78bfa' },
  { id: 'monAi',      label: 'AI Providers',  color: '#34d399' },
  { id: 'monEmail',   label: 'Email Gateway', color: '#fbbf24' },
  { id: 'monStorage', label: 'Storage',       color: '#60a5fa' }
];
// لكل لوحة: مخطّط خطّي مصغّر (sparkline) بدون محاور، يحاكي تدفّق الحالة
new Chart(ctx, { type: 'line', data: { datasets: [{ data, borderColor: color, pointRadius: 0, tension: .4 }] },
  options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } }, animation: false } });
```

كل بطاقة تعرض مؤشّر حالة أخضر "Operational"، وتُحدّث أرقام بطاقات النظام (Users / Startups / AI Tokens / Active Subs)
من `adminGetStats()` لعرض أرقام حيّة.

---

## 🔐 ملاحظات أمنية ختامية (Security Notes)

- **مفتاح Supabase العام (Anon Key)** محمي بـ **Row-Level Security (RLS)**؛ آمن في الواجهة، بينما يُمنع منعاً باتاً وضع `service_role`.
- **مفاتيح الـ AI** لا تُكشف في المتصفّح إطلاقاً — كل البثّ يمرّ عبر **Edge Function** موثّقة بـ **JWT** المستخدم.
- بوّابات الإدارة في الواجهة هي طبقة عرض فقط؛ **الإنفاذ الحقيقي للأدوار يجب أن يتمّ عبر سياسات RLS** على مستوى قاعدة البيانات.

---

<div align="center">

**Nova StartupOS AI** — وثيقة المواصفات التقنية الرئيسية · إصدار الإطلاق (Production v1) 🚀

</div>
