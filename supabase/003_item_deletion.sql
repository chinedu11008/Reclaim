-- Run once in the SQL Editor on existing projects to enable item deletion.
drop policy if exists "delete own items" on public.items;
create policy "delete own items" on public.items for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
