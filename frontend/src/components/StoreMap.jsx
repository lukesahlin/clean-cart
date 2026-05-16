// StoreMap.jsx — refined map with location picker + radius selector

import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geocodeLocation, requestGeolocation } from '../api.js'

// Fix Leaflet default icon (Vite strips the asset path)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Chain colours ──────────────────────────────────────────────────────────────
const CHAIN_COLOR = {
  walmart:     '#0071CE',
  safeway:     '#C8102E',
  albertsons:  '#003087',
  fred_meyer:  '#E07B26',
  whole_foods: '#00674B',
  trader_joes: '#B5001E',
  yokes:       '#F5A623',
  rosauers:    '#6B2D8B',
}
const CHAIN_LABEL = {
  walmart:     'W',
  safeway:     'S',
  albertsons:  'A',
  fred_meyer:  'FM',
  whole_foods: 'WF',
  trader_joes: 'TJ',
  yokes:       'Y',
  rosauers:    'R',
}

function makeStoreIcon(chainId) {
  const color = CHAIN_COLOR[chainId] || '#444'
  const label = CHAIN_LABEL[chainId] || '•'
  return L.divIcon({
    html: `<div style="
      background:${color};
      color:#fff;
      font-size:10px;
      font-weight:800;
      font-family:system-ui,sans-serif;
      width:28px;height:28px;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.35);
      letter-spacing:-0.5px;
    ">${label}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

const userIcon = L.divIcon({
  html: `
    <div style="position:relative;width:20px;height:20px;">
      <div style="
        position:absolute;inset:0;
        background:rgba(27,94,32,0.2);
        border-radius:50%;
        animation:pulse 2s ease-out infinite;
      "></div>
      <div style="
        position:absolute;top:3px;left:3px;
        width:14px;height:14px;
        background:#1B5E20;
        border:2.5px solid #fff;
        border-radius:50%;
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
      "></div>
    </div>
  `,
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
})

const milesToMeters = (mi) => Math.round(mi * 1609.344)
const metersToMiles = (m)  => (m / 1609.344).toFixed(1)

// Sync map centre when location changes
function RecenterMap({ lat, lng }) {
  const map = useMap()
  useEffect(() => { map.setView([lat, lng], map.getZoom()) }, [lat, lng]) // eslint-disable-line
  return null
}

// ── RADIUS OPTIONS ─────────────────────────────────────────────────────────────
const RADIUS_OPTIONS = [2, 5, 10, 15, 25]

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function StoreMap({
  userLocation,
  locationLabel,
  stores,
  onSearch,
  onLocationChange,
  searching,
}) {
  const [radiusMiles, setRadiusMiles] = useState(10)
  const [editingLocation, setEditingLocation] = useState(false)
  const [locationInput, setLocationInput] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editingLocation && inputRef.current) inputRef.current.focus()
  }, [editingLocation])

  async function handleGeocode(e) {
    e.preventDefault()
    if (!locationInput.trim()) return
    setGeocoding(true)
    setGeocodeError('')
    const result = await geocodeLocation(locationInput.trim())
    setGeocoding(false)
    if (result.error) {
      setGeocodeError('Location not found — try a city name or zip code')
      return
    }
    onLocationChange({ lat: result.lat, lng: result.lng, label: result.short_name })
    setEditingLocation(false)
    setLocationInput('')
    // trigger a new search with the new location
    onSearch(milesToMeters(radiusMiles), { lat: result.lat, lng: result.lng })
  }

  async function handleUseMyLocation() {
    setGeocoding(true)
    setGeocodeError('')
    try {
      const loc = await requestGeolocation()
      onLocationChange({ ...loc, label: 'Current location' })
      setEditingLocation(false)
      onSearch(milesToMeters(radiusMiles), loc)
    } catch {
      setGeocodeError('Location access denied')
    }
    setGeocoding(false)
  }

  const radiusMeters = milesToMeters(radiusMiles)
  const { lat, lng } = userLocation

  return (
    <div style={s.card}>
      <style>{`
        @keyframes pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(2.5); opacity: 0; }
          100% { transform: scale(1);   opacity: 0; }
        }
        .leaflet-container { font-family: inherit; }
        .leaflet-popup-content-wrapper {
          border-radius: 12px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
          padding: 0 !important;
        }
        .leaflet-popup-content { margin: 12px 14px !important; font-size: 13px; }
        .leaflet-popup-tip-container { display: none; }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
          border-radius: 10px !important;
          overflow: hidden;
        }
        .leaflet-control-zoom a {
          background: #fff !important;
          color: #333 !important;
          font-size: 16px !important;
          width: 32px !important;
          height: 32px !important;
          line-height: 30px !important;
        }
        .leaflet-control-zoom a:hover { background: #f5f5f5 !important; }
      `}</style>

      {/* ── Location bar ── */}
      {!editingLocation ? (
        <div style={s.locationBar}>
          <span style={s.locationDot}>📍</span>
          <span style={s.locationLabel}>{locationLabel || 'Current location'}</span>
          <button style={s.changeBtn} onClick={() => setEditingLocation(true)}>Change</button>
        </div>
      ) : (
        <form style={s.locationForm} onSubmit={handleGeocode}>
          <input
            ref={inputRef}
            style={s.locationInput}
            placeholder="City, state or zip code"
            value={locationInput}
            onChange={e => { setLocationInput(e.target.value); setGeocodeError('') }}
          />
          <button type="submit" style={s.geoBtn} disabled={geocoding || !locationInput.trim()}>
            {geocoding ? '…' : 'Go'}
          </button>
          <button type="button" style={s.cancelBtn} onClick={() => { setEditingLocation(false); setGeocodeError('') }}>✕</button>
        </form>
      )}

      {geocodeError && <div style={s.geoError}>{geocodeError}</div>}

      {editingLocation && (
        <button style={s.myLocationBtn} onClick={handleUseMyLocation} disabled={geocoding}>
          ⊕ Use my current location
        </button>
      )}

      {/* ── Radius pills ── */}
      <div style={s.radiusRow}>
        <span style={s.radiusRowLabel}>Radius</span>
        <div style={s.radiusPills}>
          {RADIUS_OPTIONS.map(mi => (
            <button
              key={mi}
              style={{ ...s.radiusPill, ...(radiusMiles === mi ? s.radiusPillActive : {}) }}
              onClick={() => setRadiusMiles(mi)}
            >
              {mi} mi
            </button>
          ))}
        </div>
      </div>

      {/* ── Map ── */}
      <div style={s.mapWrap}>
        <MapContainer
          center={[lat, lng]}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
          attributionControl={false}
        >
          {/* CartoDB Positron — clean minimal light-grey tiles */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
          <RecenterMap lat={lat} lng={lng} />

          {/* Radius circle */}
          <Circle
            center={[lat, lng]}
            radius={radiusMeters}
            pathOptions={{
              color: '#1B5E20',
              fillColor: '#1B5E20',
              fillOpacity: 0.06,
              weight: 1.5,
              dashArray: '5 4',
            }}
          />

          {/* User pin */}
          <Marker position={[lat, lng]} icon={userIcon}>
            <Popup>
              <strong style={{ fontSize: 13 }}>You</strong>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{locationLabel || 'Current location'}</div>
            </Popup>
          </Marker>

          {/* Store pins */}
          {stores.map(store => (
            <Marker key={store.place_id} position={[store.lat, store.lng]} icon={makeStoreIcon(store.chain_id)}>
              <Popup>
                <strong style={{ fontSize: 13 }}>{store.name}</strong>
                <div style={{ fontSize: 12, color: '#666', marginTop: 3 }}>{store.address}</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                  {metersToMiles(store.distance_meters)} mi away
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Attribution overlay */}
        <div style={s.attribution}>© <a href="https://carto.com/" style={{ color: '#aaa' }}>CARTO</a> · © <a href="https://www.openstreetmap.org/copyright" style={{ color: '#aaa' }}>OSM</a></div>
      </div>

      {/* ── Search button ── */}
      <button
        style={{ ...s.searchBtn, opacity: searching ? 0.65 : 1 }}
        onClick={() => onSearch(radiusMeters)}
        disabled={searching}
      >
        {searching ? '⏳ Searching…' : `Search ${radiusMiles} mi radius`}
      </button>

      {stores.length > 0 && !searching && (
        <div style={s.storeList}>
          {stores.slice(0, 5).map(store => (
            <div key={store.place_id} style={s.storeRow}>
              <div style={{ ...s.storeDot, background: CHAIN_COLOR[store.chain_id] || '#888' }} />
              <span style={s.storeName}>{store.name}</span>
              <span style={s.storeDist}>{metersToMiles(store.distance_meters)} mi</span>
            </div>
          ))}
          {stores.length > 5 && (
            <div style={s.moreStores}>+{stores.length - 5} more stores</div>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  card: {
    background: '#fff',
    borderRadius: 20,
    border: '1px solid #EBEBEB',
    overflow: 'hidden',
    margin: '12px 16px 0',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  locationBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '13px 16px 10px',
    borderBottom: '1px solid #F0EDE8',
  },
  locationDot: { fontSize: 15 },
  locationLabel: { flex: 1, fontSize: 14, fontWeight: 600, color: '#222' },
  changeBtn: {
    fontSize: 12,
    fontWeight: 700,
    color: '#1B5E20',
    background: '#E8F5E9',
    border: 'none',
    borderRadius: 20,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  locationForm: {
    display: 'flex',
    gap: 6,
    padding: '10px 12px 8px',
    borderBottom: '1px solid #F0EDE8',
  },
  locationInput: {
    flex: 1,
    border: '1.5px solid #DDDAD5',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 14,
    outline: 'none',
    background: '#FAFAF9',
  },
  geoBtn: {
    background: '#1B5E20',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '8px 14px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  cancelBtn: {
    background: '#F0EDE8',
    color: '#888',
    border: 'none',
    borderRadius: 10,
    padding: '8px 10px',
    fontSize: 14,
    cursor: 'pointer',
  },
  geoError: {
    fontSize: 12,
    color: '#E65100',
    padding: '4px 16px 6px',
  },
  myLocationBtn: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '9px 16px',
    background: '#F8F7F4',
    border: 'none',
    borderBottom: '1px solid #F0EDE8',
    fontSize: 13,
    fontWeight: 600,
    color: '#1B5E20',
    cursor: 'pointer',
  },
  radiusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderBottom: '1px solid #F0EDE8',
  },
  radiusRowLabel: { fontSize: 12, fontWeight: 600, color: '#888', whiteSpace: 'nowrap' },
  radiusPills: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  radiusPill: {
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 12px',
    borderRadius: 20,
    border: '1.5px solid #DDDAD5',
    background: '#fff',
    color: '#555',
    cursor: 'pointer',
  },
  radiusPillActive: {
    background: '#1B5E20',
    color: '#fff',
    border: '1.5px solid #1B5E20',
  },
  mapWrap: {
    height: 260,
    width: '100%',
    position: 'relative',
  },
  attribution: {
    position: 'absolute',
    bottom: 4,
    right: 6,
    fontSize: 10,
    color: '#aaa',
    zIndex: 999,
    background: 'rgba(255,255,255,0.75)',
    padding: '1px 5px',
    borderRadius: 4,
    pointerEvents: 'none',
  },
  searchBtn: {
    display: 'block',
    width: 'calc(100% - 28px)',
    margin: '12px 14px 4px',
    background: '#1B5E20',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '13px 0',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(27,94,32,0.25)',
  },
  storeList: {
    padding: '8px 0 4px',
  },
  storeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 16px',
  },
  storeDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  storeName: { flex: 1, fontSize: 13, color: '#333', fontWeight: 500 },
  storeDist: { fontSize: 12, color: '#AAA', fontWeight: 600 },
  moreStores: { fontSize: 12, color: '#AAA', padding: '4px 16px 8px', fontStyle: 'italic' },
}
