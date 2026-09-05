-- T1 signup: new match_status value for a frozen-but-visible signup list.
-- Must live alone in its own migration/transaction (Postgres forbids using a
-- new enum value in the same transaction that adds it).

ALTER TYPE match_status ADD VALUE IF NOT EXISTS 'signup_closed';
