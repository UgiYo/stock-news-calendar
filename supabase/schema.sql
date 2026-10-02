create table public.companies (
 code text primary key, name text not null, full_name text not null, market text not null check(market in ('上市','上櫃')),
 last_collected_at timestamptz, last_error text, collecting_until timestamptz
);
create table public.watchlists (
 user_id uuid not null references auth.users(id) on delete cascade,
 company_code text not null references public.companies(code), created_at timestamptz not null default now(),
 primary key(user_id,company_code)
);
create table public.news (
 id bigint generated always as identity primary key, company_code text not null references public.companies(code),
 title text not null, url text not null check(url ~ '^https?://'), source text not null,
 published_at timestamptz not null, news_date date not null, collected_at timestamptz not null default now(),
 unique(company_code,url)
);
create index news_company_date on public.news(company_code,news_date);
alter table public.companies enable row level security;
alter table public.watchlists enable row level security;
alter table public.news enable row level security;
create policy company_read on public.companies for select to authenticated using(true);
create policy own_watchlist on public.watchlists for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy tracked_news on public.news for select to authenticated using(exists(select 1 from public.watchlists w where w.user_id=auth.uid() and w.company_code=news.company_code));
grant select on public.companies,public.news to authenticated;
grant select,insert,update,delete on public.watchlists to authenticated;
revoke all on public.companies,public.watchlists,public.news from anon;
create function public.search_companies(query text) returns setof public.companies language sql stable security invoker set search_path=public as $$
 select * from companies where code=trim(query) or name ilike '%'||replace(replace(replace(trim(query),'\','\\'),'%','\%'),'_','\_')||'%' or full_name ilike '%'||replace(replace(replace(trim(query),'\','\\'),'%','\%'),'_','\_')||'%'
 order by (code=trim(query)) desc,(name=trim(query)) desc,code limit 20;
$$;
revoke execute on function public.search_companies(text) from public,anon;
grant execute on function public.search_companies(text) to authenticated;
create function public.claim_collection(stock_code text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update companies set collecting_until=now()+interval '3 minutes' where code=stock_code and (collecting_until is null or collecting_until<now()) and (last_collected_at is null or last_collected_at<now()-interval '15 minutes');
 return found;
end;$$;
revoke execute on function public.claim_collection(text) from public,anon,authenticated;
grant execute on function public.claim_collection(text) to service_role;
alter table public.news add column if not exists article_summary text;
alter table public.news add column if not exists summary_status text;
alter table public.news add column if not exists summary_method text;
alter table public.news add column if not exists summary_error text;
alter table public.news add column if not exists summary_updated_at timestamptz;
alter table public.news add column if not exists article_url text;
