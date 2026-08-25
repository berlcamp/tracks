-- 0009_storage_policies.sql
-- Storage for the scanned paper trail: LDC endorsements, the Mayor's approval,
-- the City Council resolution.
--
-- SHARED PROJECT. `storage.objects` is shared infrastructure — every policy here
-- is scoped `bucket_id = 'tracks-documents'` so it cannot touch another app's
-- files. The bucket is PRIVATE: a council resolution is a public document, but
-- a link that anyone who guesses a filename can fetch is not how it should
-- leave the building. Reads go through a signed URL.

insert into storage.buckets (id, name, public)
values ('tracks-documents', 'tracks-documents', false)
on conflict (id) do nothing;

-- Anyone provisioned in TRACKS may read the scans. This is the same reasoning as
-- the table policies: the investment programme is public work, and Budget,
-- Accounting and the LDC all need to see what came back.
drop policy if exists tracks_documents_read on storage.objects;
create policy tracks_documents_read on storage.objects for select to authenticated
using (bucket_id = 'tracks-documents' and tracks.is_provisioned());

-- Only City Planning attaches paper. They are the office the folder comes back to.
drop policy if exists tracks_documents_write on storage.objects;
create policy tracks_documents_write on storage.objects for insert to authenticated
with check (bucket_id = 'tracks-documents' and tracks.is_planning());

drop policy if exists tracks_documents_update on storage.objects;
create policy tracks_documents_update on storage.objects for update to authenticated
using (bucket_id = 'tracks-documents' and tracks.is_planning())
with check (bucket_id = 'tracks-documents' and tracks.is_planning());

-- Deliberately no DELETE policy. A resolution that has been recorded against a
-- programme is not something the system should let anyone quietly remove; if a
-- wrong file was attached, attach the right one and the record shows both.
