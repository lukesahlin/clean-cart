// ShopResults.jsx — store-first results view
// Displays products from nearby stores (Kroger/Walmart) filtered and scored.
// shopResults shape: [{ item: string, data: { query, stores_searched, stores_with_results, results: [...] } }]

import { useState, useEffect, useCallback } from 'react'
import LocationBar from './LocationBar.jsx'
import StoreMap from './StoreMap.jsx'

// ── Design helpers ────────────────────────────────────────────────────────────

function gradeColor(score) {
  if (score < 0) return { bg: '#9E9E9E', light: '#F5F5F5', text: '#fff' }
  if (score >= 85) return { bg: '#1B5E20', light: '#E8F5E9', text: '#fff' }
  if (score >= 70) return { bg: '#388E3C', light: '#F1F8E9', text: '#fff' }
  if (score >= 50) return { bg: '#F57F17', light: '#FFF8E1', text: '#fff' }
  if (score >= 30) return { bg: '#E65100', light: '#FBE9E7', text: '#fff' }
  return { bg: '#B71C1C', light: '#FFEBEE', text: '#fff' }
}

const STORE_LOGOS = {
  qfc: '/logos/qfc.svg',
  fred_meyer: '/logos/fred-meyer.svg',
  kroger: '/logos/kroger.svg',
  walmart: '/logos/walmart.svg',
}

function storeLogo(chainId) {
  return STORE_LOGOS[chainId] || ''
}

function storeEmoji(chainId) {
  const map = {
    kroger: '🟠', fred_meyer: '🟠', qfc: '🟠',
    walmart: '🔵',
  }
  return map[chainId] || '🏪'
}

