-- Fetch attempts, worker instances, versioned releases, and agent execution records.

CREATE TABLE IF NOT EXISTS article_fetch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
  url text NOT NULL,
  worker_id text,
  method text NOT NULL DEFAULT 'fetch' CHECK (method IN ('fetch', 'playwright', 'manual')),
  status text NOT NULL CHECK (status IN ('started', 'ready', 'failed', 'skipped')),
  http_status integer,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS article_fetch_attempts_article_idx ON article_fetch_attempts (article_id, started_at DESC);
CREATE INDEX IF NOT EXISTS article_fetch_attempts_status_idx ON article_fetch_attempts (status, started_at DESC);

CREATE TABLE IF NOT EXISTS worker_instances (
  id text PRIMARY KEY,
  name text,
  version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS worker_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  git_sha text NOT NULL UNIQUE,
  artifact_url text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'deployed', 'failed', 'rolled_back')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deployed_at timestamptz,
  rolled_back_at timestamptz,
  notes text
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text REFERENCES worker_instances(id) ON DELETE SET NULL,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'succeeded', 'failed', 'cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_runs_worker_idx ON agent_runs (worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_article_idx ON agent_runs (article_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON agent_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_tool_calls_run_idx ON agent_tool_calls (run_id, started_at);
