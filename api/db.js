import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dataDir = join(root, 'data')
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(join(dataDir, 'morning.sqlite'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  source TEXT,
  subreddit TEXT,
  reddit_id TEXT,
  reddit_permalink TEXT,
  reddit_score INTEGER DEFAULT 0,
  reddit_comments INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  byline TEXT,
  excerpt TEXT,
  site_name TEXT,
  text_content TEXT,
  html_content TEXT,
  word_count INTEGER DEFAULT 0,
  reading_minutes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  saved INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  liked INTEGER,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fetched_at TEXT,
  published_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_discovered ON articles(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_saved ON articles(saved, discovered_at DESC);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  found_count INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0,
  error TEXT
);
`)

try { db.exec('ALTER TABLE articles ADD COLUMN published_at TEXT') } catch {}
try { db.exec('ALTER TABLE articles ADD COLUMN saved_at TEXT') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC)') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_articles_saved_at ON articles(saved_at DESC)') } catch {}

db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  excerpt,
  byline,
  site_name,
  text_content,
  content='articles',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, excerpt, byline, site_name, text_content)
  VALUES (new.id, new.title, new.excerpt, new.byline, new.site_name, new.text_content);
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, excerpt, byline, site_name, text_content)
  VALUES('delete', old.id, old.title, old.excerpt, old.byline, old.site_name, old.text_content);
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, excerpt, byline, site_name, text_content)
  VALUES('delete', old.id, old.title, old.excerpt, old.byline, old.site_name, old.text_content);
  INSERT INTO articles_fts(rowid, title, excerpt, byline, site_name, text_content)
  VALUES (new.id, new.title, new.excerpt, new.byline, new.site_name, new.text_content);
END;
`)

try {
  db.exec(`INSERT INTO articles_fts(articles_fts) VALUES('rebuild')`)
} catch {}

function decodeEntities(str) {
  if (!str) return str
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

export function rowToArticle(row) {
  if (!row) return null
  return {
    ...row,
    title: decodeEntities(row.title),
    byline: decodeEntities(row.byline),
    excerpt: decodeEntities(row.excerpt),
    saved: Boolean(row.saved),
    archived: Boolean(row.archived),
    seen: Boolean(row.seen),
  }
}
