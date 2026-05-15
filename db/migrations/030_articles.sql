-- Shared article library.
-- Metadata and searchable text live in Neon.
-- Canonical sanitized reader HTML lives in R2 at articles.content_key.

CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  original_url text NOT NULL,
  canonical_url text,
  normalized_url text NOT NULL UNIQUE,
  normalized_url_hash text NOT NULL UNIQUE,

  title text NOT NULL,
  byline text,
  excerpt text,
  site_name text,
  language text,
  published_at timestamptz,

  content_key text,
  content_hash text,
  content_bytes integer,
  searchable_text text,
  word_count integer NOT NULL DEFAULT 0,
  reading_minutes integer NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'fetching', 'ready', 'failed', 'archived')),
  visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private')),
  error text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  first_fetched_at timestamptz,
  last_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(byline, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(site_name, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(searchable_text, '')), 'D')
  ) STORED
);

CREATE TRIGGER articles_set_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS articles_status_idx ON articles (status, discovered_at DESC);
CREATE INDEX IF NOT EXISTS articles_published_at_idx ON articles (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS articles_last_fetched_at_idx ON articles (last_fetched_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS articles_word_count_idx ON articles (word_count DESC);
CREATE INDEX IF NOT EXISTS articles_content_hash_idx ON articles (content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS articles_search_vector_idx ON articles USING gin (search_vector);

CREATE TABLE IF NOT EXISTS article_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE SET NULL,
  source_kind text NOT NULL,
  source_name text,
  external_id text,
  external_url text,
  score integer,
  comments_count integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, external_id)
);

CREATE INDEX IF NOT EXISTS article_discoveries_article_idx ON article_discoveries (article_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS article_discoveries_source_idx ON article_discoveries (source_kind, source_name, discovered_at DESC);
