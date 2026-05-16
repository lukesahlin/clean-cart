// ProductDetail.jsx — bottom sheet modal with health score + highlighted ingredients

import { useState, useEffect } from 'react'

function gradeColor(score) {
  if (score >= 85) return { bg: '#1B5E20', light: '#E8F5E9', text: '#fff' }
  if (score >= 70) return { bg: '#388E3C', light: '#F1F8E9', text: '#fff' }
  if (score >= 50) return { bg: '#F57F17', light: '#FFF8E1', text: '#fff' }
  if (score >= 30) return { bg: '#E65100', light: '#FBE9E7', text: '#fff' }
  return { bg: '#B71C1C', light: '#FFEBEE', text: '#fff' }
}

const CATEGORY_LABELS = {
  seed_oils:               { label: 'Seed oil',              color: '#E65100', bg: '#FBE9E7' },
  harmful_additives:       { label: 'Artificial additive',   color: '#B71C1C', bg: '#FFEBEE' },
  artificial_sweeteners:   { label: 'Artificial sweetener',  color: '#7B1FA2', bg: '#F3E5F5' },
  high_fructose_corn_syrup:{ label: 'HFCS',                  color: '#E65100', bg: '#FFF3E0' },
  gluten:                  { label: 'Gluten',                color: '#5D4037', bg: '#EFEBE9' },
  dairy:                   { label: 'Dairy',                 color: '#1565C0', bg: '#E3F2FD' },
  nuts:                    { label: 'Nut allergen',          color: '#BF360C', bg: '#FBE9E7' },
  eggs:                    { label: 'Egg',                   color: '#F57F17', bg: '#FFF8E1' },
}

const BREAKDOWN_LABELS = {
  seed_oils:        { label: 'Seed oils',        icon: '🌻', penalty: true },
  harmful_additives:{ label: 'Additives',        icon: '🧪', penalty: true },
  artificial_sweeteners: { label: 'Sweeteners', icon: '🍬', penalty: true },
  high_fructose_corn_syrup: { label: 'HFCS',    icon: '🌽', penalty: true },
  organic_bonus:    { label: 'Organic',          icon: '🌿', penalty: false },
  nutriscore:       { label: 'Nutri-Score',      icon: '📊', penalty: false },
  nova_group:       { label: 'Processing (NOVA)',icon: '🏭', penalty: true },
  additives_count:  { label: 'Additive count',   icon: '🔢', penalty: true },
}

