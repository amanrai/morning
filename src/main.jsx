import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Home, Layers, Menu, Moon, Search, Settings, Sun } from 'lucide-react'
import { getArticle, listArticles, updateArticle } from './lib/api.js'
import { Reader } from './Reader.jsx'
import './styles.css'

function cx(...xs) { return xs.filter(Boolean).join(' ') }

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
        <button className="icon-btn" onClick={e => { e.stopPropagation(); onSave(article) }} aria-label="save">
          {article.saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
        </button>
      </div>
    </article>
  )
}

function Sidebar({ active, onSelect, theme, onToggleTheme, collapsed, onToggle, mobileOpen }) {
  return (
    <nav className={cx('sidebar', collapsed && 'is-collapsed', mobileOpen && 'mobile-open')}>
      <div className="sidebar-brand">
        {!collapsed && <span className="wordmark">Morning</span>}
        <button className="sidebar-collapse-btn" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="sidebar-top">
            <button className={cx('sidebar-item', active === 'carousel' && 'sidebar-active')} onClick={() => onSelect('carousel')}>
              <Layers size={15} /><span>Carousel</span>
            </button>
            <button className={cx('sidebar-item', active === 'home' && 'sidebar-active')} onClick={() => onSelect('home')}>
              <Home size={15} /><span>Home</span>
            </button>
            <button className={cx('sidebar-item', active === 'search' && 'sidebar-active')} onClick={() => onSelect('search')}>
              <Search size={15} /><span>Search</span>
            </button>
          </div>
          <div className="sidebar-bottom">
            <button className="sidebar-item" onClick={onToggleTheme}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'} mode</span>
            </button>
            <button className={cx('sidebar-item', active === 'settings' && 'sidebar-active')} onClick={() => onSelect('settings')}>
              <Settings size={15} /><span>Settings</span>
            </button>
          </div>
        </>
      )}
    </nav>
  )
}

function CardList({ articles, selectedId, onOpen, onSave, emptyMessage }) {
  if (!articles.length) return <div className="empty-list">{emptyMessage ?? 'No ready essays yet.'}</div>
  return (
    <div className="cards">
      {articles.map(a => (
        <ArticleCard key={a.id} article={a} active={a.id === selectedId} onOpen={onOpen} onSave={onSave} />
      ))}
    </div>
  )
}

function CarouselPanel({ articles, onOpen, interval }) {
  const [index, setIndex] = useState(0)

  const prev = () => setIndex(i => (i - 1 + articles.length) % articles.length)
  const next = () => setIndex(i => (i + 1) % articles.length)

  useEffect(() => {
    if (!interval || articles.length <= 1) return
    const t = setInterval(next, interval * 1000)
    return () => clearInterval(t)
  }, [interval, articles.length])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next()
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [articles.length])

  const article = articles[index]

  if (!article) return (
    <div className="carousel carousel-empty">
      <p>No articles yet.</p>
    </div>
  )

  const kicker = [
    article.site_name || (article.subreddit ? `r/${article.subreddit}` : null),
    `${article.reading_minutes} min read`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="carousel">
      {interval > 0 && (
        <div key={`${index}-${interval}`} className="carousel-progress" style={{ '--dur': `${interval}s` }} />
      )}
      <div className="carousel-body">
        {kicker && <p className="carousel-kicker">{kicker}</p>}
        <h1 className="carousel-title">{article.title}</h1>
        {article.excerpt && <p className="carousel-dek">{article.excerpt}</p>}
        <button className="carousel-read-btn" onClick={() => onOpen(article.id)}>Read</button>
      </div>
      <div className="carousel-footer">
        <button className="carousel-nav-btn" onClick={prev} aria-label="Previous">
          <ChevronLeft size={16} />
        </button>
        <span className="carousel-counter">{index + 1} / {articles.length}</span>
        <button className="carousel-nav-btn" onClick={next} aria-label="Next">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

function HomePanel({ articles, selectedId, sort, onSort, minWords, onMinWords, onOpen, onSave }) {
  const [localMinWords, setLocalMinWords] = useState(minWords)
  return (
    <aside className="panel">
      <div className="panel-controls">
        <label className="sort-control">
          <span>Sort</span>
          <select value={sort} onChange={e => onSort(e.target.value)}>
            <option value="synced">Latest synced</option>
            <option value="published">Published</option>
            <option value="score">Reddit score</option>
            <option value="longest">Longest</option>
            <option value="shortest">Shortest</option>
            <option value="unread">Unread first</option>
            <option value="saved">Saved</option>
          </select>
        </label>
        <div className="min-words-control">
          <div className="min-words-label">
            <span>Min length</span>
            <span>{localMinWords.toLocaleString()} words</span>
          </div>
          <input
            type="range" min={100} max={2500} step={50}
            value={localMinWords}
            onChange={e => setLocalMinWords(Number(e.target.value))}
            onPointerUp={e => onMinWords(Number(e.target.value))}
          />
        </div>
      </div>
      <CardList articles={articles} selectedId={selectedId} onOpen={onOpen} onSave={onSave} />
    </aside>
  )
}

function SearchPanel({ articles, selectedId, query, onQuery, onOpen, onSave }) {
  return (
    <aside className="panel">
      <div className="panel-search-bar">
        <label className="search">
          <Search size={15} />
          <input value={query} onChange={e => onQuery(e.target.value)} placeholder="Find something to read" autoFocus />
          {query && <button className="search-clear" onClick={() => onQuery('')} aria-label="Clear">✕</button>}
        </label>
      </div>
      {query
        ? <CardList articles={articles} selectedId={selectedId} onOpen={onOpen} onSave={onSave} emptyMessage={`No results for "${query}"`} />
        : <p className="panel-hint">Start typing to search.</p>
      }
    </aside>
  )
}

const CAROUSEL_INTERVALS = [
  { label: 'Manual', value: 0 },
  { label: '10 seconds', value: 10 },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '3 minutes', value: 180 },
  { label: '10 minutes', value: 600 },
]

