export const schema = `
CREATE TABLE IF NOT EXISTS slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 starts_at timestamptz NOT NULL UNIQUE,
 ends_at timestamptz NOT NULL,
 CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slot_id uuid NOT NULL REFERENCES slots(id),
 patient_name text NOT NULL,
 patient_email text NOT NULL,
 patient_token_hash text NOT NULL,
 status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 cancelled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_slot ON bookings(slot_id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS bookings_patient_page ON bookings(patient_token_hash, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS idempotency (
 key text PRIMARY KEY,
 fingerprint text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY,
 window_start timestamptz NOT NULL,
 hits integer NOT NULL
);
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
`;
