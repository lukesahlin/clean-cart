// App.jsx -- Clean Cart
import { useState, useCallback, useRef } from 'react'
import GroceryList from './components/GroceryList.jsx'
import ShopResults from './components/ShopResults.jsx'
import ProductDetail from './components/ProductDetail.jsx'
import Settings from './components/Settings.jsx'
import BarcodeScanner from './components/BarcodeScanner.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import InstacartSearch from './components/InstacartSearch.jsx'
import { useLocalStorage } from './hooks/useLocalStorage.js'
import { useAuth } from './contexts/AuthContext.jsx'
import { shopAtStores, requestGeolocation, reverseGeocode, geocodeLocation } from './api.js'


export default function App() {
  const { user, loading, signOut } = useAuth()
  const [avoidList, setAvoidList] = useLocalStorage('cleanCart_avoidList', ['seed_oils', 'harmful_additives'])
  const [tab, setTab] = useState('list')
  const [screen, setScreen] = useState('list')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [shopResults, setShopResults] = useState(null)   // [{ item, data, loading, error }]
  const [currentItems, setCurrentItems] = useState([])

  // location state — visible to the user, not just a ref
  const [location, setLocation] = useState(null)   // { lat, lng, zip, label }

  const resolveLocation = useCallback(async () => {
    if (location) return location
    try {
      const loc = await requestGeolocation()
      const geo = await reverseGeocode(loc.lat, loc.lng).catch(() => ({}))
      const zip = geo.zip_code || ''
      const label = geo.city ? `${geo.city}, ${geo.state || ''}`.trim().replace(/,$/, '') : 'Current location'
      const resolved = { lat: loc.lat, lng: loc.lng, zip, label }
      setLocation(resolved)
      return resolved
    } catch {
      // GPS denied — return null so the UI can prompt the user to enter a location
      return null
    }
  }, [location])

  const handleSearch = useCallback(async (items, overrideLocation = null) => {
    if (!items.length) return
    setIsLoading(true)
    setError(null)
    setCurrentItems(items)

    // build initial loading state so the screen shows immediately
    const initial = items.map(item => ({ item, data: null, loading: true, error: null }))
    setShopResults(initial)
    setScreen('results')

    const loc = overrideLocation || await resolveLocation()

    // if location couldn't be determined, stop and ask the user to set it
    if (!loc) {
      setIsLoading(false)
      setShopResults(null)
      setScreen('list')
      setError('📍 Please set your location first — tap the location bar above.')
      return
    }

    // fire one /shop call per item concurrently, update state as each resolves
    await Promise.all(items.map(async (item, idx) => {
      try {
        const data = await shopAtStores({
          query: item,
          lat: loc.lat,
          lng: loc.lng,
          zip_code: loc.zip,
          avoid: avoidList,
          top_n: 5,
        })
        setShopResults(prev => prev.map((r, i) => i === idx ? { ...r, data, loading: false } : r))
      } catch (err) {
        setShopResults(prev => prev.map((r, i) => i === idx ? { ...r, loading: false, error: err.message } : r))
      }
    }))

    setIsLoading(false)
  }, [avoidList, resolveLocation])

  // let the user change their location and re-run the last search
  const handleLocationChange = useCallback(async (newLoc) => {
    setLocation(newLoc)
    if (currentItems.length) {
      handleSearch(currentItems, newLoc)
    }
  }, [currentItems, handleSearch])

  const handleScannedProduct = useCallback((product) => {
    setTab('list')
    handleSearch([product.product_name || product.barcode])
  }, [handleSearch])

  const handleTabChange = (t) => {
    setTab(t)
    if (t === 'list' && screen !== 'results') setScreen('list')
  }

  // show loading spinner while checking session
  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F4F1' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E8F5E9', borderTop: '3px solid #1B5E20', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // show auth screen if not signed in
  if (!user) return <AuthScreen />

  const mainContent = () => {
    if (tab === 'scan') return <BarcodeScanner avoidList={avoidList} onClose={() => setTab('list')} onProductFound={handleScannedProduct} embedded />
    if (tab === 'instacart') return <InstacartSearch avoidList={avoidList} />
    if (tab === 'settings') return <Settings avoidList={avoidList} setAvoidList={setAvoidList} onClose={() => setTab('list')} onSignOut={signOut} />
    if (tab === 'list') {
      if (screen === 'results' && shopResults) {
        return <ShopResults shopResults={shopResults} location={location} onLocationChange={handleLocationChange} onReSearch={(newLoc) => handleSearch(currentItems, newLoc)} onBack={() => { setScreen('list'); setShopResults(null) }} />
      }
      return <GroceryList onSearch={handleSearch} loading={isLoading} error={error} location={location} onLocationChange={handleLocationChange} />
    }
  }

  return (
    <div style={s.app}>
      {tab !== 'scan' && (
        <header style={s.header}>
          <div style={s.logo}>
            <img src="/logo.jpg" alt="Clean Cart" style={s.logoImg} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {tab === 'list' && screen === 'results' && shopResults && (
              <button style={s.backPill} onClick={() => { setScreen('list'); setShopResults(null) }}>← New list</button>
            )}
            <span style={s.userEmail}>{user.email?.split('@')[0]}</span>
          </div>
        </header>
      )}

      <main style={{ ...s.main, paddingBottom: tab === 'scan' ? 0 : 80 }}>
        {mainContent()}
      </main>

      <nav style={s.tabBar}>
        <TabBtn icon="🛒" label="List" active={tab === 'list'} onClick={() => handleTabChange('list')} />
        <TabBtn icon={<BarcodeIcon />} label="Scan" active={tab === 'scan'} onClick={() => handleTabChange('scan')} accent />
        <TabBtn icon="🟢" label="Instacart" active={tab === 'instacart'} onClick={() => handleTabChange('instacart')} />
        <TabBtn icon="⚙️" label="Settings" active={tab === 'settings'} onClick={() => handleTabChange('settings')} />
      </nav>

      {selectedProduct && (
        <ProductDetail product={selectedProduct} onClose={() => setSelectedProduct(null)} avoidList={avoidList} />
      )}
    </div>
  )
}

