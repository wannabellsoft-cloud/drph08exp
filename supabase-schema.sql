-- =============================================================
-- Short EXP Manager — Supabase / Postgres schema
-- Paste this whole file into Supabase SQL Editor and Run.
-- =============================================================

-- ---------- TABLES ----------
create table if not exists items (
  "itemNo"       text primary key,
  description    text,
  description2   text,
  barcode        text,
  "baseUom"      text,
  stock          numeric
);
create index if not exists items_barcode_idx on items(barcode);

create table if not exists ledger (
  "entryNo"             bigint primary key,
  "postingDate"         text,
  "entryType"           text,
  "documentType"        text,
  "documentNo"          text,
  "externalDocNo"       text,
  "itemNo"              text,
  description           text,
  "lotNo"               text,
  "expirationDate"      text,
  "locationCode"        text,
  quantity              numeric,
  "remainingQuantity"   numeric,
  uom                   text
);
create index if not exists ledger_itemNo_idx       on ledger("itemNo");
create index if not exists ledger_externalDocNo_idx on ledger("externalDocNo");

create table if not exists transfers (
  id              text primary key,
  "externalDocNo" text,
  "storeFrom"     text,
  "locationFrom"  text,
  "storeTo"       text,
  "locationTo"    text,
  "createdAt"     timestamptz default now(),
  "closedAt"      timestamptz,
  closed          boolean default false,
  applied         boolean default false,
  "appliedAt"     timestamptz,
  "cartonNo"      text,
  note            text,
  lines           jsonb default '[]'
);
create index if not exists transfers_createdAt_idx     on transfers("createdAt" desc);
create index if not exists transfers_externalDocNo_idx on transfers("externalDocNo");

create table if not exists journal (
  id                    text primary key,
  "documentNo"          text not null,
  "itemNo"              text,
  description           text,
  "locationCode"        text default '60008-EXP',
  quantity              numeric default 0,
  uom                   text,
  "oldLotNo"            text,
  "oldExpirationDate"   text,
  "newLotNo"            text,
  "newExpirationDate"   text,
  "postingDate"         text,
  "createdAt"           timestamptz default now(),
  exported              boolean default false,
  "exportedAt"          timestamptz,
  applied               boolean default false,
  "appliedAt"           timestamptz,
  note                  text
);
alter table journal add column if not exists "cartonId" text;
create index if not exists journal_createdAt_idx  on journal("createdAt" desc);
create index if not exists journal_documentNo_idx on journal("documentNo");
create index if not exists journal_exported_idx   on journal(exported);
create index if not exists journal_applied_idx    on journal(applied);
create index if not exists journal_cartonId_idx   on journal("cartonId");

-- ---------- RPC HELPERS ----------
create or replace function distinct_external_docs()
returns setof text language sql as $$
  select distinct "externalDocNo"
  from ledger
  where "externalDocNo" is not null and "externalDocNo" <> '';
$$;

create or replace function distinct_document_nos()
returns setof text language sql as $$
  select distinct "documentNo"
  from ledger
  where "documentNo" is not null and "documentNo" <> '';
$$;

create or replace function truncate_items()     returns void language sql as $$ truncate items;     $$;
create or replace function truncate_ledger()    returns void language sql as $$ truncate ledger;    $$;
create or replace function truncate_transfers() returns void language sql as $$ truncate transfers; $$;
create or replace function truncate_journal()   returns void language sql as $$ truncate journal;   $$;

-- ---------- ROW-LEVEL SECURITY ----------
-- Open access for the anon role. This app uses no auth.
-- For production, protect the deployed URL itself (e.g., Vercel Password
-- Protection, Cloudflare Access) or replace these policies with auth-based
-- ones.
alter table items     enable row level security;
alter table ledger    enable row level security;
alter table transfers enable row level security;
alter table journal   enable row level security;

drop policy if exists "anon all items"     on items;
drop policy if exists "anon all ledger"    on ledger;
drop policy if exists "anon all transfers" on transfers;
drop policy if exists "anon all journal"   on journal;

create policy "anon all items"     on items     for all to anon using (true) with check (true);
create policy "anon all ledger"    on ledger    for all to anon using (true) with check (true);
create policy "anon all transfers" on transfers for all to anon using (true) with check (true);
create policy "anon all journal"   on journal   for all to anon using (true) with check (true);
