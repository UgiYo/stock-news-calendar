alter table public.news add column if not exists article_summary text;
alter table public.news add column if not exists summary_status text;
alter table public.news add column if not exists summary_method text;
alter table public.news add column if not exists summary_error text;
alter table public.news add column if not exists summary_updated_at timestamptz;
alter table public.news add column if not exists article_url text;
