-- ============================================================
-- CVMatch Pro — Supabase Complete Schema
-- Project: pgscdvsmlojpfitbzrmo
-- ============================================================
-- BEFORE RUNNING:
-- 1. Go to Authentication > URL Configuration > set Site URL to your domain
-- 2. Add redirect URLs: http://localhost:8080, https://your-github-pages-url
-- 3. After running this SQL, deploy edge functions:
--    supabase login
--    supabase link --project-ref pgscdvsmlojpfitbzrmo
--    supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY
--    supabase functions deploy analyse-cv
--    supabase functions deploy search-jobs
-- ============================================================

-- ── EXTENSIONS ──────────────────────────────────────────────
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

-- ── USER PROFILES ───────────────────────────────────────────
create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_initials text generated always as (upper(left(coalesce(full_name,'?'),2))) stored,
  preferred_regions text[] default ARRAY['worldwide','eu','brazil'],
  preferred_regime text default 'remote' check (preferred_regime in ('remote','hybrid','onsite','any')),
  preferred_languages text[] default ARRAY['portuguese','english'],
  ui_language text default 'pt' check (ui_language in ('pt','en','es','fr','de')),
  target_roles text[],
  linkedin_url text,
  github_url text,
  website_url text,
  location text,
  onboarded boolean default false,
  plan text default 'free' check (plan in ('free','pro','team')),
  analyses_used integer default 0,
  analyses_limit integer default 10,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── CVS ─────────────────────────────────────────────────────
create table if not exists cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'Meu CV',
  content text not null,
  file_name text,
  file_type text check (file_type in ('pdf','docx','txt','paste')),
  language text default 'pt',
  analysis jsonb,
  skills_primary text[],
  skills_secondary text[],
  languages_detected jsonb,
  experience_years integer,
  seniority text check (seniority in ('junior','mid','senior','principal','executive')),
  status text default 'pending' check (status in ('pending','analysing','done','error')),
  error_message text,
  last_analysed_at timestamptz,
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists cvs_user_id_idx on cvs(user_id);
create index if not exists cvs_status_idx on cvs(status);

-- ── JOBS ────────────────────────────────────────────────────
create table if not exists jobs (
  id text primary key,
  title text not null,
  company text not null,
  region text not null check (region in ('dach','eu','brazil','usa','worldwide')),
  country text,
  flag text,
  regime text default 'remote' check (regime in ('remote','hybrid','onsite')),
  languages_accepted text[] default ARRAY['english'],
  salary text default '—',
  salary_min integer,
  salary_max integer,
  salary_currency text default 'EUR',
  skills_required text[],
  skills_nice text[],
  experience_min integer default 0,
  seniority_target text,
  source text,
  url text not null,
  posted_at date default current_date,
  is_active boolean default true,
  views integer default 0,
  applications integer default 0,
  created_at timestamptz default now(),
  last_verified timestamptz default now()
);

create index if not exists jobs_region_idx on jobs(region);
create index if not exists jobs_regime_idx on jobs(regime);
create index if not exists jobs_active_idx on jobs(is_active);
create index if not exists jobs_posted_idx on jobs(posted_at desc);

-- ── MATCHES ─────────────────────────────────────────────────
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  cv_id uuid references cvs(id) on delete cascade not null,
  job_id text references jobs(id),
  match_score integer not null check (match_score between 0 and 100),
  lang_score integer,
  tech_score integer,
  exp_score integer,
  regime_score integer,
  hit_skills text[],
  miss_skills text[],
  created_at timestamptz default now(),
  unique(cv_id, job_id)
);

create index if not exists matches_cv_id_idx on matches(cv_id);
create index if not exists matches_score_idx on matches(match_score desc);

-- ── SAVED JOBS ──────────────────────────────────────────────
create table if not exists saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  job_id text references jobs(id) not null,
  cv_id uuid references cvs(id) on delete set null,
  notes text,
  status text default 'saved' check (status in ('saved','applied','interview','offer','rejected')),
  applied_at timestamptz,
  saved_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, job_id)
);

create index if not exists saved_jobs_user_idx on saved_jobs(user_id);
create index if not exists saved_jobs_status_idx on saved_jobs(status);

-- ── SEARCH HISTORY ──────────────────────────────────────────
create table if not exists search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  cv_id uuid references cvs(id) on delete set null,
  sources_searched text[],
  query_skills text[],
  jobs_found integer default 0,
  new_jobs integer default 0,
  searched_at timestamptz default now()
);

