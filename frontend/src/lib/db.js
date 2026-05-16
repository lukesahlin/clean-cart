// db.js -- Supabase database helpers for saved lists and scan history
import { supabase } from './supabase'

// --- Saved Lists ---

export async function fetchSavedLists() {
  const { data, error } = await supabase
    .from('saved_lists')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

export async function saveList(name, items) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('saved_lists')
    .insert({ user_id: user.id, name, items })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteList(id) {
  const { error } = await supabase
    .from('saved_lists')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- Scan History ---

export async function fetchScanHistory(limit = 20) {
  const { data, error } = await supabase
    .from('scan_history')
    .select('*')
    .order('scanned_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function saveScan({ barcode, product_name, brand, image_url, health_score, grade, is_clean }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase
    .from('scan_history')
    .upsert(
      { user_id: user.id, barcode, product_name, brand, image_url, health_score, grade, is_clean, scanned_at: new Date().toISOString() },
      { onConflict: 'user_id,barcode' }
    )
  if (error) console.warn('saveScan error:', error.message)
}

export async function deleteScan(id) {
  const { error } = await supabase.from('scan_history').delete().eq('id', id)
  if (error) throw error
}
