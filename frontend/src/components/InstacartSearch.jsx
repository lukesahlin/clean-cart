// InstacartSearch.jsx -- Search Instacart for products with live prices,
// store availability, and ingredient analysis.

import { useState } from 'react'
import { searchInstacart } from '../api.js'

const GRADE_COLORS = {
  excellent: { bg: '#E8F5E9', text: '#1B5E20', label: 'Excellent' },
  good:      { bg: '#F1F8E9', text: '#33691E', label: 'Good' },
  fair:      { bg: '#FFF8E1', text: '#E65100', label: 'Fair' },
  poor:      { bg: '#FBE9E7', text: '#BF360C', label: 'Poor' },
  unknown:   { bg: '#F5F5F5', text: '#777',    label: 'Unknown' },
}

function GradeBadge({ grade, score }) {
  const colors = GRADE_COLORS[grade] || GRADE_COLORS.unknown
  return (
    <div style={{ ...s.gradeBadge, background: colors.bg, color: colors.text }}>
      {score != null ? score : colors.label}
    </div>
  )
}

function CleanBadge({ isClean, flagged }) {
  if (isClean === null || isClean === undefined) {
    return <div style={s.noBadge}>No ingredients</div>
  }
  return (
    <div style={{ ...s.cleanBadge, background: isClean ? '#E8F5E9' : '#FFEBEE', color: isClean ? '#1B5E20' : '#C62828' }}>
      {isClean ? '✓ Clean' : `⚠ ${flagged?.length || 0} flagged`}
    </div>
  )
}

function ProductCard({ product, onExpand, expanded }) {
  const fr = product.filter_result
  const hs = product.health_score

  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        {product.image_url ? (
          <img src={product.image_url} alt={product.product_name} style={s.productImg} onError={e => { e.target.style.display = 'none' }} />
        ) : (
          <div style={s.imgPlaceholder}>🛒</div>
        )}
        <div style={s.cardInfo}>
          <div style={s.productName}>{product.product_name}</div>
          {product.brand && <div style={s.brand}>{product.brand}</div>}
          <div style={s.meta}>
            {product.size && <span style={s.metaChip}>{product.size}</span>}
            {product.store_name && product.store_name !== 'Instacart' && (
              <span style={s.metaChip}>📍 {product.store_name}</span>
            )}
          </div>
        </div>
        <div style={s.cardRight}>
          {product.price_str && <div style={s.price}>{product.price_str}</div>}
          {hs ? <GradeBadge grade={hs.grade} score={hs.score} /> : null}
          {!hs && <CleanBadge isClean={fr?.is_clean} flagged={fr?.flagged} />}
        </div>
      </div>

      {fr && (
        <div style={s.filterRow}>
          <CleanBadge isClean={fr.is_clean} flagged={fr.flagged} />
          {fr.flagged?.length > 0 && (
            <div style={s.flaggedList}>
              {fr.flagged.slice(0, 3).map((f, i) => (
                <span key={i} style={s.flagChip}>{f.ingredient}</span>
              ))}
              {fr.flagged.length > 3 && <span style={s.flagChip}>+{fr.flagged.length - 3} more</span>}
            </div>
          )}
        </div>
      )}

      {product.ingredient_text && (
        <button style={s.expandBtn} onClick={() => onExpand(product.product_id)}>
          {expanded ? 'Hide ingredients ↑' : 'Show ingredients ↓'}
        </button>
      )}

      {expanded && product.ingredient_text && (
        <div style={s.ingredientBox}>
          <p style={s.ingredientText}>{product.ingredient_text}</p>
        </div>
      )}
    </div>
  )
}

