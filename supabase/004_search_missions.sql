-- REVIEW AND APPROVE before production. Apply once after 001–003; no automatic migration.
begin;
create function public.content_search_capabilities() returns integer language sql security definer set search_path='' as $$select 4$$;
revoke all on function public.content_search_capabilities() from public,anon,authenticated;
grant execute on function public.content_search_capabilities() to service_role;
create table public.content_search_tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 120), spec jsonb not null check(jsonb_typeof(spec)='object' and octet_length(spec::text)<=131072),
 revision integer not null default 1, last_run_at timestamptz,
 schedule jsonb not null default '{"enabled":false,"cadence":"weekly"}' check(schedule->>'enabled'='false'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index content_search_tasks_owner on public.content_search_tasks(user_id,updated_at desc);
alter table public.content_search_tasks enable row level security;
create policy owner_read on public.content_search_tasks for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.content_search_tasks from anon,authenticated;
grant select on public.content_search_tasks to authenticated;
grant all on public.content_search_tasks to service_role;
create function public.save_content_search_task(p_id uuid,p_name text,p_spec jsonb,p_revision integer)
returns public.content_search_tasks language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r public.content_search_tasks;
begin
 if uid is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,54));
 if p_revision=0 then
 if (select count(*) from public.content_search_tasks where user_id=uid)>=100 then raise exception 'TASK_LIMIT';end if;
 insert into public.content_search_tasks(id,user_id,name,spec) values(p_id,uid,p_name,p_spec) returning * into r;
 else
 update public.content_search_tasks set name=p_name,spec=p_spec,revision=revision+1,updated_at=now() where id=p_id and user_id=uid and revision=p_revision returning * into r;
 if not found then raise exception 'TASK_CONFLICT';end if;
 end if; return r;
end $$;
create table public.content_search_ai_usage (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid not null references public.content_research_jobs(id),phase text not null check(phase in ('plan','evaluate')),created_at timestamptz not null default now()
);
create index content_search_ai_usage_owner on public.content_search_ai_usage(user_id,created_at desc);
alter table public.content_search_ai_usage enable row level security;
revoke all on public.content_search_ai_usage from anon,authenticated;
grant all on public.content_search_ai_usage to service_role;
create function public.reserve_content_search_ai(p_user_id uuid,p_job_id uuid,p_phase text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,55));
 if not exists(select 1 from public.content_research_jobs where id=p_job_id and user_id=p_user_id and status='running' and leased_until>now()) then raise exception 'JOB_ACCESS';end if;
 if (select count(*) from public.content_search_ai_usage where user_id=p_user_id and created_at>now()-interval '24 hours')>=30 or
 (select count(*) from public.content_search_ai_usage where job_id=p_job_id and phase=p_phase)>=3 then raise exception 'AI_BUDGET';end if;
 insert into public.content_search_ai_usage(user_id,job_id,phase) values(p_user_id,p_job_id,p_phase);
end $$;
-- Preserve the v3 commit implementation and wrap it with atomic plan expansion.
alter function public.commit_content_research_step(uuid,uuid,uuid,jsonb,jsonb,boolean,integer,jsonb,text) rename to commit_content_research_step_v3;
create function public.commit_content_research_step(p_user_id uuid,p_job_id uuid,p_token uuid,p_items jsonb,p_task jsonb,p_done boolean,p_units integer,p_channel jsonb,p_error text default null)
returns public.content_research_jobs language plpgsql security definer set search_path='' as $$
declare j public.content_research_jobs; plan jsonb; task_id uuid;
begin
 select * into j from public.content_research_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found or j.lease_token is distinct from p_token or j.lease_token is null or j.leased_until<now() then raise exception 'STALE_LEASE';end if;
 if p_error is null and (j.tasks->j.cursor)->>'type'='plan' then
 plan:=p_task->'search_plan';
 if jsonb_typeof(plan->'groups') is distinct from 'array' or jsonb_array_length(plan->'groups') not between 1 and 5 or jsonb_typeof(p_task->'remaining_tasks') is distinct from 'array' or jsonb_array_length(p_task->'remaining_tasks')>506 then raise exception 'INVALID_PLAN';end if;
 update public.content_research_jobs set settings=settings || jsonb_build_object('search_plan',plan,'keywords',(select coalesce(jsonb_agg(g->>'query'),'[]') from jsonb_array_elements(plan->'groups') g where coalesce((g->>'enabled')::boolean,true))),
 tasks=(select coalesce(jsonb_agg(t.value order by t.ordinality),'[]') from jsonb_array_elements(j.tasks) with ordinality t where t.ordinality<=j.cursor+1) || (p_task->'remaining_tasks') where id=j.id;
 update public.content_research_runs set settings_snapshot=(select settings from public.content_research_jobs where id=j.id) where id=j.run_id and user_id=p_user_id;
 end if;
 j:=public.commit_content_research_step_v3(p_user_id,p_job_id,p_token,p_items,p_task,p_done,p_units,p_channel,p_error);
 if j.status='completed' and j.settings->>'kind'<>'plan' then
 task_id:=nullif(j.settings->'mission'->>'task_id','')::uuid;
 update public.content_search_tasks set last_run_at=now() where id=task_id and user_id=p_user_id;
 end if;
 return j;
