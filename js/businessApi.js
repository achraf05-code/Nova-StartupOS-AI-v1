/* =====================================================================
   Nova StartupOS AI — Business OS API client (NovaBizApi)

   This module augments the existing NovaApi (js/api.js) with a Business
   OS surface — companies, projects, tasks, CRM, invoices, expenses,
   accounting, AI CFO, investors, funding rounds. It is loaded AFTER
   js/api.js and exposes itself as `window.NovaBizApi`. It also installs
   `NovaApi.biz` as a convenience alias so callers can use either path.

   No existing NovaApi method is modified. All access is RLS-enforced via
   the company_members table; policies live in supabase_schema_v3.sql.
   ===================================================================== */
(function (global) {
  'use strict';

  function getSupabase() {
    return global.NovaApi && global.NovaApi.supabase ? global.NovaApi.supabase : null;
  }

  function sbErr(error, fallback) {
    const e = new Error((error && error.message) || fallback || 'Supabase request failed.');
    e.status = error && (error.status || error.code);
    return e;
  }

  async function uid() {
    const sb = getSupabase();
    if (!sb) throw new Error('Authentication not configured.');
    const { data, error } = await sb.auth.getUser();
    if (error || !data || !data.user) throw new Error('Not signed in.');
    return data.user.id;
  }

  /* =================================================================
     COMPANIES
     ================================================================= */
  async function listCompanies() {
    const sb = getSupabase();
    // Membership-aware: companies RLS allows SELECT only where the user
    // is a member, so a plain SELECT returns exactly the right rows.
    const { data, error } = await sb
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }

  async function createCompany(payload) {
    payload = payload || {};
    const sb = getSupabase();
    const owner = await uid();
    const row = {
      owner_user_id: owner,
      name: payload.name,
      legal_name: payload.legal_name || null,
      logo_url: payload.logo_url || null,
      industry: payload.industry || null,
      country: payload.country || null,
      currency: payload.currency || 'USD',
      tax_id: payload.tax_id || null,
      tax_rate: payload.tax_rate != null ? Number(payload.tax_rate) : 0,
      email: payload.email || null,
      phone: payload.phone || null,
      website: payload.website || null,
      address: payload.address || null,
      settings: payload.settings || {},
    };
    if (!row.name) throw new Error('Company name is required.');
    const { data, error } = await sb.from('companies').insert(row).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function updateCompany(id, patch) {
    const sb = getSupabase();
    const safe = Object.assign({}, patch || {});
    delete safe.id;
    delete safe.owner_user_id;
    delete safe.created_at;
    if (safe.tax_rate != null) safe.tax_rate = Number(safe.tax_rate);
    const { data, error } = await sb.from('companies').update(safe).eq('id', id).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function deleteCompany(id) {
    const sb = getSupabase();
    const { error } = await sb.from('companies').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true, id };
  }

  async function uploadCompanyLogo(file) {
    if (!file) return null;
    const sb = getSupabase();
    const ext = file.name && file.name.includes('.') ? file.name.split('.').pop() : 'png';
    const uniq = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
    const path = uniq + '.' + ext;
    const { error: upErr } = await sb.storage.from('company-logos').upload(path, file, { cacheControl: '3600', upsert: false });
    if (upErr) throw sbErr(upErr);
    const { data } = sb.storage.from('company-logos').getPublicUrl(path);
    return data ? data.publicUrl : null;
  }

  async function listCompanyMembers(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('company_members')
      .select('id, role, joined_at, user_id, profile:profiles(id, name, email)')
      .eq('company_id', companyId)
      .order('joined_at', { ascending: true });
    if (error) throw sbErr(error);
    return (data || []).map((m) => ({
      id: m.id,
      role: m.role,
      joined_at: m.joined_at,
      user_id: m.user_id,
      name: (m.profile && m.profile.name) || (m.profile && m.profile.email) || 'Member',
      email: m.profile && m.profile.email,
    }));
  }

  async function addCompanyMember(companyId, email, role) {
    const sb = getSupabase();
    // Look up profile by email (RLS allows this only if the inviter
    // is an admin of the target company, and only once that user has
    // signed up — invitations to non-existent users are out of scope).
    const { data: prof, error: pErr } = await sb
      .from('profiles')
      .select('id, name, email')
      .ilike('email', email)
      .maybeSingle();
    if (pErr) throw sbErr(pErr);
    if (!prof) {
      const e = new Error('No registered user with that email. Ask them to sign up first.');
      e.status = 404;
      throw e;
    }
    const inviter = await uid();
    const { data, error } = await sb.from('company_members')
      .upsert({ company_id: companyId, user_id: prof.id, role: role || 'member', invited_by: inviter },
              { onConflict: 'company_id,user_id' })
      .select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function updateMemberRole(memberId, role) {
    const sb = getSupabase();
    const { data, error } = await sb.from('company_members')
      .update({ role }).eq('id', memberId).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function removeMember(memberId) {
    const sb = getSupabase();
    const { error } = await sb.from('company_members').delete().eq('id', memberId);
    if (error) throw sbErr(error);
    return { success: true };
  }

  /* =================================================================
     PROJECTS & TASKS
     ================================================================= */
  async function listProjects(companyId, opts) {
    opts = opts || {};
    const sb = getSupabase();
    let q = sb.from('projects').select('*').eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.archived === false) q = q.eq('archived', false);
    const { data, error } = await q;
    if (error) throw sbErr(error);
    return data || [];
  }

  async function createProject(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({ company_id: companyId, created_by: me }, payload || {});
    if (!row.name) throw new Error('Project name is required.');
    const { data, error } = await sb.from('projects').insert(row).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function updateProject(id, patch) {
    const sb = getSupabase();
    const safe = Object.assign({}, patch || {});
    delete safe.id; delete safe.company_id; delete safe.created_at;
    const { data, error } = await sb.from('projects').update(safe).eq('id', id).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function deleteProject(id) {
    const sb = getSupabase();
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }

  async function listTasks(companyId, opts) {
    opts = opts || {};
    const sb = getSupabase();
    let q = sb.from('tasks').select('*').eq('company_id', companyId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (opts.projectId) q = q.eq('project_id', opts.projectId);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.assignee) q = q.eq('assignee_user_id', opts.assignee);
    const { data, error } = await q;
    if (error) throw sbErr(error);
    return data || [];
  }

  async function createTask(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({ company_id: companyId, created_by: me, status: 'todo' }, payload || {});
    if (!row.title) throw new Error('Task title is required.');
    const { data, error } = await sb.from('tasks').insert(row).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function updateTask(id, patch) {
    const sb = getSupabase();
    const safe = Object.assign({}, patch || {});
    delete safe.id; delete safe.company_id; delete safe.created_at;
    const { data, error } = await sb.from('tasks').update(safe).eq('id', id).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  async function deleteTask(id) {
    const sb = getSupabase();
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }

  async function listTaskComments(taskId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('task_comments')
      .select('*, profile:profiles(name,email)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw sbErr(error);
    return (data || []).map(r => Object.assign({}, r, {
      author: (r.profile && r.profile.name) || (r.profile && r.profile.email) || 'Member',
    }));
  }

  async function addTaskComment(companyId, taskId, content) {
    const sb = getSupabase();
    const me = await uid();
    const { data, error } = await sb.from('task_comments')
      .insert({ company_id: companyId, task_id: taskId, user_id: me, content })
      .select().single();
    if (error) throw sbErr(error);
    return data;
  }

  /* =================================================================
     CRM
     ================================================================= */
  async function listContacts(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('crm_contacts').select('*')
      .eq('company_id', companyId).order('created_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveContact(companyId, payload) {
    const sb = getSupabase();
    const row = Object.assign({}, payload || {}, { company_id: companyId });
    if (!row.full_name) throw new Error('Contact name is required.');
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('crm_contacts').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('crm_contacts').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }
  async function deleteContact(id) {
    const sb = getSupabase();
    const { error } = await sb.from('crm_contacts').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }

  async function listDeals(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('crm_deals')
      .select('*, contact:crm_contacts(id, full_name, email, company_name)')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveDeal(companyId, payload) {
    const sb = getSupabase();
    const row = Object.assign({}, payload || {}, { company_id: companyId });
    if (!row.title) throw new Error('Deal title is required.');
    if (row.value_amount_cents != null) row.value_amount_cents = Math.round(row.value_amount_cents);
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('crm_deals').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('crm_deals').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }
  async function deleteDeal(id) {
    const sb = getSupabase();
    const { error } = await sb.from('crm_deals').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }
  async function listActivities(companyId, opts) {
    opts = opts || {};
    const sb = getSupabase();
    let q = sb.from('crm_activities').select('*')
      .eq('company_id', companyId)
      .order('occurred_at', { ascending: false }).limit(200);
    if (opts.dealId)    q = q.eq('deal_id', opts.dealId);
    if (opts.contactId) q = q.eq('contact_id', opts.contactId);
    const { data, error } = await q;
    if (error) throw sbErr(error);
    return data || [];
  }
  async function addActivity(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({ company_id: companyId, created_by: me }, payload || {});
    const { data, error } = await sb.from('crm_activities').insert(row).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  /* =================================================================
     INVOICES (with line items)
     ================================================================= */
  async function listInvoices(companyId, opts) {
    opts = opts || {};
    const sb = getSupabase();
    let q = sb.from('invoices').select('*').eq('company_id', companyId)
      .order('issue_date', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.type)   q = q.eq('type', opts.type);
    const { data, error } = await q;
    if (error) throw sbErr(error);
    return data || [];
  }
  async function getInvoice(invoiceId) {
    const sb = getSupabase();
    const { data: invoice, error: e1 } = await sb.from('invoices').select('*').eq('id', invoiceId).single();
    if (e1) throw sbErr(e1);
    const { data: items, error: e2 } = await sb.from('invoice_items')
      .select('*').eq('invoice_id', invoiceId).order('position', { ascending: true });
    if (e2) throw sbErr(e2);
    return Object.assign({}, invoice, { items: items || [] });
  }
  async function nextInvoiceNumber(companyId, type) {
    const sb = getSupabase();
    const prefix = type === 'quote' ? 'Q-' : type === 'proforma' ? 'PF-' : 'INV-';
    const yr = new Date().getFullYear();
    // Pull the latest numeric suffix and bump.
    const { data, error } = await sb.from('invoices')
      .select('number').eq('company_id', companyId).eq('type', type)
      .ilike('number', prefix + yr + '-%')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw sbErr(error);
    let next = 1;
    if (data && data[0]) {
      const m = String(data[0].number).match(/(\d+)$/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    return prefix + yr + '-' + String(next).padStart(4, '0');
  }
  function _calcTotals(items, taxRate, discountCents) {
    const subtotal = (items || []).reduce((s, it) => s + (Number(it.unit_price_cents) || 0) * (Number(it.quantity) || 0), 0);
    const taxable = Math.max(0, subtotal - (Number(discountCents) || 0));
    const tax = Math.round(taxable * (Number(taxRate) || 0) / 100);
    const total = taxable + tax;
    return { subtotal_cents: Math.round(subtotal), tax_cents: tax, total_cents: total };
  }
  async function saveInvoice(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    payload = payload || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    items.forEach((it, i) => {
      it.position = i;
      it.total_cents = Math.round((Number(it.unit_price_cents) || 0) * (Number(it.quantity) || 0));
    });
    const totals = _calcTotals(items, payload.tax_rate, payload.discount_cents);
    const head = {
      company_id: companyId,
      contact_id: payload.contact_id || null,
      type: payload.type || 'invoice',
      number: payload.number || (await nextInvoiceNumber(companyId, payload.type || 'invoice')),
      status: payload.status || 'draft',
      issue_date: payload.issue_date || new Date().toISOString().slice(0, 10),
      due_date: payload.due_date || null,
      client_name: payload.client_name || null,
      client_email: payload.client_email || null,
      client_address: payload.client_address || null,
      currency: payload.currency || 'USD',
      tax_rate: Number(payload.tax_rate) || 0,
      discount_cents: Math.round(Number(payload.discount_cents) || 0),
      notes: payload.notes || null,
      terms: payload.terms || null,
      created_by: me,
      ...totals,
    };
    let invoiceId = payload.id;
    if (invoiceId) {
      const { error } = await sb.from('invoices').update(head).eq('id', invoiceId);
      if (error) throw sbErr(error);
    } else {
      const { data, error } = await sb.from('invoices').insert(head).select().single();
      if (error) throw sbErr(error);
      invoiceId = data.id;
    }
    // Replace items: simple approach (delete + insert) for atomic save.
    const { error: dErr } = await sb.from('invoice_items').delete().eq('invoice_id', invoiceId);
    if (dErr) throw sbErr(dErr);
    if (items.length) {
      const rows = items.map((it) => ({
        invoice_id: invoiceId,
        position: it.position,
        description: it.description || '',
        quantity: Number(it.quantity) || 0,
        unit_price_cents: Math.round(Number(it.unit_price_cents) || 0),
        total_cents: it.total_cents,
      }));
      const { error: iErr } = await sb.from('invoice_items').insert(rows);
      if (iErr) throw sbErr(iErr);
    }
    return getInvoice(invoiceId);
  }
  async function updateInvoiceStatus(id, status, paidAmountCents) {
    const sb = getSupabase();
    const patch = { status };
    if (status === 'paid') {
      patch.paid_at = new Date().toISOString();
      if (paidAmountCents != null) patch.paid_amount_cents = Math.round(paidAmountCents);
    }
    const { data, error } = await sb.from('invoices').update(patch).eq('id', id).select().single();
    if (error) throw sbErr(error);
    return data;
  }
  async function deleteInvoice(id) {
    const sb = getSupabase();
    const { error } = await sb.from('invoices').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }

  /* =================================================================
     EXPENSES
     ================================================================= */
  async function listExpenseCategories(companyId) {
    const sb = getSupabase();
    // RLS allows: company-specific OR global defaults.
    const { data, error } = await sb.from('expense_categories')
      .select('*')
      .or('company_id.eq.' + companyId + ',company_id.is.null')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function listExpenses(companyId, opts) {
    opts = opts || {};
    const sb = getSupabase();
    let q = sb.from('expenses')
      .select('*, category:expense_categories(name, color, icon)')
      .eq('company_id', companyId)
      .order('occurred_at', { ascending: false });
    if (opts.from) q = q.gte('occurred_at', opts.from);
    if (opts.to)   q = q.lte('occurred_at', opts.to);
    if (opts.categoryId) q = q.eq('category_id', opts.categoryId);
    const { data, error } = await q;
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveExpense(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({}, payload || {}, { company_id: companyId, created_by: me });
    if (row.amount != null && row.amount_cents == null) row.amount_cents = Math.round(Number(row.amount) * 100);
    delete row.amount;
    if (!row.amount_cents || row.amount_cents <= 0) throw new Error('Amount is required.');
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('expenses').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('expenses').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }
  async function deleteExpense(id) {
    const sb = getSupabase();
    const { error } = await sb.from('expenses').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }
  async function uploadReceipt(file, companyId) {
    if (!file) return null;
    const sb = getSupabase();
    const ext = file.name && file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const uniq = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
    const path = (companyId || 'misc') + '/' + uniq + '.' + ext;
    const { error } = await sb.storage.from('receipts').upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw sbErr(error);
    const { data } = await sb.storage.from('receipts').createSignedUrl(path, 60 * 60 * 24 * 365);
    return data && data.signedUrl ? data.signedUrl : path;
  }

  /* =================================================================
     ACCOUNTING (financial transactions ledger)
     ================================================================= */
  async function listFinancialTransactions(companyId, opts) {
    opts = opts || {};
    const sb = getSupabase();
    let q = sb.from('financial_transactions').select('*').eq('company_id', companyId)
      .order('occurred_at', { ascending: false });
    if (opts.from) q = q.gte('occurred_at', opts.from);
    if (opts.to)   q = q.lte('occurred_at', opts.to);
    if (opts.type) q = q.eq('type', opts.type);
    const { data, error } = await q;
    if (error) throw sbErr(error);
    return data || [];
  }
  async function getFinancialSummary(companyId, opts) {
    opts = opts || {};
    const txs = await listFinancialTransactions(companyId, opts);
    let income = 0, expense = 0;
    txs.forEach((t) => {
      if (t.type === 'income')  income  += Number(t.amount_cents) || 0;
      if (t.type === 'expense') expense += Number(t.amount_cents) || 0;
    });
    return {
      revenue_cents: income,
      expense_cents: expense,
      profit_cents: income - expense,
      transactions: txs,
    };
  }
  async function getMonthlyFinanceSeries(companyId, months) {
    months = months || 12;
    const sb = getSupabase();
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    const { data, error } = await sb.from('financial_transactions')
      .select('type, amount_cents, occurred_at')
      .eq('company_id', companyId)
      .gte('occurred_at', since.toISOString().slice(0, 10));
    if (error) throw sbErr(error);
    const buckets = {};
    (data || []).forEach((r) => {
      const k = String(r.occurred_at).slice(0, 7);
      if (!buckets[k]) buckets[k] = { income: 0, expense: 0 };
      buckets[k][r.type === 'income' ? 'income' : 'expense'] += Number(r.amount_cents) || 0;
    });
    const out = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(since); d.setMonth(d.getMonth() + i);
      const k = d.toISOString().slice(0, 7);
      const b = buckets[k] || { income: 0, expense: 0 };
      out.push({ month: k, income_cents: b.income, expense_cents: b.expense, profit_cents: b.income - b.expense });
    }
    return out;
  }
  async function addManualTransaction(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({}, payload || {}, {
      company_id: companyId, source: 'manual', created_by: me,
    });
    const { data, error } = await sb.from('financial_transactions').insert(row).select().single();
    if (error) throw sbErr(error);
    return data;
  }

  /* =================================================================
     AI CFO REPORTS
     ================================================================= */
  async function listCfoReports(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('ai_cfo_reports').select('*')
      .eq('company_id', companyId).order('created_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveCfoReport(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({}, payload || {}, { company_id: companyId, created_by: me });
    if (!row.title) row.title = 'AI CFO Report';
    const { data, error } = await sb.from('ai_cfo_reports').insert(row).select().single();
    if (error) throw sbErr(error);
    return data;
  }
  async function deleteCfoReport(id) {
    const sb = getSupabase();
    const { error } = await sb.from('ai_cfo_reports').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }

  /* =================================================================
     INVESTORS / MEETINGS / FUNDING ROUNDS
     ================================================================= */
  async function listInvestors(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('investors').select('*')
      .eq('company_id', companyId).order('created_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveInvestor(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({ company_id: companyId, created_by: me }, payload || {});
    if (!row.name) throw new Error('Investor name is required.');
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('investors').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('investors').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }
  async function deleteInvestor(id) {
    const sb = getSupabase();
    const { error } = await sb.from('investors').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }
  async function listInvestorMeetings(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('investor_meetings')
      .select('*, investor:investors(name)')
      .eq('company_id', companyId)
      .order('scheduled_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveInvestorMeeting(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({ company_id: companyId, created_by: me }, payload || {});
    if (!row.scheduled_at) throw new Error('Meeting time is required.');
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('investor_meetings').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('investor_meetings').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }
  async function deleteInvestorMeeting(id) {
    const sb = getSupabase();
    const { error } = await sb.from('investor_meetings').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }
  async function listFundingRounds(companyId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('funding_rounds').select('*')
      .eq('company_id', companyId).order('created_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveFundingRound(companyId, payload) {
    const sb = getSupabase();
    const me = await uid();
    const row = Object.assign({ company_id: companyId, created_by: me }, payload || {});
    if (!row.name) throw new Error('Round name is required.');
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('funding_rounds').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('funding_rounds').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }
  async function deleteFundingRound(id) {
    const sb = getSupabase();
    const { error } = await sb.from('funding_rounds').delete().eq('id', id);
    if (error) throw sbErr(error);
    return { success: true };
  }
  async function listRoundCommitments(roundId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('funding_round_commitments')
      .select('*, investor:investors(name)')
      .eq('round_id', roundId)
      .order('committed_at', { ascending: false });
    if (error) throw sbErr(error);
    return data || [];
  }
  async function saveRoundCommitment(companyId, payload) {
    const sb = getSupabase();
    const row = Object.assign({ company_id: companyId }, payload || {});
    if (!row.round_id) throw new Error('Round is required.');
    if (row.amount_cents == null) throw new Error('Amount is required.');
    let res;
    if (row.id) { const id = row.id; delete row.id; res = await sb.from('funding_round_commitments').update(row).eq('id', id).select().single(); }
    else        res = await sb.from('funding_round_commitments').insert(row).select().single();
    if (res.error) throw sbErr(res.error);
    return res.data;
  }

  /* =================================================================
     EXECUTIVE DASHBOARD ROLLUP
     ================================================================= */
  async function getExecutiveSnapshot(companyId) {
    const sb = getSupabase();
    const [finance, openProjects, overdueTasks, openDeals, openInvoices, recentTx] = await Promise.all([
      getFinancialSummary(companyId),
      sb.from('projects').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).in('status', ['active', 'on_hold']),
      sb.from('tasks').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).neq('status', 'done')
        .lt('due_date', new Date().toISOString().slice(0, 10)),
      sb.from('crm_deals').select('value_amount_cents, stage')
        .eq('company_id', companyId).not('stage', 'in', '(won,lost)'),
      sb.from('invoices').select('id, total_cents, status')
        .eq('company_id', companyId).in('status', ['sent', 'overdue']),
      sb.from('financial_transactions').select('*')
        .eq('company_id', companyId).order('occurred_at', { ascending: false }).limit(10),
    ]);
    const pipelineCents = ((openDeals && openDeals.data) || []).reduce((s, d) => s + (Number(d.value_amount_cents) || 0), 0);
    const arOpenCents = ((openInvoices && openInvoices.data) || []).reduce((s, i) => s + (Number(i.total_cents) || 0), 0);
    return {
      revenue_cents: finance.revenue_cents,
      expense_cents: finance.expense_cents,
      profit_cents: finance.profit_cents,
      cash_flow_cents: finance.profit_cents,    // simplified; manual ledger entries roll in too
      open_projects: openProjects.count || 0,
      overdue_tasks: overdueTasks.count || 0,
      pipeline_cents: pipelineCents,
      ar_open_cents: arOpenCents,
      recent_transactions: (recentTx && recentTx.data) || [],
    };
  }

  /* =================================================================
     PUBLIC API
     ================================================================= */
  const NovaBizApi = {
    // companies
    listCompanies, createCompany, updateCompany, deleteCompany,
    uploadCompanyLogo, listCompanyMembers, addCompanyMember,
    updateMemberRole, removeMember,
    // projects
    listProjects, createProject, updateProject, deleteProject,
    // tasks
    listTasks, createTask, updateTask, deleteTask,
    listTaskComments, addTaskComment,
    // crm
    listContacts, saveContact, deleteContact,
    listDeals, saveDeal, deleteDeal,
    listActivities, addActivity,
    // invoices
    listInvoices, getInvoice, saveInvoice, updateInvoiceStatus, deleteInvoice,
    nextInvoiceNumber,
    // expenses
    listExpenseCategories, listExpenses, saveExpense, deleteExpense, uploadReceipt,
    // accounting
    listFinancialTransactions, getFinancialSummary, getMonthlyFinanceSeries,
    addManualTransaction,
    // CFO reports
    listCfoReports, saveCfoReport, deleteCfoReport,
    // investors
    listInvestors, saveInvestor, deleteInvestor,
    listInvestorMeetings, saveInvestorMeeting, deleteInvestorMeeting,
    listFundingRounds, saveFundingRound, deleteFundingRound,
    listRoundCommitments, saveRoundCommitment,
    // dashboard
    getExecutiveSnapshot,
  };

  global.NovaBizApi = NovaBizApi;
  // Convenience alias under NovaApi.biz so callers can use either.
  if (global.NovaApi && !global.NovaApi.biz) global.NovaApi.biz = NovaBizApi;
})(window);
