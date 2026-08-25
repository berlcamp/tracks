-- 0010_action_document_path.sql
-- `document_url` held a Storage object path, not a URL.
--
-- The bucket is private, so what is stored is a path and what is handed to a
-- browser is a short-lived signed URL generated at read time. A column called
-- `_url` invites someone to render it into an <a href> that 400s — or worse, to
-- make the bucket public so that it works.

alter table tracks.aip_actions rename column document_url to document_path;