end $$;
alter table public.content_research_feedback add column research_context jsonb not null default '{}';
create or replace function public.record_content_feedback(p_youtube_id text,p_decision text,p_reason text)
returns public.content_research_feedback language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();v public.content_research_videos;f public.content_research_feedback;cv uuid;ev uuid;
begin
 if uid is null then raise exception 'Unauthorized' using errcode='42501';end if;
 select * into v from public.content_research_videos where user_id=uid and youtube_id=p_youtube_id and proposed_at is not null;
 if not found then raise exception 'Proposal not found' using errcode='42501';end if;
 if p_decision not in ('chosen','later','rejected','excellent') or length(p_reason)>2000 then raise exception 'Invalid feedback';end if;
 select version_id into cv from public.content_criteria_profiles where user_id=uid;
 select id into ev from public.content_criteria_versions where user_id=uid and id=nullif(v.analysis->>'criteria_version','')::uuid;
 insert into public.content_research_feedback(user_id,youtube_id,decision,reason,criteria_version,evaluated_version,video_snapshot,research_context) values(uid,p_youtube_id,p_decision,coalesce(p_reason,''),cv,ev,v.data,coalesce(v.analysis->'search_context','{}')) returning * into f;
 return f;
end $$;
create function public.edit_content_feedback(p_id uuid,p_decision text,p_reason text,p_delete boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501';end if;
 if not exists(select 1 from public.content_research_feedback where id=p_id and user_id=auth.uid()) then raise exception 'Feedback not found' using errcode='42501';end if;
 if p_delete then
 delete from public.content_preference_memories where feedback_id=p_id and user_id=auth.uid();
 delete from public.content_research_feedback where id=p_id and user_id=auth.uid();
 else
 if p_decision not in ('chosen','later','rejected','excellent') or length(p_reason)>2000 then raise exception 'Invalid feedback';end if;
 update public.content_research_feedback set decision=p_decision,reason=coalesce(p_reason,'') where id=p_id and user_id=auth.uid();
 -- Edited decisions must be explicitly confirmed again before reuse in ranking.
 update public.content_preference_memories set confirmed=false,text=case when length(coalesce(p_reason,''))>0 then p_reason else text end,preference=case when p_decision='rejected' then 'negative' else 'positive' end,updated_at=now() where feedback_id=p_id and user_id=auth.uid();
 end if;
end $$;
revoke all on function public.save_content_search_task(uuid,text,jsonb,integer),public.edit_content_feedback(uuid,text,text,boolean) from public,anon;
grant execute on function public.save_content_search_task(uuid,text,jsonb,integer),public.edit_content_feedback(uuid,text,text,boolean) to authenticated;
revoke all on function public.reserve_content_search_ai(uuid,uuid,text),public.commit_content_research_step(uuid,uuid,uuid,jsonb,jsonb,boolean,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_content_search_ai(uuid,uuid,text),public.commit_content_research_step(uuid,uuid,uuid,jsonb,jsonb,boolean,integer,jsonb,text) to service_role;
commit;
