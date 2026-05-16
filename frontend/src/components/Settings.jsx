// Settings.jsx — redesigned filter preferences screen

// Settings.jsx — filter preferences screen

const CATEGORY_INFO = {
  seed_oils: {
    label: 'Seed oils',
    description: 'Canola, soybean, sunflower, corn, cottonseed, vegetable oil blends, and more.',
    emoji: '🌻',
    alwaysOn: true,
    section: 'clean',
  },
  harmful_additives: {
    label: 'Artificial dyes & preservatives',
    description: 'Red 40, Yellow 5, Blue 1, BHA, BHT, TBHQ, sodium nitrite, and similar.',
    emoji: '🧪',
    alwaysOn: true,
    section: 'clean',
  },
  artificial_sweeteners: {
    label: 'Artificial sweeteners',
    description: 'Aspartame, sucralose, acesulfame-K, saccharin, and neotame.',
    emoji: '🍬',
    alwaysOn: false,
    section: 'clean',
  },
  high_fructose_corn_syrup: {
    label: 'High-fructose corn syrup',
    description: 'HFCS and corn syrup solids.',
    emoji: '🌽',
    alwaysOn: false,
    section: 'clean',
  },
  gluten: {
    label: 'Gluten-free',
    description: 'Flags wheat, barley, rye, spelt, malt, semolina, and vital wheat gluten.',
    emoji: '🌾',
    alwaysOn: false,
    section: 'dietary',
  },
  dairy: {
    label: 'Dairy-free',
    description: 'Flags milk, butter, cream, cheese, whey, casein, lactose, and yogurt.',
    emoji: '🥛',
    alwaysOn: false,
    section: 'dietary',
  },
  nuts: {
    label: 'Nut-free',
    description: 'Flags peanuts, tree nuts (almonds, cashews, walnuts, pecans, etc.).',
    emoji: '🥜',
    alwaysOn: false,
    section: 'dietary',
  },
  eggs: {
    label: 'Egg-free',
    description: 'Flags eggs, egg yolk, egg white, albumin, and ovalbumin.',
    emoji: '🥚',
    alwaysOn: false,
    section: 'dietary',
  },
}

const CLEAN_CATS    = Object.keys(CATEGORY_INFO).filter(k => CATEGORY_INFO[k].section === 'clean')
const DIETARY_CATS  = Object.keys(CATEGORY_INFO).filter(k => CATEGORY_INFO[k].section === 'dietary')

function FilterRow({ cat, isOn, isFixed, toggle }) {
  const info = CATEGORY_INFO[cat] || { label: cat.replace(/_/g, ' '), emoji: '⚠️', alwaysOn: false, description: '' }
  return (
    <button
      key={cat}
      style={{ ...s.row, opacity: isFixed ? 0.75 : 1 }}
      onClick={() => toggle(cat)}
      disabled={isFixed}
      aria-pressed={isOn}
    >
      <div style={s.rowEmoji}>{info.emoji}</div>
      <div style={s.rowText}>
        <div style={s.rowLabel}>{info.label}</div>
        <div style={s.rowDesc}>{info.description}</div>
        {isFixed && <div style={s.alwaysOnBadge}>Always on</div>}
      </div>
      <div style={{ ...s.toggle, background: isOn ? '#1B5E20' : '#E0DDD8' }}>
        <div style={{ ...s.toggleThumb, transform: isOn ? 'translateX(22px)' : 'translateX(2px)' }} />
      </div>
    </button>
  )
}

export default function Settings({ avoidList, setAvoidList, onClose, onSignOut }) {
  const toggle = (cat) => {
    const info = CATEGORY_INFO[cat]
    if (info?.alwaysOn) return
    if (avoidList.includes(cat)) {
      setAvoidList(prev => prev.filter(c => c !== cat))
    } else {
      setAvoidList(prev => [...prev, cat])
    }
  }

  return (
    <div style={s.page}>
      <div style={s.hero}>
        <h1 style={s.heroTitle}>Settings</h1>
        <p style={s.heroSub}>Choose what to filter out of your results.</p>
      </div>

      <div style={s.section}>
        <p style={s.sectionLabel}>Clean eating filters</p>
        {CLEAN_CATS.map(cat => (
          <FilterRow
            key={cat}
            cat={cat}
            isOn={avoidList.includes(cat) || CATEGORY_INFO[cat].alwaysOn}
            isFixed={CATEGORY_INFO[cat].alwaysOn}
            toggle={toggle}
          />
        ))}
      </div>

      <div style={s.section}>
        <p style={s.sectionLabel}>Dietary & allergen</p>
        <p style={s.sectionNote}>Turn on to flag these in ingredient lists.</p>
        {DIETARY_CATS.map(cat => (
          <FilterRow
            key={cat}
            cat={cat}
            isOn={avoidList.includes(cat)}
            isFixed={false}
            toggle={toggle}
          />
        ))}
      </div>

      <div style={s.section}>
        <p style={s.sectionLabel}>About</p>
        <div style={s.aboutCard}>
          <p style={s.aboutText}>
            Clean Cart uses Open Food Facts to check ingredient lists and surface the cleanest options for everyday grocery items.
          </p>
          <p style={s.version}>v0.2.0</p>
        </div>
      </div>

      {onSignOut && (
        <div style={{ padding: '20px 16px' }}>
          <button style={s.signOutBtn} onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { background: '#F5F4F1', minHeight: '100%', paddingBottom: 24 },
  hero: { padding: '24px 20px 20px', background: '#fff', borderBottom: '1px solid #EBEBEB' },
  heroTitle: { fontSize: 24, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-0.5px' },
  heroSub: { fontSize: 14, color: '#888', margin: '6px 0 0' },
  section: { padding: '20px 16px 0' },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 4px' },
  sectionNote: { fontSize: 12, color: '#BBB', margin: '0 0 10px' },
  row: { display: 'flex', alignItems: 'center', gap: 14, width: '100%', background: '#fff', border: '1.5px solid #EBEBEB', borderRadius: 16, padding: '16px', marginBottom: 10, textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' },
  rowEmoji: { fontSize: 26, flexShrink: 0 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: 700, color: '#111' },
  rowDesc: { fontSize: 12, color: '#888', marginTop: 3, lineHeight: 1.4 },
  alwaysOnBadge: { display: 'inline-block', marginTop: 5, fontSize: 11, color: '#1B5E20', background: '#E8F5E9', padding: '2px 8px', borderRadius: 10, fontWeight: 700 },
  toggle: { width: 46, height: 26, borderRadius: 13, position: 'relative', flexShrink: 0, transition: 'background 0.2s' },
  toggleThumb: { position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'transform 0.2s' },
  aboutCard: { background: '#fff', border: '1.5px solid #EBEBEB', borderRadius: 16, padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' },
  aboutText: { fontSize: 13, color: '#888', lineHeight: 1.6, margin: 0 },
  version: { fontSize: 12, color: '#CCC', margin: '8px 0 0' },
  signOutBtn: { width: '100%', padding: '14px', background: '#fff', color: '#C62828', border: '1.5px solid #FFCDD2', borderRadius: 14, fontSize: 15, fontWeight: 700, cursor: 'pointer' },
}
