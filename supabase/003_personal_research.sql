-- APPROVAL REQUIRED. Apply after 001 and 002. No changes to either historical file or Super Day.
begin;
alter table public.content_research_settings drop constraint content_research_settings_channels_check;
alter table public.content_research_settings add constraint content_research_settings_channels_check check(jsonb_typeof(channels)='array' and jsonb_array_length(channels)<=500);
create table public.content_research_channels (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 url text not null,canonical_url text not null,title text not null default '',youtube_channel_id text,uploads text,
 topic_group text not null default '',enabled boolean not null default true,
 last_checked_at timestamptz,last_video_at timestamptz,duplicate_of uuid references public.content_research_channels(id),
 updated_at timestamptz not null default now(),unique(user_id,canonical_url)
);
create unique index content_research_channel_identity on public.content_research_channels(user_id,youtube_channel_id) where youtube_channel_id is not null and duplicate_of is null;
insert into public.content_research_channels(user_id,url,canonical_url,title,topic_group,enabled)
 select s.user_id,c->>'url',c->>'url',coalesce(c->>'title',''),'',true from public.content_research_settings s cross join lateral jsonb_array_elements(s.channels) c where c->>'url' is not null on conflict do nothing;
create table public.content_criteria_versions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 revision integer not null,content jsonb not null,created_at timestamptz not null default now(),unique(user_id,revision)
);
create table public.content_criteria_profiles(user_id uuid primary key references auth.users(id) on delete cascade,version_id uuid not null references public.content_criteria_versions(id));
create table public.content_research_feedback (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 youtube_id text not null,decision text not null check(decision in ('chosen','later','rejected','excellent')),reason text not null default '',
 criteria_version uuid references public.content_criteria_versions(id),evaluated_version uuid references public.content_criteria_versions(id),video_snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create table public.content_preference_memories (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 feedback_id uuid references public.content_research_feedback(id),text text not null check(length(text) between 1 and 2000),video_title text not null default '',
 preference text not null check(preference in ('positive','negative')),confirmed boolean not null default false,updated_at timestamptz not null default now(),unique(user_id,feedback_id)
);
create table public.content_research_evaluations (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 youtube_id text not null,criteria_version uuid references public.content_criteria_versions(id),run_id uuid references public.content_research_runs(id),
 explanation jsonb not null,created_at timestamptz not null default now()
);
create index content_research_feedback_user_time on public.content_research_feedback(user_id,created_at desc);
create index content_research_evaluation_user_time on public.content_research_evaluations(user_id,created_at desc);
create table public.content_research_jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 run_id uuid not null references public.content_research_runs(id),status text not null default 'pending' check(status in ('pending','running','paused','completed','cancelled')),
 settings jsonb not null,criteria_version uuid references public.content_criteria_versions(id),tasks jsonb not null,cursor integer not null default 0,
 lease_token uuid,leased_until timestamptz,error_code text,error_message text,api_units integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index one_content_research_job on public.content_research_jobs(user_id) where status in ('pending','running','paused');
do $$ declare t text;begin
 foreach t in array array['content_research_channels','content_criteria_versions','content_criteria_profiles','content_research_feedback','content_preference_memories','content_research_evaluations','content_research_jobs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create policy memory_insert on public.content_preference_memories for insert to authenticated with check(user_id=auth.uid() and (feedback_id is null or exists(select 1 from public.content_research_feedback f where f.id=feedback_id and f.user_id=auth.uid())));
create policy memory_update on public.content_preference_memories for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and (feedback_id is null or exists(select 1 from public.content_research_feedback f where f.id=feedback_id and f.user_id=auth.uid())));
create policy memory_delete on public.content_preference_memories for delete to authenticated using(user_id=auth.uid());
grant insert,update,delete on public.content_preference_memories to authenticated;

create function public.save_content_criteria(p_content jsonb,p_expected_revision integer)
returns public.content_criteria_versions language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();ver public.content_criteria_versions;rev integer;k text;total numeric:=0;
begin
 if uid is null then raise exception 'Unauthorized' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,51));
 select coalesce(max(revision),0) into rev from public.content_criteria_versions where user_id=uid;
 if rev<>p_expected_revision then raise exception 'CRITERIA_CONFLICT';end if;
 foreach k in array array['positioning','audience','topics','worthwhile','avoid','examples'] loop
 if jsonb_typeof(p_content->k)<>'string' or length(p_content->>k)>12000 or p_content->k is null then raise exception 'Invalid criteria';end if;
 end loop;
 foreach k in array array['growth','engagement','relevance','novelty','potential'] loop
 if jsonb_typeof(p_content->'weights'->k)<>'number' or p_content->'weights'->k is null then raise exception 'Invalid weights';end if;
 if (p_content->'weights'->>k)::numeric not between 0 and 100 then raise exception 'Invalid weights';end if;
 total:=total+(p_content->'weights'->>k)::numeric;
 end loop;
 if total<=0 then raise exception 'Invalid weights';end if;
 insert into public.content_criteria_versions(user_id,revision,content) values(uid,rev+1,p_content) returning * into ver;
 insert into public.content_criteria_profiles(user_id,version_id) values(uid,ver.id) on conflict(user_id) do update set version_id=excluded.version_id;
 return ver;