export default function ProductDetail({ product, onClose }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const close = () => {
    setVisible(false)
    setTimeout(onClose, 220)
  }

  const hs = product.health_score
  const fr = product.filter_result
  const flaggedItems = fr?.flagged || []
  const flaggedSet = new Set(flaggedItems.map(f => f.ingredient.toLowerCase()))
  const ingredients = product.ingredient_text
    ? product.ingredient_text.split(',').map(s => s.trim()).filter(Boolean)
    : []
  const col = hs ? gradeColor(hs.score) : { bg: '#888', light: '#F5F5F5', text: '#fff' }
  const checked = fr?.checked_categories || []
  const breakdown = hs?.breakdown || {}

  return (
    <div
      style={{ ...s.overlay, opacity: visible ? 1 : 0, transition: 'opacity 0.2s' }}
      onClick={e => e.target === e.currentTarget && close()}
    >
      <div style={{
        ...s.sheet,
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.22s cubic-bezier(0.32,0.72,0,1)',
      }}>
        <div style={s.handle} onClick={close} />

        {/* Product header */}
        <div style={s.header}>
          {product.image_url
            ? <img src={product.image_url} alt="" style={s.headerImg} />
            : <div style={s.headerImgPlaceholder}>🛒</div>}
          <div style={s.headerInfo}>
            <h2 style={s.productName}>{product.product_name || 'Unknown product'}</h2>
            {product.brand && <p style={s.brand}>{product.brand}</p>}
            <div style={s.headerBadges}>
              {product.is_organic && <span style={s.organicTag}>🌿 Organic</span>}
              {product.nutriscore && <span style={s.nutriTag}>Nutri-{product.nutriscore.toUpperCase()}</span>}
              {product.nova_group && (
                <span style={{ ...s.novaTag, background: product.nova_group <= 2 ? '#E8F5E9' : product.nova_group === 3 ? '#FFF8E1' : '#FFEBEE', color: product.nova_group <= 2 ? '#1B5E20' : product.nova_group === 3 ? '#E65100' : '#B71C1C' }}>
                  NOVA {product.nova_group}
                </span>
              )}
            </div>
          </div>
          <button style={s.closeBtn} onClick={close}>✕</button>
        </div>

        {/* Health score */}
        {hs && (
          <div style={{ ...s.scoreSection, background: col.light, borderColor: col.bg + '44' }}>
            <div style={{ ...s.scoreBadgeLg, background: col.bg }}>
              <span style={s.scoreBadgeNum}>{hs.score}</span>
              <span style={s.scoreBadgeGrade}>{hs.grade}</span>
            </div>
            <div style={s.scoreDetail}>
              {hs.warnings?.map((w, i) => <div key={i} style={s.warning}>⚠️ {w}</div>)}
              {hs.positives?.map((p, i) => <div key={i} style={s.positive}>✓ {p}</div>)}
            </div>
          </div>
        )}

        {/* Score breakdown bars */}
        {Object.keys(breakdown).length > 0 && (
          <div style={s.breakdownSection}>
            <div style={s.sectionTitle}>Score breakdown</div>
            {Object.entries(breakdown).map(([key, value]) => {
              const info = BREAKDOWN_LABELS[key] || { label: key.replace(/_/g, ' '), icon: '•', penalty: false }
              const raw = Number(value)
              const isPenalty = info.penalty && raw < 0
              const isBonus = !info.penalty || raw > 0
              const barColor = isPenalty ? '#E53935' : '#1B5E20'
              const barWidth = Math.min(Math.abs(raw), 30) / 30 * 100
              if (raw === 0) return null
              return (
                <div key={key} style={s.breakdownRow}>
                  <span style={s.breakdownIcon}>{info.icon}</span>
                  <span style={s.breakdownLabel}>{info.label}</span>
                  <div style={s.barTrack}>
                    <div style={{ ...s.barFill, width: `${barWidth}%`, background: barColor }} />
                  </div>
                  <span style={{ ...s.breakdownVal, color: isPenalty ? '#E53935' : '#1B5E20' }}>
                    {raw > 0 ? `+${raw}` : raw}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Flagged ingredients breakdown */}
        {flaggedItems.length > 0 && (
          <div style={s.flaggedSection}>
            <div style={s.sectionTitle}>What was flagged</div>
            {flaggedItems.map((f, i) => {
              const catInfo = CATEGORY_LABELS[f.category] || { label: f.category.replace(/_/g, ' '), color: '#888', bg: '#F5F5F5' }
              return (
                <div key={i} style={s.flaggedRow}>
                  <div style={s.flaggedIngredientName}>{f.ingredient}</div>
                  <span style={{ ...s.flaggedCatChip, color: catInfo.color, background: catInfo.bg }}>
                    {catInfo.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Checked-for banner */}
        <div style={s.checkedBanner}>
          <span style={s.checkedIcon}>🛡️</span>
          <span style={s.checkedText}>
            Checked for {checked.map(c => c.replace(/_/g, ' ')).join(', ')}
          </span>
        </div>

        {/* Stats row */}
        <div style={s.statsRow}>
          <StatBox label="Ingredients" value={ingredients.length || '?'} />
          <StatBox label="Organic" value={product.is_organic ? 'Yes' : 'No'} accent={product.is_organic} />
          {product.nutriscore && <StatBox label="Nutri-Score" value={product.nutriscore.toUpperCase()} />}
          {product.nova_group && <StatBox label="NOVA" value={product.nova_group} accent={product.nova_group <= 2} />}
          <StatBox label="Data" value={`${product.completeness_pct}%`} />
        </div>

        {/* Ingredient chips */}
        {ingredients.length > 0 && (
          <div style={s.ingredientSection}>
            <div style={s.sectionTitle}>Ingredients</div>
            <div style={s.chipWrap}>
              {ingredients.map((ing, i) => {
                const ingLower = ing.toLowerCase()
                const matchedFlag = flaggedItems.find(f => ingLower.includes(f.ingredient.toLowerCase()))
                const catInfo = matchedFlag ? (CATEGORY_LABELS[matchedFlag.category] || { color: '#B71C1C', bg: '#FFEBEE' }) : null
                return (
                  <span
                    key={i}
                    style={catInfo ? { ...s.chip, ...s.chipBad, color: catInfo.color, background: catInfo.bg } : s.chip}
                    title={catInfo ? CATEGORY_LABELS[matchedFlag.category]?.label : undefined}
                  >
                    {ing}
                  </span>
                )
              })}
            </div>
            {flaggedSet.size > 0 && (
              <div style={s.legendRow}>
                <span style={{ ...s.chip, ...s.chipBad, color: '#B71C1C', background: '#FFEBEE', fontSize: 11 }}>highlighted</span>
                <span style={s.legendText}> = flagged ingredient</span>
              </div>
            )}
          </div>
        )}

        <div style={{ height: 16 }} />
      </div>
    </div>
  )
}

function StatBox({ label, value, accent }) {
  return (
    <div style={s.statBox}>
      <span style={{ ...s.statValue, color: accent ? '#1B5E20' : '#111' }}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  )
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 430, maxHeight: '90dvh', overflowY: 'auto', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
  handle: { width: 40, height: 4, background: '#E0DDD8', borderRadius: 2, margin: '12px auto 0', cursor: 'pointer' },

  header: { display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px 14px' },
  headerImg: { width: 72, height: 72, objectFit: 'contain', borderRadius: 14, background: '#F8F7F4', flexShrink: 0 },
  headerImgPlaceholder: { width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0EDE8', borderRadius: 14, fontSize: 32, flexShrink: 0 },
  headerInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 3px', lineHeight: 1.3, letterSpacing: '-0.3px' },
  brand: { fontSize: 13, color: '#888', margin: '0 0 6px' },
  headerBadges: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  organicTag: { display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9', borderRadius: 10, padding: '2px 8px' },
  nutriTag: { display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#555', background: '#F0EDE8', borderRadius: 10, padding: '2px 8px' },
  novaTag: { display: 'inline-block', fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 8px' },
  closeBtn: { background: '#F0EDE8', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 14, color: '#666', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  scoreSection: { margin: '0 16px 14px', borderRadius: 16, border: '1.5px solid', padding: '14px', display: 'flex', gap: 14, alignItems: 'flex-start' },
  scoreBadgeLg: { width: 64, height: 64, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scoreBadgeNum: { fontSize: 26, fontWeight: 900, color: '#fff', lineHeight: 1 },
  scoreBadgeGrade: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 2 },
  scoreDetail: { flex: 1 },
  warning: { fontSize: 13, color: '#B71C1C', marginBottom: 4, lineHeight: 1.4 },
  positive: { fontSize: 13, color: '#1B5E20', marginBottom: 4, lineHeight: 1.4 },

  sectionTitle: { fontSize: 11, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 10px' },

  breakdownSection: { margin: '0 16px 14px', background: '#F8F7F4', borderRadius: 14, padding: '12px 14px' },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 },
  breakdownIcon: { fontSize: 14, flexShrink: 0 },
  breakdownLabel: { fontSize: 12, color: '#555', width: 110, flexShrink: 0 },
  barTrack: { flex: 1, height: 6, background: '#E8E5E0', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, transition: 'width 0.4s ease' },
  breakdownVal: { fontSize: 12, fontWeight: 700, width: 36, textAlign: 'right', flexShrink: 0 },

  flaggedSection: { margin: '0 16px 14px', border: '1.5px solid #FFCDD2', borderRadius: 14, overflow: 'hidden' },
  flaggedRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 14px', borderBottom: '1px solid #FFF0F0' },
  flaggedIngredientName: { fontSize: 13, fontWeight: 600, color: '#333', flex: 1 },
  flaggedCatChip: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, flexShrink: 0 },

  checkedBanner: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 16px 14px', background: '#F0F9F4', borderRadius: 12, padding: '10px 14px' },
  checkedIcon: { fontSize: 16, flexShrink: 0 },
  checkedText: { fontSize: 12, color: '#388E3C', fontWeight: 500, lineHeight: 1.4 },

  statsRow: { display: 'flex', gap: 0, padding: '0 16px 14px' },
  statBox: { flex: 1, background: '#F8F7F4', borderRadius: 12, padding: '10px 8px', textAlign: 'center', margin: '0 3px' },
  statValue: { display: 'block', fontSize: 16, fontWeight: 800, color: '#111', marginBottom: 2 },
  statLabel: { display: 'block', fontSize: 10, color: '#AAA', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' },

  ingredientSection: { margin: '0 16px 0', background: '#F8F7F4', borderRadius: 14, padding: '12px 14px' },
  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: '5px 5px' },
  chip: { display: 'inline-block', fontSize: 12, color: '#555', background: '#EDEAE6', borderRadius: 8, padding: '3px 8px', lineHeight: 1.5 },
  chipBad: { fontWeight: 700 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 10 },
  legendText: { fontSize: 11, color: '#AAA' },
}
