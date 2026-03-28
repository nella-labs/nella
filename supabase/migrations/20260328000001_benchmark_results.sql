-- Benchmark results storage for feature metrics dashboard
create table if not exists benchmark_results (
  id uuid primary key default gen_random_uuid(),
  feature text not null,
  version text not null,
  run_date timestamptz not null default now(),
  corpus_stats jsonb not null,
  headline jsonb not null,
  by_category jsonb not null,
  by_difficulty jsonb not null,
  by_layer jsonb not null,
  raw_results_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists idx_benchmark_feature_date
  on benchmark_results(feature, run_date desc);

-- RLS policies
alter table benchmark_results enable row level security;

create policy "Admins can insert benchmark results"
  on benchmark_results for insert
  with check (true);

create policy "Authenticated users can read benchmark results"
  on benchmark_results for select
  using (true);
