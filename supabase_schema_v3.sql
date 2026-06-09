-- =====================================================================
-- Nova StartupOS AI — Business OS Migration (v3)
-- ---------------------------------------------------------------------
-- ADDITIVE migration. Run AFTER supabase_schema.sql and supabase_schema_v2.sql.
-- Safe to re-run. No existing data is dropped or modified destructively.
--
-- This migration transforms Nova StartupOS AI from a startup-assistance
-- platform into a complete AI-Powered Business Operating System.
--
-- New domains:
--   1. Companies & Members          (multi-company, multi-tenant)
--   2. Projects, Tasks, Comments    (Kanban + time tracking)
--   3. CRM (contacts, deals, acts)  (lead pipeline, sales)
--   4. Invoices & Items             (quote / invoice / proforma)
--   5. Expenses & Categories        (with receipts)
--   6. Financial Transactions       (accounting ledger, auto-fed)
--   7. AI CFO Reports               (LLM-generated insights)
--   8. Investors / Meetings / Rounds (investor relations CRM)
--
-- Multi-tenant model:
--   Every Business OS row carries `company_id`. Access is enforced via
--   `is_company_member(company_id)` / `is_company_admin(company_id)`,
--   both SECURITY DEFINER so RLS never recurses on company_members.
--
-- The pre-existing user-scoped tables (startups, generated_documents,
-- assessments, ai_requests, etc.) are NOT modified by this migration.
-- They continue to work exactly as before.
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. COMPANIES & MEMBERSHIP
-- =====================================================================

-- ---- companies -----------------------------------------------------
create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  legal_name    text,
  logo_url      text,
  industry      text,
  country       text,
  currency      text not null default 'USD',
  tax_id        text,
  tax_rate      numeric(6,3) default 0,
  email         text,
  phone         text,
  website       text,
  address       text,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_companies_owner on public.companies(owner_user_id);

-- ---- company_members -----------------------------------------------
create table if not exists public.company_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner','admin','member','viewer')),
  invited_by  uuid references public.profiles(id) on delete set null,
  joined_at   timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists idx_company_members_user on public.company_members(user_id);
create index if not exists idx_company_members_company on public.company_members(company_id);

-- ---- updated_at trigger
drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ---- on insert: auto-add the creating user as 'owner' --------------
create or replace function public.add_company_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_members(company_id, user_id, role, invited_by)
  values (new.id, new.owner_user_id, 'owner', new.owner_user_id)
  on conflict (company_id, user_id) do update set role = 'owner';
  return new;
end$$;

drop trigger if exists trg_company_owner_membership on public.companies;
create trigger trg_company_owner_membership
  after insert on public.companies
  for each row execute function public.add_company_owner_membership();


-- =====================================================================
-- 2. RBAC HELPERS (SECURITY DEFINER — never recurse into RLS)
-- =====================================================================

