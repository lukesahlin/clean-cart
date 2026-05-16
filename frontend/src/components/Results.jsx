// Results.jsx — auto store search + best store recommendation + prices

import { useState, useCallback, useEffect, useRef } from 'react'
import { fetchNearbyStores, checkAvailability, requestGeolocation, reverseGeocode } from '../api.js'
import StoreMap from './StoreMap.jsx'

// ── Design helpers ────────────────────────────────────────────────────────────

function gradeColor(score) {
  if (score >= 85) return { bg: '#1B5E20', light: '#E8F5E9', text: '#fff' }
  if (score >= 70) return { bg: '#388E3C', light: '#F1F8E9', text: '#fff' }
  if (score >= 50) return { bg: '#F57F17', light: '#FFF8E1', text: '#fff' }
  if (score >= 30) return { bg: '#E65100', light: '#FBE9E7', text: '#fff' }
  return { bg: '#B71C1C', light: '#FFEBEE', text: '#fff' }
}

function storeEmoji(chainId) {
  const map = { walmart: '🟦', safeway: '🔴', albertsons: '🔵', fred_meyer: '🟠', whole_foods: '🟢', trader_joes: '🌺', yokes: '🟡', rosauers: '🟣' }
  return map[chainId] || '🏪'
}

function fmt$(price) {
  if (price == null) return null
  return `$${Number(price).toFixed(2)}`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Results({ results, items, loading, onBack, onProductClick }) {
  const [storeStatus, setStoreStatus] = useState('idle') // idle | locating | locFailed | searching | checking | done | noStores
  const [userLocation, setUserLocation] = useState(null)
  const [nearbyStores, setNearbyStores] = useState([])
  const [availMap, setAvailMap] = useState({})          // key → { results[], done }
  const [showMap, setShowMap] = useState(false)
  const [locationLabel, setLocationLabel] = useState('')
  const [zipCode, setZipCode] = useState('99201')        // derived from actual location

  const autoRan = useRef(false)

  // Auto-run on mount: locate → find stores → check availability
  useEffect(() => {
    if (autoRan.current || loading) return
    autoRan.current = true
    runAutoSearch()
  }, [loading]) // eslint-disable-line

  const runAutoSearch = useCallback(async (radiusMeters = 16093, overrideLoc = null) => { // default 10 mi
    let loc = overrideLoc
    if (!loc) {
      setStoreStatus('locating')
      try {
        loc = await requestGeolocation()
        setUserLocation(loc)
        setLocationLabel('Current location')
        // derive zip code from actual coordinates — used by store availability adapters
        reverseGeocode(loc.lat, loc.lng).then(geo => {
          if (geo.zip_code) setZipCode(geo.zip_code)
        })
      } catch {
        setStoreStatus('locFailed')
        return
      }
    }

    setStoreStatus('searching')
    let stores = []
    try {
      const data = await fetchNearbyStores(loc.lat, loc.lng, radiusMeters)
      stores = data.stores || []
      setNearbyStores(stores)
    } catch {
      setStoreStatus('noStores')
      return
    }

    if (!stores.length) { setStoreStatus('noStores'); return }

    // check availability for top pick of every item with results
    setStoreStatus('checking')
    const toCheck = (results?.results || [])
      .map(r => r.recommendations[0])
      .filter(Boolean)

    await Promise.all(toCheck.map(async (product) => {
      const key = product.barcode || product.product_name
      setAvailMap(p => ({ ...p, [key]: { results: [], done: false } }))
      try {
        const data = await checkAvailability({
          product_query: product.brand ? `${product.brand} ${product.product_name}` : product.product_name,
          stores: stores.slice(0, 5),
          zip_code: zipCode,
        })
        setAvailMap(p => ({ ...p, [key]: { results: data.results || [], done: true } }))
      } catch {
        setAvailMap(p => ({ ...p, [key]: { results: [], done: true } }))
      }
    }))

    setStoreStatus('done')
  }, [results])

  const handleMapSearch = useCallback(async (radiusMeters, overrideLoc = null) => {
    autoRan.current = true // prevent re-run
    if (overrideLoc) {
      setUserLocation(overrideLoc)
      setLocationLabel(overrideLoc.label || 'Custom location')
    }
    await runAutoSearch(radiusMeters, overrideLoc)
  }, [runAutoSearch])

  const allDone = storeStatus === 'done'
  const shoppingPlan = buildShoppingPlan(results?.results || [], availMap)
  const bestRoute = allDone ? buildBestRoute(shoppingPlan, results?.results?.length || 0) : null

  if (loading) return <LoadingSkeleton count={items.length} />

  const cleanCount = results.results.filter(r => r.found_clean).length

  return (
    <div style={s.page}>
      {/* Summary bar */}
      <div style={s.summaryBar}>
        <div style={s.summaryCount}>
          <span style={s.summaryNum}>{cleanCount}</span>
          <span style={s.summaryOf}>/{results.results.length}</span>
          <span style={s.summaryLabel}> items with clean picks</span>
        </div>
        <StoreStatusPill status={storeStatus} storeCount={nearbyStores.length} />
      </div>

      {/* Best route recommendation — shows when availability check is done */}
      {allDone && bestRoute && (
        <RouteCard route={bestRoute} totalItems={results.results.length} />
      )}

      {storeStatus === 'noStores' && (
        <div style={s.infoBanner}>🏪 No supported stores found — try a larger radius</div>
      )}

      {/* Map — always visible once we have a location */}
      {userLocation && (
        <StoreMap
          userLocation={userLocation}
          locationLabel={locationLabel}
          stores={nearbyStores}
          onSearch={handleMapSearch}
          onLocationChange={(loc) => {
            setUserLocation(loc)
            setLocationLabel(loc.label || 'Custom location')
          }}
          searching={storeStatus === 'searching' || storeStatus === 'checking'}
        />
      )}
      {storeStatus === 'locFailed' && !userLocation && (
        <button style={s.retryBanner} onClick={() => runAutoSearch()}>
          📍 Tap to find stores near you
        </button>
      )}

      {/* Item results */}
      {results.results.map(result => (
        <ItemCard key={result.item} result={result} availMap={availMap} storeStatus={storeStatus} onProductClick={onProductClick} />
      ))}

      {/* Full shopping plan */}
      {shoppingPlan.length > 1 && <ShoppingPlan plan={shoppingPlan} />}

      <p style={s.footer}>
        Data from{' '}
        <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer" style={s.footerLink}>
          Open Food Facts
        </a>. Always verify the label in-store.
      </p>
    </div>
  )
}

// ── Status pill in summary bar ────────────────────────────────────────────────

function StoreStatusPill({ status, storeCount }) {
  const map = {
    idle:      null,
    locating:  { label: '📍 Locating…',       color: '#888' },
    locFailed: { label: '📍 Location needed',  color: '#E65100' },
    searching: { label: '🔍 Finding stores…', color: '#888' },
    checking:  { label: '⏳ Checking stock…', color: '#888' },
    done:      { label: `✓ ${storeCount} stores`, color: '#1B5E20' },
    noStores:  { label: '🏪 No stores found', color: '#888' },
  }
  const info = map[status]
  if (!info) return null
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: info.color }}>{info.label}</span>
  )
}

