-- REVIEW AND APPROVE BEFORE RUNNING. Only Super Content's new tables/functions.
-- Prerequisite: 001_content_videos.sql. No changes to its schema or save RPC.
begin;
create table public.content_research_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 channels jsonb not null default '[]' check (jsonb_typeof(channels)='array' and jsonb_array_length(channels)<=10),
 keywords jsonb not null default '[]' check (jsonb_typeof(keywords)='array' and jsonb_array_length(keywords)<=5),
 mode text not null default 'channels' check (mode in ('channels','keywords','combined')),
 published_after date not null default current_date-30,
 published_before date not null default current_date,
 result_limit integer not null default 10 check (result_limit between 1 and 50),
 schedule jsonb not null default '{"enabled":false,"cadence":"daily","local_time":"09:00","timezone":"Asia/Bangkok"}' check (schedule->>'enabled'='false'),
 updated_at timestamptz not null default now(),
 check(published_before>=published_after and published_before-published_after<=366)
);
create table public.content_research_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'running' check(status in ('running','succeeded','failed')),
 started_at timestamptz not null default now(),completed_at timestamptz,
 found_count integer not null default 0,proposed_count integer not null default 0,api_units integer not null default 0,
 error_code text,error_message text,warnings jsonb not null default '[]',settings_snapshot jsonb not null default '{}'
);
create index content_research_runs_user_time on public.content_research_runs(user_id,started_at desc);
create table public.content_research_videos (
 user_id uuid not null references auth.users(id) on delete cascade,youtube_id text not null check(youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
 data jsonb not null,sources jsonb not null default '[]',analysis jsonb not null default '{}',
 collected_at timestamptz not null default now(),proposed_at timestamptz,
 status text not null default 'suggested' check(status in ('suggested','ignored','archived','accepted')),
 last_run_id uuid references public.content_research_runs(id),primary key(user_id,youtube_id)
);
create table public.content_research_snapshots (
 user_id uuid not null,youtube_id text not null,captured_at timestamptz not null default now(),
 views bigint not null check(views>=0),likes bigint check(likes>=0),comments bigint check(comments>=0),
 primary key(user_id,youtube_id,captured_at),
 foreign key(user_id,youtube_id) references public.content_research_videos(user_id,youtube_id) on delete cascade
);
create table public.content_research_links (
 user_id uuid not null references auth.users(id) on delete cascade,youtube_id text not null,
 video_id uuid not null references public.content_videos(id),snapshot jsonb not null,
 origin text not null default 'youtube',created_at timestamptz not null default now(),primary key(user_id,youtube_id)
);
-- Generic idempotency ledger reserved for approved ChatGPT/MCP batches and other future sources.
create table public.content_research_imports (
 user_id uuid not null references auth.users(id) on delete cascade,
 source text not null check(source in ('youtube','chatgpt')),
 external_id text not null check(length(external_id) between 1 and 200),
 batch_id uuid,video_id uuid not null references public.content_videos(id),
 created_at timestamptz not null default now(),primary key(user_id,source,external_id)
);
-- Future authenticated integration preferences; no MCP endpoint or scheduler is enabled.
create table public.content_research_integrations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 notification_preferences jsonb not null default '{"enabled":false}',
 mcp_enabled boolean not null default false check(mcp_enabled=false)
);
do $$ declare t text; begin
 foreach t in array array['content_research_settings','content_research_runs','content_research_videos','content_research_snapshots','content_research_links','content_research_integrations','content_research_imports'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_read on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create policy owner_insert on public.content_research_settings for insert to authenticated with check(user_id=(select auth.uid()));
create policy owner_update on public.content_research_settings for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant insert,update on public.content_research_settings to authenticated;

-- Service-only, atomic quota/lease across all API server instances.
create function public.begin_content_research_scan(p_user_id uuid,p_settings jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare run_id uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,42));
 update public.content_research_runs set status='failed',completed_at=now(),error_code='LEASE_EXPIRED',error_message='Lần quét trước bị gián đoạn.' where user_id=p_user_id and status='running' and started_at<now()-interval '5 minutes';
 if exists(select 1 from public.content_research_runs where user_id=p_user_id and status='running') then raise exception 'SCAN_RUNNING'; end if;
 if exists(select 1 from public.content_research_runs where user_id=p_user_id and started_at>now()-interval '60 seconds') then raise exception 'SCAN_COOLDOWN'; end if;
 if (select count(*) from public.content_research_runs where user_id=p_user_id and started_at>now()-interval '24 hours')>=10 then raise exception 'SCAN_DAILY_LIMIT'; end if;
 insert into public.content_research_runs(user_id,settings_snapshot) values(p_user_id,p_settings) returning id into run_id;
 return run_id;