end $$;
create function public.save_content_channels(p_channels jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c jsonb;num integer;
begin
 if uid is null then raise exception 'Unauthorized' using errcode='42501';end if;
 if jsonb_typeof(p_channels)<>'array' or jsonb_array_length(p_channels)>500 then raise exception 'CHANNEL_LIMIT';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,52));
 for c in select value from jsonb_array_elements(p_channels) loop
 if coalesce(c->>'canonical_url','') !~ '^https://www.youtube.com/(@[^/[:space:]]+|channel/UC[A-Za-z0-9_-]{22}|user/[A-Za-z0-9_.-]+)$' or length(coalesce(c->>'topic_group',''))>100 then raise exception 'Invalid channel URL';end if;
 insert into public.content_research_channels(user_id,url,canonical_url,title,topic_group,enabled) values(uid,c->>'canonical_url',c->>'canonical_url',coalesce(c->>'title',''),coalesce(c->>'topic_group',''),coalesce((c->>'enabled')::boolean,true))
 on conflict(user_id,canonical_url) do update set topic_group=excluded.topic_group,enabled=excluded.enabled,updated_at=now();
 end loop;
 select count(*) into num from public.content_research_channels where user_id=uid;
 if num>500 then raise exception 'CHANNEL_LIMIT';end if;
 return num;
end $$;
create function public.delete_content_channel(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501';end if;
 update public.content_research_channels set duplicate_of=null where user_id=auth.uid() and duplicate_of=p_id;
 delete from public.content_research_channels where id=p_id and user_id=auth.uid();
end $$;
create function public.record_content_feedback(p_youtube_id text,p_decision text,p_reason text)
returns public.content_research_feedback language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();v public.content_research_videos;f public.content_research_feedback;cv uuid;ev uuid;
begin
 if uid is null then raise exception 'Unauthorized' using errcode='42501';end if;
 select * into v from public.content_research_videos where user_id=uid and youtube_id=p_youtube_id and proposed_at is not null;
 if not found then raise exception 'Proposal not found' using errcode='42501';end if;
 if p_decision not in ('chosen','later','rejected','excellent') or length(p_reason)>2000 then raise exception 'Invalid feedback';end if;
 select version_id into cv from public.content_criteria_profiles where user_id=uid;
 select id into ev from public.content_criteria_versions where user_id=uid and id=nullif(v.analysis->>'criteria_version','')::uuid;
 insert into public.content_research_feedback(user_id,youtube_id,decision,reason,criteria_version,evaluated_version,video_snapshot) values(uid,p_youtube_id,p_decision,coalesce(p_reason,''),cv,ev,v.data) returning * into f;
 return f;
end $$;

-- Service-only job creation/claim/commit. One short leased step per HTTP request.
create function public.start_content_research_job(p_user_id uuid,p_settings jsonb,p_tasks jsonb)
returns public.content_research_jobs language plpgsql security definer set search_path='' as $$
declare job public.content_research_jobs;run uuid;cv uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,53));
 select * into job from public.content_research_jobs where user_id=p_user_id and status in ('pending','running','paused');
 if found then return job;end if;
 if jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks)>506 or jsonb_array_length(p_tasks)<1 then raise exception 'Invalid tasks';end if;
 run:=public.begin_content_research_scan(p_user_id,p_settings);
 select version_id into cv from public.content_criteria_profiles where user_id=p_user_id;
 insert into public.content_research_jobs(user_id,run_id,settings,tasks,criteria_version) values(p_user_id,run,p_settings,p_tasks,cv) returning * into job;
 return job;
end $$;
create function public.claim_content_research_step(p_user_id uuid,p_job_id uuid)
returns public.content_research_jobs language plpgsql security definer set search_path='' as $$
declare job public.content_research_jobs;
begin
 select * into job from public.content_research_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found then raise exception 'Job not found';end if;
 if job.status in ('completed','cancelled') then return job;end if;
 if job.leased_until>now() then raise exception 'JOB_BUSY';end if;
 update public.content_research_jobs set status='running',lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',error_code=null,error_message=null,updated_at=now() where id=job.id returning * into job;
 return job;
