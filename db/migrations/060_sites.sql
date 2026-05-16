-- Normalized website metadata for article sources.
-- Article-level site_name remains as extracted display metadata; sites owns
-- stable per-host metadata such as favicon and future per-site preferences.

CREATE TABLE IF NOT EXISTS sites (
  hostname text PRIMARY KEY,
  display_name text,
  favicon_url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sites_set_updated_at
BEFORE UPDATE ON sites
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE articles
ADD COLUMN IF NOT EXISTS site_hostname text REFERENCES sites(hostname) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS articles_site_hostname_idx ON articles (site_hostname);
CREATE INDEX IF NOT EXISTS sites_display_name_idx ON sites (display_name);
