// api.js -- all backend calls live here

const BASE = import.meta.env.VITE_API_URL || '/api'

export async function fetchRecommendations({ items, avoid = [], top_n = 10 }) {
  const res = await fetch(`${BASE}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, avoid, top_n }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to fetch recommendations')
  }
  return res.json()
}

export async function fetchAutocomplete(q) {
  if (!q || q.trim().length < 1) return []
  const res = await fetch(`${BASE}/autocomplete?q=${encodeURIComponent(q)}&limit=8`)
  if (!res.ok) return []
  const data = await res.json()
  return data.suggestions || []
}

export async function fetchCategories() {
  const res = await fetch(`${BASE}/categories`)
  if (!res.ok) return []
  const data = await res.json()
  return data.categories || []
}

export async function geocodeLocation(query) {
  const res = await fetch(`${BASE}/geocode?q=${encodeURIComponent(query)}`)
  if (res.status === 404) return { error: 'not_found' }
  if (!res.ok) return { error: 'geocode_failed' }
  return res.json()
}

export async function reverseGeocode(lat, lng) {
  const res = await fetch(`${BASE}/reverse-geocode?lat=${lat}&lng=${lng}`)
  if (!res.ok) return { zip_code: null }
  return res.json()
}

export async function fetchNearbyStores(lat, lng, radius = 8000) {
  const res = await fetch(`${BASE}/nearby-stores?lat=${lat}&lng=${lng}&radius=${radius}`)
  if (!res.ok) return { stores: [], api_key_configured: false }
  return res.json()
}

export async function checkAvailability({ product_query, stores, zip_code }) {
  const res = await fetch(`${BASE}/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_query, stores, zip_code }),
  })
  if (!res.ok) return { results: [] }
  return res.json()
}

// ask the browser for the user's current location
export function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  })
}

export async function shopAtStores({ query, lat, lng, zip_code = '99201', radius_meters = 8000, avoid = [], top_n = 5 }) {
  const res = await fetch(`${BASE}/shop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, lat, lng, zip_code, radius_meters, avoid, top_n }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Store search failed')
  }
  return res.json()
}

export async function searchInstacart({ query, zip_code = '99201', avoid = [] }) {
  const res = await fetch(`${BASE}/instacart/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, zip_code, avoid }),
  })
  if (!res.ok) return { results: [], total: 0 }
  return res.json()
}

export async function fetchProductByBarcode(barcode, avoid = []) {
  const avoidParam = avoid.length ? `?avoid=${avoid.join(',')}` : ''
  const res = await fetch(`${BASE}/product/barcode/${barcode}${avoidParam}`)
  if (res.status === 404) return { error: 'not_found' }
  if (!res.ok) return { error: 'fetch_failed' }
  return res.json()
}
