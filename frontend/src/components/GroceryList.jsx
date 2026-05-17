// GroceryList.jsx -- grocery list builder with Supabase-synced saved lists

import { useState, useRef, useEffect, useCallback } from 'react'
import { fetchAutocomplete } from '../api.js'
import { fetchSavedLists, saveList, deleteList } from '../lib/db.js'
import LocationBar from './LocationBar.jsx'

const EXAMPLES = ['tortilla chips', 'mayonnaise', 'granola bars', 'ranch dressing', 'peanut butter', 'greek yogurt', 'salad dressing', 'crackers']

export default function GroceryList({ onSearch, loading, error, location, onLocationChange }) {
  const [items, setItems] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSug, setShowSug] = useState(false)
  const [activeSug, setActiveSug] = useState(-1)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveListName, setSaveListName] = useState('')
  const [savedLists, setSavedLists] = useState([])
  const [listsLoading, setListsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)
  const sugTimeout = useRef(null)

  // load saved lists from Supabase on mount
  useEffect(() => {
    fetchSavedLists()
      .then(setSavedLists)
      .catch(console.warn)
      .finally(() => setListsLoading(false))
  }, [])

  useEffect(() => {
    clearTimeout(sugTimeout.current)
    if (inputValue.trim().length < 1) { setSuggestions([]); return }
    sugTimeout.current = setTimeout(async () => {
      const r = await fetchAutocomplete(inputValue)
      setSuggestions(r)
      setShowSug(r.length > 0)
      setActiveSug(-1)
    }, 180)
    return () => clearTimeout(sugTimeout.current)
  }, [inputValue])

  const addItem = useCallback((name) => {
    const t = name.trim().toLowerCase()
    if (!t || items.includes(t)) return
    setItems(p => [...p, t])
    setInputValue('')
    setSuggestions([])
    setShowSug(false)
    inputRef.current?.focus()
  }, [items])

  const removeItem = (item) => setItems(p => p.filter(i => i !== item))

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (activeSug >= 0 && suggestions[activeSug]) addItem(suggestions[activeSug])
      else if (inputValue.trim()) addItem(inputValue)
    } else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSug(p => Math.min(p + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSug(p => Math.max(p - 1, -1)) }
    else if (e.key === 'Escape') setShowSug(false)
  }

  const saveCurrentList = async () => {
    if (!saveListName.trim() || !items.length) return
    setSaving(true)
    try {
      const newList = await saveList(saveListName.trim(), items)
      setSavedLists(p => [newList, ...p].slice(0, 20))
      setSaveListName('')
      setShowSaveInput(false)
    } catch (err) {
      console.warn('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteList = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteList(id)
      setSavedLists(p => p.filter(l => l.id !== id))
    } catch (err) {
      console.warn('Delete failed:', err)
    }
  }

  return (
    <div style={s.page}>

      {/* Hero */}
      <div style={s.hero}>
        <h1 style={s.heroTitle}>What are you shopping for?</h1>
        <p style={s.heroSub}>Add items and we'll find the cleanest options nearby.</p>
      </div>

      {/* Location picker */}
      <LocationBar location={location} onLocationChange={onLocationChange} />

      {/* Search input */}
      <div style={s.inputWrap}>
        <div style={s.inputRow}>
          <span style={s.searchIcon}>🔍</span>
          <input
            ref={inputRef}
            style={s.input}
            type="text"
            placeholder="Add grocery item…"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 120)}
            autoComplete="off"
          />
          {inputValue.trim() && (
            <button style={s.addBtn} onMouseDown={() => addItem(inputValue)}>Add</button>
          )}
        </div>

        {showSug && (
          <div style={s.suggestions}>
            {suggestions.map((sug, i) => (
              <button
                key={sug}
                style={{ ...s.suggestion, ...(i === activeSug ? s.suggestionActive : {}) }}
                onMouseDown={() => addItem(sug)}
              >
                <span style={s.sugIcon}>🔍</span>
                {sug}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Item chips */}
      {items.length > 0 && (
        <div style={s.itemList}>
          {items.map(item => (
            <div key={item} style={s.itemChip}>
              <span style={s.itemChipText}>{item}</span>
              <button style={s.itemChipRemove} onClick={() => removeItem(item)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Examples */}
      {items.length === 0 && (
        <div style={s.examplesSection}>
          <p style={s.examplesLabel}>Try these</p>
          <div style={s.examplesRow}>
            {EXAMPLES.map(e => (
              <button key={e} style={s.examplePill} onClick={() => addItem(e)}>{e}</button>
            ))}
          </div>
        </div>
      )}

      {error && <div style={s.errorBox}>⚠️ {error}</div>}

      {/* CTA */}
      {items.length > 0 && (
        <div style={s.ctaSection}>
          <button
            style={{ ...s.ctaBtn, opacity: loading ? 0.7 : 1 }}
            onClick={() => onSearch(items)}
            disabled={loading}
          >
            {loading ? (
              <span style={s.ctaBtnInner}><span style={s.ctaSpinner} />Finding clean picks…</span>
            ) : (
              <span style={s.ctaBtnInner}>Find clean picks for {items.length} item{items.length !== 1 ? 's' : ''} →</span>
            )}
          </button>

          <div style={s.saveRow}>
            {!showSaveInput ? (
              <button style={s.saveLinkBtn} onClick={() => setShowSaveInput(true)}>💾 Save this list</button>
            ) : (
              <div style={s.saveInputRow}>
                <input
                  style={s.saveInput}
                  placeholder="List name…"
                  value={saveListName}
                  onChange={e => setSaveListName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCurrentList()}
                  autoFocus
                />
                <button style={s.saveConfirmBtn} onClick={saveCurrentList} disabled={saving}>
                  {saving ? '…' : 'Save'}
                </button>
                <button style={s.saveCancelBtn} onClick={() => setShowSaveInput(false)}>✕</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved lists */}
      {!listsLoading && savedLists.length > 0 && (
        <div style={s.savedSection}>
          <p style={s.savedLabel}>Saved lists</p>
          <div style={s.savedScroll}>
            {savedLists.map(list => (
              <button key={list.id} style={s.savedCard} onClick={() => setItems(list.items)}>
                <div style={s.savedCardHeader}>
                  <div style={s.savedCardName}>{list.name}</div>
                  <button
                    style={s.deleteBtn}
                    onClick={(e) => handleDeleteList(e, list.id)}
                    title="Delete list"
                  >×</button>
                </div>
                <div style={s.savedCardCount}>{list.items.length} items</div>
                <div style={s.savedCardItems}>{list.items.slice(0, 3).join(', ')}{list.items.length > 3 ? '…' : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {listsLoading && (
        <div style={s.savedSection}>
          <p style={s.savedLabel}>Saved lists</p>
          <div style={{ display: 'flex', gap: 10 }}>
            {[1,2].map(i => <div key={i} style={s.skeletonCard} />)}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { minHeight: '100%', background: '#F7F6F3', paddingBottom: 20 },
  hero: { padding: '32px 20px 24px', background: 'linear-gradient(180deg, #fff 60%, #F7F6F3 100%)', borderBottom: 'none' },
  heroTitle: { fontSize: 26, fontWeight: 900, color: '#111', margin: 0, letterSpacing: '-0.6px', lineHeight: 1.15 },
  heroSub: { fontSize: 15, color: '#999', margin: '8px 0 0', lineHeight: 1.5, fontWeight: 400 },
  inputWrap: { position: 'relative', margin: '0 16px', zIndex: 10 },
  inputRow: { display: 'flex', alignItems: 'center', background: '#fff', border: '1.5px solid #E8E6E3', borderRadius: 16, padding: '4px 8px 4px 16px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', gap: 8 },
  searchIcon: { fontSize: 16, flexShrink: 0, opacity: 0.35 },
  input: { flex: 1, border: 'none', outline: 'none', fontSize: 16, background: 'transparent', padding: '12px 0', color: '#111', minWidth: 0 },
  addBtn: { background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  suggestions: { position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 100 },
  suggestion: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#111', textAlign: 'left', borderBottom: '1px solid #F5F5F5' },
  suggestionActive: { background: '#F0F7F1' },
  sugIcon: { fontSize: 13, opacity: 0.3 },
  itemList: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '16px 16px 0' },
  itemChip: { display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '1.5px solid #E8E6E3', borderRadius: 24, padding: '8px 8px 8px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
  itemChipText: { fontSize: 14, fontWeight: 600, color: '#222' },
  itemChipRemove: { width: 24, height: 24, borderRadius: '50%', background: '#F0EDE8', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 },
  examplesSection: { padding: '24px 16px 0' },
  examplesLabel: { fontSize: 11, fontWeight: 700, color: '#C5C5C5', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 12px' },
  examplesRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  examplePill: { background: '#fff', border: '1.5px solid #ECEAE7', borderRadius: 24, padding: '8px 16px', fontSize: 13, fontWeight: 500, color: '#666', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s' },
  errorBox: { margin: '14px 16px', background: '#FFF5F5', border: '1px solid #FFCDD2', borderRadius: 14, padding: '14px 16px', fontSize: 14, color: '#C62828' },
  ctaSection: { padding: '24px 16px 0' },
  ctaBtn: { width: '100%', background: 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 0', fontSize: 16, fontWeight: 800, cursor: 'pointer', letterSpacing: '-0.2px', boxShadow: '0 4px 24px rgba(27,94,32,0.3)', transition: 'transform 0.1s, box-shadow 0.1s' },
  ctaBtnInner: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ctaSpinner: { width: 18, height: 18, border: '2.5px solid rgba(255,255,255,0.3)', borderTop: '2.5px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' },
  saveRow: { marginTop: 12, display: 'flex', justifyContent: 'center' },
  saveLinkBtn: { background: 'none', border: 'none', fontSize: 13, color: '#999', cursor: 'pointer', padding: '6px 0', fontWeight: 500 },
  saveInputRow: { display: 'flex', gap: 8, width: '100%' },
  saveInput: { flex: 1, border: '1.5px solid #E0DDD8', borderRadius: 12, padding: '10px 14px', fontSize: 14, outline: 'none', background: '#fff' },
  saveConfirmBtn: { background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  saveCancelBtn: { background: '#F0EDE8', color: '#666', border: 'none', borderRadius: 12, padding: '10px 14px', fontSize: 14, cursor: 'pointer' },
  savedSection: { padding: '28px 16px 0' },
  savedLabel: { fontSize: 11, fontWeight: 700, color: '#C5C5C5', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 12px' },
  savedScroll: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' },
  savedCard: { flexShrink: 0, width: 156, background: '#fff', border: '1.5px solid #ECEAE7', borderRadius: 16, padding: '14px 14px 12px', textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', transition: 'border-color 0.15s' },
  savedCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  savedCardName: { fontSize: 14, fontWeight: 700, color: '#111', flex: 1, marginRight: 4 },
  savedCardCount: { fontSize: 12, color: '#2E7D32', fontWeight: 600, marginBottom: 6 },
  savedCardItems: { fontSize: 12, color: '#BBB', lineHeight: 1.4 },
  deleteBtn: { background: 'none', border: 'none', fontSize: 16, color: '#D5D5D5', cursor: 'pointer', padding: '0 0 0 4px', lineHeight: 1, flexShrink: 0 },
  skeletonCard: { flexShrink: 0, width: 156, height: 90, background: '#ECEAE7', borderRadius: 16, animation: 'pulse 1.5s ease-in-out infinite' },
}
