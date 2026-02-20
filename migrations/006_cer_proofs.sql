CREATE TABLE IF NOT EXISTS cer_proofs (
  id            BIGSERIAL       PRIMARY KEY,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  api_key_id    BIGINT          NULL,
  bundle_type   TEXT            NOT NULL,
  certificate_hash TEXT         NOT NULL UNIQUE,
  attestation_id   TEXT         NOT NULL,
  node_runtime_hash TEXT        NOT NULL,
  protocol_version  TEXT        NOT NULL,
  sdk_version       TEXT        NULL,
  app_id            TEXT        NULL,
  execution_id      TEXT        NULL,
  input_hash        TEXT        NULL,
  output_hash       TEXT        NULL,
  status            TEXT        NOT NULL CHECK (status IN ('ATTESTED','UNATTESTED','LOCAL')),
  error             TEXT        NULL,
  artifact_path     TEXT        NULL,
  meta              JSONB       NULL
);

CREATE INDEX IF NOT EXISTS idx_cer_proofs_apikey_created
  ON cer_proofs (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cer_proofs_certificate_hash
  ON cer_proofs (certificate_hash);