function distLabel(meters) {
  if (!meters) return ''
  const mi = meters / 1609.34
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

/** Opens Google Maps directions (works on mobile + desktop). */
function buildDirectionsUrl({ lat, lng, address, originLat, originLng }) {
  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && !(lat === 0 && lng === 0)
  const params = new URLSearchParams()
  params.set('api', '1')
  if (hasCoords) {
    params.set('destination', `${lat},${lng}`)
  } else if (address?.trim()) {
    params.set('destination', address.trim())
  } else {
    return null
  }
  if (
    typeof originLat === 'number' && typeof originLng === 'number'
    && Number.isFinite(originLat) && Number.isFinite(originLng)
  ) {
    params.set('origin', `${originLat},${originLng}`)
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** Coordinates on route entries may be missing; merge from map pins when needed. */
function directionsUrlForStore(store, nearbyStores, userLocation) {
  let lat = store.lat
  let lng = store.lng
  const coordsOk = typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
  if (!coordsOk) {
    const target = (store.store_name || '').split('—')[0].trim().toLowerCase()
    const pin = nearbyStores.find((n) => {
      const nname = (n.name || '').split('—')[0].trim().toLowerCase()
      return nname === target || (n.name || '') === (store.store_name || '')
    })
    if (pin && typeof pin.lat === 'number' && typeof pin.lng === 'number') {
      lat = pin.lat
      lng = pin.lng
    }
  }
  return buildDirectionsUrl({
    lat,
    lng,
    address: store.address,
    originLat: userLocation?.lat,
    originLng: userLocation?.lng,
  })
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

// Build a shopping route: find the cleanest product for each item across
// ALL stores, then group by store to show where to shop.
function buildRoute(shopResults) {
  // Step 1: for each item, find the single best product across every store
  const bestPerItem = {}  // item → { storeName, storeResult, product, score }

  for (const { item, data } of shopResults) {
    for (const storeResult of (data?.results || [])) {
      for (const product of (storeResult.products || [])) {
        const score = product.health_score?.score ?? -1
        const prev = bestPerItem[item]
        if (!prev || score > prev.score) {
          bestPerItem[item] = {
            storeName: storeResult.store_name,
            chain_id: storeResult.chain_id,
            address: storeResult.address,
            distance_meters: storeResult.distance_meters,
            lat: storeResult.lat,
            lng: storeResult.lng,
            product,
            score,
          }
        }
      }
    }
  }

  // Step 2: group winning products by the store they came from
  const storeMap = {}
  for (const [item, winner] of Object.entries(bestPerItem)) {
    const key = winner.storeName
    if (!storeMap[key]) {
      storeMap[key] = {
        store_name: winner.storeName,
        chain_id: winner.chain_id,
        address: winner.address,
        distance_meters: winner.distance_meters,
        lat: winner.lat,
        lng: winner.lng,
        items: [],
        totalPrice: 0,
        hasPrices: false,
        cleanCount: 0,
        totalScore: 0,
      }
    }
    const p = winner.product
    const clean = p.filter_result?.is_clean !== false
    storeMap[key].items.push({
      item,
      product_name: p.product_name,
      brand: p.brand,
      price: p.price,
      price_str: p.price_str,
      image_url: p.image_url,
      is_clean: clean,
      health_score: winner.score,
    })
    if (clean) storeMap[key].cleanCount++
    storeMap[key].totalScore += winner.score > 0 ? winner.score : 0
    if (p.price) {
      storeMap[key].totalPrice += p.price
      storeMap[key].hasPrices = true
    }
  }

  // sort: most winning items → highest total score → cheapest
  return Object.values(storeMap).sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore
    return a.totalPrice - b.totalPrice
  })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ShopResults({ shopResults, discoveredPins = [], location, onLocationChange, onReSearch, onBack }) {
  const [expandedItem, setExpandedItem] = useState(null)
  const [expandedProduct, setExpandedProduct] = useState(null)
  const [nearbyStores, setNearbyStores] = useState([])
  const [mapSearching, setMapSearching] = useState(false)
  const [radiusMeters, setRadiusMeters] = useState(8000)
  const [mapOpen, setMapOpen] = useState(false)

  const summary = buildSummary(shopResults)
  const route = buildRoute(shopResults)
  const bestStore = route[0]
  const isLoading = shopResults.some(r => r.loading)
  const bestDirectionsUrl = bestStore?.items?.length
    ? directionsUrlForStore(bestStore, nearbyStores, location)
    : null

  // Build map pins: start with discovered pins (shown before product search),
  // then merge in any additional pins from product search results
  useEffect(() => {
    const pins = []
    const seen = new Set()

    const addPin = (s) => {
      const name = s.store_name || s.name || ''
      const key = `${name}|${s.lat}|${s.lng}`
      if (seen.has(key) || !s.lat || !s.lng) return
      seen.add(key)
      pins.push({
        name,
        chain_id: s.chain_id,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        distance_meters: s.distance_meters,
      })
    }

    // pre-discovered store pins (available immediately)
    for (const pin of discoveredPins) addPin(pin)

    // merge pins from product search results
    for (const entry of shopResults) {
      const data = entry?.data
      if (!data) continue
      for (const sr of (data.results || [])) addPin(sr)
      if (Array.isArray(data.nearby_pins)) {
        for (const pin of data.nearby_pins) addPin(pin)
      }
    }

    if (pins.length > 0) setNearbyStores(pins)
  }, [shopResults, discoveredPins])

  const handleMapSearch = useCallback(async (newRadiusMeters, overrideLoc = null) => {
    setRadiusMeters(newRadiusMeters)
    const loc = overrideLoc || location
    if (!loc) return
    setMapSearching(true)
    if (overrideLoc) onLocationChange(overrideLoc)
    onReSearch(loc)
    setMapSearching(false)
  }, [location, onLocationChange, onReSearch])

  return (
    <div style={s.page}>

      {/* Compact top bar — slim for iPhone, tappable to expand map */}
      <div style={s.topBar}>
        <div style={s.topBarLeft}>
          {isLoading ? (
            <>
              <div style={s.spinnerSmall} />
              <span style={s.summaryLabel}>Searching stores…</span>
            </>
          ) : (
            <>
              <span style={s.summaryBig}>{summary.cleanItems}</span>
              <span style={s.summaryOf}>/{summary.totalItems}</span>
              <span style={s.summaryLabel}> clean</span>
            </>
          )}
        </div>
        <button style={s.mapToggle} onClick={() => setMapOpen(!mapOpen)}>
          {mapOpen ? '✕ Close map' : `📍 ${nearbyStores.length} stores`}
        </button>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
      `}</style>

      {/* Collapsible map + location + store list */}
      {mapOpen && location?.lat && (
        <div style={s.mapDropdown}>
          <StoreMap
            userLocation={location}
            locationLabel={location.label}
            stores={nearbyStores}
            onSearch={handleMapSearch}
            onLocationChange={(newLoc) => {
              onLocationChange(newLoc)
            }}
            searching={mapSearching || isLoading}
          />
        </div>
      )}

      {/* Inline store chips — always visible below top bar */}
      {nearbyStores.length > 0 && !mapOpen && (
        <div style={s.storeChipsRow}>
          {nearbyStores.slice(0, 6).map((store, i) => (
            <div key={`${store.name}-${i}`} style={s.storeChipItem}>
              <img src={storeLogo(store.chain_id)} alt="" style={s.storeChipLogo} />
              <span style={s.storeChipName}>{(store.name || '').split('—')[0].trim()}</span>
              {store.distance_meters != null && (
                <span style={s.storeChipDist}>{distLabel(store.distance_meters)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Full-page loading state while waiting for product results */}
      {isLoading && !bestStore && (
        <div style={s.loadingBanner}>
          <div style={s.spinnerLarge} />
          <div style={s.loadingTitle}>Searching nearby stores</div>
          <div style={s.loadingSubtitle}>
            Finding the cleanest products at {nearbyStores.length > 0 ? nearbyStores.length : ''} store{nearbyStores.length !== 1 ? 's' : ''}…
          </div>
        </div>
      )}

      {/* Best store card — shown when we have results */}
      {bestStore && bestStore.items.length > 0 && (
        <div style={s.routeCard}>
          <div style={s.routeCardLabel}>Best stop</div>
          <div style={s.routeCardStore}>
            {storeLogo(bestStore.chain_id)
              ? <img src={storeLogo(bestStore.chain_id)} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6, background: '#fff', padding: 2 }} />
              : <span style={{ fontSize: 20 }}>{storeEmoji(bestStore.chain_id)}</span>
            }
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
          {bestDirectionsUrl && (
            <a
              href={bestDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={s.routeDirectionsBtn}
            >
              Get directions
            </a>
          )}
          {route.length > 1 && (
            <div style={s.routeExtra}>+{route.length - 1} more store{route.length > 2 ? 's' : ''} nearby</div>
          )}
        </div>
      )}

      {/* No results at all */}
      {summary.storeCount === 0 && !shopResults.some(r => r.loading) && (
        <div style={s.emptyBanner}>
          <div style={s.emptyIcon}>🏪</div>
          <div style={s.emptyTitle}>No store results</div>
          <div style={s.emptyText}>No Fred Meyer, QFC, or Walmart found near your location. Try expanding the search radius or changing your location.</div>
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

      <p style={s.footer}>Products from Kroger & Walmart APIs. Ingredients from Open Food Facts. Always verify the label in-store.</p>
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
        <p style={s.noMatchText}>Not found at nearby Fred Meyer, QFC, or Walmart. Try a different search term or scan the barcode in-store.</p>
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
  const cleanCount = allProducts.filter(p => p.filter_result?.is_clean !== false && !p.filter_result?.ingredients_unknown).length

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
  const ingredientsUnknown = fr?.ingredients_unknown === true
  const isClean = fr ? fr.is_clean !== false : null
  const score = hs?.score ?? null
  const col = ingredientsUnknown
    ? { bg: '#9E9E9E', light: '#F5F5F5', text: '#fff' }
    : score !== null && score >= 0
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
            {storeLogo(store?.chain_id)
              ? <img src={storeLogo(store?.chain_id)} alt="" style={{ width: 14, height: 14, objectFit: 'contain' }} />
              : <span>{storeEmoji(store?.chain_id)}</span>
            }
            <span>{store?.store_name?.split('—')[0]?.trim()?.split(' ').slice(0, 2).join(' ')}</span>
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
          {flagged.length === 0 && isClean === true && !ingredientsUnknown && (
            <div style={s.cleanRow}>✓ No harmful ingredients found</div>
          )}
          {ingredientsUnknown && (
            <div style={s.unknownRow}>📷 Scan barcode to check ingredients</div>
          )}
        </div>

        {/* Score + price */}
        <div style={s.cardRight}>
          <div style={{ ...s.scoreBox, background: col.bg }}>
            {ingredientsUnknown ? (
              <>
                <span style={{ fontSize: 16 }}>📷</span>
                <span style={s.scoreGrade}>scan</span>
              </>
            ) : score !== null && score >= 0 ? (
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
          {ingredientsUnknown && (
            <div style={{ ...s.expandedClean, background: '#F5F5F5' }}>
              <span style={s.expandedCleanIcon}>📷</span>
              <div>
                <div style={{ ...s.expandedCleanTitle, color: '#555' }}>Ingredients not available online</div>
                <div style={{ ...s.expandedCleanSub, color: '#888' }}>This product is available at the store but ingredient data isn't in our database yet. Use the Scan tab to check the barcode in-store.</div>
              </div>
            </div>
          )}
          {isClean === true && flagged.length === 0 && !ingredientsUnknown && (
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
          {storeLogo(store.chain_id)
            ? <img src={storeLogo(store.chain_id)} alt="" style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 5, flexShrink: 0 }} />
            : <span style={s.allStoreEmoji}>{storeEmoji(store.chain_id)}</span>
          }
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
  page: { background: '#F7F6F3', minHeight: '100%', paddingBottom: 24 },

  topBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px',
    paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
    background: '#fff', borderBottom: '1px solid #EBEBEB',
  },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 6, flex: 1 },
  summaryBig: { fontSize: 24, fontWeight: 900, color: '#1B5E20', letterSpacing: '-0.5px' },
  summaryOf: { fontSize: 14, fontWeight: 600, color: '#C5C5C5' },
  summaryLabel: { fontSize: 13, color: '#888', fontWeight: 500 },
  mapToggle: {
    fontSize: 12, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9',
    border: 'none', borderRadius: 20, padding: '7px 14px', cursor: 'pointer',
    whiteSpace: 'nowrap', transition: 'background 0.15s',
  },
  spinnerSmall: {
    width: 20, height: 20,
    border: '2.5px solid #E8F5E9', borderTop: '2.5px solid #1B5E20',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  spinnerLarge: {
    width: 44, height: 44,
    border: '4px solid #E8F5E9', borderTop: '4px solid #1B5E20',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
    margin: '0 auto 20px',
  },
  loadingBanner: {
    margin: '20px 16px 0', background: '#fff', borderRadius: 20,
    padding: '48px 24px', textAlign: 'center',
    boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
  },
  loadingTitle: { fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 8 },
  loadingSubtitle: { fontSize: 14, color: '#999', lineHeight: 1.5 },
  mapDropdown: { borderBottom: '1px solid #EBEBEB' },

  storeChipsRow: {
    display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto',
    background: '#fff', borderBottom: '1px solid #EBEBEB',
    WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
  },
  storeChipItem: {
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
    background: '#F8F7F4', borderRadius: 12, padding: '6px 12px',
  },
  storeChipLogo: { width: 18, height: 18, objectFit: 'contain', borderRadius: 3 },
  storeChipName: { fontSize: 12, fontWeight: 600, color: '#333', whiteSpace: 'nowrap' },
  storeChipDist: { fontSize: 11, color: '#AAA', whiteSpace: 'nowrap' },

  routeCard: {
    margin: '14px 16px 0', borderRadius: 20, padding: '18px',
    background: 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%)',
    boxShadow: '0 6px 24px rgba(27,94,32,0.3)',
  },
  routeCardLabel: { fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 },
  routeCardStore: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  routeCardInfo: { flex: 1 },
  routeCardName: { fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  routeCardMeta: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  routeCardTotal: { fontSize: 20, fontWeight: 900, color: '#fff', background: 'rgba(255,255,255,0.15)', padding: '6px 14px', borderRadius: 12 },
  routeItems: { borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 12 },
  routeItem: { display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' },
  routeDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  routeItemName: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: 600, width: 85, flexShrink: 0, textTransform: 'capitalize' },
  routeItemProduct: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  routeItemPrice: { fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 },
  routeDirectionsBtn: {
    display: 'block',
    width: '100%',
    marginTop: 14,
    padding: '12px 16px',
    textAlign: 'center',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 800,
    color: '#1B5E20',
    background: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    border: 'none',
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  },
  routeExtra: { marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'right' },

  emptyBanner: { margin: '24px 16px', background: '#fff', borderRadius: 20, padding: '36px 24px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#999', lineHeight: 1.6 },

  itemCard: { background: '#fff', margin: '12px 16px 0', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.04)' },
  itemHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px' },
  itemName: { fontSize: 18, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-0.4px', textTransform: 'capitalize' },
  cleanPill: { fontSize: 12, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9', borderRadius: 20, padding: '5px 12px', flexShrink: 0 },
  dirtyPill: { fontSize: 12, fontWeight: 700, color: '#B71C1C', background: '#FFEBEE', borderRadius: 20, padding: '5px 12px', flexShrink: 0 },
  searchingPill: { fontSize: 12, fontWeight: 600, color: '#999', background: '#F5F5F5', borderRadius: 20, padding: '5px 12px', flexShrink: 0 },
  noMatchPill: { fontSize: 12, fontWeight: 700, color: '#999', background: '#F5F5F5', borderRadius: 20, padding: '5px 12px', flexShrink: 0 },
  noMatchText: { fontSize: 14, color: '#999', padding: '0 16px 18px', margin: 0, lineHeight: 1.6 },

  skeletonRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderTop: '1px solid #F0EDE8' },
  skeleton: { background: 'linear-gradient(90deg,#ECEAE7 25%,#F3F1EE 50%,#ECEAE7 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite', borderRadius: 10 },

  productWrap: { borderTop: '1px solid #F0EDE8' },
  productCard: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left' },
  imgWrap: { position: 'relative', flexShrink: 0, width: 56, height: 56 },
  productImg: { width: 56, height: 56, objectFit: 'contain', borderRadius: 12, background: '#F8F7F4' },
  imgPlaceholder: { width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0EDE8', borderRadius: 12, fontSize: 22, color: '#CCC' },
  dirtyOverlay: { position: 'absolute', top: -3, right: -3, background: '#EF5350', color: '#fff', fontSize: 8, fontWeight: 800, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.35, marginBottom: 2 },
  cardBrand: { fontSize: 12, color: '#999', marginBottom: 3 },
  cardSize: { fontSize: 11, color: '#CCC', marginBottom: 4 },
  storeChip: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#666', background: '#F5F4F1', borderRadius: 8, padding: '3px 8px', marginBottom: 4 },
  distText: { color: '#BBB' },
  flagRow: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 },
  flagChip: { fontSize: 10, fontWeight: 700, color: '#C62828', background: '#FFEBEE', borderRadius: 8, padding: '2px 7px' },
  flagChipMore: { fontSize: 10, fontWeight: 700, color: '#999', background: '#F5F5F5', borderRadius: 8, padding: '2px 7px' },
  cleanRow: { fontSize: 11, color: '#2E7D32', fontWeight: 600, marginTop: 3 },
  unknownRow: { fontSize: 11, color: '#999', fontWeight: 600, marginTop: 3 },
  cardRight: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 },
  scoreBox: { width: 50, height: 50, borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 },
  scoreNum: { fontSize: 19, fontWeight: 900, color: '#fff', lineHeight: 1 },
  scoreGrade: { fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase' },
  priceTag: { fontSize: 13, fontWeight: 800, color: '#1B5E20', background: '#E8F5E9', borderRadius: 8, padding: '3px 8px' },

  showMoreBtn: { width: '100%', padding: '12px 0', background: 'none', border: 'none', borderTop: '1px solid #F0EDE8', fontSize: 13, fontWeight: 600, color: '#888', cursor: 'pointer' },

  expandedPanel: { background: '#FAFAF8', borderTop: '1px solid #F0EDE8', padding: '16px' },
  expandedClean: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, background: '#E8F5E9', borderRadius: 14, padding: '12px 14px' },
  expandedCleanIcon: { fontSize: 18, flexShrink: 0 },
  expandedCleanTitle: { fontSize: 13, fontWeight: 700, color: '#1B5E20' },
  expandedCleanSub: { fontSize: 12, color: '#4CAF50', lineHeight: 1.5, marginTop: 2 },
  flaggedSection: { marginBottom: 14 },
  flaggedTitle: { fontSize: 12, fontWeight: 700, color: '#C62828', marginBottom: 8 },
  flaggedItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F0EDE8' },
  flaggedDot: { width: 6, height: 6, borderRadius: '50%', background: '#EF5350', flexShrink: 0 },
  flaggedName: { flex: 1, fontSize: 12, color: '#333', fontWeight: 500 },
  flaggedCat: { fontSize: 11, color: '#999', background: '#F5F5F5', borderRadius: 6, padding: '2px 8px' },
  hsSection: { marginBottom: 12 },
  hsList: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 },
  hsPositive: { fontSize: 12, color: '#2E7D32', fontWeight: 500 },
  hsWarning: { fontSize: 12, color: '#E65100', fontWeight: 500 },
  ingredientSection: { marginTop: 12 },
  ingredientLabel: { fontSize: 11, fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  ingredientText: { fontSize: 12, color: '#666', lineHeight: 1.7 },
  noIngText: { fontSize: 12, color: '#BBB', fontStyle: 'italic', padding: '4px 0' },
  sourceLink: { display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 600, color: '#1B5E20', textDecoration: 'none' },

  allStoresCard: { margin: '14px 16px 0', background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.04)' },
  allStoresTitle: { fontSize: 11, fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '16px 16px 8px' },
  allStoreRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid #F0EDE8' },
  allStoreEmoji: { fontSize: 20, flexShrink: 0 },
  allStoreInfo: { flex: 1 },
  allStoreName: { fontSize: 14, fontWeight: 700, color: '#111' },
  allStoreMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  allStoreTotal: { fontSize: 15, fontWeight: 800, color: '#1B5E20' },

  footer: { fontSize: 11, color: '#D5D5D5', textAlign: 'center', padding: '24px 20px 0', lineHeight: 1.6, margin: 0 },
}