end $$;
create function public.commit_content_research_step(p_user_id uuid,p_job_id uuid,p_token uuid,p_items jsonb,p_task jsonb,p_done boolean,p_units integer,p_channel jsonb,p_error text default null)
returns public.content_research_jobs language plpgsql security definer set search_path='' as $$
declare j public.content_research_jobs;item jsonb;target uuid;ch uuid;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>2000 then raise exception 'Invalid batch';end if;
 select * into j from public.content_research_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found or j.lease_token is distinct from p_token or j.leased_until<now() then raise exception 'STALE_LEASE';end if;
 if p_error is not null then
 update public.content_research_jobs set api_units=api_units+greatest(p_units,0),status='paused',error_code='STEP_FAILED',error_message=left(p_error,500),lease_token=null,leased_until=null,updated_at=now() where id=j.id returning * into j;return j;
 end if;
 -- Cache-only evaluation updates the assessment, never invents a new YouTube collection timestamp/snapshot.
 if (j.tasks->j.cursor)->>'type'='evaluate' then
 for item in select value from jsonb_array_elements(p_items) loop
 update public.content_research_videos set analysis=item->'analysis',proposed_at=coalesce(proposed_at,case when (item->>'proposed')::boolean then now() else null end),last_run_id=j.run_id where user_id=p_user_id and youtube_id=item->>'youtube_id';
 end loop;
 else
 select coalesce(jsonb_agg(case when v->'analysis'='{}'::jsonb then jsonb_set(v,'{analysis}',coalesce((select analysis from public.content_research_videos where user_id=p_user_id and youtube_id=v->>'youtube_id'),'{}')) else v end),'[]') into p_items from jsonb_array_elements(p_items) v;
 perform public.persist_content_research_scan(p_user_id,j.run_id,p_items,now());end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if item ? 'analysis' and (item->'analysis') ? 'criteria_version' then
 insert into public.content_research_evaluations(user_id,youtube_id,criteria_version,run_id,explanation) values(p_user_id,item->>'youtube_id',j.criteria_version,j.run_id,item->'analysis');
 end if;
 end loop;
 if p_channel is not null then
 ch:=(p_channel->>'row_id')::uuid;
 select id into target from public.content_research_channels where user_id=p_user_id and youtube_channel_id=p_channel->>'id' and id<>ch and duplicate_of is null limit 1;
 if target is not null then
 update public.content_research_channels set enabled=false,duplicate_of=target,last_checked_at=now(),updated_at=now() where id=ch and user_id=p_user_id;
 else
 update public.content_research_channels set youtube_channel_id=p_channel->>'id',title=p_channel->>'title',uploads=p_channel->>'uploads',last_checked_at=now(),last_video_at=coalesce((p_channel->>'latest')::timestamptz,last_video_at),updated_at=now() where id=ch and user_id=p_user_id;
 end if;
 end if;
 if p_done then j.cursor:=j.cursor+1;else j.tasks:=jsonb_set(j.tasks,array[j.cursor::text],p_task);end if;
 update public.content_research_jobs set cursor=j.cursor,tasks=j.tasks,api_units=api_units+greatest(p_units,0),status=case when j.cursor>=jsonb_array_length(j.tasks) then 'completed' else 'pending' end,lease_token=null,leased_until=null,updated_at=now() where id=j.id returning * into j;
 if j.status='completed' then update public.content_research_runs set status='succeeded',completed_at=now(),api_units=j.api_units,proposed_count=(select count(*) from jsonb_array_elements(p_items) i where (i->>'proposed')::boolean),found_count=jsonb_array_length(p_items),warnings='["Mẫu hữu hạn; đánh giá chỉ dùng tiêu đề, mô tả và số liệu công khai."]' where id=j.run_id and user_id=p_user_id;end if;
 return j;
end $$;
create function public.cancel_content_research_job(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare run uuid;
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501';end if;
 update public.content_research_jobs set status='cancelled',lease_token=null,leased_until=null,updated_at=now() where id=p_id and user_id=auth.uid() and status in ('pending','running','paused') returning run_id into run;
 update public.content_research_runs set status='failed',completed_at=now(),error_code='USER_CANCELLED',error_message='Người dùng hủy tiến trình.' where id=run and user_id=auth.uid();
end $$;
do $$ declare sig text;begin
 foreach sig in array array['save_content_criteria(jsonb,integer)','save_content_channels(jsonb)','delete_content_channel(uuid)','record_content_feedback(text,text,text)','cancel_content_research_job(uuid)'] loop
 execute 'revoke all on function public.'||sig||' from public,anon';execute 'grant execute on function public.'||sig||' to authenticated';end loop;
 foreach sig in array array['start_content_research_job(uuid,jsonb,jsonb)','claim_content_research_step(uuid,uuid)','commit_content_research_step(uuid,uuid,uuid,jsonb,jsonb,boolean,integer,jsonb,text)'] loop
 execute 'revoke all on function public.'||sig||' from public,anon,authenticated';execute 'grant execute on function public.'||sig||' to service_role';end loop;
end $$;
commit;
