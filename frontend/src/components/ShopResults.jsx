// ShopResults.jsx — store-first results view
// Displays products from nearby stores (Kroger/Walmart) filtered and scored.
// shopResults shape: [{ item: string, data: { query, stores_searched, stores_with_results, results: [...] } }]

import { useState } from 'react'
import LocationBar from './LocationBar.jsx'

// ── Design helpers ────────────────────────────────────────────────────────────

function gradeColor(score) {
  if (score >= 85) return { bg: '#1B5E20', light: '#E8F5E9', text: '#fff' }
  if (score >= 70) return { bg: '#388E3C', light: '#F1F8E9', text: '#fff' }
  if (score >= 50) return { bg: '#F57F17', light: '#FFF8E1', text: '#fff' }
  if (score >= 30) return { bg: '#E65100', light: '#FBE9E7', text: '#fff' }
  return { bg: '#B71C1C', light: '#FFEBEE', text: '#fff' }
}

function storeEmoji(chainId) {
  const map = {
    kroger: '🟠', fred_meyer: '🟠', qfc: '🟠',
    walmart: '🟦', safeway: '🔴', albertsons: '🔵',
    whole_foods: '🟢', trader_joes: '🌺', instacart: '🟩',
  }
  return map[chainId] || '🏪'
}

function distLabel(meters) {
  if (!meters) return ''
  const mi = meters / 1609.34
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

function ingCount(text) {
  if (!text) return null
  return text.split(',').filter(t => t.trim()).length
}

// ── Summary helpers ───────────────────────────────────────────────────────────

function buildSummary(shopResults) {
  let cleanItems = 0
  const storeSet = new Set()
  let totalProducts = 0

  for (const { data } of shopResults) {
    if (!data) continue
    let itemHasClean = false
    for (const storeResult of (data.results || [])) {
      storeSet.add(storeResult.store_name)
      for (const p of (storeResult.products || [])) {
        totalProducts++
        if (p.filter_result?.is_clean !== false) itemHasClean = true
      }
    }
    if (itemHasClean) cleanItems++
  }

  return { cleanItems, totalItems: shopResults.length, storeCount: storeSet.size, totalProducts }
}

// Build a shopping route: for each store, which items can you get there
function buildRoute(shopResults) {
  const storeMap = {}

  for (const { item, data } of shopResults) {
    for (const storeResult of (data?.results || [])) {
      const key = storeResult.store_name
      if (!storeMap[key]) {
        storeMap[key] = {
          store_name: storeResult.store_name,
          chain_id: storeResult.chain_id,
          address: storeResult.address,
          distance_meters: storeResult.distance_meters,
          items: [],
          totalPrice: 0,
          hasPrices: false,
        }
      }
      // best clean product for this item at this store
      const cleanPicks = (storeResult.products || []).filter(p => p.filter_result?.is_clean !== false)
      const best = cleanPicks[0] || storeResult.products?.[0]
      if (best) {
        storeMap[key].items.push({
          item,
          product_name: best.product_name,
          brand: best.brand,
          price: best.price,
          price_str: best.price_str,
          image_url: best.image_url,
          is_clean: best.filter_result?.is_clean !== false,
        })
        if (best.price) {
          storeMap[key].totalPrice += best.price
          storeMap[key].hasPrices = true
        }
      }
    }
  }

  // sort: most items first, then cheapest total
  return Object.values(storeMap).sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length
    return a.totalPrice - b.totalPrice
  })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ShopResults({ shopResults, location, onLocationChange, onBack }) {
  const [expandedItem, setExpandedItem] = useState(null)
  const [expandedProduct, setExpandedProduct] = useState(null)

  const summary = buildSummary(shopResults)
  const route = buildRoute(shopResults)
  const bestStore = route[0]
  const isLoading = shopResults.some(r => r.loading)

  return (
    <div style={s.page}>

      {/* Summary bar */}
      <div style={s.summaryBar}>
        <div style={s.summaryLeft}>
          <span style={s.summaryBig}>{summary.cleanItems}</span>
          <span style={s.summaryOf}>/{summary.totalItems}</span>
          <span style={s.summaryLabel}> items with clean picks</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {summary.storeCount > 0 && (
            <span style={s.storePill}>🏪 {summary.storeCount} store{summary.storeCount !== 1 ? 's' : ''}</span>
          )}
          {isLoading && <span style={s.loadingPill}>🔍 Searching…</span>}
        </div>
      </div>

      {/* Location bar — compact, always visible so user can change it */}
      <div style={s.locationRow}>
        <LocationBar location={location} onLocationChange={onLocationChange} compact />
      </div>

      {/* Best store card — shown when we have results */}
      {bestStore && bestStore.items.length > 0 && (
        <div style={s.routeCard}>
          <div style={s.routeCardLabel}>Best stop</div>
          <div style={s.routeCardStore}>
            <span style={{ fontSize: 20 }}>{storeEmoji(bestStore.chain_id)}</span>
            <div style={s.routeCardInfo}>
              <div style={s.routeCardName}>{bestStore.store_name}</div>
              <div style={s.routeCardMeta}>
                {distLabel(bestStore.distance_meters)}
                {bestStore.address ? ` · ${bestStore.address.split(',')[0]}` : ''}
              </div>
            </div>
            {bestStore.hasPrices && (
              <div style={s.routeCardTotal}>${bestStore.totalPrice.toFixed(2)}</div>
            )}
          </div>
          <div style={s.routeItems}>
            {bestStore.items.map(({ item, product_name, is_clean, price_str }) => (
              <div key={item} style={s.routeItem}>
                <span style={{ ...s.routeDot, background: is_clean ? '#4CAF50' : '#FF7043' }} />
                <span style={s.routeItemName}>{item}</span>
                <span style={s.routeItemProduct}>{product_name}</span>
                {price_str && <span style={s.routeItemPrice}>{price_str}</span>}
              </div>
            ))}
          </div>
          {route.length > 1 && (
            <div style={s.routeExtra}>+{route.length - 1} more store{route.length > 2 ? 's' : ''} nearby</div>
          )}
        </div>
      )}

      {/* No results at all */}
      {summary.storeCount === 0 && !shopResults.some(r => r.loading) && (
        <div style={s.emptyBanner}>
          <div style={s.emptyIcon}>🏪</div>
          <div style={s.emptyTitle}>No store results yet</div>
          <div style={s.emptyText}>Make sure Kroger API credentials are configured on the backend, or try expanding your search radius.</div>
        </div>
      )}

      {/* Per-item results */}
      {shopResults.map(({ item, data, loading: itemLoading, error: itemError }) => (
        <ItemSection
          key={item}
          item={item}
          data={data}
          loading={itemLoading}
          error={itemError}
          expanded={expandedItem === item}
          onToggle={() => setExpandedItem(expandedItem === item ? null : item)}
          expandedProduct={expandedProduct}
          onProductToggle={setExpandedProduct}
        />
      ))}

      {/* All-stores breakdown (when multi-store route exists) */}
      {route.length > 1 && (
        <AllStoresCard route={route} />
      )}

      <p style={s.footer}>Ingredient data from store APIs. Always verify the label in-store.</p>
    </div>
  )
}

