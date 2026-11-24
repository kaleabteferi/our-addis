-- Our Addis: private two-person places & memories log.
-- Only the first two accounts that sign up become members; everyone else sees nothing.

create extension if not exists pgcrypto;

-- ---------- members (max 2) ----------
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(424242);
  if (select count(*) from public.members) < 2 then
    insert into public.members(user_id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- places ----------
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  lat double precision not null,
  lng double precision not null,
  area text not null default '',
  kind text not null default 'restaurant',      -- restaurant | cafe | bar | bakery | park | culture | other
  cuisine text not null default '',             -- habesha, kitfo, italian, burgers ...
  fasting_friendly boolean not null default false,
  price_level smallint check (price_level between 1 and 4),
  notes text not null default '',
  wishlist boolean not null default false,       -- "want to try"
  osm_id text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- visits ----------
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  visited_on date not null default current_date,
  occasion text not null default '',
  ordered text not null default '',
  food_review text not null default '',
  place_review text not null default '',
  r_food smallint check (r_food between 1 and 5),
  r_vibe smallint check (r_vibe between 1 and 5),
  r_service smallint check (r_service between 1 and 5),
  r_value smallint check (r_value between 1 and 5),
  spent_birr numeric(10,2) check (spent_birr >= 0),
  fasting boolean not null default false,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists visits_place_idx on public.visits(place_id);
create index if not exists visits_date_idx on public.visits(visited_on desc);

-- ---------- photos ----------
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  path text not null,
  width int, height int,
  caption text not null default '',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists photos_visit_idx on public.photos(visit_id);

-- ---------- AI recommendation history ----------
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  request jsonb not null,
  result jsonb not null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- row level security: members only ----------
alter table public.members enable row level security;
alter table public.places enable row level security;
alter table public.visits enable row level security;
alter table public.photos enable row level security;
alter table public.recommendations enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member());
drop policy if exists members_rename on public.members;
create policy members_rename on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['places','visits','photos'] loop
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format('create policy %I_all on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t, t);
  end loop;
end $$;

drop policy if exists recs_read on public.recommendations;
create policy recs_read on public.recommendations for select to authenticated using (public.is_member());
drop policy if exists recs_delete on public.recommendations;
create policy recs_delete on public.recommendations for delete to authenticated using (public.is_member());
-- inserts into recommendations happen only from the edge function (service role).

-- ---------- private photo bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memories', 'memories', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists memories_read on storage.objects;
create policy memories_read on storage.objects for select to authenticated using (bucket_id = 'memories' and public.is_member());
drop policy if exists memories_insert on storage.objects;
create policy memories_insert on storage.objects for insert to authenticated with check (bucket_id = 'memories' and public.is_member());
drop policy if exists memories_delete on storage.objects;
create policy memories_delete on storage.objects for delete to authenticated using (bucket_id = 'memories' and public.is_member());
