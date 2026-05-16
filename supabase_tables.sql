-- Run this in Supabase SQL Editor to create the required tables

-- Saved grocery lists
create table if not exists saved_lists (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  items jsonb not null default '[]',
  created_at timestamptz default now()
);

alter table saved_lists enable row level security;

create policy "Users can manage their own lists"
  on saved_lists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Scan history
create table if not exists scan_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  barcode text not null,
  product_name text,
  brand text,
  image_url text,
  health_score int,
  grade text,
  is_clean boolean,
  scanned_at timestamptz default now()
);

alter table scan_history enable row level security;

create policy "Users can manage their own scan history"
  on scan_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast lookups
create index if not exists scan_history_user_id_idx on scan_history(user_id, scanned_at desc);
create index if not exists saved_lists_user_id_idx on saved_lists(user_id, created_at desc);
