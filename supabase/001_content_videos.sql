-- Review and run manually only after confirmation. Does not modify Super Day tables.
begin;
create table public.content_videos (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default '',
 stage text not null default 'ideas' check (stage in ('ideas','script','filming','editing','published')),
 source_url text not null default '', notes text not null default '', script text not null default '',
 postproduction_notes text not null default '', draft_url text not null default '', youtube_url text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 published_at timestamptz, archived_at timestamptz, deleted_at timestamptz,
 purged_at timestamptz, revision bigint not null default 1
);
create index content_videos_user_idx on public.content_videos(user_id, updated_at desc);
alter table public.content_videos enable row level security;
create policy content_videos_owner on public.content_videos for all to authenticated
 using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.content_videos from anon;
grant select,insert,update on public.content_videos to authenticated;
-- Compare-and-swap: a stale device receives no row, and must resolve the conflict.
create function public.save_content_video(payload jsonb, expected_revision bigint)
returns setof public.content_videos language plpgsql security invoker set search_path = '' as $$
declare v public.content_videos;
begin
 if auth.uid() is null or (payload->>'user_id')::uuid is distinct from auth.uid() then
   raise exception 'Unauthorized' using errcode='42501';
 end if;
 v := jsonb_populate_record(null::public.content_videos, payload);
 if expected_revision = 0 then
   return query insert into public.content_videos
   (id,user_id,title,stage,source_url,notes,script,postproduction_notes,draft_url,youtube_url,created_at,updated_at,published_at,archived_at,deleted_at,purged_at,revision)
   values(v.id,auth.uid(),v.title,v.stage,v.source_url,v.notes,v.script,v.postproduction_notes,v.draft_url,v.youtube_url,v.created_at,now(),v.published_at,v.archived_at,v.deleted_at,v.purged_at,1)
   on conflict(id) do nothing returning *;
 else
   return query update public.content_videos t set title=v.title,stage=v.stage,
   source_url=v.source_url,notes=v.notes,script=v.script,postproduction_notes=v.postproduction_notes,
   draft_url=v.draft_url,youtube_url=v.youtube_url,updated_at=now(),published_at=v.published_at,
   archived_at=v.archived_at,deleted_at=v.deleted_at,purged_at=v.purged_at,revision=t.revision+1
   where t.id=v.id and t.user_id=auth.uid() and t.revision=expected_revision returning t.*;
 end if;
end; $$;
revoke all on function public.save_content_video(jsonb,bigint) from public,anon;
grant execute on function public.save_content_video(jsonb,bigint) to authenticated;
commit;
