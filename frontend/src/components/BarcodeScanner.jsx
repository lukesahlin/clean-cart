// BarcodeScanner.jsx
// Camera-based barcode scanner with manual entry fallback.
// Uses @zxing/browser for UPC/EAN detection.
// Scan history is persisted to localStorage.

import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { fetchProductByBarcode } from '../api.js'

const HISTORY_KEY = 'cleancart_scan_history'
const MAX_HISTORY = 20

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistory(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))) } catch {}
}

// Score color for the badge
function scoreColor(score) {
  if (score >= 85) return { bg: '#1a7a4a', text: '#fff' }
  if (score >= 70) return { bg: '#56a02c', text: '#fff' }
  if (score >= 50) return { bg: '#e6b800', text: '#fff' }
  if (score >= 30) return { bg: '#e07c30', text: '#fff' }
  return { bg: '#c0392b', text: '#fff' }
}

export default function BarcodeScanner({ avoidList = [], onClose, onProductFound }) {
  const [mode, setMode] = useState('camera') // 'camera' | 'manual'
  const [manualBarcode, setManualBarcode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)      // fetched product
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(loadHistory)
  const [cameraError, setCameraError] = useState(null)

  const videoRef = useRef(null)
  const readerRef = useRef(null)
  const controlsRef = useRef(null)

  // ── Camera scanner ──────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try { controlsRef.current.stop() } catch {}
      controlsRef.current = null
    }
    setScanning(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setError(null)
    setResult(null)
    setScanning(true)

    try {
      readerRef.current = new BrowserMultiFormatReader()
      const devices = await BrowserMultiFormatReader.listVideoInputDevices()
      const backCamera = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0]
      if (!backCamera) throw new Error('No camera found')

      controlsRef.current = await readerRef.current.decodeFromVideoDevice(
        backCamera.deviceId,
        videoRef.current,
        (scanResult, err) => {
          if (scanResult) {
            stopCamera()
            handleBarcode(scanResult.getText())
          }
          // NotFoundException is normal while scanning — ignore it
        }
      )
    } catch (err) {
      stopCamera()
      if (err.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Use manual entry below.')
      } else {
        setCameraError(`Camera unavailable: ${err.message}`)
      }
    }
  }, [stopCamera])

  useEffect(() => {
    if (mode === 'camera') startCamera()
    return () => stopCamera()
  }, [mode])

  // ── Barcode handler ────────────────────────────────────────────────────────

  const handleBarcode = useCallback(async (barcode) => {
    const trimmed = barcode.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setResult(null)

    const data = await fetchProductByBarcode(trimmed, avoidList)

    if (data.error === 'not_found') {
      setError(`Barcode ${trimmed} not found in Open Food Facts. Try searching by name instead.`)
      setLoading(false)
      return
    }
    if (data.error) {
      setError('Could not reach the server. Check your connection.')
      setLoading(false)
      return
    }

    setResult(data)
    setLoading(false)

    // update history
    const entry = {
      barcode: trimmed,
      product_name: data.product_name,
      brand: data.brand,
      health_score: data.health_score,
      scanned_at: new Date().toISOString(),
    }
    const updated = [entry, ...history.filter(h => h.barcode !== trimmed)]
    setHistory(updated)
    saveHistory(updated)
  }, [avoidList, history])

  const handleManualSubmit = (e) => {
    e.preventDefault()
    if (manualBarcode.trim()) handleBarcode(manualBarcode.trim())
  }

  const handleHistoryTap = (entry) => handleBarcode(entry.barcode)

  const clearHistory = () => {
    setHistory([])
    saveHistory([])
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.container}>
      {/* Top bar */}
      <div style={s.topBar}>
        <button style={s.backBtn} onClick={onClose}>← Back</button>
        <span style={s.title}>Scan Product</span>
        <div style={s.modeToggle}>
          <button style={{ ...s.modeBtn, ...(mode === 'camera' ? s.modeBtnActive : {}) }} onClick={() => setMode('camera')}>📷</button>
          <button style={{ ...s.modeBtn, ...(mode === 'manual' ? s.modeBtnActive : {}) }} onClick={() => setMode('manual')}>⌨️</button>
        </div>
      </div>

      {/* Camera view */}
      {mode === 'camera' && (
        <div style={s.cameraSection}>
          <div style={s.videoWrap}>
            <video ref={videoRef} style={s.video} autoPlay muted playsInline />
            {scanning && (
              <div style={s.scanOverlay}>
                <div style={s.scanFrame} />
                <p style={s.scanHint}>Point camera at barcode</p>
              </div>
            )}
          </div>
          {cameraError && (
            <div style={s.cameraError}>
              <span>⚠️ {cameraError}</span>
              <button style={s.switchBtn} onClick={() => setMode('manual')}>Use manual entry</button>
            </div>
          )}
        </div>
      )}

      {/* Manual entry */}
      {mode === 'manual' && (
        <form style={s.manualForm} onSubmit={handleManualSubmit}>
          <input
            style={s.barcodeInput}
            type="text"
            inputMode="numeric"
            placeholder="Enter UPC or EAN barcode..."
            value={manualBarcode}
            onChange={e => setManualBarcode(e.target.value)}
            autoFocus
          />
          <button style={s.lookupBtn} type="submit" disabled={loading || !manualBarcode.trim()}>
            {loading ? 'Looking up…' : 'Look up'}
          </button>
        </form>
      )}

      {/* Loading spinner */}
      {loading && (
        <div style={s.loadingRow}>
          <div style={s.spinner} />
          <span style={s.loadingText}>Checking ingredients…</span>
        </div>
      )}

      {/* Error */}
      {error && <div style={s.errorBox}>{error}</div>}

      {/* Scan result */}
      {result && !loading && <ScanResult result={result} onAdd={() => onProductFound && onProductFound(result)} />}

      {/* Scan history */}
      {history.length > 0 && !result && !loading && (
        <div style={s.historySection}>
          <div style={s.historyHeader}>
            <span style={s.historyTitle}>Recent scans</span>
            <button style={s.clearBtn} onClick={clearHistory}>Clear</button>
          </div>
          {history.map(entry => (
            <button key={entry.barcode + entry.scanned_at} style={s.historyRow} onClick={() => handleHistoryTap(entry)}>
              <div style={s.historyLeft}>
                <div style={s.historyName}>{entry.product_name || entry.barcode}</div>
                {entry.brand && <div style={s.historyBrand}>{entry.brand}</div>}
              </div>
              {entry.health_score && (
                <div style={{ ...s.historyScore, ...scoreColor(entry.health_score.score) }}>
                  {entry.health_score.score}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ScanResult({ result, onAdd }) {
  const hs = result.health_score
  const fr = result.filter_result
  const col = hs ? scoreColor(hs.score) : { bg: '#999', text: '#fff' }
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={s.resultCard}>
      {/* Product header */}
      <div style={s.resultHeader}>
        {result.image_url
          ? <img src={result.image_url} alt="" style={s.resultImage} />
          : <div style={s.resultImagePlaceholder}>🛒</div>
        }
        <div style={s.resultInfo}>
          <div style={s.resultName}>{result.product_name}</div>
          {result.brand && <div style={s.resultBrand}>{result.brand}</div>}
          <div style={s.resultBarcode}>#{result.barcode}</div>
        </div>
        {hs && (
          <div style={{ ...s.scoreBadge, background: col.bg, color: col.text }}>
            <div style={s.scoreNum}>{hs.score}</div>
            <div style={s.scoreGrade}>{hs.grade}</div>
          </div>
        )}
      </div>

      {/* Warnings */}
      {hs && hs.warnings.length > 0 && (
        <div style={s.warningList}>
          {hs.warnings.map((w, i) => <div key={i} style={s.warningItem}>⚠️ {w}</div>)}
        </div>
      )}

      {/* Positives */}
      {hs && hs.positives.length > 0 && (
        <div style={s.positiveList}>
          {hs.positives.map((p, i) => <div key={i} style={s.positiveItem}>✓ {p}</div>)}
        </div>
      )}

      {/* Ingredient list toggle */}
      {result.ingredient_text && (
        <div style={s.ingredientSection}>
          <button style={s.expandBtn} onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Hide ingredients ▲' : 'Show ingredients ▼'}
          </button>
          {expanded && (
            <div style={s.ingredientText}>
              {result.ingredient_text.split(',').map((ing, i) => {
                const ingLower = ing.toLowerCase().trim()
                const flagged = fr && fr.flagged && fr.flagged.some(f => ingLower.includes(f.ingredient.toLowerCase()))
                return (
                  <span key={i} style={flagged ? s.flaggedIngredient : s.cleanIngredient}>
                    {ing.trim()}{i < result.ingredient_text.split(',').length - 1 ? ', ' : ''}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      <button style={s.addToListBtn} onClick={onAdd}>+ Add to grocery list</button>
    </div>
  )
}

const s = {
  container: { display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#faf9f6', paddingBottom: 40 },
  topBar: { display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #f0eeea', background: '#fff', gap: 10 },
  backBtn: { background: 'none', border: 'none', fontSize: 14, color: '#1B5E20', fontWeight: 500, cursor: 'pointer', padding: 0 },
  title: { flex: 1, fontWeight: 700, fontSize: 17, textAlign: 'center' },
  modeToggle: { display: 'flex', gap: 4 },
  modeBtn: { background: '#f0eeea', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 16, cursor: 'pointer' },
  modeBtnActive: { background: '#1B5E20', color: '#fff' },
  cameraSection: { position: 'relative' },
  videoWrap: { position: 'relative', width: '100%', background: '#000', overflow: 'hidden', aspectRatio: '4/3', maxHeight: 340 },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  scanOverlay: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  scanFrame: { width: 220, height: 120, border: '2.5px solid #1B5E20', borderRadius: 12, boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)' },
  scanHint: { color: '#fff', fontSize: 13, marginTop: 16, fontWeight: 500, textShadow: '0 1px 3px rgba(0,0,0,0.8)' },
  cameraError: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#fff8f0', borderBottom: '1px solid #f0eeea', fontSize: 13, color: '#c0392b' },
  switchBtn: { background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  manualForm: { display: 'flex', gap: 10, padding: '16px 16px 0' },
  barcodeInput: { flex: 1, border: '1.5px solid #ddd', borderRadius: 10, padding: '11px 14px', fontSize: 15, outline: 'none', background: '#fff' },
  lookupBtn: { background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  loadingRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '20px 16px', justifyContent: 'center' },
  spinner: { width: 24, height: 24, border: '3px solid #e8f5e9', borderTop: '3px solid #1B5E20', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  loadingText: { fontSize: 14, color: '#555' },
  errorBox: { margin: '14px 16px', background: '#fff5f5', border: '1px solid #ffcdd2', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#c0392b', lineHeight: 1.5 },
  resultCard: { margin: '14px 16px', background: '#fff', border: '1.5px solid #eceae6', borderRadius: 14, overflow: 'hidden' },
  resultHeader: { display: 'flex', gap: 12, padding: '14px', alignItems: 'flex-start' },
  resultImage: { width: 64, height: 64, objectFit: 'contain', borderRadius: 8, background: '#f8f7f4', flexShrink: 0 },
  resultImagePlaceholder: { width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0eeea', borderRadius: 8, fontSize: 28, flexShrink: 0 },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.3 },
  resultBrand: { fontSize: 12, color: '#888', marginTop: 2 },
  resultBarcode: { fontSize: 11, color: '#bbb', marginTop: 4, fontFamily: 'monospace' },
  scoreBadge: { borderRadius: 10, padding: '8px 10px', textAlign: 'center', minWidth: 52, flexShrink: 0 },
  scoreNum: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  scoreGrade: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginTop: 2, letterSpacing: '0.5px' },
  warningList: { padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 5 },
  warningItem: { fontSize: 13, color: '#c0392b', background: '#fff5f5', borderRadius: 8, padding: '6px 10px' },
  positiveList: { padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 5 },
  positiveItem: { fontSize: 13, color: '#1a5c36', background: '#e8f5e9', borderRadius: 8, padding: '6px 10px' },
  ingredientSection: { borderTop: '1px solid #f0eeea', padding: '10px 14px' },
  expandBtn: { background: 'none', border: 'none', fontSize: 13, color: '#1B5E20', fontWeight: 600, cursor: 'pointer', padding: 0 },
  ingredientText: { marginTop: 8, fontSize: 12, color: '#555', lineHeight: 1.7 },
  flaggedIngredient: { background: '#fff0f0', color: '#c0392b', fontWeight: 600, borderRadius: 3, padding: '1px 2px' },
  cleanIngredient: { color: '#555' },
  addToListBtn: { display: 'block', width: 'calc(100% - 28px)', margin: '12px 14px 14px', background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  historySection: { margin: '16px 16px 0' },
  historyHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  historyTitle: { fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' },
  clearBtn: { fontSize: 12, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer' },
  historyRow: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: '#fff', border: '1.5px solid #eceae6', borderRadius: 10, padding: '10px 12px', marginBottom: 8, textAlign: 'left', cursor: 'pointer' },
  historyLeft: { flex: 1, minWidth: 0 },
  historyName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  historyBrand: { fontSize: 12, color: '#888', marginTop: 2 },
  historyScore: { width: 38, height: 38, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 },
}