function SettingsPanel({ fontScale, onFontScale, carouselInterval, onCarouselInterval, carouselMinWords, onCarouselMinWords }) {
  const [localMinWords, setLocalMinWords] = useState(carouselMinWords)
  return (
    <aside className="panel">
      <div className="panel-section-title">Settings</div>
      <div className="settings-body">
        <div className="settings-group">
          <div className="settings-row-label">
            <span>Reader font size</span>
            <span>{Math.round(fontScale * 100)}%</span>
          </div>
          <div className="settings-stepper">
            <button className="settings-step-btn" onClick={() => onFontScale(-1)}>A−</button>
            <button className="settings-step-btn" onClick={() => onFontScale(1)}>A+</button>
          </div>
        </div>
        <div className="settings-group">
          <div className="settings-row-label">
            <span>Carousel interval</span>
          </div>
          <select className="settings-select" value={carouselInterval} onChange={e => onCarouselInterval(Number(e.target.value))}>
            {CAROUSEL_INTERVALS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-group">
          <div className="settings-row-label">
            <span>Carousel min. length</span>
            <span>{localMinWords.toLocaleString()} words</span>
          </div>
          <input
            type="range" min={100} max={2500} step={50}
            value={localMinWords}
            onChange={e => setLocalMinWords(Number(e.target.value))}
            onPointerUp={e => onCarouselMinWords(Number(e.target.value))}
          />
        </div>
      </div>
    </aside>
  )
}

function parseUrl() {
  const p = new URLSearchParams(window.location.search)
  return {
    panel:     p.get('panel') || 'carousel',
    articleId: p.get('article') ? Number(p.get('article')) : null,
    query:     p.get('q') || '',
    sort:      p.get('sort') || 'published',
    minWords:  p.get('min') ? Number(p.get('min')) : 600,
  }
}

function App() {
  const [articles, setArticles] = useState([])
  const [selectedId, setSelectedId] = useState(() => parseUrl().articleId)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState(() => parseUrl().query)
  const [sort, setSort] = useState(() => parseUrl().sort)
  const [minWords, setMinWords] = useState(() => parseUrl().minWords)
  const [activePanel, setActivePanel] = useState(() => parseUrl().panel)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [carouselInterval, setCarouselInterval] = useState(() => {
    const saved = Number(localStorage.getItem('morning.carouselInterval') ?? '')
    return Number.isFinite(saved) && saved >= 0 ? saved : 30
  })
  const [carouselMinWords, setCarouselMinWords] = useState(() => {
    const saved = Number(localStorage.getItem('morning.carouselMinWords') ?? '')
    return Number.isFinite(saved) && saved > 0 ? saved : 1500
  })
  const [readerScrolled, setReaderScrolled] = useState(false)
  const [fontScale, setFontScale] = useState(() => {
    const saved = Number(localStorage.getItem('morning.fontScale') ?? '')
    return saved > 0 && Number.isFinite(saved) ? saved : 1
  })
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

  useEffect(() => { localStorage.setItem('morning.fontScale', String(fontScale)) }, [fontScale])
  useEffect(() => { localStorage.setItem('morning.carouselInterval', String(carouselInterval)) }, [carouselInterval])
  useEffect(() => { localStorage.setItem('morning.carouselMinWords', String(carouselMinWords)) }, [carouselMinWords])

  // Sync filter changes (sort, min, query) to URL without pushing a new history entry
  useEffect(() => {
    if (selectedId) return
    const p = new URLSearchParams()
    p.set('panel', activePanel)
    if (query) p.set('q', query)
    if (sort !== 'published') p.set('sort', sort)
    if (minWords !== 600) p.set('min', String(minWords))
    history.replaceState(null, '', `?${p}`)
  }, [activePanel, query, sort, minWords, selectedId])

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      const { panel, articleId, query: q, sort: s, minWords: m } = parseUrl()
      setActivePanel(panel)
      setQuery(q)
      setSort(s)
      setMinWords(m)
      setSelectedId(articleId)
      if (!articleId) setSelected(null)
      setReaderScrolled(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const currentArticle = selected?.id === selectedId ? selected : null

  async function refresh() {
    const { articles } = await listArticles({ q: query, status: 'ready', sort, min_words: minWords })
    setArticles(articles)
  }

  useEffect(() => {
    clearReader()
    refresh().catch(console.error)
  }, [query, sort, minWords])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setSelected(null)
    setReaderScrolled(false)
    readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    getArticle(selectedId).then(({ article }) => {
      if (cancelled) return
      setSelected(article)
      setReaderScrolled(false)
      readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    }).catch(console.error)
    return () => { cancelled = true }
  }, [selectedId])

  function clearReader() {
    setSelectedId(null)
    setSelected(null)
    setReaderScrolled(false)
  }

  async function selectArticle(id) {
    history.pushState(null, '', `?article=${id}`)
    setSelectedId(id)
    setSelected(null)
    setReaderScrolled(false)
    readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    try {
      const { article } = await getArticle(id)
      setSelected(article)
      readerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    } catch (err) {
      console.error(err)
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

  function selectPanel(panel) {
    const p = new URLSearchParams()
    p.set('panel', panel)
    history.pushState(null, '', `?${p}`)
    if (panel === 'home') setQuery('')
    clearReader()
    setActivePanel(panel)
    setMobileNavOpen(false)
  }

  function togglePanel() {
    const p = new URLSearchParams({ panel: 'home' })
    history.pushState(null, '', `?${p}`)
    clearReader()
    setActivePanel('home')
  }

  function adjustFontScale(delta) {
    setFontScale(v => Math.max(0.85, Math.min(1.3, Number((v + delta * 0.05).toFixed(2)))))
  }

  const sharedCardProps = { articles, selectedId, onOpen: selectArticle, onSave: toggleSave }
  const toggleSidebar = () => setSidebarCollapsed(v => !v)

  return (
    <main className={cx('app-shell', sidebarCollapsed && 'sidebar-collapsed')}>
      <Sidebar
        active={selectedId ? null : activePanel}
        onSelect={selectPanel}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        mobileOpen={mobileNavOpen}
      />
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <button className="mobile-hamburger" onClick={() => setMobileNavOpen(v => !v)} aria-label="Menu">
        <Menu size={18} />
      </button>
      {selectedId ? (
        <Reader
          ref={readerRef}
          article={currentArticle}
          scrolled={readerScrolled}
          onScroll={e => setReaderScrolled(e.currentTarget.scrollTop > 120)}
          fontScale={fontScale}
          onFontScale={adjustFontScale}
          onToggleLibrary={togglePanel}
          onPatch={patchSelected}
          theme={theme}
          onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        />
      ) : activePanel === 'carousel' ? (
        <CarouselPanel
          articles={articles.filter(a => (a.word_count ?? 0) >= carouselMinWords)}
          onOpen={selectArticle}
          interval={carouselInterval}
        />
      ) : activePanel === 'home' ? (
        <HomePanel
          {...sharedCardProps}
          sort={sort}
          onSort={v => setSort(v)}
          minWords={minWords}
          onMinWords={v => setMinWords(v)}
        />
      ) : activePanel === 'search' ? (
        <SearchPanel
          {...sharedCardProps}
          query={query}
          onQuery={v => setQuery(v)}
        />
      ) : activePanel === 'settings' ? (
        <SettingsPanel
          fontScale={fontScale}
          onFontScale={adjustFontScale}
          carouselInterval={carouselInterval}
          onCarouselInterval={setCarouselInterval}
          carouselMinWords={carouselMinWords}
          onCarouselMinWords={setCarouselMinWords}
        />
      ) : null}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