-- ── TRIGGERS ────────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into user_profiles (id, full_name, ui_language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'ui_language', 'pt')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists cvs_updated_at on cvs;
create trigger cvs_updated_at before update on cvs
  for each row execute function update_updated_at();

drop trigger if exists saved_jobs_updated_at on saved_jobs;
create trigger saved_jobs_updated_at before update on saved_jobs
  for each row execute function update_updated_at();

drop trigger if exists user_profiles_updated_at on user_profiles;
create trigger user_profiles_updated_at before update on user_profiles
  for each row execute function update_updated_at();

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
alter table user_profiles  enable row level security;
alter table cvs             enable row level security;
alter table jobs            enable row level security;
alter table matches         enable row level security;
alter table saved_jobs      enable row level security;
alter table search_history  enable row level security;

-- user_profiles
create policy "users own profile"      on user_profiles for all using (auth.uid() = id);

-- cvs
create policy "users own cvs"          on cvs for all using (auth.uid() = user_id);

-- jobs: public read
create policy "public read jobs"       on jobs for select using (true);
create policy "auth insert jobs"       on jobs for insert with check (auth.role() = 'authenticated');

-- matches
create policy "users own matches"      on matches for all using (auth.uid() = user_id);

-- saved_jobs
create policy "users own saved"        on saved_jobs for all using (auth.uid() = user_id);

-- search_history
create policy "users own history"      on search_history for all using (auth.uid() = user_id);

-- ── HELPER FUNCTIONS ────────────────────────────────────────
create or replace function get_user_stats(p_user_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'cv_count',    (select count(*) from cvs where user_id = p_user_id),
    'match_count', (select count(*) from matches where user_id = p_user_id),
    'saved_count', (select count(*) from saved_jobs where user_id = p_user_id),
    'applied_count',(select count(*) from saved_jobs where user_id = p_user_id and status = 'applied'),
    'top_match',   (select match_score from matches where user_id = p_user_id order by match_score desc limit 1),
    'jobs_total',  (select count(*) from jobs where is_active = true)
  ) into result;
  return result;
end;
$$;

-- ── JOB DATA ────────────────────────────────────────────────
insert into jobs (id,title,company,region,country,flag,regime,languages_accepted,salary,skills_required,skills_nice,experience_min,source,posted_at) values

('windhoff-datasphere-remote','Senior Consultant — SAP BW / SAP Datasphere','Windhoff Group','worldwide','Alemanha (Worldwide Remote)','🇩🇪','remote',ARRAY['english','german'],'~€90–130k',ARRAY['SAP BW','SAP Datasphere','data modeling','ETL'],ARRAY['BW/4HANA','SAP HANA','ABAP','Databricks'],5,'RemoteRocketship','2026-06-10'),

('verus-datasphere-datalake','Consultor SAP Datasphere & DataLake','Verus Brasil','brazil','Brasil — Remoto','🇧🇷','remote',ARRAY['portuguese','english'],'PJ / CLT',ARRAY['SAP Datasphere','Data Lake','SAP HANA','data modeling'],ARRAY['SAP BW','BW/4HANA','SAC','ETL','SQL'],5,'RemoteRocketship','2026-06-12'),

('verus-sac-planning-brasil','Senior SAP SAC Planning Consultant','Verus Brasil','brazil','Brasil — Worldwide Remote','🇧🇷','remote',ARRAY['portuguese','english'],'PJ / CLT',ARRAY['SAP Analytics Cloud','SAC Planning','BPC'],ARRAY['SAP BW','Datasphere','HANA','financial planning'],5,'RemoteRocketship','2026-06-15'),

('3m-consultancy-datasphere-architect-usa','Cloud Data & Analytics Architect — SAP BW/Datasphere','3M Consultancy','usa','USA — Remote','🇺🇸','remote',ARRAY['english'],'$125k–$222k',ARRAY['SAP BW','SAP Datasphere','cloud architecture','AWS','Azure','data migration'],ARRAY['GCP','ETL','data lake','SAC','BW/4HANA'],8,'Jobgether','2026-06-18'),

('comerit-sac-bw-analytics-usa','SAP SAC BW Analytics Lead Consultant','COMERIT','worldwide','USA — Remote Worldwide','🌐','remote',ARRAY['english'],'—',ARRAY['SAP Analytics Cloud','SAP BW','analytics','reporting','BI'],ARRAY['SAC Planning','Datasphere','BW/4HANA','HANA'],5,'Direct','2026-06-20'),