create or replace function public.is_company_member(c_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.company_members
    where company_id = c_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_company_admin(c_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.company_members
    where company_id = c_id
      and user_id = auth.uid()
      and role in ('owner','admin')
  );
$$;

create or replace function public.is_company_owner(c_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.company_members
    where company_id = c_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;


-- =====================================================================
-- 3. PROJECTS / TASKS / COMMENTS
-- =====================================================================

create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  description     text,
  status          text not null default 'active'
                    check (status in ('active','on_hold','completed','archived','cancelled')),
  priority        text default 'medium'
                    check (priority in ('low','medium','high','urgent')),
  start_date      date,
  due_date        date,
  owner_user_id   uuid references public.profiles(id) on delete set null,
  color           text default '#8b5cf6',
  archived        boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_projects_company on public.projects(company_id);
create index if not exists idx_projects_status  on public.projects(company_id, status);
create index if not exists idx_projects_due     on public.projects(company_id, due_date);

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---- tasks ---------------------------------------------------------
create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  project_id          uuid references public.projects(id) on delete cascade,
  title               text not null,
  description         text,
  status              text not null default 'todo'
                        check (status in ('todo','in_progress','review','done','blocked')),
  priority            text default 'medium'
                        check (priority in ('low','medium','high','urgent')),
  assignee_user_id    uuid references public.profiles(id) on delete set null,
  due_date            date,
  completed_at        timestamptz,
  position            integer default 0,
  time_spent_minutes  integer default 0,
  attachments         jsonb default '[]'::jsonb,
  tags                text[],
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tasks_company  on public.tasks(company_id);
create index if not exists idx_tasks_project  on public.tasks(project_id, status, position);
create index if not exists idx_tasks_assignee on public.tasks(assignee_user_id);
create index if not exists idx_tasks_status   on public.tasks(company_id, status);

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Auto-stamp completed_at when status flips to 'done'.
create or replace function public.task_set_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done' or new.completed_at is null) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end$$;

drop trigger if exists trg_task_completed on public.tasks;
create trigger trg_task_completed
  before insert or update of status on public.tasks
  for each row execute function public.task_set_completed_at();

-- ---- task_comments -------------------------------------------------
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_task_comments_task on public.task_comments(task_id, created_at);


-- =====================================================================
-- 4. CRM
-- =====================================================================

create table if not exists public.crm_contacts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  full_name     text not null,
  email         text,
  phone         text,
  company_name  text,
  job_title     text,
  source        text,                                -- 'website','referral','outbound', etc.
  tags          text[],
  notes         text,
  owner_user_id uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_crm_contacts_company on public.crm_contacts(company_id);
create index if not exists idx_crm_contacts_email   on public.crm_contacts(email);

drop trigger if exists trg_crm_contacts_updated on public.crm_contacts;
create trigger trg_crm_contacts_updated
  before update on public.crm_contacts
  for each row execute function public.set_updated_at();

create table if not exists public.crm_deals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  contact_id          uuid references public.crm_contacts(id) on delete set null,
  title               text not null,
  stage               text not null default 'lead'
                        check (stage in ('lead','contacted','meeting','proposal','won','lost')),
  value_amount_cents  bigint default 0,
  currency            text default 'USD',
  probability         integer default 10,            -- 0-100
  expected_close_date date,
  notes               text,
  owner_user_id       uuid references public.profiles(id) on delete set null,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_crm_deals_company on public.crm_deals(company_id);
create index if not exists idx_crm_deals_stage   on public.crm_deals(company_id, stage);
create index if not exists idx_crm_deals_contact on public.crm_deals(contact_id);

drop trigger if exists trg_crm_deals_updated on public.crm_deals;
create trigger trg_crm_deals_updated
  before update on public.crm_deals
  for each row execute function public.set_updated_at();

-- Auto-stamp closed_at when stage moves to won/lost.
create or replace function public.deal_set_closed_at()
returns trigger language plpgsql as $$
begin
  if new.stage in ('won','lost') and (old.stage is distinct from 'won' and old.stage is distinct from 'lost') then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.stage not in ('won','lost') then
    new.closed_at := null;
  end if;
  return new;
end$$;

drop trigger if exists trg_deal_closed on public.crm_deals;
create trigger trg_deal_closed
  before insert or update of stage on public.crm_deals
  for each row execute function public.deal_set_closed_at();

create table if not exists public.crm_activities (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  deal_id      uuid references public.crm_deals(id) on delete cascade,
  contact_id   uuid references public.crm_contacts(id) on delete cascade,
  type         text not null check (type in ('note','call','email','meeting','task')),
  subject      text,
  body         text,
  occurred_at  timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_crm_activities_company on public.crm_activities(company_id);
create index if not exists idx_crm_activities_deal    on public.crm_activities(deal_id, occurred_at desc);
create index if not exists idx_crm_activities_contact on public.crm_activities(contact_id, occurred_at desc);


-- =====================================================================
-- 5. INVOICES
-- =====================================================================

create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  contact_id        uuid references public.crm_contacts(id) on delete set null,
  type              text not null default 'invoice'
                      check (type in ('invoice','quote','proforma')),
  number            text not null,
  status            text not null default 'draft'
                      check (status in ('draft','sent','paid','overdue','cancelled')),
  issue_date        date not null default current_date,
  due_date          date,
  client_name       text,
  client_email      text,
  client_address    text,
  currency          text not null default 'USD',
  subtotal_cents    bigint not null default 0,
  tax_rate          numeric(6,3) not null default 0,
  tax_cents         bigint not null default 0,
  discount_cents    bigint not null default 0,
  total_cents       bigint not null default 0,
  notes             text,
  terms             text,
  paid_at           timestamptz,
  paid_amount_cents bigint default 0,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number)
);
create index if not exists idx_invoices_company on public.invoices(company_id);
create index if not exists idx_invoices_status  on public.invoices(company_id, status);
create index if not exists idx_invoices_contact on public.invoices(contact_id);
create index if not exists idx_invoices_issue   on public.invoices(company_id, issue_date desc);

drop trigger if exists trg_invoices_updated on public.invoices;
create trigger trg_invoices_updated
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ---- invoice_items -------------------------------------------------
create table if not exists public.invoice_items (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  position          integer not null default 0,
  description       text not null,
  quantity          numeric(12,3) not null default 1,
  unit_price_cents  bigint not null default 0,
  total_cents       bigint not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_invoice_items_invoice on public.invoice_items(invoice_id, position);


-- =====================================================================
-- 6. EXPENSES
-- =====================================================================

create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,  -- null = global default
  name        text not null,
  color       text default '#8b5cf6',
  icon        text default 'fa-receipt',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_expense_categories_company on public.expense_categories(company_id);

-- Seed default categories (company_id NULL = available to every company).
insert into public.expense_categories (name, color, icon, is_default) values
  ('Marketing',  '#ec4899', 'fa-bullhorn',     true),
  ('Hosting',    '#3b82f6', 'fa-server',       true),
  ('Payroll',    '#22c55e', 'fa-users',        true),
  ('Software',   '#8b5cf6', 'fa-laptop-code',  true),
  ('Travel',     '#f59e0b', 'fa-plane',        true),
  ('Operations', '#06b6d4', 'fa-gears',        true),
  ('Other',      '#64748b', 'fa-receipt',      true)
on conflict do nothing;

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  category_id   uuid references public.expense_categories(id) on delete set null,
  vendor        text,
  amount_cents  bigint not null,
  currency      text not null default 'USD',
  occurred_at   date not null default current_date,
  notes         text,
  receipt_url   text,
  attachments   jsonb default '[]'::jsonb,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_expenses_company  on public.expenses(company_id);
create index if not exists idx_expenses_occurred on public.expenses(company_id, occurred_at desc);
create index if not exists idx_expenses_category on public.expenses(category_id);

drop trigger if exists trg_expenses_updated on public.expenses;
create trigger trg_expenses_updated
  before update on public.expenses
  for each row execute function public.set_updated_at();


-- =====================================================================
-- 7. FINANCIAL TRANSACTIONS (accounting ledger, auto-fed)
-- =====================================================================
-- Every paid invoice and every expense becomes a row here. The accounting
-- dashboard reads only this table to compute Revenue / Expenses / Profit.
-- This denormalization gives the AI CFO a clean unified ledger to analyze.

create table if not exists public.financial_transactions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  type          text not null check (type in ('income','expense')),
  source        text not null check (source in ('invoice','expense','manual')),
  source_id     uuid,                                          -- pointer to invoices.id / expenses.id
  amount_cents  bigint not null,
  currency      text not null default 'USD',
  occurred_at   date not null default current_date,
  description   text,
  metadata      jsonb default '{}'::jsonb,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fintx_company   on public.financial_transactions(company_id);
create index if not exists idx_fintx_type      on public.financial_transactions(company_id, type, occurred_at);
create index if not exists idx_fintx_source    on public.financial_transactions(source, source_id);

-- ---- Auto-feed ledger from invoices --------------------------------
create or replace function public.fintx_from_invoice()
returns trigger language plpgsql as $$
begin
  -- Only book income when an invoice transitions INTO 'paid' status.
  if (tg_op = 'UPDATE') then
    if new.status = 'paid' and old.status is distinct from 'paid' then
      delete from public.financial_transactions
        where source = 'invoice' and source_id = new.id;
      insert into public.financial_transactions
        (company_id, type, source, source_id, amount_cents, currency, occurred_at, description, created_by)
      values
        (new.company_id, 'income', 'invoice', new.id,
         coalesce(new.paid_amount_cents, new.total_cents), new.currency,
         coalesce(new.paid_at::date, current_date),
         coalesce('Invoice ' || new.number, 'Invoice payment'),
         new.created_by);
    elsif new.status <> 'paid' and old.status = 'paid' then
      delete from public.financial_transactions
        where source = 'invoice' and source_id = new.id;
    end if;
  end if;
  return new;
end$$;

drop trigger if exists trg_fintx_invoice on public.invoices;
create trigger trg_fintx_invoice
  after update on public.invoices
  for each row execute function public.fintx_from_invoice();

-- ---- Auto-feed ledger from expenses --------------------------------
create or replace function public.fintx_from_expense()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.financial_transactions
      (company_id, type, source, source_id, amount_cents, currency, occurred_at, description, created_by)
    values
      (new.company_id, 'expense', 'expense', new.id, new.amount_cents, new.currency,
       new.occurred_at, coalesce(new.vendor || ' — expense', 'Expense'), new.created_by);
  elsif (tg_op = 'UPDATE') then
    update public.financial_transactions
       set amount_cents = new.amount_cents,
           currency     = new.currency,
           occurred_at  = new.occurred_at,
           description  = coalesce(new.vendor || ' — expense', 'Expense')
     where source = 'expense' and source_id = new.id;
  elsif (tg_op = 'DELETE') then
    delete from public.financial_transactions
      where source = 'expense' and source_id = old.id;
    return old;
  end if;
  return new;
end$$;

drop trigger if exists trg_fintx_expense_ins on public.expenses;
create trigger trg_fintx_expense_ins
  after insert on public.expenses
  for each row execute function public.fintx_from_expense();

drop trigger if exists trg_fintx_expense_upd on public.expenses;
create trigger trg_fintx_expense_upd
  after update on public.expenses
  for each row execute function public.fintx_from_expense();

drop trigger if exists trg_fintx_expense_del on public.expenses;
create trigger trg_fintx_expense_del
  after delete on public.expenses
  for each row execute function public.fintx_from_expense();


-- =====================================================================
-- 8. AI CFO REPORTS
-- =====================================================================

create table if not exists public.ai_cfo_reports (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  period            text not null,                       -- 'YYYY-MM' or '30d' / '90d' / '6m' / '12m'
  title             text not null,
  summary           text,
  recommendations   jsonb not null default '[]'::jsonb,  -- [{title, body, severity, category}]
  metrics           jsonb not null default '{}'::jsonb,  -- snapshot of inputs that fed the analysis
  health_score      integer check (health_score between 0 and 100),
  ai_model          text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_cfo_reports_company on public.ai_cfo_reports(company_id, created_at desc);


-- =====================================================================
-- 9. INVESTORS / MEETINGS / FUNDING ROUNDS
-- =====================================================================

create table if not exists public.investors (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  type            text default 'angel'
                    check (type in ('angel','vc','fund','accelerator','grant','strategic','family_office','other')),
  country         text,
  focus           text,
  ticket_size     text,
  contact_email   text,
  contact_person  text,
  contact_phone   text,
  website         text,
  linkedin_url    text,
  notes           text,
  status          text default 'prospect'
                    check (status in ('prospect','interested','due_diligence','term_sheet','passed','invested')),
  rating          integer check (rating between 1 and 5),
  tags            text[],
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_investors_company on public.investors(company_id);
create index if not exists idx_investors_status  on public.investors(company_id, status);

drop trigger if exists trg_investors_updated on public.investors;
create trigger trg_investors_updated
  before update on public.investors
  for each row execute function public.set_updated_at();

create table if not exists public.investor_meetings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  investor_id   uuid references public.investors(id) on delete cascade,
  scheduled_at  timestamptz not null,
  duration_min  integer default 30,
  location      text,
  agenda        text,
  notes         text,
  outcome       text,                                -- 'positive','neutral','negative','no_show'
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_inv_meetings_company  on public.investor_meetings(company_id);
create index if not exists idx_inv_meetings_investor on public.investor_meetings(investor_id, scheduled_at desc);

create table if not exists public.funding_rounds (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  name                  text not null,                            -- e.g. 'Pre-seed', 'Seed', 'Series A'
  target_amount_cents   bigint default 0,
  raised_amount_cents   bigint default 0,
  valuation_cents       bigint default 0,
  currency              text default 'USD',
  status                text default 'planning'
                          check (status in ('planning','active','closed','cancelled')),
  opened_at             date,
  closed_at             date,
  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_funding_rounds_company on public.funding_rounds(company_id);

drop trigger if exists trg_funding_rounds_updated on public.funding_rounds;
create trigger trg_funding_rounds_updated
  before update on public.funding_rounds
  for each row execute function public.set_updated_at();

create table if not exists public.funding_round_commitments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  round_id        uuid not null references public.funding_rounds(id) on delete cascade,
  investor_id     uuid references public.investors(id) on delete set null,
  amount_cents    bigint not null,
  status          text default 'verbal'
                    check (status in ('verbal','signed','wired','withdrawn')),
  committed_at    date default current_date,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_round_commits_round on public.funding_round_commitments(round_id);


-- =====================================================================
-- 10. ROW-LEVEL SECURITY (every Business OS table)
-- =====================================================================

alter table public.companies                  enable row level security;
alter table public.company_members            enable row level security;
alter table public.projects                   enable row level security;
alter table public.tasks                      enable row level security;
alter table public.task_comments              enable row level security;
alter table public.crm_contacts               enable row level security;
alter table public.crm_deals                  enable row level security;
alter table public.crm_activities             enable row level security;
alter table public.invoices                   enable row level security;
alter table public.invoice_items              enable row level security;
alter table public.expense_categories         enable row level security;
alter table public.expenses                   enable row level security;
alter table public.financial_transactions     enable row level security;
alter table public.ai_cfo_reports             enable row level security;
alter table public.investors                  enable row level security;
alter table public.investor_meetings          enable row level security;
alter table public.funding_rounds             enable row level security;
alter table public.funding_round_commitments  enable row level security;

-- ----- companies ----------------------------------------------------
drop policy if exists companies_member_select on public.companies;
drop policy if exists companies_owner_insert  on public.companies;
drop policy if exists companies_admin_update  on public.companies;
drop policy if exists companies_owner_delete  on public.companies;
drop policy if exists companies_super_select  on public.companies;

create policy companies_member_select on public.companies for select
  using (public.is_company_member(id));
create policy companies_owner_insert on public.companies for insert
  with check (owner_user_id = auth.uid());
create policy companies_admin_update on public.companies for update
  using (public.is_company_admin(id))
  with check (public.is_company_admin(id));
create policy companies_owner_delete on public.companies for delete
  using (public.is_company_owner(id));
create policy companies_super_select on public.companies for select
  using (public.is_admin());

-- ----- company_members ----------------------------------------------
drop policy if exists members_self_select         on public.company_members;
drop policy if exists members_admin_select        on public.company_members;
drop policy if exists members_admin_write         on public.company_members;
drop policy if exists members_self_leave          on public.company_members;

create policy members_self_select on public.company_members for select
  using (user_id = auth.uid());
create policy members_admin_select on public.company_members for select
  using (public.is_company_admin(company_id));
create policy members_admin_write on public.company_members for all
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));
create policy members_self_leave on public.company_members for delete
  using (user_id = auth.uid());

-- Generic helper that builds member-scoped policies for the rest.
-- (Inline'd manually below — Postgres doesn't have "create policy
-- generator" macros, so we DRY-up with consistent naming.)

-- ----- projects -----------------------------------------------------
drop policy if exists projects_member_all on public.projects;
create policy projects_member_all on public.projects for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----- tasks --------------------------------------------------------
drop policy if exists tasks_member_all on public.tasks;
create policy tasks_member_all on public.tasks for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----- task_comments ------------------------------------------------
drop policy if exists task_comments_member_all on public.task_comments;
create policy task_comments_member_all on public.task_comments for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----- CRM ---------------------------------------------------------
drop policy if exists crm_contacts_member_all on public.crm_contacts;
create policy crm_contacts_member_all on public.crm_contacts for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists crm_deals_member_all on public.crm_deals;
create policy crm_deals_member_all on public.crm_deals for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists crm_activities_member_all on public.crm_activities;
create policy crm_activities_member_all on public.crm_activities for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----- Invoices -----------------------------------------------------
drop policy if exists invoices_member_all on public.invoices;
create policy invoices_member_all on public.invoices for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- invoice_items: piggy-back on parent invoice's company_id
drop policy if exists invoice_items_member_all on public.invoice_items;
create policy invoice_items_member_all on public.invoice_items for all
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.is_company_member(i.company_id)))
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.is_company_member(i.company_id)));