// ── Route card ────────────────────────────────────────────────────────────────

function RouteCard({ route, totalItems }) {
  const { stops, coveredCount, total } = route
  const isMultiStop = stops.length > 1
  const label = isMultiStop ? 'Best 2-stop route' : 'Recommended store'
  const coveragePct = Math.round((coveredCount / totalItems) * 100)

  // Build a Google Maps directions URL for multi-stop
  function directionsUrl() {
    if (stops.length === 1) {
      const addr = encodeURIComponent(stops[0].store.store_name)
      return `https://www.google.com/maps/search/?api=1&query=${addr}`
    }
    const a = encodeURIComponent(stops[0].store.store_name)
    const b = encodeURIComponent(stops[1].store.store_name)
    return `https://www.google.com/maps/dir/?api=1&destination=${b}&waypoints=${a}`
  }

  return (
    <div style={s.routeCard}>
      {/* Header row */}
      <div style={s.routeHeader}>
        <div>
          <div style={s.routeBadge}>{label}</div>
          <div style={s.routeCoverage}>
            {coveredCount}/{totalItems} items covered
            {total != null && ` · Est. $${total.toFixed(2)}`}
          </div>
        </div>
        <a href={directionsUrl()} target="_blank" rel="noopener noreferrer" style={s.directionsBtn}>
          🗺 Route
        </a>
      </div>

      {/* Coverage bar */}
      <div style={s.coverageBarTrack}>
        <div style={{ ...s.coverageBarFill, width: `${coveragePct}%` }} />
      </div>

      {/* Stops */}
      {stops.map((stop, idx) => (
        <div key={stop.store.store_branch_id} style={s.routeStop}>
          <div style={s.routeStopHeader}>
            <div style={s.routeStopNumber}>{idx + 1}</div>
            <div style={s.routeStopInfo}>
              <div style={s.routeStopName}>{storeEmoji(stop.store.chain_id)} {stop.store.store_name}</div>
              {stop.items.some(i => i.price != null) && (
                <div style={s.routeStopTotal}>
                  ${stop.items.reduce((s, i) => s + (i.price || 0), 0).toFixed(2)}
                </div>
              )}
            </div>
          </div>
          <div style={s.routeStopItems}>
            {stop.items.map(item => (
              <div key={item.product_name} style={s.routeItem}>
                <span style={s.routeItemCheck}>✓</span>
                <span style={s.routeItemName}>{item.product_name}</span>
                {item.price != null && <span style={s.routeItemPrice}>{fmt$(item.price)}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Item card ─────────────────────────────────────────────────────────────────

function ItemCard({ result, availMap, storeStatus, onProductClick }) {
  const hasResults = result.recommendations.length > 0
  return (
    <div style={s.itemCard}>
      <div style={s.itemHeader}>
        <h2 style={s.itemName}>{result.item}</h2>
        {hasResults
          ? <span style={s.cleanPill}>✓ {result.recommendations.length} clean</span>
          : <span style={s.noMatchPill}>No match</span>}
      </div>

      {!hasResults && (
        <p style={s.noMatchText}>
          Checked {result.total_products_checked} products — no clean option found. Scan the label in-store.
        </p>
      )}

      {result.recommendations.map((product, i) => {
        const key = product.barcode || product.product_name
        return (
          <ProductCard
            key={key}
            product={product}
            rank={i + 1}
            avail={availMap[key]}
            storeStatus={storeStatus}
            onClick={() => onProductClick(product)}
          />
        )
      })}
    </div>
  )
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ product, rank, avail, storeStatus, onClick }) {
  const hs = product.health_score
  const score = hs?.score ?? null
  const col = score !== null ? gradeColor(score) : { bg: '#CCC', light: '#F5F5F5', text: '#fff' }

  // find the best in-stock result with a price
  const inStockResults = (avail?.results || []).filter(r => r.in_stock)
  const cheapest = inStockResults
    .filter(r => r.price != null)
    .sort((a, b) => a.price - b.price)[0]

  return (
    <button style={s.productCard} onClick={onClick}>
      {/* Left: image */}
      <div style={s.cardImageWrap}>
        {product.image_url
          ? <img src={product.image_url} alt="" style={s.cardImage} />
          : <div style={s.cardImagePlaceholder}>🛒</div>}
        {rank === 1 && <div style={s.bestPick}>Best</div>}
      </div>

      {/* Middle: info */}
      <div style={s.cardBody}>
        <div style={s.cardName}>{product.product_name}</div>
        {product.brand && <div style={s.cardBrand}>{product.brand}</div>}

        <div style={s.cardBadges}>
          {product.is_organic && <span style={s.organicBadge}>Organic</span>}
          {product.nutriscore && <span style={s.nutriBadge}>{`Nutri-${product.nutriscore.toUpperCase()}`}</span>}
        </div>

        {/* Store availability */}
        {(storeStatus === 'checking' || (avail && !avail.done)) && (
          <div style={s.availChecking}>⏳ Checking stores…</div>
        )}
        {avail?.done && (
          <div style={s.availRow}>
            {inStockResults.length > 0 ? (
              <>
                {inStockResults.slice(0, 3).map(r => (
                  <span key={r.store_branch_id} style={s.availChipIn}>
                    {storeEmoji(r.chain_id)} {r.store_name.split(' ')[0]}
                    {r.price != null ? ` ${fmt$(r.price)}` : ' ✓'}
                  </span>
                ))}
              </>
            ) : (
              <span style={s.availChipOut}>Not found nearby</span>
            )}
          </div>
        )}

        <div style={s.cardMeta}>{estimateIngCount(product.ingredient_text)} ingredients</div>
      </div>

      {/* Right: score + price */}
      <div style={s.cardRight}>
        <div style={{ ...s.scoreCircle, background: col.bg }}>
          {score !== null ? (
            <>
              <span style={s.scoreNum}>{score}</span>
              <span style={s.scoreGrade}>{hs.grade.slice(0,4)}</span>
            </>
          ) : <span style={s.scoreNum}>?</span>}
        </div>
        {cheapest?.price != null && (
          <div style={s.priceTag}>{fmt$(cheapest.price)}</div>
        )}
      </div>
    </button>
  )
}

// ── Shopping plan (all stores) ────────────────────────────────────────────────

function ShoppingPlan({ plan }) {
  return (
    <div style={s.planSection}>
      <h2 style={s.planTitle}>All stores</h2>
      {plan.map(({ store, items }) => {
        const hasPrice = items.some(i => i.price != null)
        const total = hasPrice ? items.reduce((sum, i) => sum + (i.price || 0), 0) : null
        return (
          <div key={store.store_branch_id} style={s.planStore}>
            <div style={s.planStoreHeader}>
              <span style={s.planStoreEmoji}>{storeEmoji(store.chain_id)}</span>
              <div style={{ flex: 1 }}>
                <div style={s.planStoreName}>{store.store_name}</div>
                <div style={s.planStoreCount}>{items.length} item{items.length !== 1 ? 's' : ''}</div>
              </div>
              {total != null && <span style={s.planTotal}>${total.toFixed(2)}</span>}
            </div>
            {items.map(item => (
              <div key={item.product_name} style={s.planItem}>
                <span style={s.planDot} />
                <span style={s.planItemName}>{item.product_name}</span>
                {item.price != null && <span style={s.planPrice}>{fmt$(item.price)}</span>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton({ count }) {
  return (
    <div style={s.page}>
      <div style={s.summaryBar}>
        <div style={{ ...s.skeletonBlock, width: 180, height: 20 }} />
      </div>
      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
        <div key={i} style={s.itemCard}>
          <div style={{ ...s.skeletonBlock, width: 120, height: 18, marginBottom: 12 }} />
          <div style={{ ...s.productCard, cursor: 'default' }}>
            <div style={{ ...s.skeletonBlock, width: 62, height: 62, borderRadius: 10 }} />
            <div style={s.cardBody}>
              <div style={{ ...s.skeletonBlock, width: '80%', height: 15, marginBottom: 8 }} />
              <div style={{ ...s.skeletonBlock, width: '50%', height: 13 }} />
            </div>
            <div style={{ ...s.scoreCircle, background: '#E0DDD8' }} />
          </div>
        </div>
      ))}
      <style>{`@keyframes shimmer{0%{opacity:.5}50%{opacity:1}100%{opacity:.5}}`}</style>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateIngCount(text) {
  if (!text) return '?'
  return text.split(',').filter(p => p.trim()).length
}

function buildShoppingPlan(itemResults, availMap) {
  // group in-stock items by store, sorted by coverage then price
  const storeMap = {}
  for (const r of itemResults) {
    const top = r.recommendations[0]
    if (!top) continue
    const key = top.barcode || top.product_name
    const avail = availMap[key]
    if (!avail?.done) continue
    for (const result of avail.results) {
      if (!result.in_stock) continue
      const sid = result.store_branch_id
      if (!storeMap[sid]) storeMap[sid] = { store: result, items: [] }
      storeMap[sid].items.push({ product_name: top.product_name, price: result.price })
    }
  }
  // sort: most items first, then by total price (lower better)
  return Object.values(storeMap).sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length
    const aTotal = a.items.reduce((s, i) => s + (i.price || 0), 0)
    const bTotal = b.items.reduce((s, i) => s + (i.price || 0), 0)
    return aTotal - bTotal
  })
}

function buildBestRoute(plan, totalItems) {
  // Returns the best 1 or 2-stop route covering the most items cheapest.
  // plan is already sorted best-first from buildShoppingPlan.
  if (plan.length === 0) return null

  // single-store — covers everything
  if (plan[0].items.length === totalItems || plan.length === 1) {
    return { stops: [plan[0]], coveredCount: plan[0].items.length }
  }

  // try all pairs of stores, pick the pair with best coverage then lowest total
  let bestRoute = { stops: [plan[0]], coveredCount: plan[0].items.length, total: null }

  for (let i = 0; i < Math.min(plan.length, 5); i++) {
    for (let j = i + 1; j < Math.min(plan.length, 5); j++) {
      const storeA = plan[i]
      const storeB = plan[j]
      // union of product names covered
      const namesA = new Set(storeA.items.map(x => x.product_name))
      const namesB = new Set(storeB.items.map(x => x.product_name))
      const combined = new Set([...namesA, ...namesB])

      // for each item, pick cheapest store
      const allItemNames = [...combined]
      let routeTotal = null
      const itemsForA = [], itemsForB = []

      for (const name of allItemNames) {
        const fromA = storeA.items.find(x => x.product_name === name)
        const fromB = storeB.items.find(x => x.product_name === name)
        // prefer A (it's better-ranked), put in B only if B has it and A doesn't
        if (fromA) {
          itemsForA.push(fromA)
          if (fromA.price != null) routeTotal = (routeTotal || 0) + fromA.price
        } else if (fromB) {
          itemsForB.push(fromB)
          if (fromB.price != null) routeTotal = (routeTotal || 0) + fromB.price
        }
      }

      const route = {
        stops: [
          { ...storeA, items: itemsForA },
          { ...storeB, items: itemsForB },
        ].filter(s => s.items.length > 0),
        coveredCount: combined.size,
        total: routeTotal,
      }

      // prefer more coverage, then lower total
      if (
        route.coveredCount > bestRoute.coveredCount ||
        (route.coveredCount === bestRoute.coveredCount &&
          route.total != null &&
          (bestRoute.total == null || route.total < bestRoute.total))
      ) {
        bestRoute = route
      }
    }
  }

  return bestRoute
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: { background: '#F5F4F1', minHeight: '100%', paddingBottom: 24 },

  summaryBar: { padding: '14px 20px', background: '#fff', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  summaryCount: { display: 'flex', alignItems: 'baseline', gap: 2 },
  summaryNum: { fontSize: 26, fontWeight: 800, color: '#1B5E20' },
  summaryOf: { fontSize: 18, fontWeight: 600, color: '#AAA' },
  summaryLabel: { fontSize: 14, color: '#666' },

  // route card
  routeCard: { margin: '12px 16px 0', background: '#1B5E20', borderRadius: 18, overflow: 'hidden', boxShadow: '0 4px 20px rgba(27,94,32,0.3)' },
  routeHeader: { padding: '14px 16px 10px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  routeBadge: { fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 },
  routeCoverage: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 600 },
  directionsBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: 'rgba(255,255,255,0.15)', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap' },
  coverageBarTrack: { height: 4, background: 'rgba(255,255,255,0.2)', marginBottom: 2 },
  coverageBarFill: { height: '100%', background: '#A5D6A7', transition: 'width 0.6s ease', borderRadius: 2 },
  routeStop: { padding: '10px 16px 12px', borderTop: '1px solid rgba(255,255,255,0.12)' },
  routeStopHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  routeStopNumber: { width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  routeStopInfo: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  routeStopName: { fontSize: 14, fontWeight: 700, color: '#fff' },
  routeStopTotal: { fontSize: 13, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: 8 },
  routeStopItems: {},
  routeItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.07)' },
  routeItemCheck: { fontSize: 11, color: '#A5D6A7', flexShrink: 0 },
  routeItemName: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  routeItemPrice: { fontSize: 12, fontWeight: 700, color: '#fff' },

  retryBanner: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px 20px', background: '#FFF8E1', border: 'none', borderBottom: '1px solid #FFE082', fontSize: 14, fontWeight: 600, color: '#E65100', cursor: 'pointer' },
  infoBanner: { padding: '12px 20px', background: '#F5F5F5', fontSize: 13, color: '#888', textAlign: 'center' },
  mapToggle: { display: 'block', margin: '12px 16px 0', padding: '9px 16px', background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, fontSize: 13, fontWeight: 600, color: '#555', cursor: 'pointer', width: 'calc(100% - 32px)' },

  itemCard: { background: '#fff', margin: '12px 16px 0', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  itemHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' },
  itemName: { fontSize: 17, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-0.3px' },
  cleanPill: { fontSize: 12, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9', borderRadius: 20, padding: '4px 10px', flexShrink: 0 },
  noMatchPill: { fontSize: 12, fontWeight: 700, color: '#B71C1C', background: '#FFEBEE', borderRadius: 20, padding: '4px 10px', flexShrink: 0 },
  noMatchText: { fontSize: 13, color: '#888', padding: '0 16px 16px', margin: 0, lineHeight: 1.5 },

  productCard: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 14px', background: 'none', border: 'none', borderTop: '1px solid #F0EDE8', width: '100%', cursor: 'pointer', textAlign: 'left' },
  cardImageWrap: { position: 'relative', flexShrink: 0 },
  cardImage: { width: 60, height: 60, objectFit: 'contain', borderRadius: 10, background: '#F8F7F4' },
  cardImagePlaceholder: { width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0EDE8', borderRadius: 10, fontSize: 24 },
  bestPick: { position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', background: '#1B5E20', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap', letterSpacing: '0.3px' },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.3, marginBottom: 2 },
  cardBrand: { fontSize: 12, color: '#888', marginBottom: 5 },
  cardBadges: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 5 },
  organicBadge: { fontSize: 11, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9', borderRadius: 10, padding: '2px 7px' },
  nutriBadge: { fontSize: 11, fontWeight: 700, color: '#555', background: '#F0EDE8', borderRadius: 10, padding: '2px 7px' },
  cardMeta: { fontSize: 11, color: '#BBB', marginTop: 3 },
  availChecking: { fontSize: 11, color: '#AAA', fontStyle: 'italic', marginBottom: 3 },
  availRow: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 3 },
  availChipIn: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#E8F5E9', color: '#1B5E20' },
  availChipOut: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#F5F5F5', color: '#AAA' },

  cardRight: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 },
  scoreCircle: { width: 54, height: 54, borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  scoreNum: { fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 },
  scoreGrade: { fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 1 },
  priceTag: { fontSize: 13, fontWeight: 800, color: '#1B5E20', background: '#E8F5E9', borderRadius: 8, padding: '2px 6px' },

  planSection: { margin: '12px 16px 0', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  planTitle: { fontSize: 11, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '14px 16px 6px', margin: 0 },
  planStore: { borderTop: '1px solid #F0EDE8', padding: '12px 16px' },
  planStoreHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  planStoreEmoji: { fontSize: 20 },
  planStoreName: { fontSize: 14, fontWeight: 700, color: '#111' },
  planStoreCount: { fontSize: 12, color: '#888' },
  planTotal: { fontSize: 15, fontWeight: 800, color: '#1B5E20' },
  planItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid #F8F7F4' },
  planDot: { width: 6, height: 6, borderRadius: '50%', background: '#1B5E20', flexShrink: 0 },
  planItemName: { flex: 1, fontSize: 13, color: '#444' },
  planPrice: { fontSize: 13, fontWeight: 700, color: '#111' },

  footer: { fontSize: 12, color: '#CCC', textAlign: 'center', padding: '20px 20px 0', lineHeight: 1.5, margin: 0 },
  footerLink: { color: '#AAA' },
  skeletonBlock: { background: 'linear-gradient(90deg,#E8E6E3 25%,#F0EDE8 50%,#E8E6E3 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite', borderRadius: 8 },
}