('epam-sac-consultant-spain','Senior SAP Analytics Cloud Consultant','EPAM Systems','eu','Espanha — Remoto EU','🇪🇸','remote',ARRAY['english'],'—',ARRAY['SAP Analytics Cloud','SAC','data modeling','BI','BTP'],ARRAY['BW/4HANA','S/4HANA','HANA','Datasphere'],5,'EPAM Careers','2026-06-19'),

('nttdata-datasphere-bw-london','Senior SAP Datasphere & BW Consultant','NTT DATA Business Solutions','eu','Londres, UK — Remote','🇬🇧','remote',ARRAY['english'],'—',ARRAY['SAP Datasphere','SAP BW','BW/4HANA','data warehouse','analytics'],ARRAY['SAC','HANA','CDS Views','ABAP','S/4HANA'],7,'WelcomeToTheJungle','2026-06-14'),

('solveplan-sac-planning-brasil','Consultor SAP Analytics Cloud Planning','SolvePlan','brazil','Brasil — Remoto','🇧🇷','remote',ARRAY['portuguese','english'],'PJ',ARRAY['SAP Analytics Cloud','SAC Planning','financial planning','BPC'],ARRAY['SAP BW','HANA','data modeling','reporting'],4,'Gupy','2026-06-22'),

('talan-datasphere-expert-eu','SAP Datasphere Expert','Talan','worldwide','França / Europa — Worldwide Remote','🇪🇺','remote',ARRAY['english','french'],'—',ARRAY['SAP Datasphere','data architecture','BI','cloud data'],ARRAY['SAP BW','BW/4HANA','SAC','HANA','data governance'],6,'RemoteRocketship','2026-06-08'),

('wireit-bw-consultant-portugal','SAP BI/BW Consultant','Wire IT','eu','Portugal — Remoto','🇵🇹','remote',ARRAY['portuguese','english'],'—',ARRAY['SAP BW','SAP BI','data warehouse','reporting','ETL'],ARRAY['BW/4HANA','Datasphere','SAC','HANA','ABAP'],4,'Jobgether','2026-06-21'),

('hcltech-sap-bw-hana-brasil','SAP BW HANA Consultant','HCLTech','brazil','Brasil — Remoto','🇧🇷','remote',ARRAY['portuguese','english'],'—',ARRAY['SAP BW','SAP HANA','analytics','data warehouse'],ARRAY['BW/4HANA','Datasphere','SAC','S/4HANA'],5,'HCLTech Careers','2026-06-17'),

('celver-sac-consultant-dach','SAP Analytics Cloud Consultant','celver AG','worldwide','Alemanha — Worldwide Remote','🇩🇪','remote',ARRAY['german','english'],'—',ARRAY['SAP Analytics Cloud','SAC','BI','planning','reporting'],ARRAY['BPC','SAP BW','Datasphere','HANA'],4,'RemoteRocketship','2026-06-11'),

('freelancermap-datasphere-migration','SAP Datasphere Migration Lead','FreelancerMap Client','eu','Europa — Remote EU','🇪🇺','remote',ARRAY['english'],'Freelance',ARRAY['SAP Datasphere','data migration','SAP BW','project lead'],ARRAY['BW/4HANA','HANA','ETL','data governance','CDS Views'],7,'FreelancerMap','2026-06-09'),

('adv-techminds-sac-datasphere','SAP SAC & Datasphere Consultant','ADV TechMinds','eu','Europa — Remoto','🇪🇺','remote',ARRAY['english'],'Freelance',ARRAY['SAP Analytics Cloud','SAP Datasphere','consulting'],ARRAY['SAP BW','BPC','HANA','data modeling'],5,'Direct','2026-06-13'),

('ndcgroup-datasphere-prague','SAP Datasphere Consultant','NDC Group','eu','Praga — Remote EU','🇨🇿','remote',ARRAY['english'],'—',ARRAY['SAP Datasphere','SAP BW','SAC','HANA','data modeling'],ARRAY['BW/4HANA','CDS Views','ABAP','ETL'],5,'NDC Group','2026-06-16'),

('3m-consultancy-sap-integration-architect','Solution Architect — SAP Data & Integration','3M Consultancy','worldwide','Worldwide Remote','🌐','remote',ARRAY['english'],'—',ARRAY['SAP','data integration','solution architecture','API','cloud'],ARRAY['SAP BW','Datasphere','BTP','CPI','HANA'],8,'Jobgether','2026-06-20')

on conflict (id) do update set
  is_active = excluded.is_active,
  last_verified = now();