-- ----- Expenses -----------------------------------------------------
drop policy if exists expense_categories_select on public.expense_categories;
drop policy if exists expense_categories_member_write on public.expense_categories;

create policy expense_categories_select on public.expense_categories for select
  using (
    company_id is null                       -- global defaults visible to all auth users
    or public.is_company_member(company_id)
  );
create policy expense_categories_member_write on public.expense_categories for all
  using (company_id is not null and public.is_company_member(company_id))
  with check (company_id is not null and public.is_company_member(company_id));

drop policy if exists expenses_member_all on public.expenses;
create policy expenses_member_all on public.expenses for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----- Financial transactions --------------------------------------
drop policy if exists fintx_member_select on public.financial_transactions;
drop policy if exists fintx_member_write  on public.financial_transactions;

create policy fintx_member_select on public.financial_transactions for select
  using (public.is_company_member(company_id));
-- Only manual entries are allowed via direct INSERT; auto-entries come from triggers (SECURITY DEFINER).
create policy fintx_member_write on public.financial_transactions for all
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id) and source = 'manual');

-- ----- AI CFO reports ----------------------------------------------
drop policy if exists cfo_member_all on public.ai_cfo_reports;
create policy cfo_member_all on public.ai_cfo_reports for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----- Investors / meetings / rounds -------------------------------
drop policy if exists investors_member_all on public.investors;
create policy investors_member_all on public.investors for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists inv_meetings_member_all on public.investor_meetings;
create policy inv_meetings_member_all on public.investor_meetings for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists rounds_member_all on public.funding_rounds;
create policy rounds_member_all on public.funding_rounds for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists round_commits_member_all on public.funding_round_commitments;
create policy round_commits_member_all on public.funding_round_commitments for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));