// ── Item section ──────────────────────────────────────────────────────────────

function ItemSection({ item, data, loading, error, expanded, onToggle, expandedProduct, onProductToggle }) {
  if (loading) {
    return (
      <div style={s.itemCard}>
        <div style={s.itemHeader}>
          <h2 style={s.itemName}>{item}</h2>
          <span style={s.searchingPill}>🔍 Searching…</span>
        </div>
        <div style={s.skeletonRow}>
          <div style={{ ...s.skeleton, width: 60, height: 60, borderRadius: 10 }} />
          <div style={{ flex: 1 }}>
            <div style={{ ...s.skeleton, height: 14, width: '75%', marginBottom: 8 }} />
            <div style={{ ...s.skeleton, height: 12, width: '50%' }} />
          </div>
          <div style={{ ...s.skeleton, width: 52, height: 52, borderRadius: 14 }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={s.itemCard}>
        <div style={s.itemHeader}>
          <h2 style={s.itemName}>{item}</h2>
          <span style={s.noMatchPill}>Error</span>
        </div>
        <p style={s.noMatchText}>Could not fetch results: {error}</p>
      </div>
    )
  }

  if (!data || !data.results?.length) {
    return (
      <div style={s.itemCard}>
        <div style={s.itemHeader}>
          <h2 style={s.itemName}>{item}</h2>
          <span style={s.noMatchPill}>No match</span>
        </div>
        <p style={s.noMatchText}>No products found at nearby stores. Try scanning the barcode in-store.</p>
      </div>
    )
  }

  // flatten all products across stores, keeping store info on each
  const allProducts = []
  for (const storeResult of data.results) {
    for (const p of storeResult.products || []) {
      allProducts.push({ ...p, _store: storeResult })
    }
  }
  const cleanCount = allProducts.filter(p => p.filter_result?.is_clean !== false).length

  // show top 2 products collapsed, all when expanded
  const displayProducts = expanded ? allProducts : allProducts.slice(0, 2)

  return (
    <div style={s.itemCard}>
      <div style={s.itemHeader}>
        <h2 style={s.itemName}>{item}</h2>
        {cleanCount > 0
          ? <span style={s.cleanPill}>✓ {cleanCount} clean</span>
          : <span style={s.dirtyPill}>⚠ No clean picks</span>
        }
      </div>

      {displayProducts.map((product, i) => (
        <ProductRow
          key={`${product.product_id || product.product_name}-${i}`}
          product={product}
          isExpanded={expandedProduct === `${item}-${i}`}
          onToggle={() => onProductToggle(expandedProduct === `${item}-${i}` ? null : `${item}-${i}`)}
        />
      ))}

      {allProducts.length > 2 && (
        <button style={s.showMoreBtn} onClick={onToggle}>
          {expanded ? '↑ Show less' : `↓ Show ${allProducts.length - 2} more`}
        </button>
      )}
    </div>
  )
}

// ── Product row ───────────────────────────────────────────────────────────────

function ProductRow({ product, isExpanded, onToggle }) {
  const hs = product.health_score
  const fr = product.filter_result
  const isClean = fr ? fr.is_clean !== false : null
  const score = hs?.score ?? null
  const col = score !== null
    ? gradeColor(score)
    : isClean === true
      ? { bg: '#4CAF50', light: '#E8F5E9', text: '#fff' }
      : isClean === false
        ? { bg: '#EF5350', light: '#FFEBEE', text: '#fff' }
        : { bg: '#CCC', light: '#F5F5F5', text: '#fff' }

  const flagged = fr?.flagged || []
  const ingNum = ingCount(product.ingredient_text)
  const store = product._store

  return (
    <div style={s.productWrap}>
      <button style={s.productCard} onClick={onToggle}>
        {/* Image */}
        <div style={s.imgWrap}>
          {product.image_url
            ? <img src={product.image_url} alt="" style={s.productImg} onError={e => { e.target.style.display = 'none' }} />
            : <div style={s.imgPlaceholder}>🛒</div>
          }
          {isClean === false && <div style={s.dirtyOverlay}>⚠</div>}
        </div>

        {/* Info */}
        <div style={s.cardBody}>
          <div style={s.cardName}>{product.product_name || product.brand}</div>
          {product.brand && product.brand !== product.product_name && (
            <div style={s.cardBrand}>{product.brand}</div>
          )}
          {product.size && <div style={s.cardSize}>{product.size}</div>}

          {/* Store chip */}
          <div style={s.storeChip}>
            <span>{storeEmoji(store?.chain_id)}</span>
            <span>{store?.store_name?.split(' ').slice(0, 2).join(' ')}</span>
            {store?.distance_meters && <span style={s.distText}>{distLabel(store.distance_meters)}</span>}
          </div>

          {/* Flags */}
          {flagged.length > 0 && (
            <div style={s.flagRow}>
              {flagged.slice(0, 2).map(f => (
                <span key={f.ingredient} style={s.flagChip}>⚠ {f.ingredient}</span>
              ))}
              {flagged.length > 2 && <span style={s.flagChipMore}>+{flagged.length - 2}</span>}
            </div>
          )}
          {flagged.length === 0 && isClean === true && (
            <div style={s.cleanRow}>✓ No harmful ingredients found</div>
          )}
        </div>

        {/* Score + price */}
        <div style={s.cardRight}>
          <div style={{ ...s.scoreBox, background: col.bg }}>
            {score !== null ? (
              <>
                <span style={s.scoreNum}>{score}</span>
                <span style={s.scoreGrade}>{hs.grade?.slice(0, 2)}</span>
              </>
            ) : isClean === true ? (
              <span style={s.scoreGrade}>✓</span>
            ) : isClean === false ? (
              <span style={s.scoreGrade}>✕</span>
            ) : (
              <span style={s.scoreNum}>?</span>
            )}
          </div>
          {product.price_str && <div style={s.priceTag}>{product.price_str}</div>}
        </div>
      </button>

      {/* Expanded ingredient detail */}
      {isExpanded && (
        <div style={s.expandedPanel}>
          {/* Why this is clean/flagged */}
          {isClean === true && flagged.length === 0 && (
            <div style={s.expandedClean}>
              <span style={s.expandedCleanIcon}>✓</span>
              <div>
                <div style={s.expandedCleanTitle}>Clean pick</div>
                <div style={s.expandedCleanSub}>No seed oils, artificial additives, or other flagged ingredients detected.</div>
              </div>
            </div>
          )}
          {flagged.length > 0 && (
            <div style={s.flaggedSection}>
              <div style={s.flaggedTitle}>⚠ Flagged ingredients</div>
              {flagged.map(f => (
                <div key={f.ingredient} style={s.flaggedItem}>
                  <span style={s.flaggedDot} />
                  <span style={s.flaggedName}>{f.ingredient}</span>
                  <span style={s.flaggedCat}>{f.category.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Health score breakdown */}
          {hs && (
            <div style={s.hsSection}>
              {hs.positives?.length > 0 && (
                <div style={s.hsList}>
                  {hs.positives.map(p => (
                    <div key={p} style={s.hsPositive}>✓ {p}</div>
                  ))}
                </div>
              )}
              {hs.warnings?.length > 0 && (
                <div style={s.hsList}>
                  {hs.warnings.map(w => (
                    <div key={w} style={s.hsWarning}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Full ingredient text */}
          {product.ingredient_text && (
            <div style={s.ingredientSection}>
              <div style={s.ingredientLabel}>
                Full ingredients {ingNum ? `· ${ingNum} total` : ''}
              </div>
              <div style={s.ingredientText}>{product.ingredient_text}</div>
            </div>
          )}
          {!product.ingredient_text && (
            <div style={s.noIngText}>Ingredient data not available from store API.</div>
          )}

          {/* Source link */}
          {product.source_url && (
            <a href={product.source_url} target="_blank" rel="noopener noreferrer" style={s.sourceLink}>
              View at store →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ── All stores breakdown ──────────────────────────────────────────────────────

function AllStoresCard({ route }) {
  return (
    <div style={s.allStoresCard}>
      <div style={s.allStoresTitle}>All nearby stores</div>
      {route.map(store => (
        <div key={store.store_name} style={s.allStoreRow}>
          <span style={s.allStoreEmoji}>{storeEmoji(store.chain_id)}</span>
          <div style={s.allStoreInfo}>
            <div style={s.allStoreName}>{store.store_name}</div>
            <div style={s.allStoreMeta}>
              {store.items.length} item{store.items.length !== 1 ? 's' : ''}
              {distLabel(store.distance_meters) ? ` · ${distLabel(store.distance_meters)}` : ''}
            </div>
          </div>
          {store.hasPrices && (
            <div style={s.allStoreTotal}>${store.totalPrice.toFixed(2)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: { background: '#F5F4F1', minHeight: '100%', paddingBottom: 24 },

  // Summary bar
  summaryBar: { padding: '14px 20px', background: '#fff', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  summaryLeft: { display: 'flex', alignItems: 'baseline', gap: 2 },
  summaryBig: { fontSize: 26, fontWeight: 800, color: '#1B5E20' },
  summaryOf: { fontSize: 18, fontWeight: 600, color: '#AAA' },
  summaryLabel: { fontSize: 14, color: '#666' },
  storePill:   { fontSize: 12, fontWeight: 600, color: '#555', background: '#F0EDE8', borderRadius: 20, padding: '4px 10px' },
  loadingPill: { fontSize: 12, fontWeight: 600, color: '#888', background: '#F5F5F5', borderRadius: 20, padding: '4px 10px' },
  locationRow: { background: '#fff', borderBottom: '1px solid #EBEBEB', padding: '6px 16px 8px' },

  // Route card
  routeCard: { margin: '12px 16px 0', background: '#1B5E20', borderRadius: 18, padding: '16px', boxShadow: '0 4px 20px rgba(27,94,32,0.3)' },
  routeCardLabel: { fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 },
  routeCardStore: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  routeCardInfo: { flex: 1 },
  routeCardName: { fontSize: 16, fontWeight: 800, color: '#fff' },
  routeCardMeta: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  routeCardTotal: { fontSize: 18, fontWeight: 900, color: '#fff', background: 'rgba(255,255,255,0.15)', padding: '4px 10px', borderRadius: 10 },
  routeItems: { borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 10 },
  routeItem: { display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 7, borderBottom: '1px solid rgba(255,255,255,0.07)' },
  routeDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  routeItemName: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 600, width: 90, flexShrink: 0 },
  routeItemProduct: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  routeItemPrice: { fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 },
  routeExtra: { marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'right' },

  // Empty state
  emptyBanner: { margin: '20px 16px', background: '#fff', borderRadius: 18, padding: '28px 20px', textAlign: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 6 },
  emptyText: { fontSize: 13, color: '#888', lineHeight: 1.5 },

  // Item sections
  itemCard: { background: '#fff', margin: '12px 16px 0', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  itemHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' },
  itemName: { fontSize: 17, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-0.3px', textTransform: 'capitalize' },
  cleanPill: { fontSize: 12, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9', borderRadius: 20, padding: '4px 10px', flexShrink: 0 },
  dirtyPill: { fontSize: 12, fontWeight: 700, color: '#B71C1C', background: '#FFEBEE', borderRadius: 20, padding: '4px 10px', flexShrink: 0 },
  searchingPill: { fontSize: 12, fontWeight: 600, color: '#888', background: '#F5F5F5', borderRadius: 20, padding: '4px 10px', flexShrink: 0 },
  noMatchPill: { fontSize: 12, fontWeight: 700, color: '#888', background: '#F5F5F5', borderRadius: 20, padding: '4px 10px', flexShrink: 0 },
  noMatchText: { fontSize: 13, color: '#888', padding: '0 16px 16px', margin: 0, lineHeight: 1.5 },

  // Loading skeleton
  skeletonRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 14px', borderTop: '1px solid #F0EDE8' },
  skeleton: { background: 'linear-gradient(90deg,#E8E6E3 25%,#F0EDE8 50%,#E8E6E3 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite', borderRadius: 8 },

  // Product row
  productWrap: { borderTop: '1px solid #F0EDE8' },
  productCard: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 14px', background: 'none', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left' },
  imgWrap: { position: 'relative', flexShrink: 0, width: 60, height: 60 },
  productImg: { width: 60, height: 60, objectFit: 'contain', borderRadius: 10, background: '#F8F7F4' },
  imgPlaceholder: { width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0EDE8', borderRadius: 10, fontSize: 24 },
  dirtyOverlay: { position: 'absolute', top: -4, right: -4, background: '#FF7043', color: '#fff', fontSize: 9, fontWeight: 800, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.3, marginBottom: 1 },
  cardBrand: { fontSize: 12, color: '#888', marginBottom: 2 },
  cardSize: { fontSize: 11, color: '#BBB', marginBottom: 4 },
  storeChip: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', background: '#F5F4F1', borderRadius: 8, padding: '2px 6px', marginBottom: 4 },
  distText: { color: '#AAA' },
  flagRow: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  flagChip: { fontSize: 10, fontWeight: 700, color: '#B71C1C', background: '#FFEBEE', borderRadius: 8, padding: '2px 6px' },
  flagChipMore: { fontSize: 10, fontWeight: 700, color: '#888', background: '#F5F5F5', borderRadius: 8, padding: '2px 6px' },
  cleanRow: { fontSize: 11, color: '#1B5E20', fontWeight: 600, marginTop: 2 },
  cardRight: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 },
  scoreBox: { width: 52, height: 52, borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 },
  scoreNum: { fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 },
  scoreGrade: { fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.85)' },
  priceTag: { fontSize: 13, fontWeight: 800, color: '#1B5E20', background: '#E8F5E9', borderRadius: 8, padding: '2px 7px' },

  showMoreBtn: { width: '100%', padding: '11px 0', background: 'none', border: 'none', borderTop: '1px solid #F0EDE8', fontSize: 13, fontWeight: 600, color: '#555', cursor: 'pointer' },

  // Expanded panel
  expandedPanel: { background: '#F8F7F4', borderTop: '1px solid #F0EDE8', padding: '14px 16px' },
  expandedClean: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12, background: '#E8F5E9', borderRadius: 12, padding: '10px 12px' },
  expandedCleanIcon: { fontSize: 18, flexShrink: 0 },
  expandedCleanTitle: { fontSize: 13, fontWeight: 700, color: '#1B5E20' },
  expandedCleanSub: { fontSize: 12, color: '#4CAF50', lineHeight: 1.4, marginTop: 2 },
  flaggedSection: { marginBottom: 12 },
  flaggedTitle: { fontSize: 12, fontWeight: 700, color: '#B71C1C', marginBottom: 6 },
  flaggedItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #F0EDE8' },
  flaggedDot: { width: 6, height: 6, borderRadius: '50%', background: '#EF5350', flexShrink: 0 },
  flaggedName: { flex: 1, fontSize: 12, color: '#333', fontWeight: 500 },
  flaggedCat: { fontSize: 11, color: '#888', background: '#F5F5F5', borderRadius: 6, padding: '1px 6px' },
  hsSection: { marginBottom: 10 },
  hsList: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 },
  hsPositive: { fontSize: 12, color: '#2E7D32', fontWeight: 500 },
  hsWarning: { fontSize: 12, color: '#E65100', fontWeight: 500 },
  ingredientSection: { marginTop: 10 },
  ingredientLabel: { fontSize: 11, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 },
  ingredientText: { fontSize: 12, color: '#555', lineHeight: 1.6 },
  noIngText: { fontSize: 12, color: '#AAA', fontStyle: 'italic', padding: '4px 0' },
  sourceLink: { display: 'inline-block', marginTop: 10, fontSize: 12, fontWeight: 600, color: '#1B5E20', textDecoration: 'none' },

  // All stores card
  allStoresCard: { margin: '12px 16px 0', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  allStoresTitle: { fontSize: 11, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '14px 16px 6px' },
  allStoreRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderTop: '1px solid #F0EDE8' },
  allStoreEmoji: { fontSize: 20, flexShrink: 0 },
  allStoreInfo: { flex: 1 },
  allStoreName: { fontSize: 14, fontWeight: 700, color: '#111' },
  allStoreMeta: { fontSize: 12, color: '#888', marginTop: 1 },
  allStoreTotal: { fontSize: 15, fontWeight: 800, color: '#1B5E20' },

  footer: { fontSize: 12, color: '#CCC', textAlign: 'center', padding: '20px 20px 0', lineHeight: 1.5, margin: 0 },
}
