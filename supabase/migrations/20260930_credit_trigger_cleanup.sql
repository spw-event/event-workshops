-- Run after 20260918_atomic_credit_enforcement.sql.
--
-- Production still carries triggers from before that migration (seen in the
-- 2026-10-01 schema snapshot). Left in place alongside the new
-- trg_registration_credit_insert / _delete triggers they would:
--   • refund_credits_on_delete: refund a second time on every cancellation
--     (and by party_size, ignoring workshops.credit_cost);
--   • refund_credits_on_status_change: refund on confirmed → cancelled
--     updates, which nothing in the app does any more;
--   • enforce_session_capacity: run the same capacity check as
--     trg_check_session_capacity a second time.
-- The functions behind them are left in place; only the triggers go.
drop trigger if exists refund_credits_on_delete on registrations;
drop trigger if exists refund_credits_on_status_change on registrations;
drop trigger if exists enforce_session_capacity on registrations;