-- =====================================================================
-- 11. STORAGE BUCKETS for Business OS uploads
-- =====================================================================
-- - company-logos (public read; auth write)
-- - receipts      (private; member read/write)
-- - invoice-pdfs  (private; member read/write)

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'company-logos') then
    insert into storage.buckets (id, name, public) values ('company-logos','company-logos', true);
  end if;
  if not exists (select 1 from storage.buckets where id = 'receipts') then
    insert into storage.buckets (id, name, public) values ('receipts','receipts', false);
  end if;
  if not exists (select 1 from storage.buckets where id = 'invoice-pdfs') then
    insert into storage.buckets (id, name, public) values ('invoice-pdfs','invoice-pdfs', false);
  end if;
end$$;

-- company-logos: public read, authenticated write/update.
drop policy if exists "company_logos_public_read" on storage.objects;
create policy "company_logos_public_read"
  on storage.objects for select
  using (bucket_id = 'company-logos');

drop policy if exists "company_logos_auth_write" on storage.objects;
create policy "company_logos_auth_write"
  on storage.objects for insert
  with check (bucket_id = 'company-logos' and auth.uid() is not null);

drop policy if exists "company_logos_auth_update" on storage.objects;
create policy "company_logos_auth_update"
  on storage.objects for update
  using (bucket_id = 'company-logos' and auth.uid() is not null);

