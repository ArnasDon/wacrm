-- Public bucket used only for catalogue product images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-products',
  'catalog-products',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are scoped as <account_id>/<uuid>.<ext>.
drop policy if exists "catalog_media_read" on storage.objects;
create policy "catalog_media_read" on storage.objects
  for select using (bucket_id = 'catalog-products');

drop policy if exists "catalog_media_insert" on storage.objects;
create policy "catalog_media_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog-products'
    and exists (
      select 1 from wacrm.profiles
      where profiles.user_id = auth.uid()
        and profiles.account_id::text = (storage.foldername(name))[1]
        and profiles.account_role in ('owner', 'admin')
    )
  );

drop policy if exists "catalog_media_update" on storage.objects;
create policy "catalog_media_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'catalog-products'
    and exists (
      select 1 from wacrm.profiles
      where profiles.user_id = auth.uid()
        and profiles.account_id::text = (storage.foldername(name))[1]
        and profiles.account_role in ('owner', 'admin')
    )
  );

drop policy if exists "catalog_media_delete" on storage.objects;
create policy "catalog_media_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalog-products'
    and exists (
      select 1 from wacrm.profiles
      where profiles.user_id = auth.uid()
        and profiles.account_id::text = (storage.foldername(name))[1]
        and profiles.account_role in ('owner', 'admin')
    )
  );
