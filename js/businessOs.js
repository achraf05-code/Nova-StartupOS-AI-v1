/* =====================================================================
   Nova StartupOS AI — Business OS (NovaBiz)

   Adds the Business OS modules (Companies, Projects, CRM, Invoices,
   Expenses, Accounting, AI CFO, AI Forecast, Investors, Funding Rounds,
   Executive Dashboard) into the existing single-page dashboard, reusing
   the Nova design system. Pattern mirrors js/admin.js (NovaAdmin):
     - Sidebar nav group injected on init.
     - Section panels appended to #dashboard .db-content.
     - Section ids prefixed `b-`. Routing: dbNav('b-*').
     - All data is fetched via NovaBizApi (js/businessApi.js).

   No existing user / admin functionality is modified. The Business OS
   is purely additive: a user can ignore it entirely and the platform
   continues to behave exactly as before.
   ===================================================================== */
(function (global) {
  'use strict';

  /* =================================================================
     STATE
     ================================================================= */
  const STATE = {
    user: null,
    companies: [],
    activeCompanyId: null,
    currency: 'USD',
    booted: false,
  };
  const ACTIVE_KEY = 'nova.activeCompanyId';

  /* =================================================================
     SMALL HELPERS
     ================================================================= */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function fmtMoney(cents, currency) {
    if (cents == null) cents = 0;
    const ccy = currency || STATE.currency || 'USD';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: ccy, maximumFractionDigits: 0 })
        .format((Number(cents) || 0) / 100);
    } catch (_) {
      return ((Number(cents) || 0) / 100).toFixed(2) + ' ' + ccy;
    }
  }
  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString(); } catch (_) { return '—'; }
  }
  function fmtDateTime(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch (_) { return '—'; }
  }
  function toast(msg, kind) {
    if (typeof global.novaToast === 'function') return global.novaToast(msg, kind);
    if (kind === 'error') console.error(msg); else console.log(msg);
  }
  function toastErr(e) { toast((e && e.message) || 'Operation failed.', 'error'); }
  function setBusy(el, busy, html) {
    if (!el) return;
    if (busy) {
      if (!el.dataset.html) el.dataset.html = el.innerHTML;
      el.disabled = true;
      el.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Working…';
    } else {
      el.disabled = false;
      el.innerHTML = html || el.dataset.html || el.innerHTML;
      delete el.dataset.html;
    }
  }
  function dbg() { /* hook for debugging — silent in prod */ }

  /* =================================================================
     COMPANY CONTEXT
     ================================================================= */
  function getActiveCompany() {
    return STATE.companies.find((c) => c.id === STATE.activeCompanyId) || null;
  }
  function setActiveCompany(id) {
    STATE.activeCompanyId = id;
    STATE.currency = (getActiveCompany() && getActiveCompany().currency) || 'USD';
    try { localStorage.setItem(ACTIVE_KEY, id || ''); } catch (_) {}
    syncCompanyChip();
    // Re-render whatever section is currently visible.
    const active = document.querySelector('.db-section.active');
    if (active && active.id && active.id.startsWith('sec-b-')) {
      load(active.id.replace('sec-', ''));
    }
  }
  function syncCompanyChip() {
    document.querySelectorAll('#bizCompanyChip, .bizCompanyChip').forEach((chip) => {
      const c = getActiveCompany();
      chip.innerHTML = c
        ? `<i class="fa-solid fa-building me-2" style="color:var(--pur)"></i><span>${esc(c.name)}</span> <span class="ms-2" style="color:var(--tx3);font-size:.75rem">${esc(c.currency || 'USD')}</span>`
        : `<i class="fa-solid fa-building me-2" style="color:var(--tx3)"></i><span style="color:var(--tx3)">No company</span>`;
    });
  }

  function companySelector() {
    if (!STATE.companies.length) return '';
    const opts = STATE.companies.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === STATE.activeCompanyId ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
    return `
      <div class="d-flex align-items-center gap-2 flex-wrap mb-3" style="font-size:.85rem">
        <label class="m-0" style="color:var(--tx3)"><i class="fa-solid fa-building me-1"></i>Active company</label>
        <select class="ninp mb-0" style="max-width:240px;height:36px;font-size:.85rem"
                onchange="NovaBiz.switchCompany(this.value)">${opts}</select>
        <button class="boc btn py-1 px-3" style="font-size:.78rem" onclick="NovaBiz.openCompanyEditor()">
          <i class="fa-solid fa-gear me-1"></i>Edit company
        </button>
      </div>`;
  }
  function emptyCompanyState(action) {
    return `
      <div class="nova-panel text-center" style="padding:48px 24px">
        <div style="font-size:2.4rem;color:var(--tx3);margin-bottom:8px">
          <i class="fa-solid fa-building"></i>
        </div>
        <h5 style="margin-bottom:6px">No company yet</h5>
        <p style="color:var(--tx3);max-width:420px;margin:0 auto 16px">
          Business OS modules are scoped to a company. Create your first company to enable
          ${esc(action || 'this module')}.
        </p>
        <button class="bgrd btn py-2 px-4" onclick="NovaBiz.openNewCompany()">
          <i class="fa-solid fa-plus me-1"></i>Create your first company
        </button>
      </div>`;
  }

  /* =================================================================
     INIT (called by main.js after auth)
     ================================================================= */
  async function init(user) {
    if (!user) return;
    STATE.user = user;
    if (STATE.booted) return;
    STATE.booted = true;
    buildNav();
    buildSections();
    syncCompanyChip();
    try {
      STATE.companies = await NovaBizApi.listCompanies();
    } catch (e) { dbg('listCompanies', e); STATE.companies = []; }
    let stored = '';
    try { stored = localStorage.getItem(ACTIVE_KEY) || ''; } catch (_) {}
    const valid = STATE.companies.find((c) => c.id === stored);
    STATE.activeCompanyId = valid ? stored : (STATE.companies[0] && STATE.companies[0].id) || null;
    STATE.currency = (getActiveCompany() && getActiveCompany().currency) || 'USD';
    syncCompanyChip();
    updateBadges();
  }
  function reset() {
    STATE.user = null;
    STATE.companies = [];
    STATE.activeCompanyId = null;
    STATE.currency = 'USD';
    STATE.booted = false;
  }

  /* =================================================================
     SIDEBAR NAV (idempotent)
     ================================================================= */
  function navBtn(section, icon, key, fallback, badgeId) {
    const badge = badgeId ? ` <span class="db-badge" id="${badgeId}">0</span>` : '';
    return `<button class="db-nl" onclick="dbNav('${section}',this)">
      <i class="fa-solid ${icon}"></i>
      <span data-i18n="${key}">${esc(fallback)}</span>${badge}
    </button>`;
  }
  function buildNav() {
    if (document.getElementById('bizNavGroup')) return;
    const userNav = document.getElementById('userNavGroup');
    if (!userNav) return;
    const g = document.createElement('div');
    g.id = 'bizNavGroup';
    g.innerHTML =
      '<div class="db-nav-section" data-i18n="section.business_os">Business OS</div>' +
      navBtn('b-executive', 'fa-chart-line',         'biz.nav.executive', 'Executive Dashboard') +
      navBtn('b-companies', 'fa-building',           'biz.nav.companies', 'Companies') +
      navBtn('b-projects',  'fa-diagram-project',    'biz.nav.projects',  'Projects', 'bizProjectCount') +
      navBtn('b-crm',       'fa-users-line',         'biz.nav.crm',       'CRM') +
      navBtn('b-invoices',  'fa-file-invoice-dollar','biz.nav.invoices',  'Invoices') +
      navBtn('b-expenses',  'fa-receipt',            'biz.nav.expenses',  'Expenses') +
      navBtn('b-accounting','fa-scale-balanced',     'biz.nav.accounting','Accounting') +
      navBtn('b-forecast',  'fa-wand-sparkles',      'biz.nav.forecast',  'AI Forecast') +
      navBtn('b-cfo',       'fa-user-tie',           'biz.nav.cfo',       'AI CFO') +
      navBtn('b-investors', 'fa-handshake',          'biz.nav.investors', 'Investors') +
      navBtn('b-rounds',    'fa-coins',              'biz.nav.rounds',    'Funding Rounds');
    userNav.appendChild(g);
    if (global.NovaI18n && typeof global.NovaI18n.applyTranslations === 'function') {
      global.NovaI18n.applyTranslations(document.getElementById('dbSidebar'));
    }
  }

  /* =================================================================
     SECTIONS HOST (idempotent)
     ================================================================= */
  function panel(id, title, body, opts) {
    opts = opts || {};
    return `<div class="db-section" id="sec-${id}">
      <div class="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h4 style="font-size:1.4rem;font-weight:700;margin-bottom:4px">${esc(title)}</h4>
          ${opts.subtitle ? `<p style="color:var(--tx3);margin:0">${esc(opts.subtitle)}</p>` : ''}
        </div>
        <div class="bizCompanyChip d-flex align-items-center"
             style="background:var(--bg3);border:1px solid var(--bd);border-radius:10px;padding:8px 14px;font-size:.85rem"></div>
      </div>
      ${body}
    </div>`;
  }
  function buildSections() {
    let host = document.getElementById('bizSections');
    if (!host) {
      const content = document.querySelector('#dashboard .db-content');
      if (!content) return;
      host = document.createElement('div');
      host.id = 'bizSections';
      content.appendChild(host);
    }
    host.innerHTML = [
      panel('b-executive', 'Executive Dashboard',
        '<div id="bizExecBody"></div>',
        { subtitle: 'Real-time view of revenue, projects, pipeline, and AI insights.' }),
      panel('b-companies', 'Companies',
        '<div class="d-flex justify-content-end mb-3"><button class="bgrd btn py-2 px-3" onclick="NovaBiz.openNewCompany()"><i class="fa-solid fa-plus me-1"></i>New Company</button></div>' +
        '<div id="bizCompaniesBody"></div>',
        { subtitle: 'Manage every company you operate. Each company is fully isolated by RLS.' }),
      panel('b-projects', 'Projects & Tasks',
        '<div id="bizProjectsBody"></div>',
        { subtitle: 'Plan, assign, and ship work. Kanban board with status, priority, and deadlines.' }),
      panel('b-crm', 'CRM — Sales Pipeline',
        '<div id="bizCrmBody"></div>',
        { subtitle: 'Contacts, deals, and activities. Track every lead from first touch to closed-won.' }),
      panel('b-invoices', 'Invoices, Quotes & Proformas',
        '<div id="bizInvoicesBody"></div>',
        { subtitle: 'Issue invoices, quotes, and proformas with automatic tax and PDF export.' }),
      panel('b-expenses', 'Expenses',
        '<div id="bizExpensesBody"></div>',
        { subtitle: 'Track every dollar that leaves the company. Categories, receipts, vendors.' }),
      panel('b-accounting', 'Accounting',
        '<div id="bizAccountingBody"></div>',
        { subtitle: 'Revenue, expenses, profit, and cash flow. Auto-fed from invoices and expenses.' }),
      panel('b-forecast', 'AI Financial Forecast',
        '<div id="bizForecastBody"></div>',
        { subtitle: 'Project the next 30 / 90 / 180 / 365 days based on your real ledger.' }),
      panel('b-cfo', 'AI CFO',
        '<div id="bizCfoBody"></div>',
        { subtitle: 'An AI Chief Financial Officer reviewing the business and recommending action.' }),
      panel('b-investors', 'Investor Relations',
        '<div id="bizInvestorsBody"></div>',
        { subtitle: 'Track investors, meetings, and funding conversations through every stage.' }),
      panel('b-rounds', 'Funding Rounds',
        '<div id="bizRoundsBody"></div>',
        { subtitle: 'Plan, run, and close fundraising rounds. Commitments tracked per investor.' }),
    ].join('');
  }

  /* =================================================================
     ROUTER (called from dbNav)
     ================================================================= */
  function load(section) {
    if (!section || !section.startsWith || !section.startsWith('b-')) return;
    syncCompanyChip();
    if (!STATE.activeCompanyId && section !== 'b-companies') {
      const target = document.getElementById('sec-' + section);
      if (target) {
        const body = target.querySelector(`[id^="biz"][id$="Body"]`);
        if (body) body.innerHTML = emptyCompanyState(section.replace('b-', ''));
      }
      return;
    }
    switch (section) {
      case 'b-executive':  return loadExecutive();
      case 'b-companies':  return loadCompanies();
      case 'b-projects':   return loadProjects();
      case 'b-crm':        return loadCrm();
      case 'b-invoices':   return loadInvoices();
      case 'b-expenses':   return loadExpenses();
      case 'b-accounting': return loadAccounting();
      case 'b-forecast':   return loadForecast();
      case 'b-cfo':        return loadCfo();
      case 'b-investors':  return loadInvestors();
      case 'b-rounds':     return loadRounds();
    }
  }

  /* =================================================================
     BADGES (sidebar count chips)
     ================================================================= */
  async function updateBadges() {
    if (!STATE.activeCompanyId) return;
    try {
      const projects = await NovaBizApi.listProjects(STATE.activeCompanyId, { archived: false });
      const open = projects.filter((p) => p.status === 'active').length;
      const el = document.getElementById('bizProjectCount');
      if (el) el.textContent = String(open);
    } catch (_) {}
  }

  /* =================================================================
     COMPANIES SECTION
     ================================================================= */
  async function loadCompanies() {
    const body = document.getElementById('bizCompaniesBody');
    if (!body) return;
    body.innerHTML = '<div class="nova-panel"><span class="spinner-border spinner-border-sm me-2"></span>Loading companies…</div>';
    try {
      const cos = await NovaBizApi.listCompanies();
      STATE.companies = cos;
      if (!cos.length) { body.innerHTML = emptyCompanyState('Business OS'); return; }
      body.innerHTML = renderCompaniesTable(cos);
    } catch (e) { body.innerHTML = `<div class="nova-panel" style="color:#f87171">${esc(e.message)}</div>`; }
  }
  function renderCompaniesTable(cos) {
    const rows = cos.map((c) => `
      <tr>
        <td><div class="d-flex align-items-center gap-2">
          ${c.logo_url ? `<img src="${esc(c.logo_url)}" alt="" style="width:28px;height:28px;border-radius:8px;object-fit:cover">`
                       : `<div style="width:28px;height:28px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--tx3)"><i class="fa-solid fa-building"></i></div>`}
          <div>
            <div style="font-weight:600">${esc(c.name)}</div>
            <div style="font-size:.72rem;color:var(--tx3)">${esc(c.legal_name || '—')}</div>
          </div>
        </div></td>
        <td>${esc(c.industry || '—')}</td>
        <td>${esc(c.country || '—')}</td>
        <td>${esc(c.currency || 'USD')}</td>
        <td style="white-space:nowrap">${fmtDate(c.created_at)}</td>
        <td class="text-end">
          ${c.id === STATE.activeCompanyId
            ? '<span class="bst son">Active</span>'
            : `<button class="boc btn py-1 px-2" style="font-size:.75rem" onclick="NovaBiz.switchCompany('${esc(c.id)}')">Switch</button>`}
          <button class="boc btn py-1 px-2 ms-1" style="font-size:.75rem" onclick="NovaBiz.openCompanyEditor('${esc(c.id)}')">Edit</button>
          <button class="boc btn py-1 px-2 ms-1" style="font-size:.75rem" onclick="NovaBiz.openCompanyMembers('${esc(c.id)}')">Members</button>
          <button class="boc btn py-1 px-2 ms-1" style="font-size:.75rem;color:#f87171" onclick="NovaBiz.deleteCompany('${esc(c.id)}')">Delete</button>
        </td>
      </tr>`).join('');
    return `
      <div class="nova-panel" style="overflow:auto">
        <table class="nova-table">
          <thead><tr><th>Name</th><th>Industry</th><th>Country</th><th>Currency</th><th>Created</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
  function openNewCompany() { openCompanyEditor(null); }
  function openCompanyEditor(id) {
    const c = (id && STATE.companies.find((x) => x.id === id)) || {};
    const isNew = !c.id;
    const html = `
      <div class="modal fade" tabindex="-1" id="bizCompanyModal" data-bs-backdrop="static">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content nova-panel" style="border-radius:14px">
            <div class="modal-header" style="border-bottom:1px solid var(--bd)">
              <h5 class="modal-title">${isNew ? 'New Company' : 'Edit Company'}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="row g-3">
                ${field('coName', 'Name *', c.name)}
                ${field('coLegal', 'Legal name', c.legal_name)}
                ${field('coIndustry', 'Industry', c.industry)}
                ${field('coCountry', 'Country', c.country)}
                ${field('coCurrency', 'Currency (e.g. USD, EUR)', c.currency || 'USD', { col: 4 })}
                ${field('coTaxRate', 'Tax rate %', c.tax_rate || 0, { col: 4, type: 'number', step: '0.01' })}
                ${field('coTaxId', 'Tax ID / VAT', c.tax_id, { col: 4 })}
                ${field('coEmail', 'Billing email', c.email)}
                ${field('coPhone', 'Phone', c.phone)}
                ${field('coWebsite', 'Website', c.website, { col: 12 })}
                ${field('coAddress', 'Address', c.address, { col: 12, type: 'textarea' })}
                <div class="col-md-6">
                  <label class="nlbl">Logo</label>
                  <input class="ninp" type="file" id="coLogoFile" accept="image/*">
                </div>
              </div>
            </div>
            <div class="modal-footer" style="border-top:1px solid var(--bd)">
              <button class="boc btn py-2 px-3" data-bs-dismiss="modal">Cancel</button>
              <button class="bgrd btn py-2 px-4" id="coSaveBtn" onclick="NovaBiz._saveCompany('${esc(c.id || '')}')">
                <i class="fa-solid fa-floppy-disk me-1"></i>${isNew ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>`;
    mountModal('bizCompanyModal', html);
  }
  async function _saveCompany(id) {
    const v = (i) => (document.getElementById(i) || {}).value || '';
    const payload = {
      name: v('coName').trim(),
      legal_name: v('coLegal').trim() || null,
      industry: v('coIndustry').trim() || null,
      country: v('coCountry').trim() || null,
      currency: (v('coCurrency').trim() || 'USD').toUpperCase().slice(0, 8),
      tax_rate: Number(v('coTaxRate')) || 0,
      tax_id: v('coTaxId').trim() || null,
      email: v('coEmail').trim() || null,
      phone: v('coPhone').trim() || null,
      website: v('coWebsite').trim() || null,
      address: v('coAddress').trim() || null,
    };
    if (!payload.name) return toast('Name is required.', 'error');
    const btn = document.getElementById('coSaveBtn');
    setBusy(btn, true);
    try {
      const file = document.getElementById('coLogoFile') && document.getElementById('coLogoFile').files[0];
      if (file) payload.logo_url = await NovaBizApi.uploadCompanyLogo(file);
      let saved;
      if (id) saved = await NovaBizApi.updateCompany(id, payload);
      else    saved = await NovaBizApi.createCompany(payload);
      STATE.companies = await NovaBizApi.listCompanies();
      if (!STATE.activeCompanyId) STATE.activeCompanyId = saved.id;
      syncCompanyChip();
      closeModal('bizCompanyModal');
      toast(id ? 'Company updated.' : 'Company created.');
      loadCompanies();
    } catch (e) { toastErr(e); }
    finally { setBusy(btn, false, '<i class="fa-solid fa-floppy-disk me-1"></i>Save'); }
  }
  async function deleteCompany(id) {
    const c = STATE.companies.find((x) => x.id === id);
    if (!c) return;
    if (!confirm(`Delete "${c.name}"? This will cascade-delete every project, invoice, expense, contact, and report for this company. This cannot be undone.`)) return;
    try {
      await NovaBizApi.deleteCompany(id);
      STATE.companies = await NovaBizApi.listCompanies();
      if (STATE.activeCompanyId === id) {
        STATE.activeCompanyId = (STATE.companies[0] && STATE.companies[0].id) || null;
        try { localStorage.setItem(ACTIVE_KEY, STATE.activeCompanyId || ''); } catch (_) {}
      }
      syncCompanyChip();
      toast('Company deleted.');
      loadCompanies();
    } catch (e) { toastErr(e); }
  }
  function switchCompany(id) {
    if (!id) return;
    setActiveCompany(id);
    toast('Switched company.');
  }

  /* =================================================================
     COMPANY MEMBERS
     ================================================================= */
  async function openCompanyMembers(companyId) {
    const co = STATE.companies.find((x) => x.id === companyId);
    if (!co) return;
    const html = `
      <div class="modal fade" tabindex="-1" id="bizMembersModal">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content nova-panel" style="border-radius:14px">
            <div class="modal-header" style="border-bottom:1px solid var(--bd)">
              <h5 class="modal-title">${esc(co.name)} — Members</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="d-flex gap-2 mb-3 flex-wrap">
                <input id="bizMemberEmail" class="ninp mb-0" placeholder="user@example.com" style="max-width:280px">
                <select id="bizMemberRole" class="ninp mb-0" style="max-width:160px">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button class="bgrd btn py-2 px-3" onclick="NovaBiz._addMember('${esc(companyId)}')">
                  <i class="fa-solid fa-user-plus me-1"></i>Invite
                </button>
              </div>
              <div id="bizMembersTable" class="nova-panel" style="overflow:auto;padding:0">
                <div style="padding:24px;text-align:center;color:var(--tx3)">Loading…</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    mountModal('bizMembersModal', html);
    refreshMembers(companyId);
  }
  async function refreshMembers(companyId) {
    try {
      const list = await NovaBizApi.listCompanyMembers(companyId);
      const rows = list.map((m) => `
        <tr>
          <td>${esc(m.name)}</td>
          <td style="color:var(--tx3)">${esc(m.email || '—')}</td>
          <td>
            <select class="ninp mb-0" style="height:32px;font-size:.78rem;max-width:140px"
                    ${m.role === 'owner' ? 'disabled' : ''}
                    onchange="NovaBiz._updateMemberRole('${esc(m.id)}','${esc(companyId)}',this.value)">
              ${['owner','admin','member','viewer'].map(r =>
                `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </td>
          <td style="color:var(--tx3)">${fmtDate(m.joined_at)}</td>
          <td class="text-end">
            ${m.role === 'owner' ? '<span style="color:var(--tx3);font-size:.75rem">—</span>'
              : `<button class="boc btn py-1 px-2" style="font-size:.75rem;color:#f87171" onclick="NovaBiz._removeMember('${esc(m.id)}','${esc(companyId)}')">Remove</button>`}
          </td>
        </tr>`).join('');
      document.getElementById('bizMembersTable').innerHTML = `
        <table class="nova-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--tx3)">No members yet.</td></tr>'}</tbody>
        </table>`;
    } catch (e) {
      document.getElementById('bizMembersTable').innerHTML = `<div style="padding:18px;color:#f87171">${esc(e.message)}</div>`;
    }
  }
  async function _addMember(companyId) {
    const email = (document.getElementById('bizMemberEmail') || {}).value;
    const role  = (document.getElementById('bizMemberRole') || {}).value || 'member';
    if (!email) return toast('Enter an email address.', 'error');
    try {
      await NovaBizApi.addCompanyMember(companyId, email.trim(), role);
      document.getElementById('bizMemberEmail').value = '';
      refreshMembers(companyId);
      toast('Member added.');
    } catch (e) { toastErr(e); }
  }
  async function _updateMemberRole(memberId, companyId, role) {
    try { await NovaBizApi.updateMemberRole(memberId, role); refreshMembers(companyId); }
    catch (e) { toastErr(e); }
  }
  async function _removeMember(memberId, companyId) {
    if (!confirm('Remove this member?')) return;
    try { await NovaBizApi.removeMember(memberId); refreshMembers(companyId); toast('Removed.'); }
    catch (e) { toastErr(e); }
  }

  /* =================================================================
     SHARED FORM HELPERS
     ================================================================= */
  function field(id, label, value, opts) {
    opts = opts || {};
    const col = opts.col || 6;
    const type = opts.type || 'text';
    const v = value == null ? '' : value;
    if (type === 'textarea') {
      return `<div class="col-md-${col}"><label class="nlbl">${esc(label)}</label>
        <textarea class="ninp" id="${id}" rows="${opts.rows || 2}">${esc(v)}</textarea></div>`;
    }
    if (type === 'select') {
      const opts2 = (opts.options || []).map((o) => {
        const ov = typeof o === 'string' ? o : o.value;
        const ol = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`;
      }).join('');
      return `<div class="col-md-${col}"><label class="nlbl">${esc(label)}</label>
        <select class="ninp" id="${id}">${opts2}</select></div>`;
    }
    return `<div class="col-md-${col}"><label class="nlbl">${esc(label)}</label>
      <input class="ninp" id="${id}" type="${type}" ${opts.step ? 'step="' + opts.step + '"' : ''}
             value="${esc(v)}" ${opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : ''}></div>`;
  }
  function mountModal(id, html) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    const el = document.getElementById(id);
    const m = (global.bootstrap && global.bootstrap.Modal) ? new global.bootstrap.Modal(el) : null;
    if (m) m.show();
    el.addEventListener('hidden.bs.modal', () => el.remove());
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const m = global.bootstrap && global.bootstrap.Modal && global.bootstrap.Modal.getInstance(el);
    if (m) m.hide(); else el.remove();
  }

  /* =================================================================
     KPI / EMPTY-STATE PRIMITIVES
     ================================================================= */
  function kpi(icon, label, value, color, sub) {
    return `
      <div class="col-md-3 col-sm-6">
        <div class="db-stat-card" style="padding:18px">
          <div class="d-flex align-items-center gap-3 mb-2">
            <div style="width:40px;height:40px;border-radius:10px;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:1.05rem">
              <i class="fa-solid ${icon}"></i>
            </div>
            <div style="font-size:.72rem;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em">${esc(label)}</div>
          </div>
          <div style="font-size:1.5rem;font-weight:700;line-height:1.1">${value}</div>
          ${sub ? `<div style="font-size:.74rem;color:var(--tx3);margin-top:4px">${esc(sub)}</div>` : ''}
        </div>
      </div>`;
  }
  function emptyState(icon, title, subtitle, btn) {
    return `
      <div class="nova-panel text-center" style="padding:40px 24px">
        <div style="font-size:2rem;color:var(--tx3);margin-bottom:8px"><i class="fa-solid ${icon}"></i></div>
        <h6 style="margin-bottom:6px">${esc(title)}</h6>
        <p style="color:var(--tx3);max-width:420px;margin:0 auto 14px;font-size:.85rem">${esc(subtitle || '')}</p>
        ${btn || ''}
      </div>`;
  }

  /* =================================================================
     PROJECTS & TASKS
     ================================================================= */
  const TASK_STATUSES = [
    { id: 'todo',        label: 'To Do',       color: '#64748b' },
    { id: 'in_progress', label: 'In Progress', color: '#3b82f6' },
    { id: 'review',      label: 'Review',      color: '#f59e0b' },
    { id: 'done',        label: 'Done',        color: '#22c55e' },
    { id: 'blocked',     label: 'Blocked',     color: '#ef4444' },
  ];
  let CURRENT_PROJECT_ID = null;

  async function loadProjects() {
    const body = document.getElementById('bizProjectsBody');
    if (!body) return;
    body.innerHTML = companySelector() +
      '<div class="nova-panel"><span class="spinner-border spinner-border-sm me-2"></span>Loading projects…</div>';
    try {
      const list  = await NovaBizApi.listProjects(STATE.activeCompanyId);
      const tasks = await NovaBizApi.listTasks(STATE.activeCompanyId);
      const today = new Date().toISOString().slice(0, 10);
      const overdue = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length;
      const open    = list.filter(p => p.status === 'active').length;
      const done    = list.filter(p => p.status === 'completed').length;

      const stats = `
        <div class="row g-3 mb-4">
          ${kpi('fa-diagram-project',      'Projects',     list.length, '#8b5cf6')}
          ${kpi('fa-folder-open',          'Open',         open,        '#3b82f6')}
          ${kpi('fa-circle-check',         'Completed',    done,        '#22c55e')}
          ${kpi('fa-triangle-exclamation', 'Overdue Tasks',overdue,     '#ef4444')}
        </div>`;

      const cards = list.length
        ? list.map((p) => {
            const projTasks = tasks.filter(t => t.project_id === p.id);
            const pct = projTasks.length ? Math.round(projTasks.filter(t => t.status === 'done').length * 100 / projTasks.length) : 0;
            return `
              <div class="col-md-6 col-lg-4">
                <div class="db-stat-card" style="padding:18px;cursor:pointer" onclick="NovaBiz.openProject('${esc(p.id)}')">
                  <div class="d-flex justify-content-between align-items-start mb-2 gap-2">
                    <div style="font-weight:600">${esc(p.name)}</div>
                    <span class="bst son" style="background:${p.status === 'active' ? 'rgba(52,211,153,.12)' : 'rgba(148,163,184,.12)'};color:${p.status === 'active' ? '#34d399' : '#94a3b8'}">${esc(p.status)}</span>
                  </div>
                  <p style="color:var(--tx3);font-size:.82rem;margin-bottom:10px;min-height:32px">${esc(p.description || '—')}</p>
                  <div style="height:6px;background:var(--bg3);border-radius:99px;overflow:hidden">
                    <div style="width:${pct}%;height:100%;background:var(--grad)"></div>
                  </div>
                  <div class="d-flex justify-content-between mt-2" style="font-size:.74rem;color:var(--tx3)">
                    <span>${projTasks.length} tasks · ${pct}% done</span>
                    <span>${p.due_date ? 'Due ' + fmtDate(p.due_date) : '—'}</span>
                  </div>
                </div>
              </div>`;
          }).join('')
        : `<div class="col-12">${emptyState('fa-diagram-project', 'No projects yet', 'Create your first project to start tracking work, deadlines, and team output.',
            '<button class="bgrd btn py-2 px-4" onclick="NovaBiz.openProjectEditor()"><i class=\"fa-solid fa-plus me-1\"></i>New Project</button>')}</div>`;

      body.innerHTML = companySelector() + stats + `
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h6 style="margin:0">Projects</h6>
          <button class="bgrd btn py-2 px-3" onclick="NovaBiz.openProjectEditor()">
            <i class="fa-solid fa-plus me-1"></i>New Project
          </button>
        </div>
        <div class="row g-3">${cards}</div>
        <div class="mt-4">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 style="margin:0">All Tasks (Kanban)</h6>
            <button class="boc btn py-1 px-3" style="font-size:.78rem" onclick="NovaBiz.openTaskEditor()">
              <i class="fa-solid fa-plus me-1"></i>New Task
            </button>
          </div>
          ${renderKanban(tasks, list)}
        </div>`;
    } catch (e) {
      body.innerHTML = companySelector() + `<div class="nova-panel" style="color:#f87171">${esc(e.message)}</div>`;
    }
  }

  function renderKanban(tasks, projects) {
    const projMap = {};
    (projects || []).forEach(p => { projMap[p.id] = p; });
    const cols = TASK_STATUSES.map((st) => {
      const items = tasks.filter(t => t.status === st.id);
      const list = items.map(t => `
        <div class="nova-panel" style="padding:12px;margin-bottom:10px;cursor:pointer;border-left:3px solid ${st.color}"
             onclick="NovaBiz.openTaskEditor('${esc(t.id)}')">
          <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${esc(t.title)}</div>
          ${t.project_id && projMap[t.project_id] ? `<div style="font-size:.7rem;color:var(--tx3);margin-bottom:6px"><i class="fa-solid fa-diagram-project me-1"></i>${esc(projMap[t.project_id].name)}</div>` : ''}
          <div class="d-flex justify-content-between align-items-center" style="font-size:.7rem;color:var(--tx3)">
            <span>${t.priority ? `<span class="bst" style="background:${priorityColor(t.priority)}22;color:${priorityColor(t.priority)};padding:2px 6px">${esc(t.priority)}</span>` : ''}</span>
            <span>${t.due_date ? fmtDate(t.due_date) : ''}</span>
          </div>
        </div>`).join('');
      return `
        <div class="col" style="min-width:240px">
          <div style="font-size:.78rem;color:${st.color};font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
            ${esc(st.label)} <span style="color:var(--tx3);margin-left:6px">${items.length}</span>
          </div>
          ${list || `<div style="font-size:.78rem;color:var(--tx3);padding:8px">No tasks</div>`}
        </div>`;
    }).join('');
    return `<div class="row g-3 flex-nowrap" style="overflow-x:auto;padding-bottom:8px">${cols}</div>`;
  }

  function priorityColor(p) {
    return p === 'urgent' ? '#ef4444' : p === 'high' ? '#f59e0b' : p === 'medium' ? '#3b82f6' : '#64748b';
  }

  async function openProject(projectId) {
    CURRENT_PROJECT_ID = projectId;
    const body = document.getElementById('bizProjectsBody');
    if (!body) return;
    body.innerHTML = companySelector() + '<div class="nova-panel"><span class="spinner-border spinner-border-sm me-2"></span>Loading project…</div>';
    try {
      const projects = await NovaBizApi.listProjects(STATE.activeCompanyId);
      const project = projects.find(p => p.id === projectId);
      if (!project) { return loadProjects(); }
      const tasks = await NovaBizApi.listTasks(STATE.activeCompanyId, { projectId });
      const done = tasks.filter(t => t.status === 'done').length;
      body.innerHTML = companySelector() + `
        <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <button class="boc btn py-1 px-3" style="font-size:.8rem" onclick="NovaBiz.load('b-projects')">
            <i class="fa-solid fa-arrow-left me-1"></i>Back
          </button>
          <h5 style="margin:0">${esc(project.name)}</h5>
          <span class="bst son ms-2">${esc(project.status)}</span>
          <button class="boc btn py-1 px-2 ms-auto" style="font-size:.78rem" onclick="NovaBiz.openProjectEditor('${esc(projectId)}')">
            <i class="fa-solid fa-pen me-1"></i>Edit project
          </button>
          <button class="bgrd btn py-1 px-3" style="font-size:.8rem" onclick="NovaBiz.openTaskEditor(null,'${esc(projectId)}')">
            <i class="fa-solid fa-plus me-1"></i>New Task
          </button>
        </div>
        <p style="color:var(--tx3);font-size:.85rem">${esc(project.description || '—')}</p>
        <div class="row g-3 mb-3">
          ${kpi('fa-list-check',     'Tasks',     tasks.length, '#8b5cf6')}
          ${kpi('fa-circle-check',   'Completed', done,         '#22c55e')}
          ${kpi('fa-clock',          'Open',      tasks.length - done, '#3b82f6')}
          ${kpi('fa-calendar',       'Due',       project.due_date ? fmtDate(project.due_date) : '—', '#f59e0b')}
        </div>
        ${renderKanban(tasks, [project])}
      `;
    } catch (e) { body.innerHTML = `<div class="nova-panel" style="color:#f87171">${esc(e.message)}</div>`; }
  }

  function openProjectEditor(id) {
    if (!getActiveCompany()) return toast('Create a company first.', 'error');
    NovaBizApi.listProjects(STATE.activeCompanyId).then((list) => {
      const p = (id && list.find(x => x.id === id)) || {};
      const isNew = !p.id;
      const html = `
        <div class="modal fade" tabindex="-1" id="bizProjectModal">
          <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content nova-panel" style="border-radius:14px">
              <div class="modal-header" style="border-bottom:1px solid var(--bd)">
                <h5 class="modal-title">${isNew ? 'New Project' : 'Edit Project'}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="row g-3">
                  ${field('pjName', 'Project name *', p.name, { col: 12 })}
                  ${field('pjDesc', 'Description', p.description, { col: 12, type: 'textarea', rows: 3 })}
                  ${field('pjStatus', 'Status', p.status || 'active', { col: 4, type: 'select',
                    options: ['active','on_hold','completed','archived','cancelled'] })}
                  ${field('pjPrio', 'Priority', p.priority || 'medium', { col: 4, type: 'select',
                    options: ['low','medium','high','urgent'] })}
                  ${field('pjColor', 'Color', p.color || '#8b5cf6', { col: 4 })}
                  ${field('pjStart', 'Start date', p.start_date || '', { col: 6, type: 'date' })}
                  ${field('pjDue',   'Due date',   p.due_date   || '', { col: 6, type: 'date' })}
                </div>
              </div>
              <div class="modal-footer" style="border-top:1px solid var(--bd)">
                ${id ? `<button class="boc btn py-2 px-3" style="color:#f87171" onclick="NovaBiz._deleteProject('${esc(id)}')"><i class="fa-solid fa-trash me-1"></i>Delete</button>` : ''}
                <button class="boc btn py-2 px-3" data-bs-dismiss="modal">Cancel</button>
                <button class="bgrd btn py-2 px-4" id="pjSaveBtn" onclick="NovaBiz._saveProject('${esc(id || '')}')">
                  <i class="fa-solid fa-floppy-disk me-1"></i>Save
                </button>
              </div>
            </div>
          </div>
        </div>`;
      mountModal('bizProjectModal', html);
    }).catch(toastErr);
  }

  async function _saveProject(id) {
    const v = (i) => (document.getElementById(i) || {}).value || '';
    const payload = {
      name: v('pjName').trim(),
      description: v('pjDesc').trim() || null,
      status: v('pjStatus') || 'active',
      priority: v('pjPrio') || 'medium',
      color: v('pjColor') || '#8b5cf6',
      start_date: v('pjStart') || null,
      due_date: v('pjDue') || null,
    };
    if (!payload.name) return toast('Project name is required.', 'error');
    const btn = document.getElementById('pjSaveBtn'); setBusy(btn, true);
    try {
      if (id) await NovaBizApi.updateProject(id, payload);
      else    await NovaBizApi.createProject(STATE.activeCompanyId, payload);
      closeModal('bizProjectModal');
      toast(id ? 'Project updated.' : 'Project created.');
      if (CURRENT_PROJECT_ID && id === CURRENT_PROJECT_ID) openProject(id);
      else loadProjects();
      updateBadges();
    } catch (e) { toastErr(e); }
    finally { setBusy(btn, false, '<i class="fa-solid fa-floppy-disk me-1"></i>Save'); }
  }
  async function _deleteProject(id) {
    if (!confirm('Delete this project and all its tasks? This cannot be undone.')) return;
    try { await NovaBizApi.deleteProject(id); closeModal('bizProjectModal');
      toast('Project deleted.'); CURRENT_PROJECT_ID = null; loadProjects();
    } catch (e) { toastErr(e); }
  }

  function openTaskEditor(taskId, projectId) {
    if (!getActiveCompany()) return toast('Create a company first.', 'error');
    Promise.all([
      NovaBizApi.listProjects(STATE.activeCompanyId),
      NovaBizApi.listTasks(STATE.activeCompanyId),
      NovaBizApi.listCompanyMembers(STATE.activeCompanyId).catch(() => []),
    ]).then(([projects, tasks, members]) => {
      const t = (taskId && tasks.find(x => x.id === taskId)) || {};
      if (!taskId && projectId) t.project_id = projectId;
      const isNew = !t.id;
      const projOpts = [{ value: '', label: '— No project —' }].concat(projects.map(p => ({ value: p.id, label: p.name })));
      const memberOpts = [{ value: '', label: '— Unassigned —' }].concat(
        members.map(m => ({ value: m.user_id, label: (m.name || m.email || 'Member') })));

      const html = `
        <div class="modal fade" tabindex="-1" id="bizTaskModal">
          <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content nova-panel" style="border-radius:14px">
              <div class="modal-header" style="border-bottom:1px solid var(--bd)">
                <h5 class="modal-title">${isNew ? 'New Task' : 'Edit Task'}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="row g-3">
                  ${field('tkTitle', 'Title *', t.title, { col: 12 })}
                  ${field('tkDesc',  'Description', t.description, { col: 12, type: 'textarea', rows: 3 })}
                  ${field('tkProject', 'Project', t.project_id || '', { col: 6, type: 'select', options: projOpts })}
                  ${field('tkStatus',  'Status',  t.status || 'todo',  { col: 6, type: 'select', options: TASK_STATUSES.map(s => ({ value: s.id, label: s.label })) })}
                  ${field('tkPrio',    'Priority', t.priority || 'medium', { col: 4, type: 'select', options: ['low','medium','high','urgent'] })}
                  ${field('tkAssignee','Assignee', t.assignee_user_id || '', { col: 4, type: 'select', options: memberOpts })}
                  ${field('tkDue',     'Due date', t.due_date || '', { col: 4, type: 'date' })}
                  ${field('tkTime',    'Time spent (minutes)', t.time_spent_minutes || 0, { col: 6, type: 'number' })}
                  ${field('tkTags',    'Tags (comma-separated)', (t.tags || []).join(', '), { col: 6 })}
                </div>
                ${taskId ? '<div class="mt-3"><h6>Comments</h6><div id="tkCommentsBox">Loading…</div><div class="d-flex gap-2 mt-2"><input id="tkCommentInp" class="ninp mb-0" placeholder="Add a comment…"><button class="bgrd btn py-2 px-3" onclick="NovaBiz._addTaskComment(\'' + esc(taskId) + '\')">Post</button></div></div>' : ''}
              </div>
              <div class="modal-footer" style="border-top:1px solid var(--bd)">
                ${taskId ? `<button class="boc btn py-2 px-3" style="color:#f87171" onclick="NovaBiz._deleteTask('${esc(taskId)}')"><i class="fa-solid fa-trash me-1"></i>Delete</button>` : ''}
                <button class="boc btn py-2 px-3" data-bs-dismiss="modal">Cancel</button>
                <button class="bgrd btn py-2 px-4" id="tkSaveBtn" onclick="NovaBiz._saveTask('${esc(taskId || '')}')">
                  <i class="fa-solid fa-floppy-disk me-1"></i>Save
                </button>
              </div>
            </div>
          </div>
        </div>`;
      mountModal('bizTaskModal', html);
      if (taskId) refreshTaskComments(taskId);
    }).catch(toastErr);
  }

  async function refreshTaskComments(taskId) {
    const box = document.getElementById('tkCommentsBox'); if (!box) return;
    try {
      const list = await NovaBizApi.listTaskComments(taskId);
      if (!list.length) { box.innerHTML = '<div style="color:var(--tx3);font-size:.8rem">No comments yet.</div>'; return; }
      box.innerHTML = list.map(c => `
        <div class="nova-panel" style="padding:10px;margin-bottom:6px">
          <div style="font-size:.75rem;color:var(--tx3);margin-bottom:4px">
            <strong style="color:var(--tx2)">${esc(c.author)}</strong> · ${fmtDateTime(c.created_at)}
          </div>
          <div style="font-size:.85rem;white-space:pre-wrap">${esc(c.content)}</div>
        </div>`).join('');
    } catch (e) { box.innerHTML = `<div style="color:#f87171">${esc(e.message)}</div>`; }
  }

  async function _addTaskComment(taskId) {
    const inp = document.getElementById('tkCommentInp');
    const text = inp && inp.value && inp.value.trim();
    if (!text) return;
    try { await NovaBizApi.addTaskComment(STATE.activeCompanyId, taskId, text); inp.value = ''; refreshTaskComments(taskId); }
    catch (e) { toastErr(e); }
  }

  async function _saveTask(taskId) {
    const v = (i) => (document.getElementById(i) || {}).value || '';
    const tags = v('tkTags').split(',').map(s => s.trim()).filter(Boolean);
    const payload = {
      title: v('tkTitle').trim(),
      description: v('tkDesc').trim() || null,
      project_id: v('tkProject') || null,
      status: v('tkStatus') || 'todo',
      priority: v('tkPrio') || 'medium',
      assignee_user_id: v('tkAssignee') || null,
      due_date: v('tkDue') || null,
      time_spent_minutes: parseInt(v('tkTime') || '0', 10) || 0,
      tags: tags.length ? tags : null,
    };
    if (!payload.title) return toast('Task title is required.', 'error');
    const btn = document.getElementById('tkSaveBtn'); setBusy(btn, true);
    try {
      if (taskId) await NovaBizApi.updateTask(taskId, payload);
      else        await NovaBizApi.createTask(STATE.activeCompanyId, payload);
      closeModal('bizTaskModal');
      toast(taskId ? 'Task updated.' : 'Task created.');
      if (CURRENT_PROJECT_ID) openProject(CURRENT_PROJECT_ID);
      else loadProjects();
    } catch (e) { toastErr(e); }
    finally { setBusy(btn, false, '<i class="fa-solid fa-floppy-disk me-1"></i>Save'); }
  }

  async function _deleteTask(taskId) {
    if (!confirm('Delete this task?')) return;
    try { await NovaBizApi.deleteTask(taskId); closeModal('bizTaskModal');
      toast('Task deleted.');
      if (CURRENT_PROJECT_ID) openProject(CURRENT_PROJECT_ID); else loadProjects();
    } catch (e) { toastErr(e); }
  }

  /* =================================================================
     EXPORT (companies + projects only — others appended below)
     ================================================================= */
  global.NovaBiz = {
    init, load, reset,
    // companies
    openNewCompany, openCompanyEditor, _saveCompany, deleteCompany, switchCompany,
    openCompanyMembers, _addMember, _updateMemberRole, _removeMember,
    // projects + tasks
    openProject, openProjectEditor, _saveProject, _deleteProject,
    openTaskEditor, _saveTask, _deleteTask, _addTaskComment,
  };
  global.NovaBiz._internal = {
    STATE, esc, fmtMoney, fmtDate, fmtDateTime,
    toast, toastErr, setBusy, getActiveCompany,
    field, mountModal, closeModal, companySelector, emptyCompanyState,
    syncCompanyChip, updateBadges, panel, kpi, emptyState,
    TASK_STATUSES, priorityColor,
  };

})(window);