end $$;
revoke all on function public.begin_content_research_scan(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_content_research_scan(uuid,jsonb) to service_role;

-- A scan refresh must never reset accepted/archived/ignored state, even during a concurrent acceptance.
create function public.persist_content_research_scan(p_user_id uuid,p_run_id uuid,p_items jsonb,p_captured_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>2000 then raise exception 'Invalid scan batch'; end if;
 if not exists(select 1 from public.content_research_runs where id=p_run_id and user_id=p_user_id and status='running') then raise exception 'Invalid run'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
 insert into public.content_research_videos as current(user_id,youtube_id,data,sources,analysis,collected_at,proposed_at,last_run_id)
 values(p_user_id,item->>'youtube_id',item,item->'sources',item->'analysis',p_captured_at,case when (item->>'proposed')::boolean then p_captured_at else null end,p_run_id)
 on conflict(user_id,youtube_id) do update set
 data=excluded.data,analysis=excluded.analysis,collected_at=excluded.collected_at,last_run_id=excluded.last_run_id,
 proposed_at=coalesce(current.proposed_at,excluded.proposed_at),
 sources=(select coalesce(jsonb_agg(distinct value),'[]') from jsonb_array_elements(current.sources||excluded.sources));
 insert into public.content_research_snapshots(user_id,youtube_id,captured_at,views,likes,comments)
 values(p_user_id,item->>'youtube_id',p_captured_at,(item->>'views')::bigint,(item->>'likes')::bigint,(item->>'comments')::bigint)
 on conflict(user_id,youtube_id,captured_at) do nothing;
 end loop;
end $$;
revoke all on function public.persist_content_research_scan(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.persist_content_research_scan(uuid,uuid,jsonb,timestamptz) to service_role;

-- Atomic acceptance: unique YouTube ID per account, no copies, no overwrite of existing scripts.
create function public.accept_content_research(p_ids text[])
returns setof public.content_videos language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();yt text;r public.content_research_videos;target uuid;history jsonb;
begin
 if uid is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 if coalesce(array_length(p_ids,1),0) not between 1 and 50 then raise exception 'Select 1 to 50 videos'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,43));
 foreach yt in array p_ids loop
 select * into r from public.content_research_videos where user_id=uid and youtube_id=yt and proposed_at is not null;
 if not found then raise exception 'Proposal not found' using errcode='42501'; end if;
 select video_id into target from public.content_research_links where user_id=uid and youtube_id=yt;
 if target is null then
 select id into target from public.content_videos where user_id=uid and source_url ~ '^https?://(www\.|m\.)?(youtube\.com|youtu\.be)/' and substring(source_url from '(?:v=|youtu.be/|shorts/|embed/)([A-Za-z0-9_-]{11})')=yt order by created_at limit 1;
 if target is null then
 target:=gen_random_uuid();
 insert into public.content_videos(id,user_id,title,stage,source_url,notes)
 values(target,uid,r.data->>'title','ideas',r.data->>'url','Nguồn: '||(r.data->>'channel')||E'\nNghiên cứu: '||coalesce(r.analysis->>'angle','')||E'\nThông tin và thống kê được giữ trong hồ sơ nghiên cứu.');
 end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by captured_at),'[]') into history from public.content_research_snapshots s where user_id=uid and youtube_id=yt;
 insert into public.content_research_links(user_id,youtube_id,video_id,snapshot) values(uid,yt,target,jsonb_build_object('video',to_jsonb(r),'statistics',history));
 end if;
 insert into public.content_research_imports(user_id,source,external_id,video_id) values(uid,'youtube',yt,target) on conflict(user_id,source,external_id) do nothing;
 update public.content_research_videos set status='accepted' where user_id=uid and youtube_id=yt;
 return query select * from public.content_videos where user_id=uid and id=target;
 end loop;
end $$;
revoke all on function public.accept_content_research(text[]) from public,anon;
grant execute on function public.accept_content_research(text[]) to authenticated;
create function public.set_content_research_status(p_ids text[],p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_status not in ('suggested','ignored','archived') or coalesce(array_length(p_ids,1),0) not between 1 and 50 then raise exception 'Invalid action'; end if;
 update public.content_research_videos set status=p_status where user_id=auth.uid() and youtube_id=any(p_ids) and status<>'accepted' and proposed_at is not null;
end $$;
revoke all on function public.set_content_research_status(text[],text) from public,anon;
grant execute on function public.set_content_research_status(text[],text) to authenticated;
commit;
