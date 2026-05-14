import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Archive, Bookmark, BookmarkCheck, ExternalLink, Menu, Moon, RefreshCw, Search, Sparkles, Sun } from 'lucide-react'
import { discover, fetchQueued, getArticle, health, listArticles, updateArticle } from './lib/api.js'
import './styles.css'

function cx(...xs) { return xs.filter(Boolean).join(' ') }

function Button({ className, variant = 'default', ...props }) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...props} />
}

function Badge({ children }) { return <span className="badge">{children}</span> }

function ArticleCard({ article, active, onOpen, onSave }) {
  return (
    <article className={cx('card', active && 'card-active')} onClick={() => onOpen(article.id)}>
      <div className="card-meta">
        <Badge>{article.reading_minutes} min</Badge>
        {article.subreddit && <span>r/{article.subreddit}</span>}
        {article.site_name && <span>{article.site_name}</span>}
      </div>
      <h2>{article.title}</h2>
      {article.excerpt && <p>{article.excerpt}</p>}
      <div className="card-foot">
        <span>{article.word_count?.toLocaleString()} words · {article.reddit_score ?? 0} points</span>
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onSave(article) }} aria-label="save">
          {article.saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
        </button>
      </div>
    </article>
  )
}

function articleHtml(article) {
  if (article.html_content) return article.html_content
  return (article.text_content || '')
    .replace(/([.!?][\"''']?)\s+(?=[A-Z"])/g, '$1\n\n')
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(text => '<p>' + text + '</p>')
    .join('\n')
}

const Reader = React.forwardRef(function Reader({ article, onToggleLibrary, onPatch, scrolled, onScroll, fontScale, onFontScale, theme, onToggleTheme }, ref) {
  if (!article) return <section ref={ref} onScroll={onScroll} className="reader empty"><Sparkles/><p>Loading article…</p></section>
  return (
    <section ref={ref} onScroll={onScroll} className="reader">
      <div className="reader-actions">
        <Button variant="ghost" className="reader-icon-btn" onClick={onToggleLibrary} aria-label="Toggle library" title="Library"><Menu size={14}/></Button>
        <div className={cx('reader-sticky-title', scrolled && 'visible')}>{article.title}</div>
        <div className="reader-action-group">
          <Button variant="ghost" className="reader-icon-btn" onClick={() => onPatch({ saved: !article.saved })} aria-label="Save article" title="Save">{article.saved ? <BookmarkCheck size={14}/> : <Bookmark size={14}/>}</Button>
          <Button variant="ghost" className="reader-icon-btn font-btn" onClick={() => onFontScale(-1)} aria-label="Decrease font size" title="Decrease font size">A−</Button>
          <Button variant="ghost" className="reader-icon-btn font-btn" onClick={() => onFontScale(1)} aria-label="Increase font size" title="Increase font size">A+</Button>
          <Button variant="ghost" className="reader-icon-btn" onClick={() => onPatch({ archived: true })} aria-label="Archive article" title="Archive"><Archive size={14}/></Button>
          <a className="btn btn-ghost reader-icon-btn" href={article.url} target="_blank" rel="noreferrer" aria-label="Open original" title="Original"><ExternalLink size={14}/></a>
          <Button variant="ghost" className="reader-icon-btn" onClick={onToggleTheme} aria-label="Toggle dark mode" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>{theme === 'dark' ? <Sun size={14}/> : <Moon size={14}/>}</Button>
        </div>
      </div>
      <header className="reader-head">
        <div className="reader-kicker">{article.site_name || 'Essay'} · {article.reading_minutes} minute read</div>
        <h1>{article.title}</h1>
        {article.byline && <p className="byline">{article.byline}</p>}
        {article.excerpt && <p className="dek">{article.excerpt}</p>}
      </header>
      <div className="prose" style={{ '--reader-font-scale': fontScale }} dangerouslySetInnerHTML={{ __html: articleHtml(article) }} />
    </section>
  )
})

