-- sessions table has RLS enabled but no write policies for the anon role,
-- blocking admin inserts/updates/deletes. Add permissive policies to match
-- the access pattern of all other tables in this app (PIN-based auth, no
-- per-user row isolation needed).

CREATE POLICY "anon_select_sessions"
  ON sessions FOR SELECT USING (true);

CREATE POLICY "anon_insert_sessions"
  ON sessions FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_sessions"
  ON sessions FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_sessions"
  ON sessions FOR DELETE USING (true);
