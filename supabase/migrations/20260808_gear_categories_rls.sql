-- gear_categories was created with RLS enabled but no write policies for
-- the anon role, blocking admin upserts. Add permissive policies to match
-- the access pattern of all other tables in this app (PIN-based auth, no
-- per-user row isolation needed) — same fix as 20260521_sessions_rls.sql.

CREATE POLICY "anon_select_gear_categories"
  ON gear_categories FOR SELECT USING (true);

CREATE POLICY "anon_insert_gear_categories"
  ON gear_categories FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_gear_categories"
  ON gear_categories FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_gear_categories"
  ON gear_categories FOR DELETE USING (true);