function App() {
  const [articles, setArticles] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('synced')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [readerScrolled, setReaderScrolled] = useState(false)
  const [fontScale, setFontScale] = useState(() => {
    const saved = Number(localStorage.getItem('morning.fontScale') ?? '')
    return saved > 0 && Number.isFinite(saved) ? saved : 1
  })
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('morning.theme')
    if (saved) return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const readerRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('morning.theme', theme)
  }, [theme])

  const selectedInList = useMemo(() => articles.find(a => a.id === selectedId), [articles, selectedId])
  const currentArticle = selected?.id === selectedId ? selected : null

  async function refresh() {
    const [{ articles }, h] = await Promise.all([
      listArticles({ q: query, status: 'ready', sort }),
      health().catch(() => null),
    ])
    setArticles(articles)
    setStatus(h)
    if (!selectedId && articles[0]) setSelectedId(articles[0].id)
  }

  useEffect(() => { refresh().catch(console.error) }, [query, sort])
  useEffect(() => { localStorage.setItem('morning.fontScale', String(fontScale)) }, [fontScale])
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setSelected(null)
    setReaderScrolled(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
    readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    getArticle(selectedId).then(({ article }) => {
      if (cancelled) return
      setSelected(article)
      setReaderScrolled(false)
      window.scrollTo({ top: 0, behavior: 'auto' })
      readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    }).catch(console.error)
    return () => { cancelled = true }
  }, [selectedId])

  async function selectArticle(id) {
    setSelectedId(id)
    setSelected(null)
    setReaderScrolled(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
    readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    try {
      const { article } = await getArticle(id)
      setSelected(article)
      readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    } catch (err) {
      console.error(err)
    }
  }

  async function runDiscovery() {
    setLoading(true)
    try {
      await discover()
      await refresh()
      setTimeout(() => refresh().catch(console.error), 5000)
    } finally {
      setLoading(false)
    }
  }

  async function patchSelected(patch) {
    if (!selected) return
    const { article } = await updateArticle(selected.id, patch)
    setSelected(article)
    setArticles(xs => xs.map(x => x.id === article.id ? { ...x, ...article } : x).filter(x => !x.archived))
  }

  async function toggleSave(article) {
    const { article: updated } = await updateArticle(article.id, { saved: !article.saved })
    setArticles(xs => xs.map(x => x.id === updated.id ? { ...x, saved: updated.saved } : x))
    if (selected?.id === updated.id) setSelected({ ...selected, saved: updated.saved })
  }

  function toggleLibrary() {
    if (window.matchMedia('(max-width: 1100px)').matches) {
      setSelected(null)
      setLibraryCollapsed(false)
      window.scrollTo({ top: 0, behavior: 'auto' })
    } else {
      setLibraryCollapsed(v => !v)
    }
  }

  return (
    <main className={cx('app-shell', libraryCollapsed && 'library-collapsed')}>
      <aside className={cx('library', selected && 'has-selection', libraryCollapsed && 'collapsed')}>
        <header className="masthead">
          <div className="masthead-copy">
            <p className="eyebrow">Morning</p>
          </div>
          <div className="masthead-actions">
            <Button onClick={runDiscovery} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={16}/> Discover</Button>
            <Button variant="secondary" onClick={async () => { setLoading(true); try { await fetchQueued(30); await refresh() } finally { setLoading(false) } }} disabled={loading}>Fetch queued</Button>
          </div>
        </header>
        <section className="library-controls">
          <label className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your local library" /></label>
          <label className="sort-control">
            <span>Sort</span>
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="synced">Latest synced</option>
              <option value="published">Published</option>
              <option value="score">Reddit score</option>
              <option value="longest">Longest</option>
              <option value="shortest">Shortest</option>
              <option value="unread">Unread first</option>
              <option value="saved">Saved articles</option>
            </select>
          </label>
        </section>
        <div className="stats">
          {(status?.counts || []).map(c => <span key={c.status}><strong>{c.count}</strong> {c.status}</span>)}
        </div>
        <div className="cards">
          {articles.map(a => <ArticleCard key={a.id} article={a} active={a.id === selectedId} onOpen={selectArticle} onSave={toggleSave} />)}
          {!articles.length && <div className="empty-list">No ready essays yet. Hit Discover; extraction may take a minute.</div>}
        </div>
      </aside>
      <Reader
        ref={readerRef}
        article={currentArticle}
        scrolled={readerScrolled}
        onScroll={(e) => setReaderScrolled(e.currentTarget.scrollTop > 120)}
        fontScale={fontScale}
        onFontScale={(delta) => setFontScale(v => Math.max(0.85, Math.min(1.3, Number((v + delta * 0.05).toFixed(2)))))}
        onToggleLibrary={toggleLibrary}
        onPatch={patchSelected}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