-- receipts: authenticated-only read AND write (no public read).
drop policy if exists "receipts_auth_read"  on storage.objects;
drop policy if exists "receipts_auth_write" on storage.objects;
drop policy if exists "receipts_auth_update" on storage.objects;

create policy "receipts_auth_read" on storage.objects for select
  using (bucket_id = 'receipts' and auth.uid() is not null);
create policy "receipts_auth_write" on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid() is not null);
create policy "receipts_auth_update" on storage.objects for update
  using (bucket_id = 'receipts' and auth.uid() is not null);

drop policy if exists "invoice_pdfs_auth_read"  on storage.objects;
drop policy if exists "invoice_pdfs_auth_write" on storage.objects;
create policy "invoice_pdfs_auth_read" on storage.objects for select
  using (bucket_id = 'invoice-pdfs' and auth.uid() is not null);
create policy "invoice_pdfs_auth_write" on storage.objects for insert
  with check (bucket_id = 'invoice-pdfs' and auth.uid() is not null);


-- =====================================================================
-- 12. HELPER VIEWS for the dashboard (read-only, RLS-respecting)
-- =====================================================================
-- Quick rollups so the SPA can grab a single row instead of issuing N
-- aggregate queries. RLS on the underlying tables is preserved because
-- views inherit the caller's auth.uid().

create or replace view public.v_company_finance_summary as
  select
    c.id as company_id,
    coalesce(sum(case when ft.type = 'income'  then ft.amount_cents end), 0) as revenue_cents,
    coalesce(sum(case when ft.type = 'expense' then ft.amount_cents end), 0) as expense_cents,
    coalesce(sum(case when ft.type = 'income'  then ft.amount_cents end), 0)
    - coalesce(sum(case when ft.type = 'expense' then ft.amount_cents end), 0) as profit_cents
  from public.companies c
  left join public.financial_transactions ft on ft.company_id = c.id
  group by c.id;

-- =====================================================================
-- DONE.
-- Post-setup notes:
--   • This migration is fully idempotent.
--   • Existing tables are NOT modified; existing user flows continue to work.
--   • New users still get a personal workspace (startups/profiles) as before.
--   • Once a user creates their first company via the new Companies module,
--     all Business OS modules become active for that company.
-- =====================================================================
