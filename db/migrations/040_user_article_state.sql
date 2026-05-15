-- Per-user state over the shared article library.

CREATE TABLE IF NOT EXISTS user_article_state (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  saved boolean NOT NULL DEFAULT false,
  saved_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  seen boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  liked boolean,
  preference_score integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

CREATE TRIGGER user_article_state_set_updated_at
BEFORE UPDATE ON user_article_state
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS user_article_state_saved_idx ON user_article_state (user_id, saved_at DESC) WHERE saved = true;
CREATE INDEX IF NOT EXISTS user_article_state_archived_idx ON user_article_state (user_id, archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_article_state_seen_idx ON user_article_state (user_id, seen, last_seen_at DESC NULLS LAST);
