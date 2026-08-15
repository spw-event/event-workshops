'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'

export default function StaffResourceCategoryPage() {
  const params = useParams()
  const category = decodeURIComponent(params.category || '')

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [resources, setResources] = useState([])
  const [zoomedImage, setZoomedImage] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function verifyAndLoad() {
      const staffId = localStorage.getItem('spw_staff_id')
      if (!staffId) {
        window.location.href = '/staff'
        return
      }

      // Re-verify the stored id against the staff table so this page doesn't
      // trust localStorage blindly — matches the login check on /staff itself.
      const { data: staffData } = await supabase
        .from('staff')
        .select('id')
        .eq('id', staffId)
        .eq('is_active', true)
        .single()

      if (cancelled) return

      if (!staffData) {
        localStorage.removeItem('spw_staff_id')
        localStorage.removeItem('spw_staff_role')
        window.location.href = '/staff'
        return
      }

      setAuthorized(true)

      const eventId = localStorage.getItem('spw_staff_event_id')
      const { data } = await supabase
        .from('staff_resources')
        .select('*')
        .order('sort_order')

      if (cancelled) return

      const filtered = (data || [])
        .filter(r => r.event_id === eventId || r.is_global)
        .filter(r => (r.category || 'All Events') === category)

      setResources(filtered)
      setLoading(false)
    }

    verifyAndLoad()
    return () => { cancelled = true }
  }, [category])

  if (!authorized) {
    return (
      <div style={{ minHeight: '100vh', background: '#FAFAF8' }} />
    )
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', padding: '20px 16px 40px', color: '#1a1a1a', background: '#FAFAF8', minHeight: '100vh' }}>
      {/* Back arrow */}
      <a
        href="/staff"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
          color: '#8C8C8C', fontSize: 13, marginBottom: 20
        }}
      >
        ← Back
      </a>

      {/* Header */}
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a', marginBottom: 24, paddingBottom: 14, borderBottom: '0.5px solid #E8E4DE' }}>
        {category}
      </div>

      {loading ? null : resources.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>
          No resources in this category yet.
        </div>
      ) : (
        resources.map(res => (
          <div key={res.id} style={{ background: '#fff', border: '0.5px solid #E8E4DE', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: res.description ? 6 : 0 }}>{res.title}</div>
            {res.description && (
              <div style={{ fontSize: 14, color: '#8C8C8C', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{res.description}</div>
            )}
            {res.image_url && (
              <img
                src={res.image_url}
                alt={res.title}
                loading="lazy"
                onClick={() => setZoomedImage(res.image_url)}
                style={{ width: '100%', marginTop: 14, borderRadius: 8, display: 'block', cursor: 'zoom-in', border: '0.5px solid #E8E4DE' }}
              />
            )}
          </div>
        ))
      )}

      {/* Full-screen image zoom */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, cursor: 'zoom-out'
          }}
        >
          <img src={zoomedImage} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
        </div>
      )}
    </div>
  )
}