export default function InstacartSearch({ avoidList = [] }) {
  const [query, setQuery] = useState('')
  const [zipCode, setZipCode] = useState('99201')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const handleSearch = async (e) => {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResults(null)
    setExpandedId(null)
    try {
      const data = await searchInstacart({ query: query.trim(), zip_code: zipCode, avoid: avoidList })
      setResults(data)
      if (data.results?.length === 0) {
        setError('No results found. Try a different search term.')
      }
    } catch (err) {
      setError('Search failed. The backend may be waking up — try again in 30 seconds.')
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id)

  return (
    <div style={s.page}>
      <div style={s.hero}>
        <div style={s.heroHeader}>
          <span style={s.heroIcon}>🛒</span>
          <div>
            <h1 style={s.heroTitle}>Instacart Search</h1>
            <p style={s.heroSub}>Live prices, availability, and ingredient analysis.</p>
          </div>
        </div>
      </div>

      <form style={s.searchForm} onSubmit={handleSearch}>
        <div style={s.searchRow}>
          <input
            style={s.searchInput}
            type="text"
            placeholder="Search Instacart (e.g. tortilla chips)…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
          />
          <input
            style={s.zipInput}
            type="text"
            placeholder="Zip"
            value={zipCode}
            onChange={e => setZipCode(e.target.value)}
            maxLength={5}
          />
        </div>
        <button style={{ ...s.searchBtn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
          {loading ? (
            <span style={s.btnInner}><span style={s.spinner} /> Searching Instacart…</span>
          ) : (
            'Search →'
          )}
        </button>
      </form>

      {loading && (
        <div style={s.loadingBox}>
          <div style={s.spinner2} />
          <p style={s.loadingText}>Searching Instacart… this may take 20–30 seconds on first search.</p>
        </div>
      )}

      {error && !loading && (
        <div style={s.errorBox}>⚠️ {error}</div>
      )}

      {results && !loading && results.results?.length > 0 && (
        <div style={s.results}>
          <p style={s.resultsMeta}>
            {results.total} result{results.total !== 1 ? 's' : ''} for "{results.query}"
          </p>
          {results.results.map(product => (
            <ProductCard
              key={product.product_id}
              product={product}
              onExpand={toggleExpand}
              expanded={expandedId === product.product_id}
            />
          ))}
        </div>
      )}

      {!results && !loading && (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>🛒</div>
          <p style={s.emptyTitle}>Search any grocery item</p>
          <p style={s.emptySub}>We'll find it on Instacart and check the ingredients for you.</p>
          <div style={s.exampleChips}>
            {['tortilla chips', 'mayo', 'granola', 'salad dressing'].map(ex => (
              <button key={ex} style={s.exampleChip} onClick={() => { setQuery(ex); }}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { minHeight: '100%', background: '#F5F4F1', paddingBottom: 24 },
  hero: { padding: '24px 20px 20px', background: '#fff', borderBottom: '1px solid #EBEBEB' },
  heroHeader: { display: 'flex', alignItems: 'center', gap: 12 },
  heroIcon: { fontSize: 32 },
  heroTitle: { fontSize: 22, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-0.4px' },
  heroSub: { fontSize: 13, color: '#888', margin: '3px 0 0' },
  searchForm: { padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 },
  searchRow: { display: 'flex', gap: 8 },
  searchInput: { flex: 1, border: '1.5px solid #E0DDD8', borderRadius: 12, padding: '12px 14px', fontSize: 15, outline: 'none', background: '#fff', fontFamily: 'inherit' },
  zipInput: { width: 72, border: '1.5px solid #E0DDD8', borderRadius: 12, padding: '12px 10px', fontSize: 15, outline: 'none', background: '#fff', fontFamily: 'inherit', textAlign: 'center' },
  searchBtn: { background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', width: '100%' },
  btnInner: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  spinner: { width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' },
  loadingBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', gap: 16 },
  spinner2: { width: 36, height: 36, border: '3px solid #E8F5E9', borderTop: '3px solid #1B5E20', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  loadingText: { fontSize: 14, color: '#888', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 },
  errorBox: { margin: '16px', background: '#FFF5F5', border: '1px solid #FFCDD2', borderRadius: 12, padding: '14px', fontSize: 13, color: '#B71C1C' },
  results: { padding: '16px 16px 0' },
  resultsMeta: { fontSize: 12, color: '#AAA', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' },
  card: { background: '#fff', border: '1.5px solid #EBEBEB', borderRadius: 16, padding: '14px', marginBottom: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
  cardTop: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  productImg: { width: 60, height: 60, objectFit: 'contain', borderRadius: 10, background: '#F5F5F5', flexShrink: 0 },
  imgPlaceholder: { width: 60, height: 60, borderRadius: 10, background: '#F0EDE8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 },
  cardInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.3, marginBottom: 3 },
  brand: { fontSize: 12, color: '#888', marginBottom: 5 },
  meta: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  metaChip: { fontSize: 11, background: '#F0F0EE', color: '#666', borderRadius: 8, padding: '2px 7px', fontWeight: 500 },
  cardRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  price: { fontSize: 16, fontWeight: 800, color: '#111' },
  gradeBadge: { fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '3px 9px' },
  cleanBadge: { fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '3px 9px' },
  noBadge: { fontSize: 11, color: '#BBB', fontStyle: 'italic' },
  filterRow: { marginTop: 10, paddingTop: 10, borderTop: '1px solid #F0EDE8', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  flaggedList: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  flagChip: { fontSize: 11, background: '#FFEBEE', color: '#C62828', borderRadius: 6, padding: '2px 7px', fontWeight: 600 },
  expandBtn: { marginTop: 10, background: 'none', border: 'none', fontSize: 12, color: '#1B5E20', cursor: 'pointer', fontWeight: 600, padding: 0 },
  ingredientBox: { marginTop: 8, background: '#F8F7F4', borderRadius: 10, padding: '10px 12px' },
  ingredientText: { fontSize: 12, color: '#555', lineHeight: 1.6, margin: 0 },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', textAlign: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: '#111', margin: '0 0 6px' },
  emptySub: { fontSize: 14, color: '#888', margin: '0 0 20px', lineHeight: 1.5 },
  exampleChips: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  exampleChip: { background: '#fff', border: '1.5px solid #E0DDD8', borderRadius: 20, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: '#555', fontWeight: 500 },
}
