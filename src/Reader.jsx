import React, { useRef, useState } from 'react'
import { Archive, ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, Moon, Sparkles, Sun } from 'lucide-react'

function cx(...xs) { return xs.filter(Boolean).join(' ') }

function Button({ className, variant = 'default', ...props }) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...props} />
}

function articleHtml(article) {
  if (article.html_content) {
    return article.html_content
      .replace(/<a\b(?![^>]*\btarget=)/gi, '<a target="_blank" rel="noreferrer"')
      .replace(/<a\b([^>]*?)\btarget=([\'"])[^\'"]*\2/gi, '<a$1target="_blank"')
      .replace(/<a\b(?![^>]*\brel=)([^>]*)>/gi, '<a rel="noreferrer"$1>')
  }
  return (article.text_content || '')
    .replace(/([.!?][\"''']?)\s+(?=[A-Z"])/g, '$1\n\n')
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(text => '<p>' + text + '</p>')
    .join('\n')
}

export const Reader = React.forwardRef(function Reader(
  { article, onToggleLibrary, onPatch, scrolled, onScroll, fontScale, onFontScale, theme, onToggleTheme },
  ref,
) {
  if (!article) return (
    <section ref={ref} onScroll={onScroll} className="reader empty">
      <Sparkles />
      <p>Select something worth your attention.</p>
    </section>
  )

  return (
    <section ref={ref} onScroll={onScroll} className="reader">
      <div className="reader-actions">
        <Button variant="ghost" className="reader-icon-btn" onClick={onToggleLibrary} aria-label="Back" title="Back"><ArrowLeft size={14} /></Button>
        <div className={cx('reader-sticky-title', scrolled && 'visible')}>
          {article.favicon_url && <img className="favicon favicon-sticky" src={article.favicon_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
          {article.title}
        </div>
        <div className="reader-action-group">
          <Button variant="ghost" className="reader-icon-btn" onClick={() => onPatch({ saved: !article.saved })} aria-label="Save article" title="Save">
            {article.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </Button>
          <Button variant="ghost" className="reader-icon-btn font-btn" onClick={() => onFontScale(-1)} aria-label="Decrease font size" title="Decrease font size">A−</Button>
          <Button variant="ghost" className="reader-icon-btn font-btn" onClick={() => onFontScale(1)} aria-label="Increase font size" title="Increase font size">A+</Button>
          <Button variant="ghost" className="reader-icon-btn" onClick={() => onPatch({ archived: true })} aria-label="Archive article" title="Archive"><Archive size={14} /></Button>
          <a className="btn btn-ghost reader-icon-btn" href={article.url} target="_blank" rel="noreferrer" aria-label="Open original" title="Original"><ExternalLink size={14} /></a>
          <Button variant="ghost" className="reader-icon-btn" onClick={onToggleTheme} aria-label="Toggle dark mode" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </div>
      </div>
      <header className="reader-head">
        <div className="reader-kicker">
          {article.favicon_url && <img className="favicon favicon-kicker" src={article.favicon_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
          {article.site_name || 'Essay'} · {article.reading_minutes} minute read
        </div>
        <h1>{article.title}</h1>
        {article.byline && <p className="byline">{article.byline}</p>}
        {article.excerpt && <p className="dek">{article.excerpt}</p>}
      </header>
      <div
        className="prose"
        style={{ '--reader-font-scale': fontScale }}
        dangerouslySetInnerHTML={{ __html: articleHtml(article) }}
      />
    </section>
  )
})
