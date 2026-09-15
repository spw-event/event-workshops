-- Lets specific workshops cost more than the default 1 credit per person
-- (e.g. a premium/limited workshop priced at 2 credits), instead of every
-- workshop being a flat 1-credit-per-person deduction.
alter table workshops
  add column if not exists credit_cost integer not null default 1;

alter table workshops
  add constraint workshops_credit_cost_positive check (credit_cost > 0);