function TabBtn({ icon, label, active, onClick, accent }) {
  return (
    <button style={{ ...s.tabBtn, ...(active ? s.tabBtnActive : {}) }} onClick={onClick}>
      {accent ? (
        <div style={{ ...s.scanFab, ...(active ? s.scanFabActive : {}) }}>{icon}</div>
      ) : (
        <span style={s.tabIcon}>{icon}</span>
      )}
      <span style={{ ...s.tabLabel, ...(active && !accent ? s.tabLabelActive : {}) }}>{label}</span>
    </button>
  )
}

function BarcodeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <line x1="7" y1="8" x2="7" y2="16"/><line x1="11" y1="8" x2="11" y2="16"/>
      <line x1="15" y1="8" x2="15" y2="16"/>
    </svg>
  )
}

const s = {
  app: { minHeight: '100dvh', display: 'flex', flexDirection: 'column', maxWidth: 430, margin: '0 auto', background: '#F5F4F1', position: 'relative' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', background: '#fff', borderBottom: '1px solid #EBEBEB', position: 'sticky', top: 0, zIndex: 20 },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoImg: { height: 32, width: 'auto', objectFit: 'contain' },
  backPill: { fontSize: 13, fontWeight: 600, color: '#1B5E20', background: '#E8F5E9', border: 'none', borderRadius: 20, padding: '6px 14px', cursor: 'pointer' },
  userEmail: { fontSize: 12, color: '#AAA', fontWeight: 500 },
  main: { flex: 1, overflowY: 'auto' },
  tabBar: { position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', background: '#fff', borderTop: '1px solid #EBEBEB', padding: '8px 0 max(8px, env(safe-area-inset-bottom))', zIndex: 30 },
  tabBtn: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 2px' },
  tabBtnActive: {},
  tabIcon: { fontSize: 22 },
  tabLabel: { fontSize: 11, fontWeight: 500, color: '#AAA', letterSpacing: '0.2px' },
  tabLabelActive: { color: '#1B5E20', fontWeight: 700 },
  scanFab: { width: 52, height: 52, background: '#1B5E20', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 2, boxShadow: '0 4px 16px rgba(27,94,32,0.35)' },
  scanFabActive: { background: '#145214' },
}
