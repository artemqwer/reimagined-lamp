-- Profile photos. src/app/(dashboard)/profile/page.tsx uploads to
-- `${uid}/avatar.${ext}` and then calls getPublicUrl, so the bucket must be
-- public-read. This was never in supabase/*.sql at all — the bucket only ever
-- existed because someone made it by hand in the dashboard, so a fresh project
-- would have failed every avatar upload with "Bucket not found".
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Public read: getPublicUrl serves through the CDN and must not need a session.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Write is confined to the user's OWN folder. The upload path starts with the
-- uid, so comparing the first path segment to auth.uid() stops one user
-- overwriting another's photo — upsert:true makes that a real risk otherwise.
drop policy if exists "avatars: own folder insert" on storage.objects;
create policy "avatars: own folder insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: own folder update" on storage.objects;
create policy "avatars: own folder update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: own folder delete" on storage.objects;
create policy "avatars: own folder delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
