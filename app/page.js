'use client'

import { useEffect, useState } from 'react'
import { Calendar, CheckSquare, MapPin, BookOpen, ShoppingBag } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { playfair } from './fonts'

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}
function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`
}
function deleteCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/`
}

// Orders a list of category names using the admin-configured gear_categories
// sort_order for this event. Categories without an explicit row yet (never
// reordered) sort after ones that have been, alphabetically among themselves.
function orderGearCategories(categories, categoryRows, eventId) {
  const orderMap = {}
  categoryRows.filter(gc => gc.event_id === eventId).forEach(gc => { orderMap[gc.name] = gc.sort_order })
  return [...categories].sort((a, b) => {
    const ao = orderMap[a]
    const bo = orderMap[b]
    if (ao !== undefined && bo !== undefined) return ao - bo
    if (ao !== undefined) return -1
    if (bo !== undefined) return 1
    return a.localeCompare(b)
  })
}

// registration_opens_at is saved as a naive datetime-local string (no offset),
// stored with a UTC label even though the digits represent wall-clock time in
// registration_timezone. This resolves those digits into the true absolute
// instant, so "is registration open" is correct no matter what timezone the
// guest's own device is in.
function resolveRegistrationOpenTime(event) {
  if (!event?.registration_opens_at) return null
  const tz = event.registration_timezone || 'America/New_York'
  const raw = new Date(event.registration_opens_at)
  const guessUtc = Date.UTC(
    raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(),
    raw.getUTCHours(), raw.getUTCMinutes(), raw.getUTCSeconds()
  )
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const map = {}
  dtf.formatToParts(new Date(guessUtc)).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value })
  const hour = map.hour === '24' ? 0 : Number(map.hour)
  const shownAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second))
  return new Date(guessUtc + (guessUtc - shownAsUtc))
}

const SCHEDULE_CACHE_KEY = 'spw_schedule_cache'

// Schedule-only snapshot for offline fallback (a lighter-weight sibling of
// the full per-token cache). Sessions keep their nested `workshops` object
// as-is, matching the shape every render site (Schedule tab, party modal,
// ICS export, My Agenda) already expects — flattening it would silently
// blank out workshop names/locations after a cache restore.
function buildScheduleSnapshot(event, sessionsArr, momentsArr, regsArr, savesArr) {
  return {
    savedAt: new Date().toISOString(),
    event: event || null,
    sessions: (sessionsArr || []).map(s => ({
      id: s.id,
      event_id: s.event_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      workshops: s.workshops ? { name: s.workshops.name, location: s.workshops.location } : null,
    })),
    openMoments: momentsArr || [],
    registrations: regsArr || [],
    momentSaves: savesArr || [],
  }
}

const INFO_CONTACT_PHONE_DISPLAY = '+1 (888) 424-4916'
const INFO_CONTACT_PHONE_HREF = 'tel:+18884244916'

// Renders plain-text section content with line breaks preserved and any
// mailto:/tel: tokens turned into tappable links.
function renderInfoContent(content) {
  if (!content) return null
  return content.split('\n').map((line, i) => {
    if (line.trim() === '') return <div key={i} style={{ height: 10 }} />
    const tokens = line.split(/(\s+)/)
    return (
      <div key={i} style={{ marginBottom: 2 }}>
        {tokens.map((tok, j) => {
          const m = tok.match(/^(mailto:|tel:)(.+)$/i)
          if (!m) return tok
          return (
            <a key={j} href={tok} style={{ color: '#2D4A2D', textDecoration: 'underline', fontWeight: 600 }}>
              {m[2]}
            </a>
          )
        })}
      </div>
    )
  })
}

function EventInfoAccordion({ event, sections, partners }) {
  const [openSection, setOpenSection] = useState(null)
  const ordered = [...sections].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const orderedPartners = [...(partners || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const callouts = []
  if (event?.checkin_time) callouts.push({ label: 'Check-in', value: event.checkin_time })
  if (event?.checkout_time) callouts.push({ label: 'Check-out', value: event.checkout_time })

  // Every available contact method, one per line, falling back to the
  // original hardcoded phone number when an event hasn't set any of its own.
  const contactLines = []
  const generalPhone = event?.questions_contact?.trim()
  if (generalPhone) {
    let href
    if (generalPhone.includes('@')) href = 'mailto:' + generalPhone
    else if (/\d/.test(generalPhone)) href = 'tel:' + generalPhone.replace(/[^\d+]/g, '')
    contactLines.push({ value: generalPhone, href })
  }
  const contactEmail = event?.contact_email?.trim()
  if (contactEmail) contactLines.push({ value: contactEmail, href: 'mailto:' + contactEmail })
  const dayOfPhone = event?.contact_phone_dayof?.trim()
  if (dayOfPhone) contactLines.push({ label: 'Day of event', value: dayOfPhone, href: 'tel:' + dayOfPhone.replace(/[^\d+]/g, '') })
  if (contactLines.length === 0) contactLines.push({ value: INFO_CONTACT_PHONE_DISPLAY, href: INFO_CONTACT_PHONE_HREF })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {callouts.map(c => (
          <div key={c.label} style={{
            flex: '1 1 150px', minWidth: 140, background: '#F5F0E8',
            border: '0.5px solid #E8E4DE',
            borderRadius: 6, padding: '16px 18px'
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4 }}>{c.value}</div>
          </div>
        ))}
        <div style={{
          flex: '1 1 150px', minWidth: 140, background: '#F5F0E8',
          border: '0.5px solid #E8E4DE',
          borderRadius: 6, padding: '16px 18px'
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 6 }}>Questions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {contactLines.map((line, i) => {
              const Tag = line.href ? 'a' : 'div'
              return (
                <Tag key={i} href={line.href} style={{ fontSize: 14, fontWeight: 600, color: line.href ? '#2D4A2D' : '#1a1a1a', lineHeight: 1.4, textDecoration: 'none' }}>
                  {line.label ? line.label + ': ' : ''}{line.value}
                </Tag>
              )
            })}
          </div>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div style={{ fontSize: 13, color: '#8C8C8C', padding: '40px 0', textAlign: 'center', letterSpacing: '0.02em' }}>
          No information available for this event yet.
        </div>
      ) : (
        <div>
          {ordered.map(s => {
            const open = openSection === s.id
            return (
              <div key={s.id}>
                <button
                  onClick={() => setOpenSection(open ? null : s.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 0', background: 'none',
                    border: 'none', borderBottom: '0.5px solid #E8E4DE',
                    cursor: 'pointer', textAlign: 'left', font: 'inherit'
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1a1a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{s.title}</span>
                  <span style={{ fontSize: 13, color: '#8C8C8C', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
                </button>
                <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s ease' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 0 18px', fontSize: 14, lineHeight: 1.7, color: '#1a1a1a' }}>
                      {renderInfoContent(s.content)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {orderedPartners.length > 0 && (() => {
        const partnersOpen = openSection === 'partners'
        return (
        <div style={{ marginTop: ordered.length > 0 ? 8 : 0 }}>
          <button
            onClick={() => setOpenSection(partnersOpen ? null : 'partners')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 0', background: 'none',
              border: 'none', borderBottom: '0.5px solid #E8E4DE',
              cursor: 'pointer', textAlign: 'left', font: 'inherit'
            }}
          >
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1a1a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Our Partners</span>
            <span style={{ fontSize: 13, color: '#8C8C8C', flexShrink: 0 }}>{partnersOpen ? '▾' : '▸'}</span>
          </button>
          <div style={{ display: 'grid', gridTemplateRows: partnersOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s ease' }}>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 0 18px' }}>
                {orderedPartners.map((p, i) => (
                  <div key={p.id} style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    padding: '14px 0',
                    borderTop: i > 0 ? '0.5px solid #E8E4DE' : 'none'
                  }}>
                    {p.logo_url && (
                      <div style={{
                        flexShrink: 0, width: 72, height: 60, background: '#FAFAF8',
                        border: '0.5px solid #E8E4DE', borderRadius: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
                      }}>
                        <img src={p.logo_url} alt={p.name} style={{ maxWidth: '100%', maxHeight: 60, objectFit: 'contain' }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{p.name}</div>
                      {p.description && <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 3, lineHeight: 1.5 }}>{p.description}</div>}
                      {p.website_url && (
                        <a href={p.website_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2D4A2D', fontWeight: 600, textDecoration: 'none', marginTop: 6, display: 'inline-block' }}>
                          Visit →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}

export default function Home() {
  const [guest, setGuest] = useState(null)
  const [guestEvent, setGuestEvent] = useState(null)
  const [myEvents, setMyEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [workshops, setWorkshops] = useState([])
  const [sessions, setSessions] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [partyCreditsUsed, setPartyCreditsUsed] = useState(0)
  const [partyCreditsTotal, setPartyCreditsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('schedule')
  const [registering, setRegistering] = useState(null)
  const [message, setMessage] = useState(null)
  const [expandedSessionId, setExpandedSessionId] = useState(null)
  const [selectedPartySize, setSelectedPartySize] = useState(1)
  const [sessionAvailability, setSessionAvailability] = useState({})
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [opensAt, setOpensAt] = useState(null)
  const [openMoments, setOpenMoments] = useState([])
  const [momentSaves, setMomentSaves] = useState([])
  const [savingMoment, setSavingMoment] = useState(null)
  const [scheduleDayFilter, setScheduleDayFilter] = useState('all')
  const [scheduleTypeFilter, setScheduleTypeFilter] = useState('all')
  const [agendaDayFilter, setAgendaDayFilter] = useState('all')
  const [gearItems, setGearItems] = useState([]) // all gear across all guest events
  const [gearCategories, setGearCategories] = useState([]) // { event_id, name, sort_order } — controls packing list section order
  const [gearChecks, setGearChecks] = useState([]) // gear_item_ids the guest has checked
  const [infoSections, setInfoSections] = useState([]) // info sections for the currently selected event
  const [eventPartners, setEventPartners] = useState([]) // partner orgs for the currently selected event
  const [togglingGear, setTogglingGear] = useState(null)
  const [packingEvent, setPackingEvent] = useState(null) // independent event selector for packing tab
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [installBannerType, setInstallBannerType] = useState(null) // 'ios-install' | 'ios-safari' | 'ios-chrome' | 'android'
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null)
  const [isOffline, setIsOffline] = useState(false)
  const [loadedFromCache, setLoadedFromCache] = useState(false)
  const [storedToken, setStoredToken] = useState(null)
  const [loaderDone, setLoaderDone] = useState(false)
  const [loaderFading, setLoaderFading] = useState(false)
  const [logoVisible, setLogoVisible] = useState(false)
  const [dotsIndex, setDotsIndex] = useState(0)
  const [needsEmailLogin, setNeedsEmailLogin] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState(null)
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    const urlEventId = params.get('event')

    // Persist token/event to localStorage AND cookies.
    // iOS PWAs have isolated localStorage from Safari, but share cookies.
    if (urlToken) {
      localStorage.setItem('spw_guest_token', urlToken)
      setCookie('spw_guest_token', urlToken)
      if (urlEventId) {
        localStorage.setItem('spw_event_id', urlEventId)
        setCookie('spw_event_id', urlEventId)
      } else {
        localStorage.removeItem('spw_event_id')
        deleteCookie('spw_event_id')
      }
    }

    const token = urlToken || localStorage.getItem('spw_guest_token') || getCookie('spw_guest_token')
    const eventId = urlEventId || localStorage.getItem('spw_event_id') || getCookie('spw_event_id')

    // Token (from the URL, a bookmark, or a previously-stored token session)
    // always wins — preserves admin resend links, bookmarked links, and
    // staff on-site instant access.
    if (token) {
      loadData(token, eventId)
      return
    }

    // Returning email-login visitor — skip straight to their schedule.
    const storedGuestId = localStorage.getItem('spw_guest_id')
    if (storedGuestId) {
      loadDataByGuestId(storedGuestId, eventId)
      return
    }

    // No stored session — show the email entry screen.
    setLoading(false)
    setNeedsEmailLogin(true)
  }, [])

  // iOS install prompt — 30s delay, only on mobile Safari, not already installed
  useEffect(() => {
    if (localStorage.getItem('pwa-banner-dismissed')) return
    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream
    if (!isIOS) return
    if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) return
    const isMobileSafari = /Safari\//.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua)
    const isInAppBrowser = /Instagram|FBAV|FBAN|Twitter|Snapchat|TikTok|Line|MicroMessenger/.test(ua)
    const isChromeIOS = /CriOS/.test(ua)
    const t = setTimeout(() => {
      setInstallBannerType(
        isInAppBrowser || !isMobileSafari
          ? (isChromeIOS ? 'ios-chrome' : 'ios-safari')
          : 'ios-install'
      )
      setShowInstallBanner(true)
    }, 30000)
    return () => clearTimeout(t)
  }, [])

  // Android install prompt — capture beforeinstallprompt, show after 30s
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setDeferredInstallPrompt(e)
      if (!localStorage.getItem('pwa-banner-dismissed')) {
        setTimeout(() => {
          setInstallBannerType('android')
          setShowInstallBanner(true)
        }, 30000)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Offline / online detection
  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // Flush queued gear checks when connection returns
  useEffect(() => {
    if (!isOffline && guest) flushGearQueue()
  }, [isOffline, guest])

  // Logo fade-in on first render
  useEffect(() => {
    requestAnimationFrame(() => setLogoVisible(true))
  }, [])

  // Cycle dots while loader is visible
  useEffect(() => {
    if (loaderDone) return
    const interval = setInterval(() => setDotsIndex(i => (i + 1) % 3), 600)
    return () => clearInterval(interval)
  }, [loaderDone])

  // Fade out loader when data finishes loading
  useEffect(() => {
    if (!loading && !loaderDone) {
      setLoaderFading(true)
      const t = setTimeout(() => setLoaderDone(true), 200)
      return () => clearTimeout(t)
    }
  }, [loading])

  // Shared "guest row found" continuation for all three login paths (token,
  // stored guest id, email). cacheKey is the guest's own token — every login
  // method still keys the offline cache off it since that's what the guest
  // row always has, regardless of how the guest signed in this time.
  async function finishGuestLoad(guestData, eventId, cacheKey) {
    setGuest(guestData)
    setStoredToken(cacheKey)

    // Load events this guest is invited to
    const { data: guestEvents } = await supabase
      .from('guest_events')
      .select('*, events(*)')
      .eq('guest_id', guestData.id)

    const events = (guestEvents || []).map(ge => ge.events).filter(Boolean)
    setMyEvents(events)

    // Load gear items for all events this guest is invited to (all at once so the
    // packing tab can switch events without re-fetching)
    let allGear = []
    let allGearCategories = []
    if (events.length > 0) {
      const { data: gearData } = await supabase
        .from('gear_items')
        .select('id, event_id, name, category, description, link_1_label, link_1_url, link_2_label, link_2_url, is_available_to_rent, sort_order')
        .in('event_id', events.map(e => e.id))
        .in('visibility', ['guests', 'both'])
        .order('sort_order')
      allGear = gearData || []
      setGearItems(allGear)

      const { data: gearCatData } = await supabase
        .from('gear_categories')
        .select('event_id, name, sort_order')
        .in('event_id', events.map(e => e.id))
      allGearCategories = gearCatData || []
      setGearCategories(allGearCategories)
    }

    // Load all gear checks for this guest (covers every event)
    const { data: checksData } = await supabase
      .from('guest_gear_checks')
      .select('gear_item_id')
      .eq('guest_id', guestData.id)
    setGearChecks((checksData || []).map(c => c.gear_item_id))

    // Pick event — from URL param or first non-past
    const isPastEvent = (ev) => !!(ev?.end_date && ev.end_date < new Date().toISOString().slice(0, 10))

    let activeEvent = null
    if (eventId) {
      activeEvent = events.find(e => e.id === eventId && !isPastEvent(e))
        || events.find(e => e.id === eventId)
    } else {
      activeEvent = events.find(e => !isPastEvent(e) && (e.status === 'upcoming' || e.status === 'active'))
        || events.find(e => !isPastEvent(e))
    }

    if (!activeEvent) {
      setError(events.length > 0
        ? 'No upcoming events — check back soon.'
        : 'You are not registered for any events.')
      setLoading(false)
      return
    }
    setSelectedEvent(activeEvent)

    // Check registration open time
    if (activeEvent.registration_opens_at) {
      const opensDate = resolveRegistrationOpenTime(activeEvent)
      const now = new Date()
      if (now < opensDate) {
        setRegistrationOpen(false)
        setOpensAt(opensDate)
      }
    }

    // Load guest_event record for credits
    const geRecord = guestEvents?.find(ge => ge.event_id === activeEvent.id)
    setGuestEvent(geRecord || null)

    await loadEventData(guestData, activeEvent, cacheKey, {
      guest: guestData, events, guestEvent: geRecord || null,
      gearItems: allGear || [], gearCategories: allGearCategories || [], gearChecks: (checksData || []).map(c => c.gear_item_id),
      activeEventId: activeEvent.id,
    })
    setLoading(false)
  }

  async function loadData(token, eventId) {
    setLoading(true)

    // Offline fallback — restore from localStorage cache
    if (!navigator.onLine) {
      const cached = localStorage.getItem(`spw_cache_${token}`)
      if (cached) {
        try {
          const d = JSON.parse(cached)
          setGuest(d.guest)
          setMyEvents(d.events || [])
          setGuestEvent(d.guestEvent || null)
          setGearItems(d.gearItems || [])
          setGearCategories(d.gearCategories || [])
          setGearChecks(d.gearChecks || [])
          setInfoSections(d.infoSections || [])
          setEventPartners(d.eventPartners || [])
          const activeEv = (d.events || []).find(e => e.id === (eventId || d.activeEventId)) || (d.events || [])[0]
          setSelectedEvent(activeEv || null)
          setSessions(d.sessions || [])
          setWorkshops(d.workshops || [])
          setRegistrations(d.registrations || [])
          setOpenMoments(d.openMoments || [])
          setMomentSaves(d.momentSaves || [])
          setPartyCreditsUsed(d.partyCreditsUsed || 0)
          setPartyCreditsTotal(d.partyCreditsTotal || 0)
          setSessionAvailability(d.sessionAvailability || {})
          setLoadedFromCache(true)
        } catch {
          setError('Could not load cached data. Please connect to the internet.')
        }
      } else {
        setError("You're offline and there's no saved data for this page yet. Connect to load your experience.")
      }
      setLoading(false)
      return
    }

    try {
      const { data: guestData, error: guestError } = await supabase
        .from('guests')
        .select('*, ticket_types(*)')
        .eq('token', token)
        .single()

      if (guestError || !guestData) {
        setError('Invalid invite token. Please check your invitation email.')
        setLoading(false)
        return
      }
      await finishGuestLoad(guestData, eventId, token)
    } catch (err) {
      // Live fetch failed (network error, timeout, etc. — distinct from the
      // navigator.onLine check above, which only catches being fully offline).
      // Fall back to the lighter schedule-only cache so Schedule/My Agenda
      // still work.
      console.error('[loadData] fetch failed, falling back to schedule cache:', err)
      const cached = localStorage.getItem(SCHEDULE_CACHE_KEY)
      if (cached) {
        try {
          const d = JSON.parse(cached)
          setSelectedEvent(d.event || null)
          setSessions(d.sessions || [])
          setOpenMoments(d.openMoments || [])
          setRegistrations(d.registrations || [])
          setMomentSaves(d.momentSaves || [])
          setLoadedFromCache(true)
        } catch {
          setError('Could not load your schedule. Please check your connection and try again.')
        }
      } else {
        setError('Could not load your schedule. Please check your connection and try again.')
      }
      setLoading(false)
    }
  }

  // Returning email-login visitor — same flow as loadData, but looked up by
  // the guest id stashed in localStorage instead of a token.
  async function loadDataByGuestId(guestId, eventId) {
    setLoading(true)

    if (!navigator.onLine) {
      const cached = localStorage.getItem(SCHEDULE_CACHE_KEY)
      if (cached) {
        try {
          const d = JSON.parse(cached)
          setSelectedEvent(d.event || null)
          setSessions(d.sessions || [])
          setOpenMoments(d.openMoments || [])
          setRegistrations(d.registrations || [])
          setMomentSaves(d.momentSaves || [])
          setLoadedFromCache(true)
        } catch {
          setError('Could not load cached data. Please connect to the internet.')
        }
      } else {
        setError("You're offline and there's no saved data for this page yet. Connect to load your experience.")
      }
      setLoading(false)
      return
    }

    try {
      const { data: guestData, error: guestError } = await supabase
        .from('guests')
        .select('*, ticket_types(*)')
        .eq('id', guestId)
        .single()

      if (guestError || !guestData) {
        // Stale/invalid stored guest id — fall back to the email entry screen.
        localStorage.removeItem('spw_guest_id')
        localStorage.removeItem('spw_guest_email')
        setLoading(false)
        setNeedsEmailLogin(true)
        return
      }
      await finishGuestLoad(guestData, eventId, guestData.token)
    } catch (err) {
      console.error('[loadDataByGuestId] fetch failed, falling back to schedule cache:', err)
      const cached = localStorage.getItem(SCHEDULE_CACHE_KEY)
      if (cached) {
        try {
          const d = JSON.parse(cached)
          setSelectedEvent(d.event || null)
          setSessions(d.sessions || [])
          setOpenMoments(d.openMoments || [])
          setRegistrations(d.registrations || [])
          setMomentSaves(d.momentSaves || [])
          setLoadedFromCache(true)
        } catch {
          setError('Could not load your schedule. Please check your connection and try again.')
        }
      } else {
        setError('Could not load your schedule. Please check your connection and try again.')
      }
      setLoading(false)
    }
  }

  // Email entry screen — case-insensitive lookup against the guests table.
  async function loadDataByEmail(rawEmail) {
    const email = rawEmail.trim()
    if (!email) return
    setEmailError(null)
    setEmailSubmitting(true)
    try {
      const { data, error: lookupError } = await supabase
        .from('guests')
        .select('*, ticket_types(*)')
        .ilike('email', email)
        .limit(1)

      const guestData = data?.[0]
      if (lookupError || !guestData) {
        setEmailError("We couldn't find that email. Check your invitation or contact info@snowpeak.com")
        setEmailSubmitting(false)
        return
      }

      localStorage.setItem('spw_guest_id', guestData.id)
      localStorage.setItem('spw_guest_email', guestData.email)
      setNeedsEmailLogin(false)
      setEmailSubmitting(false)
      setLoading(true)
      await finishGuestLoad(guestData, null, guestData.token)
    } catch (err) {
      console.error('[loadDataByEmail] lookup failed:', err)
      setEmailError('Something went wrong. Please try again.')
      setEmailSubmitting(false)
    }
  }

  async function loadEventData(guestData, event, cacheToken = null, cacheBase = null) {
    // Credits
    const { data: creditsUsed } = await supabase
      .rpc('get_party_credits_used', { p_guest_id: guestData.id, p_event_id: event.id })
    const { data: creditsTotal } = await supabase
      .rpc('get_party_credits_total', { p_guest_id: guestData.id, p_event_id: event.id })
    setPartyCreditsUsed(creditsUsed || 0)
    setPartyCreditsTotal(creditsTotal || 0)

    // Sessions for this event
    let { data: sessionData } = await supabase
      .from('sessions')
      .select('*, workshops(*)')
      .eq('event_id', event.id)
      .order('start_time', { ascending: true })

    // Fallback for legacy sessions that pre-date the event_id column
    if (!sessionData || sessionData.length === 0) {
      const { data: legacySessions } = await supabase
        .from('sessions')
        .select('*, workshops(*)')
        .is('event_id', null)
        .order('start_time', { ascending: true })
      if (legacySessions && legacySessions.length > 0) sessionData = legacySessions
    }
    setSessions(sessionData || [])

    // Unique workshops from sessions
    const wsMap = {}
    sessionData?.forEach(s => { if (s.workshops) wsMap[s.workshop_id] = s.workshops })
    setWorkshops(Object.values(wsMap))

    // Registrations for this guest and event
    const { data: regData } = await supabase
      .from('registrations')
      .select('*, sessions(*, workshops(*))')
      .eq('guest_id', guestData.id)
      .eq('event_id', event.id)
      .neq('status', 'cancelled')
    setRegistrations(regData || [])

    // Open moments for this event
    const { data: momentsData } = await supabase
      .from('open_moments')
      .select('*')
      .eq('event_id', event.id)
      .order('date')
      .order('start_time')
    setOpenMoments(momentsData || [])

    // Moment saves for this guest
    const { data: savesData } = await supabase
      .from('guest_moment_saves')
      .select('*')
      .eq('guest_id', guestData.id)
    setMomentSaves(savesData || [])

    // Info sections for this event, ordered for the accordion
    const { data: sectionsData } = await supabase
      .from('event_info_sections')
      .select('id, event_id, title, content, icon, sort_order')
      .eq('event_id', event.id)
      .order('sort_order')
    setInfoSections(sectionsData || [])

    // Partner orgs for this event, ordered for the Guide tab
    const { data: partnersData } = await supabase
      .from('event_partners')
      .select('id, event_id, name, description, website_url, logo_url, sort_order')
      .eq('event_id', event.id)
      .order('sort_order')
    setEventPartners(partnersData || [])

    // Availability
    let availMap = {}
    if (sessionData) {
      for (const s of sessionData) {
        const { data: avail } = await supabase
          .rpc('get_session_availability', { p_session_id: s.id })
        availMap[s.id] = avail || 0
      }
      setSessionAvailability(availMap)
    }

    // Persist to localStorage so the app works offline on next visit
    if (cacheToken) {
      try {
        const { data: creditsUsed } = await supabase
          .rpc('get_party_credits_used', { p_guest_id: guestData.id, p_event_id: event.id })
        const { data: creditsTotal } = await supabase
          .rpc('get_party_credits_total', { p_guest_id: guestData.id, p_event_id: event.id })
        localStorage.setItem(`spw_cache_${cacheToken}`, JSON.stringify({
          ...(cacheBase || {}),
          sessions: sessionData || [],
          workshops: Object.values(wsMap),
          registrations: regData || [],
          openMoments: momentsData || [],
          momentSaves: savesData || [],
          infoSections: sectionsData || [],
          eventPartners: partnersData || [],
          partyCreditsUsed: creditsUsed || 0,
          partyCreditsTotal: creditsTotal || 0,
          sessionAvailability: availMap,
        }))
      } catch { /* non-fatal */ }
    }

    // Also refresh the lighter-weight schedule-only cache on every successful
    // load, not just the initial one, so switching events keeps it current.
    try {
      localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(
        buildScheduleSnapshot(event, sessionData, momentsData, regData, savesData)
      ))
    } catch { /* non-fatal */ }
  }

  function signOutGuest() {
    // Blanket sweep of every spw_-prefixed key — covers spw_guest_id,
    // spw_guest_email, spw_guest_token, spw_event_id, spw_schedule_cache,
    // spw_cache_<token>, spw_gear_queue, and any future guest-session key —
    // rather than an easy-to-miss allowlist of individually named keys.
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('spw_')) localStorage.removeItem(key)
    })
    // Cookies are the iOS-PWA fallback for token/event — must go too, or the
    // bootstrap effect will silently log the guest back in on next load.
    deleteCookie('spw_guest_token')
    deleteCookie('spw_event_id')

    // Refresh the service worker without unregistering it — keeps offline
    // support intact while making sure it isn't holding stale auth state.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(reg => reg.update())
      })
    }

    // Hard navigation, not a React state reset — guarantees a fully fresh
    // load instead of resuming from leftover in-memory state.
    window.location.href = '/'
  }

  async function switchEvent(event) {
    setSelectedEvent(event)
    setRegistrations([])
    setSessions([])
    setWorkshops([])
    setInfoSections([])
    setMessage(null)

    if (event.registration_opens_at) {
      const opensDate = resolveRegistrationOpenTime(event)
      const now = new Date()
      setRegistrationOpen(now >= opensDate)
      setOpensAt(opensDate)
    } else {
      setRegistrationOpen(true)
      setOpensAt(null)
    }

    const geRecord = await supabase
      .from('guest_events')
      .select('*')
      .eq('guest_id', guest.id)
      .eq('event_id', event.id)
      .single()
    setGuestEvent(geRecord.data || null)

    await loadEventData(guest, event)
  }

  async function refreshAll() {
    if (!guest || !selectedEvent) return
    await loadEventData(guest, selectedEvent)
  }

  function toggleSessionExpand(session) {
    setExpandedSessionId(prev => prev === session.id ? null : session.id)
    setSelectedPartySize(1)
    setMessage(null)
  }

  function collapseSession() {
    setExpandedSessionId(null)
    setSelectedPartySize(1)
  }

  async function confirmRegister() {
    const session = sessions.find(s => s.id === expandedSessionId)
    if (!guest || !session || !selectedEvent) return
    const partySize = selectedPartySize
    const creditCost = (session.workshops?.credit_cost || 1) * partySize
    collapseSession()
    setRegistering(session.id)
    setMessage(null)

    const creditsRemaining = Math.max(0, partyCreditsTotal - partyCreditsUsed)
    if (creditCost > creditsRemaining) {
      setMessage({ type: 'error', text: 'Not enough credits for that many people.' })
      setRegistering(null)
      return
    }

    const avail = sessionAvailability[session.id] || 0

    if (avail < partySize) {
      setMessage({ type: 'error', text: 'Not enough spots remaining for your group.' })
      setRegistering(null)
      return
    }

    const { error: regError } = await supabase
      .from('registrations')
      .insert({ guest_id: guest.id, session_id: session.id, event_id: selectedEvent.id, status: 'confirmed', party_size: partySize })
    if (!regError) {
      // Credits are deducted atomically by a database trigger on this insert
      // (apply_registration_credit_delta) — no client-side credits_used write here.
      setMessage({ type: 'success', text: 'Reserved ' + partySize + ' spot' + (partySize > 1 ? 's' : '') + ' successfully.' })
      await refreshAll()
    } else if (regError.message?.includes('SESSION_FULL')) {
      // Someone else took the remaining spot(s) between our last refresh and
      // this click — the database's own capacity check caught it.
      setMessage({ type: 'error', text: 'That spot was just taken by someone else — please choose another time.' })
      await refreshAll()
    } else if (regError.message?.includes('CREDITS_EXCEEDED')) {
      // Another registration from this guest (e.g. a second tab) used up the
      // remaining credits between our last refresh and this click.
      setMessage({ type: 'error', text: 'Not enough credits remaining for that many people.' })
      await refreshAll()
    } else {
      setMessage({ type: 'error', text: 'Could not register. Please try again.' })
    }
    setRegistering(null)
  }

  async function cancel(registrationId, sessionId, partySize) {
    setMessage(null)

    const session = sessions.find(s => s.id === sessionId)
    if (isSessionPast(session)) {
      setMessage({ type: 'error', text: 'This session has already happened — it can no longer be cancelled.' })
      return
    }

    const { error: delError } = await supabase
      .from('registrations')
      .delete()
      .eq('id', registrationId)

    if (delError) {
      setMessage({ type: 'error', text: 'Could not cancel. Please try again.' })
      return
    }

    // Credits are refunded atomically by a database trigger on this delete
    // (apply_registration_credit_delta) — no client-side credits_used write here.
    const creditRefund = (session?.workshops?.credit_cost || 1) * (partySize || 1)
    setMessage({ type: 'success', text: 'Spot released. ' + creditRefund + ' credit' + (creditRefund > 1 ? 's' : '') + ' returned.' })
    await refreshAll()
  }

  async function saveMoment(momentId) {
    setSavingMoment(momentId)
    await supabase.from('guest_moment_saves').insert({ guest_id: guest.id, moment_id: momentId })
    const { data } = await supabase.from('guest_moment_saves').select('*').eq('guest_id', guest.id)
    setMomentSaves(data || [])
    setSavingMoment(null)
  }

  async function unsaveMoment(momentId) {
    setSavingMoment(momentId)
    await supabase.from('guest_moment_saves').delete().eq('guest_id', guest.id).eq('moment_id', momentId)
    const { data } = await supabase.from('guest_moment_saves').select('*').eq('guest_id', guest.id)
    setMomentSaves(data || [])
    setSavingMoment(null)
  }

  function isMomentSaved(momentId) {
    return momentSaves.some(s => s.moment_id === momentId)
  }

  async function flushGearQueue() {
    const queue = JSON.parse(localStorage.getItem('spw_gear_queue') || '[]')
    if (!queue.length) return
    for (const item of queue) {
      if (item.action === 'check') {
        await supabase.from('guest_gear_checks')
          .upsert({ guest_id: item.guestId, gear_item_id: item.itemId }, { onConflict: 'guest_id,gear_item_id' })
      } else {
        await supabase.from('guest_gear_checks').delete()
          .eq('guest_id', item.guestId).eq('gear_item_id', item.itemId)
      }
    }
    localStorage.removeItem('spw_gear_queue')
  }

  async function toggleGearCheck(itemId) {
    if (!guest) return
    const isChecked = gearChecks.includes(itemId)
    setTogglingGear(itemId)
    // Optimistic update always
    if (isChecked) {
      setGearChecks(c => c.filter(id => id !== itemId))
    } else {
      setGearChecks(c => [...c, itemId])
    }
    if (isOffline) {
      // Queue for sync when back online; toggling twice cancels out
      const queue = JSON.parse(localStorage.getItem('spw_gear_queue') || '[]')
      const filtered = queue.filter(q => q.itemId !== itemId)
      filtered.push({ action: isChecked ? 'uncheck' : 'check', itemId, guestId: guest.id })
      localStorage.setItem('spw_gear_queue', JSON.stringify(filtered))
    } else {
      if (isChecked) {
        await supabase.from('guest_gear_checks').delete()
          .eq('guest_id', guest.id).eq('gear_item_id', itemId)
      } else {
        await supabase.from('guest_gear_checks').insert({ guest_id: guest.id, gear_item_id: itemId })
      }
    }
    setTogglingGear(null)
  }

  async function clearAllGearChecks(eventId) {
    if (!guest) return
    const eventItemIds = gearItems.filter(i => i.event_id === eventId).map(i => i.id)
    if (eventItemIds.length === 0) return
    setGearChecks(c => c.filter(id => !eventItemIds.includes(id)))
    await supabase.from('guest_gear_checks').delete()
      .eq('guest_id', guest.id)
      .in('gear_item_id', eventItemIds)
  }

  function formatICSDateTime(d, t) {
    return new Date(d + 'T' + t).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  function buildVEvent(dtStart, dtEnd, summary, location) {
    return ['BEGIN:VEVENT',
      'DTSTART:' + dtStart,
      'DTEND:' + dtEnd,
      'SUMMARY:' + summary,
      'LOCATION:' + (location || ''),
      'END:VEVENT']
  }

  // A single anchor/blob/click download — used for both one-event and
  // multi-event (whole-day) calendar files. Triggering several of these in a
  // tight loop (the old per-item approach for "add day to calendar") gets
  // throttled by the browser, which silently drops all but the last one —
  // so a whole day must always be bundled into one VCALENDAR with multiple
  // VEVENTs instead of one download per item.
  function downloadICS(filename, veventLines) {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...veventLines, 'END:VCALENDAR'].join('\n')
    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  function generateMomentICS(moment) {
    if (!moment?.date || !moment?.start_time) return
    const endTime = moment.end_time || moment.start_time
    const summary = moment.name + ' — ' + (selectedEvent?.name || 'Snow Peak')
    downloadICS(moment.name.replace(/\s+/g, '-') + '.ics',
      buildVEvent(formatICSDateTime(moment.date, moment.start_time), formatICSDateTime(moment.date, endTime), summary, moment.location))
  }

  function generateICS(session) {
    if (!session) return
    const name = session.workshops?.name || 'Workshop'
    const summary = name + ' — ' + (selectedEvent?.name || 'Snow Peak')
    downloadICS(name.replace(/\s+/g, '-') + '.ics',
      buildVEvent(formatICSDateTime(session.date, session.start_time), formatICSDateTime(session.date, session.end_time), summary, session.workshops?.location))
  }

  function generateDayICS(day, dayItems) {
    const veventLines = []
    dayItems.forEach(item => {
      if (item.type === 'reg') {
        const session = item.data.sessions
        if (!session?.date || !session?.start_time) return
        const name = session.workshops?.name || 'Workshop'
        veventLines.push(...buildVEvent(
          formatICSDateTime(session.date, session.start_time),
          formatICSDateTime(session.date, session.end_time),
          name + ' — ' + (selectedEvent?.name || 'Snow Peak'),
          session.workshops?.location
        ))
      } else if (item.data.date && item.data.start_time) {
        const moment = item.data
        veventLines.push(...buildVEvent(
          formatICSDateTime(moment.date, moment.start_time),
          formatICSDateTime(moment.date, moment.end_time || moment.start_time),
          moment.name + ' — ' + (selectedEvent?.name || 'Snow Peak'),
          moment.location
        ))
      }
    })
    if (veventLines.length === 0) return
    downloadICS('agenda-' + day + '.ics', veventLines)
  }

  function isRegistered(sessionId) {
    return registrations.some(r => r.session_id === sessionId && r.status === 'confirmed')
  }

  function getReg(sessionId) {
    return registrations.find(r => r.session_id === sessionId)
  }

  // Naive local-time comparison, matching how session dates/times are
  // displayed everywhere else in this file (no per-session timezone data exists).
  function isSessionPast(session) {
    if (!session?.date || !session?.start_time) return false
    return new Date(session.date + 'T' + session.start_time) <= new Date()
  }

  function formatTime(t) {
    if (!t) return ''
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return (hour % 12 || 12) + ':' + m + ' ' + (hour >= 12 ? 'PM' : 'AM')
  }

  function formatDate(d) {
    if (!d) return ''
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }

  const TIMEZONE_ABBREVIATIONS = {
    'America/New_York': 'ET',
    'America/Chicago': 'CT',
    'America/Denver': 'MT',
    'America/Los_Angeles': 'PT',
  }

  // "June 5 at 6:00 PM ET" — formatted in the event's registration_timezone
  // (not the guest's local zone) so the displayed time matches the label.
  function formatDateTime(dt, tz) {
    if (!dt) return ''
    const zone = tz || 'America/New_York'
    const date = new Date(dt)
    const datePart = date.toLocaleDateString('en-US', { timeZone: zone, month: 'long', day: 'numeric' })
    const timePart = date.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
    const abbr = TIMEZONE_ABBREVIATIONS[zone] || ''
    return datePart + ' at ' + timePart + (abbr ? ' ' + abbr : '')
  }

  const creditsRemaining = Math.max(0, partyCreditsTotal - partyCreditsUsed)
  const confirmedRegs = registrations.filter(r => r.status === 'confirmed')
  const sortKey = (date, time) => (date || '9999-99-99') + ' ' + (time || '99:99:99')

  const allDates = [...new Set([
    ...sessions.map(s => s.date).filter(Boolean),
    ...openMoments.filter(m => m.moment_type !== 'amenity').map(m => m.date).filter(Boolean)
  ])].sort()

  // Amenities repeat daily and live in the Site tab, not the Schedule tab.
  const amenityMoments = openMoments.filter(m => m.moment_type === 'amenity')
  // Mandatory All Campers moments are the only thing pre-registration guests can see —
  // workshops and drop-in moments stay hidden until registration_opens_at.
  const mandatoryMoments = openMoments.filter(m => m.moment_type === 'mandatory')
  // Forward-compatible: no `category` column exists yet, so this is always
  // empty today — the Site tab's Partners section hides itself accordingly.
  const partnerMoments = openMoments.filter(m => m.category === 'partner')

  const agendaItems = [
    ...confirmedRegs.map(r => ({ type: 'reg', data: r, key: sortKey(r.sessions?.date, r.sessions?.start_time) })),
    ...openMoments.filter(m => m.moment_type === 'mandatory').map(m => ({ type: 'mandatory', data: m, key: sortKey(m.date, m.start_time) })),
    ...openMoments.filter(m => m.moment_type === 'optional' && isMomentSaved(m.id)).map(m => ({ type: 'saved', data: m, key: sortKey(m.date, m.start_time) }))
  ].sort((a, b) => a.key.localeCompare(b.key))

  const agendaDates = [...new Set(agendaItems.map(item =>
    item.type === 'reg' ? item.data.sessions?.date : item.data.date
  ).filter(Boolean))].sort()

  function getMaxPartySize(sessionId) {
    const avail = sessionAvailability[sessionId] || 0
    const partyCap = guest?.ticket_types?.party_cap || 1
    const costPerPerson = sessions.find(s => s.id === sessionId)?.workshops?.credit_cost || 1
    return Math.max(1, Math.min(Math.floor(creditsRemaining / costPerPerson), partyCap, avail))
  }

  // "Fri" / "Sat" — used on the filter pills
  function formatDayPill(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
  }

  // "Saturday · September 19" — rendered all-caps via CSS on the day header
  function formatDayHeader(d) {
    const date = new Date(d + 'T12:00:00')
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
    const monthDay = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return weekday + ' · ' + monthDay
  }

  function DayFilterPills({ dates, value, onChange }) {
    if (dates.length === 0) return null
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {['all', ...dates].map(d => {
          const active = value === d
          return (
            <button key={d} onClick={() => onChange(d)} style={{
              padding: '5px 14px', borderRadius: 20,
              border: '0.5px solid', borderColor: active ? '#1a1a1a' : '#E8E4DE',
              background: active ? '#1a1a1a' : '#fff',
              color: active ? '#fff' : '#8C8C8C',
              fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer'
            }}>
              {d === 'all' ? 'All' : formatDayPill(d)}
            </button>
          )
        })}
      </div>
    )
  }

  if (!loaderDone) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#FAFAF8', opacity: loaderFading ? 0 : 1, transition: 'opacity 200ms ease' }}>
      <div style={{ textAlign: 'center' }}>
        <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 100, display: 'block', margin: '0 auto', opacity: logoVisible ? 1 : 0, transition: 'opacity 400ms ease' }} />
        <div style={{ marginTop: 40, fontSize: 12, letterSpacing: '0.1em', color: '#8C8C8C' }}>
          Setting up camp<span style={{ display: 'inline-block', width: '1.6em', textAlign: 'left' }}>{['.', '..', '...'][dotsIndex]}</span>
        </div>
      </div>
    </div>
  )

  if (needsEmailLogin) return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#FAFAF8', fontFamily: 'sans-serif' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
          <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 120, display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 28 }}>Snow Peak Way</div>
          <div className={playfair.className} style={{ fontSize: 22, fontWeight: 400, color: '#1a1a1a', marginBottom: 16 }}>Welcome</div>
          <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 28, lineHeight: 1.5 }}>Enter the email address used to purchase your ticket</div>
          <form onSubmit={e => { e.preventDefault(); loadDataByEmail(emailInput) }}>
            <input
              type="email"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box', padding: 12,
                borderRadius: 8, border: '0.5px solid #E8E4DE', background: '#fff',
                fontSize: 15, color: '#1a1a1a', marginBottom: 16, fontFamily: 'inherit'
              }}
            />
            {emailError && (
              <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'left', marginBottom: 16, lineHeight: 1.5 }}>
                {emailError}
              </div>
            )}
            <button
              type="submit"
              disabled={emailSubmitting || !emailInput.trim()}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: 'none',
                background: '#1a1a1a', color: '#fff', fontSize: 14, fontWeight: 500,
                cursor: emailSubmitting ? 'default' : 'pointer',
                opacity: emailSubmitting || !emailInput.trim() ? 0.6 : 1
              }}
            >
              {emailSubmitting ? 'Checking…' : 'Continue'}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <a href="/login" style={{ fontSize: 11, color: '#C8C4BC' }}>Staff or admin? Sign in here →</a>
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', padding: '20px 24px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aaa' }}>
        Snow Peak Way · snowpeak.com
      </div>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, background: '#FAFAF8' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Access Required</div>
        <div style={{ color: '#8C8C8C', lineHeight: 1.6 }}>{error}</div>
        <div style={{ marginTop: 24 }}>
          <button onClick={signOutGuest} style={{ background: 'none', border: 'none', fontSize: 11, color: '#C8C4BC', cursor: 'pointer', padding: 4 }}>
            Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  )

  if (selectedEvent?.is_archived) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, background: '#FAFAF8', color: '#1a1a1a' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 100, display: 'block', margin: '0 auto 32px' }} />
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '0.01em', marginBottom: 10 }}>Thank you for joining us.</div>
        <div style={{ fontSize: 15, color: '#1a1a1a', marginBottom: 4 }}>{selectedEvent.name}</div>
        {selectedEvent.start_date && selectedEvent.end_date && (
          <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 20 }}>
            {new Date(selectedEvent.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {'–'}
            {new Date(selectedEvent.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}
        <div style={{ fontSize: 13, color: '#8C8C8C', lineHeight: 1.6 }}>We hope to see you again soon.</div>
        <div style={{ marginTop: 28 }}>
          <button onClick={signOutGuest} style={{ background: 'none', border: 'none', fontSize: 11, color: '#C8C4BC', cursor: 'pointer', padding: 4 }}>
            Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{
      background: '#FAFAF8', minHeight: '100vh', fontFamily: 'sans-serif', color: '#1a1a1a',
      boxSizing: 'border-box', width: '100%'
    }}>
      <div style={{
        maxWidth: 680, margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box', width: '100%',
        paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom))' : 24
      }}>

        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 120, display: 'block', margin: '0 auto 28px' }} />

          {selectedEvent && (
            <>
              <div className={playfair.className} style={{ fontSize: 22, fontWeight: 400, color: '#1a1a1a' }}>
                {selectedEvent.name}
              </div>
              <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>
                {selectedEvent.location ? selectedEvent.location + ' · ' : ''}{new Date(selectedEvent.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{new Date(selectedEvent.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </>
          )}

          {myEvents.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
              {myEvents.map(ev => (
                <button key={ev.id} onClick={() => switchEvent(ev)} style={{
                  padding: '5px 14px', borderRadius: 4,
                  borderTop: '0.5px solid', borderRight: '0.5px solid', borderBottom: '0.5px solid', borderLeft: '0.5px solid',
                  borderColor: selectedEvent?.id === ev.id ? '#1a1a1a' : '#E8E4DE',
                  background: selectedEvent?.id === ev.id ? '#1a1a1a' : 'transparent',
                  color: selectedEvent?.id === ev.id ? '#fff' : '#8C8C8C',
                  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer'
                }}>
                  {ev.name}
                </button>
              ))}
            </div>
          )}

          {guest?.name && (
            <div className={playfair.className} style={{ fontSize: 18, fontWeight: 400, color: '#1a1a1a', marginTop: 14, textAlign: 'center' }}>
              {guest.name}
            </div>
          )}

          {guest?.ticket_types && !selectedEvent?.is_archived && (
            <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8C8C8C', marginTop: 8, textAlign: 'center' }}>
              {guest.ticket_types.display_name || guest.ticket_types.name}
            </div>
          )}

          {guest?.ticket_types && registrationOpen && !selectedEvent?.is_archived && (
            <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4, textAlign: 'center', color: creditsRemaining > 0 ? '#1a1a1a' : '#8C8C8C' }}>
              {creditsRemaining} credit{creditsRemaining === 1 ? '' : 's'} remaining
            </div>
          )}
          {guestEvent?.booking_summary && (
            <div style={{ fontSize: 12, color: '#8C8C8C', fontStyle: 'italic', marginTop: 2 }}>
              {guestEvent.booking_summary}
            </div>
          )}

          {guest?.name && (
            <div style={{ marginTop: 10 }}>
              <button onClick={signOutGuest} style={{ background: 'none', border: 'none', fontSize: 11, color: '#C8C4BC', cursor: 'pointer', padding: 4 }}>
                Not you? Sign out
              </button>
            </div>
          )}
        </div>

        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 4, marginBottom: 16, fontSize: 13,
            background: message.type === 'success' ? '#F0F5F0' : message.type === 'error' ? '#FDF2F2' : '#FDF8F0',
            color: message.type === 'success' ? '#2D4A2D' : message.type === 'error' ? '#c0392b' : '#5C3D1E',
            border: '0.5px solid ' + (message.type === 'success' ? '#C0D4C0' : message.type === 'error' ? '#F0C8C8' : '#E8D8BC')
          }}>
            {message.text}
          </div>
        )}

        {/* Tabs — desktop only; mobile uses the bottom nav instead */}
        {!isMobile && (
          <div className="tab-scroll" style={{
            overflowX: 'scroll',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            margin: '0 -16px',
            padding: '0 16px',
            borderBottom: '0.5px solid #e0e0e0',
            marginBottom: 24
          }}>
            <div style={{ display: 'flex', width: 'max-content', paddingBottom: 1 }}>
              {[['schedule', 'Schedule'], ['agenda', 'My Agenda'], ['site', 'Site'], ['guide', 'Guide'], ['packing', 'Packing List']].map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  flex: '0 0 auto',
                  padding: '8px 14px',
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: activeTab === tab ? '#1a1a1a' : '#8C8C8C',
                  borderBottom: activeTab === tab ? '2px solid #2D4A2D' : '2px solid transparent',
                  marginBottom: -1,
                  fontWeight: activeTab === tab ? 600 : 400
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {activeTab === 'schedule' && (
          <div style={{ paddingTop: 20 }}>

            {(isOffline || loadedFromCache) && (
              <div style={{ fontSize: 12, color: '#8C8C8C', padding: '9px 14px', marginBottom: 16, background: '#F5F2EC', borderRadius: 4, border: '0.5px solid #E8E4DE', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>○</span>
                You're offline — showing your saved schedule
              </div>
            )}

            {/* Explainer — event-editable, falls back to the default below.
                Hidden pre-registration since it references reservations/credits
                that aren't relevant until workshops are visible. */}
            {registrationOpen && (
              <div style={{ fontSize: 12, fontStyle: 'italic', color: '#8C8C8C', lineHeight: 1.5, marginBottom: 16 }}>
                {selectedEvent?.schedule_explainer || 'Workshops require a reservation and use your credits. Open activities are drop-in — just show up, or save them to your agenda.'}
              </div>
            )}

            {!registrationOpen && opensAt && (
              <div style={{ fontSize: 13, color: '#5C3D1E', background: '#F5F0E8', borderRadius: 4, padding: '10px 14px', marginBottom: 16 }}>
                🧭 Workshops will be announced and open for reservation on {formatDateTime(opensAt, selectedEvent?.registration_timezone)}
              </div>
            )}

            {!registrationOpen && mandatoryMoments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#B0ABA3' }}>
                  More to come.
                </div>
              </div>
            ) : (
              <>
              <DayFilterPills dates={allDates} value={scheduleDayFilter} onChange={setScheduleDayFilter} />

              {/* Type filter — All / Workshops / Open Moments, same pill style as day filters */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
              {[['all', 'All'], ['workshops', 'Workshops'], ['moments', 'Open Moments']].map(([key, label]) => {
                const active = scheduleTypeFilter === key
                return (
                  <button key={key} onClick={() => setScheduleTypeFilter(key)} style={{
                    padding: '5px 14px', borderRadius: 20,
                    border: '0.5px solid', borderColor: active ? '#1a1a1a' : '#E8E4DE',
                    background: active ? '#1a1a1a' : '#fff',
                    color: active ? '#fff' : '#8C8C8C',
                    fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer'
                  }}>
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Credits remaining — shown once here, not repeated per card */}
            {guest?.ticket_types && registrationOpen && !selectedEvent?.is_archived && (
              <div style={{ fontSize: 12, color: '#8C8C8C', marginBottom: 20 }}>
                {creditsRemaining} of {partyCreditsTotal} credits remaining
              </div>
            )}

            {allDates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: '#8C8C8C' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⛺</div>
                <div>No workshops scheduled yet for this event.</div>
              </div>
            ) : (() => {
              const showWorkshops = registrationOpen && (scheduleTypeFilter === 'all' || scheduleTypeFilter === 'workshops')
              const showMoments = scheduleTypeFilter === 'all' || scheduleTypeFilter === 'moments'

              /* ── Reserve / cancel panel below an expanded time slot pill ── */
              const renderSessionExpansion = session => {
                const registered = isRegistered(session.id)
                const reg = getReg(session.id)
                const avail = sessionAvailability[session.id] ?? session.capacity
                const isFull = avail === 0 && !registered
                const costPerPerson = session.workshops?.credit_cost || 1
                const canRegister = registrationOpen && creditsRemaining >= costPerPerson && !isOffline && !isFull
                const timeRange = (
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 }}>
                    {formatTime(session.start_time)} – {formatTime(session.end_time)}
                  </div>
                )

                if (registered) {
                  const sessionPast = isSessionPast(session)
                  return (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E8E4DE' }}>
                      {timeRange}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 12, color: '#8C8C8C', flex: 1 }}>
                          {reg?.party_size > 1 ? reg.party_size + ' people' : '1 person'} reserved
                        </div>
                        {sessionPast ? (
                          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8C8C8C' }}>Session complete</span>
                        ) : (
                          <>
                            <button onClick={() => generateICS(session)} style={{ fontSize: 11, padding: '5px 10px', cursor: 'pointer', border: '0.5px solid #C0D4C0', borderRadius: 4, background: '#fff', color: '#2D4A2D' }}>+ Cal</button>
                            <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{ fontSize: 11, padding: '5px 10px', cursor: 'pointer', border: '0.5px solid #E8E4DE', borderRadius: 4, background: '#fff', color: '#8C8C8C' }}>Release spot</button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E8E4DE' }}>
                    {timeRange}
                    <div style={{ fontSize: 12, marginBottom: 10, color: (avail > 0 && avail <= 5) ? '#c0392b' : '#8C8C8C' }}>
                      {isFull ? 'No spots remaining' : avail + (avail === 1 ? ' spot remaining' : ' spots remaining')}
                    </div>
                    {canRegister && (
                      <>
                        <div style={{ fontSize: 11, color: '#8C8C8C', marginBottom: 6, letterSpacing: '0.04em' }}>Party size</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                          {Array.from({ length: getMaxPartySize(session.id) }, (_, i) => i + 1).map(n => (
                            <button key={n} onClick={() => setSelectedPartySize(n)} style={{
                              width: 36, height: 36, borderRadius: 4, border: '0.5px solid',
                              borderColor: selectedPartySize === n ? '#1a1a1a' : '#E8E4DE',
                              background: selectedPartySize === n ? '#1a1a1a' : '#fff',
                              color: selectedPartySize === n ? '#fff' : '#1a1a1a',
                              fontSize: 13, fontWeight: 500, cursor: 'pointer'
                            }}>{n}</button>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: '#8C8C8C', marginBottom: 10 }}>
                          {selectedPartySize * costPerPerson} credit{selectedPartySize * costPerPerson > 1 ? 's' : ''} used
                          {costPerPerson > 1 ? ' (' + costPerPerson + ' per person)' : ''}
                          {' '}· {creditsRemaining - selectedPartySize * costPerPerson} remaining after
                        </div>
                      </>
                    )}
                    <button
                      onClick={() => canRegister && confirmRegister()}
                      disabled={registering === session.id || !canRegister}
                      style={{
                        width: '100%', padding: 10, cursor: canRegister ? 'pointer' : 'not-allowed',
                        border: '0.5px solid',
                        borderColor: canRegister ? '#2D4A2D' : '#E8E4DE',
                        borderRadius: 4,
                        background: canRegister ? '#2D4A2D' : '#F5F5F5',
                        color: canRegister ? '#fff' : '#8C8C8C',
                        fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase'
                      }}
                    >
                      {registering === session.id ? '...' :
                       isOffline ? 'Offline' :
                       !registrationOpen ? 'Not open yet' :
                       isFull ? 'Full' :
                       creditsRemaining < costPerPerson ? 'Credits used' : 'Reserve'}
                    </button>
                  </div>
                )
              }

              /* ── One time slot pill ── */
              const renderTimeSlotPill = session => {
                const registered = isRegistered(session.id)
                const avail = sessionAvailability[session.id] ?? session.capacity
                const isFull = avail === 0 && !registered
                const isExpanded = expandedSessionId === session.id

                const pillStyle = registered
                  ? { background: '#2D4A2D', border: '0.5px solid #2D4A2D', color: '#fff' }
                  : isFull
                  ? { background: '#F0EDEA', border: '0.5px solid #E8E4DE', color: '#8C8C8C' }
                  : { background: '#fff', border: '0.5px solid #1a1a1a', color: '#1a1a1a' }

                return (
                  <button key={session.id} onClick={() => toggleSessionExpand(session)} style={{
                    padding: '8px 14px', borderRadius: 20, cursor: 'pointer',
                    fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                    ...pillStyle,
                    outline: isExpanded ? '2px solid #1a1a1a' : 'none', outlineOffset: 1
                  }}>
                    {(isFull ? 'Full · ' : registered ? '✓ ' : '') + formatTime(session.start_time) + ' – ' + formatTime(session.end_time)}
                  </button>
                )
              }

              /* ── One workshop card — all its sessions as pills ── */
              const renderWorkshopCard = group => {
                const workshop = group.workshop
                const expandedSession = group.sessions.find(s => s.id === expandedSessionId)
                return (
                  <div key={group.workshopId} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ marginBottom: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#fff', background: '#2D4A2D', padding: '2px 8px', borderRadius: 4 }}>Workshop</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{workshop?.name}</div>
                    <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 3 }}>
                      {workshop?.instructor || ''}{workshop?.instructor && workshop?.location ? ' · ' : ''}{workshop?.location ? '📍 ' + workshop.location : ''}
                    </div>
                    {workshop?.credit_cost > 1 && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#9a5a18', marginTop: 6 }}>
                        {workshop.credit_cost} credits per person
                      </div>
                    )}
                    {workshop?.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 6, lineHeight: 1.5 }}>{workshop.description}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      {group.sessions.map(renderTimeSlotPill)}
                    </div>
                    {expandedSession && renderSessionExpansion(expandedSession)}
                  </div>
                )
              }

              const renderDay = (date) => {
                const daySessions = sessions.filter(s => s.date === date)
                const dayMoments = openMoments.filter(m => m.date === date && m.moment_type !== 'amenity' && (registrationOpen || m.moment_type === 'mandatory'))

                const workshopGroups = {}
                daySessions.forEach(s => {
                  if (!workshopGroups[s.workshop_id]) workshopGroups[s.workshop_id] = { workshopId: s.workshop_id, workshop: s.workshops, sessions: [] }
                  workshopGroups[s.workshop_id].sessions.push(s)
                })
                Object.values(workshopGroups).forEach(g => g.sessions.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')))

                const dayItems = [
                  ...(showWorkshops ? Object.values(workshopGroups).map(g => ({ type: 'workshop', group: g, time: g.sessions[0]?.start_time || '' })) : []),
                  ...(showMoments ? dayMoments.map(m => ({ type: m.moment_type === 'mandatory' ? 'mandatory' : 'optional', data: m, time: m.start_time || '' })) : [])
                ].sort((a, b) => (a.time || '').localeCompare(b.time || ''))

                if (dayItems.length === 0) return null

                return (
                  <div key={date} style={{ marginBottom: 8 }}>
                    {/* Day header */}
                    <div style={{ marginTop: 24, marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a' }}>
                        {formatDayHeader(date)}
                      </div>
                      <div style={{ height: '0.5px', background: '#E8E4DE', marginTop: 8 }} />
                    </div>

                    {dayItems.map(item => {

                      /* ── WORKSHOP CARD ── */
                      if (item.type === 'workshop') {
                        return renderWorkshopCard(item.group)
                      }

                      /* ── ALL CAMPERS moment (mandatory) ── */
                      /* Purely informational — these show up in My Agenda automatically, so no actions here. */
                      if (item.type === 'mandatory') {
                        const m = item.data
                        return (
                          <div key={m.id} style={{ background: '#F5F0E8', borderRadius: 4, padding: '14px 16px', marginBottom: 10, borderTop: '0.5px solid #E8D8BC', borderRight: '0.5px solid #E8D8BC', borderBottom: '0.5px solid #E8D8BC', borderLeft: '3px solid #C4A882' }}>
                            <div style={{ marginBottom: 5 }}>
                              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#5C3D1E', background: '#C4A882', padding: '2px 8px', borderRadius: 4 }}>All Campers</span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{m.name}</div>
                            <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 3 }}>
                              {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                              {m.location ? ' · 📍 ' + m.location : ''}
                            </div>
                            {m.description && <div style={{ fontSize: 11, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                          </div>
                        )
                      }

                      /* ── DROP IN moment (optional) ── */
                      const m = item.data
                      const saved = isMomentSaved(m.id)
                      return (
                        <div key={m.id} style={{ background: '#fff', borderRadius: 4, padding: '14px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: '0.5px dashed #E8E4DE', borderRight: '0.5px dashed #E8E4DE', borderBottom: '0.5px dashed #E8E4DE', borderLeft: '3px solid #B5622A' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ marginBottom: 5 }}>
                              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#5C3D1E', background: '#F5E4CC', padding: '2px 8px', borderRadius: 4 }}>Drop-in</span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{m.name}</div>
                            <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 3 }}>
                              {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                              {m.location ? ' · 📍 ' + m.location : ''}
                            </div>
                            {m.description && <div style={{ fontSize: 11, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            {saved ? (
                              <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#2D4A2D', fontWeight: 500 }}>Saved ✓</span>
                                {m.date && m.start_time && (
                                  <button onClick={() => generateMomentICS(m)} style={{ background: 'none', border: 'none', padding: 0, marginLeft: 4, fontSize: 12, color: '#8C8C8C', textDecoration: 'underline', cursor: 'pointer' }}>
                                    · Add to calendar
                                  </button>
                                )}
                              </div>
                            ) : (
                              <button onClick={() => saveMoment(m.id)} disabled={savingMoment === m.id} style={{ fontSize: 12, padding: '5px 12px', borderTop: '0.5px solid #B5622A', borderRight: '0.5px solid #B5622A', borderBottom: '0.5px solid #B5622A', borderLeft: '0.5px solid #B5622A', borderRadius: 4, background: 'transparent', color: '#B5622A', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                {savingMoment === m.id ? '...' : 'Save to agenda'}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              }

              const datesToShow = scheduleDayFilter === 'all' ? allDates : [scheduleDayFilter]
              const dayNodes = datesToShow.map(renderDay)

              if (dayNodes.every(n => n === null)) {
                return (
                  <div style={{ textAlign: 'center', padding: '3rem 0', color: '#8C8C8C' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>{scheduleTypeFilter === 'moments' ? '🌿' : '🧭'}</div>
                    <div>{scheduleTypeFilter === 'moments' ? 'No open moments for this selection.' : 'No workshops for this selection.'}</div>
                  </div>
                )
              }
              return <div>{dayNodes}</div>
            })()}
              </>
            )}
          </div>
        )}

        {/* ── MY AGENDA TAB ── */}
        {activeTab === 'agenda' && (
          <div style={{ paddingTop: 20 }}>
            {(isOffline || loadedFromCache) && (
              <div style={{ fontSize: 12, color: '#8C8C8C', padding: '9px 14px', marginBottom: 16, background: '#F5F2EC', borderRadius: 4, border: '0.5px solid #E8E4DE', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>○</span>
                You're offline — showing your saved schedule
              </div>
            )}
            {agendaItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 15, marginBottom: 8, color: '#1a1a1a' }}>Your agenda is empty</div>
                <div style={{ fontSize: 13, color: '#8C8C8C' }}>Reserve workshops or save drop-in activities from the Schedule tab</div>
              </div>
            ) : (() => {
              const datesToShow = agendaDayFilter === 'all' ? agendaDates : [agendaDayFilter]

              return (
                <div>
                  <DayFilterPills dates={agendaDates} value={agendaDayFilter} onChange={setAgendaDayFilter} />

                  {datesToShow.map(day => {
                    const dayItems = agendaItems.filter(item => {
                      const d = item.type === 'reg' ? item.data.sessions?.date : item.data.date
                      return d === day
                    })
                    if (dayItems.length === 0) return null

                    return (
                      <div key={day} style={{ marginBottom: 36 }}>
                        {/* Day header */}
                        <div style={{ marginTop: 24, marginBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a' }}>
                            {formatDayHeader(day)}
                          </div>
                          <div style={{ height: '0.5px', background: '#E8E4DE', marginTop: 8 }} />
                        </div>

                        {dayItems.map(item => {
                          /* All Campers */
                          if (item.type === 'mandatory') {
                            const m = item.data
                            return (
                              <div key={'m-' + m.id} style={{ background: '#F5F0E8', borderRadius: 4, padding: '13px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: '0.5px solid #E8D8BC', borderRight: '0.5px solid #E8D8BC', borderBottom: '0.5px solid #E8D8BC', borderLeft: '3px solid #C4A882' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5C3D1E', background: '#C4A882', padding: '2px 9px', borderRadius: 4 }}>All Campers</span>
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{m.name}</div>
                                  <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>
                                    {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                                    {m.location ? ' · 📍 ' + m.location : ''}
                                  </div>
                                </div>
                              </div>
                            )
                          }

                          /* Drop In (saved optional) */
                          if (item.type === 'saved') {
                            const m = item.data
                            return (
                              <div key={'s-' + m.id} style={{ background: '#fff', borderRadius: 4, padding: '13px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: '0.5px solid #E8E4DE', borderRight: '0.5px solid #E8E4DE', borderBottom: '0.5px solid #E8E4DE', borderLeft: '3px solid #B5622A' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5C3D1E', background: '#F5E4CC', padding: '2px 9px', borderRadius: 4 }}>Drop In</span>
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>{m.name}</div>
                                  <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>
                                    {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                                    {m.location ? ' · 📍 ' + m.location : ''}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  <button onClick={() => unsaveMoment(m.id)} disabled={savingMoment === m.id} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderTop: '0.5px solid #F0C8C8', borderRight: '0.5px solid #F0C8C8', borderBottom: '0.5px solid #F0C8C8', borderLeft: '0.5px solid #F0C8C8', borderRadius: 4, background: '#fff', color: '#c0392b' }}>Remove</button>
                                </div>
                              </div>
                            )
                          }

                          /* Workshop registration */
                          const reg = item.data
                          const past = isSessionPast(reg.sessions)
                          return (
                            <div key={reg.id} style={{
                              background: past ? '#F5F5F3' : '#EEF3EE', borderRadius: 4, padding: '13px 16px', marginBottom: 10,
                              borderTop: '0.5px solid ' + (past ? '#E0DDD7' : '#C0D4C0'),
                              borderRight: '0.5px solid ' + (past ? '#E0DDD7' : '#C0D4C0'),
                              borderBottom: '0.5px solid ' + (past ? '#E0DDD7' : '#C0D4C0'),
                              borderLeft: '3px solid ' + (past ? '#C8C4BC' : '#2D4A2D'),
                              opacity: past ? 0.7 : 1
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    {past ? (
                                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', background: '#E8E4DE', padding: '2px 9px', borderRadius: 4 }}>Complete</span>
                                    ) : (
                                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#fff', background: '#2D4A2D', padding: '2px 9px', borderRadius: 4 }}>✓ Reserved</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: past ? '#8C8C8C' : '#1a1a1a' }}>{reg.sessions?.workshops?.name}</div>
                                  <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>
                                    {formatTime(reg.sessions?.start_time)} – {formatTime(reg.sessions?.end_time)}
                                    {reg.party_size > 1 ? ' · ' + reg.party_size + ' people' : ''}
                                  </div>
                                  {reg.sessions?.workshops?.location && (
                                    <div style={{ fontSize: 11, color: '#8C8C8C', marginTop: 2 }}>📍 {reg.sessions.workshops.location}</div>
                                  )}
                                </div>
                                {!past && (
                                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    <button onClick={() => cancel(reg.id, reg.session_id, reg.party_size)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderTop: '0.5px solid #E8E4DE', borderRight: '0.5px solid #E8E4DE', borderBottom: '0.5px solid #E8E4DE', borderLeft: '0.5px solid #E8E4DE', borderRadius: 4, background: '#fff', color: '#8C8C8C' }}>Release spot</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}

                        <button onClick={() => generateDayICS(day, dayItems)} style={{ marginTop: 4, fontSize: 12, letterSpacing: '0.04em', padding: '9px 16px', cursor: 'pointer', borderTop: '0.5px solid #E8E4DE', borderRight: '0.5px solid #E8E4DE', borderBottom: '0.5px solid #E8E4DE', borderLeft: '0.5px solid #E8E4DE', borderRadius: 4, background: 'transparent', color: '#8C8C8C', width: '100%' }}>
                          + Add {new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} to calendar
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
        {/* ── PACKING TAB ── */}
        {/* ── SITE TAB ── */}
        {activeTab === 'site' && (
          <div style={{ paddingTop: 20 }}>
            {/* Section A — Map */}
            {selectedEvent?.map_image_url && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ marginTop: 24, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a' }}>Site Map</div>
                  <div style={{ height: '0.5px', background: '#E8E4DE', marginTop: 8 }} />
                </div>
                <img
                  src={selectedEvent.map_image_url}
                  alt="Event map"
                  onClick={() => setMapFullscreen(true)}
                  style={{ width: '100%', borderRadius: 4, display: 'block', border: '0.5px solid #E8E4DE', cursor: 'zoom-in' }}
                />
              </div>
            )}

            {/* Section B — Amenities & Hours */}
            {amenityMoments.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ marginTop: 24, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a' }}>Amenities &amp; Hours</div>
                  <div style={{ height: '0.5px', background: '#E8E4DE', marginTop: 8 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {amenityMoments.map(m => (
                    <div key={m.id} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', padding: '14px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{m.name}</div>
                      {m.location && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>{m.location}</div>}
                      {m.hours_text && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>{m.hours_text}</div>}
                      {m.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section C — Partners */}
            {partnerMoments.length > 0 && (
              <div>
                <div style={{ marginTop: 24, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a' }}>Partners</div>
                  <div style={{ height: '0.5px', background: '#E8E4DE', marginTop: 8 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {partnerMoments.map(m => (
                    <div key={m.id} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', padding: '14px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{m.name}</div>
                      {m.location && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>{m.location}</div>}
                      {m.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!selectedEvent?.map_image_url && amenityMoments.length === 0 && partnerMoments.length === 0 && (
              <div style={{ fontSize: 13, color: '#8C8C8C', padding: '40px 0', textAlign: 'center', letterSpacing: '0.02em' }}>
                Nothing to show here yet for this event.
              </div>
            )}

            {/* Fullscreen map overlay — tap to zoom on mobile */}
            {mapFullscreen && selectedEvent?.map_image_url && (
              <div
                onClick={() => setMapFullscreen(false)}
                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}
              >
                <img src={selectedEvent.map_image_url} alt="Event map" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
            )}
          </div>
        )}

        {/* ── GUIDE TAB ── */}
        {activeTab === 'guide' && (
          <div style={{ paddingTop: 20 }}>
            <EventInfoAccordion event={selectedEvent} sections={infoSections} partners={eventPartners} />
          </div>
        )}

        {/* ── PACKING LIST TAB ── */}
        {activeTab === 'packing' && (() => {
          const activePackingEvent = packingEvent || selectedEvent
          const eventsWithGear = myEvents.filter(ev => gearItems.some(i => i.event_id === ev.id))
          const evGear = gearItems.filter(i => i.event_id === activePackingEvent?.id)
          const checkedCount = evGear.filter(i => gearChecks.includes(i.id)).length
          const total = evGear.length
          const pct = total > 0 ? Math.round((checkedCount / total) * 100) : 0
          const categories = orderGearCategories([...new Set(evGear.map(i => i.category))], gearCategories, activePackingEvent?.id)
          return (
            <div style={{ paddingTop: 20 }}>
              {/* Per-event switcher — only shown when multiple events have gear */}
              {eventsWithGear.length > 1 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                  {eventsWithGear.map(ev => {
                    const isActive = (packingEvent || selectedEvent)?.id === ev.id
                    return (
                      <button key={ev.id} onClick={() => setPackingEvent(ev)} style={{
                        padding: '5px 14px', borderRadius: 4,
                        borderTop: '0.5px solid', borderRight: '0.5px solid',
                        borderBottom: '0.5px solid', borderLeft: '0.5px solid',
                        borderColor: isActive ? '#1a1a1a' : '#E8E4DE',
                        background: isActive ? '#1a1a1a' : 'transparent',
                        color: isActive ? '#fff' : '#8C8C8C',
                        fontSize: 12, cursor: 'pointer', letterSpacing: '0.02em'
                      }}>
                        {ev.name}
                      </button>
                    )
                  })}
                </div>
              )}

              {total === 0 ? (
                <div style={{ fontSize: 13, color: '#8C8C8C', padding: '32px 0', textAlign: 'center', letterSpacing: '0.02em' }}>
                  No packing list for this event yet.
                </div>
              ) : (
                <>
                  {/* Progress bar */}
                  <div style={{ marginBottom: 24, padding: '16px 18px', background: '#F5F2EC', borderRadius: 4, borderTop: '0.5px solid #E8E4DE', borderRight: '0.5px solid #E8E4DE', borderBottom: '0.5px solid #E8E4DE', borderLeft: '0.5px solid #E8E4DE' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.02em' }}>
                        {checkedCount === total ? 'All packed.' : checkedCount + ' of ' + total + ' items'}
                      </div>
                      <div style={{ fontSize: 11, color: '#8C8C8C', letterSpacing: '0.04em' }}>{pct}%</div>
                    </div>
                    <div style={{ background: '#E8E4DE', borderRadius: 2, height: 3 }}>
                      <div style={{ width: pct + '%', height: 3, borderRadius: 2, background: checkedCount === total ? '#2D4A2D' : '#B5622A', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>

                  {/* Categories */}
                  {categories.map(cat => {
                    const items = evGear.filter(i => i.category === cat)
                    return (
                      <div key={cat} style={{ marginBottom: 24 }}>
                        <div style={{ marginTop: 24, marginBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a' }}>{cat}</div>
                          <div style={{ height: '0.5px', background: '#E8E4DE', marginTop: 8 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {items.map(item => {
                            const checked = gearChecks.includes(item.id)
                            const busy = togglingGear === item.id
                            const hasLink1 = item.link_1_url && item.link_1_url.length > 0
                            const hasLink2 = item.link_2_url && item.link_2_url.length > 0
                            return (
                              <div key={item.id} style={{
                                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                                background: checked ? '#F7F5F2' : '#fff',
                                borderRadius: 4,
                                borderTop: '0.5px solid', borderRight: '0.5px solid',
                                borderBottom: '0.5px solid', borderLeft: '0.5px solid',
                                borderColor: '#E8E4DE',
                                transition: 'background 0.15s'
                              }}>
                                <input type="checkbox" checked={checked} onChange={() => !busy && toggleGearCheck(item.id)}
                                  style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer', accentColor: '#2D4A2D', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 14, color: checked ? '#C8C4BC' : '#1a1a1a', textDecoration: checked ? 'line-through' : 'none', lineHeight: 1.4 }}>
                                    {item.name}
                                  </div>
                                  {item.description && (
                                    <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2, lineHeight: 1.4 }}>{item.description}</div>
                                  )}
                                </div>
                                {(hasLink1 || hasLink2) && (
                                  <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center', paddingTop: 1 }}>
                                    {hasLink1 && (
                                      <a href={item.link_1_url} target="_blank" rel="noopener noreferrer"
                                        style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, border: '0.5px solid #1a1a1a', background: '#fff', color: '#1a1a1a', textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 600, letterSpacing: '0.02em' }}>
                                        {item.link_1_label || 'Learn more'}
                                      </a>
                                    )}
                                    {hasLink2 && (
                                      <a href={item.link_2_url} target="_blank" rel="noopener noreferrer"
                                        style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, border: '0.5px solid #1a1a1a', background: '#fff', color: '#1a1a1a', textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 600, letterSpacing: '0.02em' }}>
                                        {item.link_2_label || 'Learn more'}
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}

                  {/* Clear all */}
                  {checkedCount > 0 && (
                    <button onClick={() => clearAllGearChecks(activePackingEvent?.id)}
                      style={{ marginTop: 8, fontSize: 11, letterSpacing: '0.06em', padding: '10px 16px', cursor: 'pointer', borderTop: '0.5px solid #E8E4DE', borderRight: '0.5px solid #E8E4DE', borderBottom: '0.5px solid #E8E4DE', borderLeft: '0.5px solid #E8E4DE', borderRadius: 4, background: 'transparent', color: '#8C8C8C', width: '100%' }}>
                      Clear all checks
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })()}

        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button onClick={signOutGuest} style={{ background: 'none', border: 'none', fontSize: 11, color: '#C8C4BC', cursor: 'pointer', padding: 4 }}>
            Not you? Sign out
          </button>
        </div>
      </div>

      {/* Install / offline banner */}
      {showInstallBanner && (
        <div style={{
          position: 'fixed', bottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom))' : 0, left: 0, right: 0,
          background: '#FAFAF8', borderTop: '0.5px solid #E8E4DE',
          padding: '14px 16px',
          paddingBottom: isMobile ? 14 : 'calc(14px + env(safe-area-inset-bottom, 0px))',
          zIndex: 9999, display: 'flex', alignItems: 'flex-start', gap: 12,
          fontFamily: 'sans-serif'
        }}>
          <img src="/spw-logo.png" alt="" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            {installBannerType === 'ios-install' && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 3 }}>
                  Add Snow Peak Way to your home screen
                </div>
                <div style={{ fontSize: 12, color: '#8C8C8C', lineHeight: 1.5 }}>
                  Tap the <strong>Share</strong> button ⎋ then <strong>"Add to Home Screen"</strong> for offline access and the best experience.
                </div>
              </>
            )}
            {installBannerType === 'ios-safari' && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 3 }}>
                  Open in Safari to install
                </div>
                <div style={{ fontSize: 12, color: '#8C8C8C', lineHeight: 1.5, marginBottom: 8 }}>
                  Installation only works from Safari on iOS. Open this page in Safari, then tap Share ⎋ → "Add to Home Screen."
                </div>
                <div style={{ fontSize: 12, color: '#8C8C8C', lineHeight: 1.5 }}>
                  Or, <strong>bookmark this page for quick access</strong> using your browser's bookmark or favorite feature.
                </div>
              </>
            )}
            {installBannerType === 'ios-chrome' && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 3 }}>
                  Open in Safari to install
                </div>
                <div style={{ fontSize: 12, color: '#8C8C8C', lineHeight: 1.5, marginBottom: 8 }}>
                  Installation only works from Safari on iOS. Open this page in Safari, then tap Share ⎋ → "Add to Home Screen."
                </div>
                <div style={{ fontSize: 12, color: '#8C8C8C', lineHeight: 1.5 }}>
                  Or, <strong>bookmark this page for quick access</strong> — tap <strong>⋯</strong> in Chrome and choose "Add to Bookmarks."
                </div>
              </>
            )}
            {installBannerType === 'android' && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 3 }}>
                  Install the Snow Peak Way app
                </div>
                <div style={{ fontSize: 12, color: '#8C8C8C', lineHeight: 1.5, marginBottom: 8 }}>
                  Add to your home screen for offline access and a faster experience.
                </div>
                <button
                  onClick={async () => {
                    if (deferredInstallPrompt) {
                      await deferredInstallPrompt.prompt()
                      setDeferredInstallPrompt(null)
                    }
                    localStorage.setItem('pwa-banner-dismissed', '1')
                    setShowInstallBanner(false)
                  }}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 4, border: 'none', background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em' }}
                >
                  Install
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => { localStorage.setItem('pwa-banner-dismissed', '1'); setShowInstallBanner(false) }}
            style={{ background: 'none', border: 'none', fontSize: 20, color: '#C8C4BC', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0, marginTop: 1 }}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {/* Bottom nav — mobile only, replaces the top tab bar */}
      {isMobile && (
        <div style={{
          display: 'flex',
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#FAFAF8', borderTop: '0.5px solid #E8E4DE',
          paddingBottom: 'env(safe-area-inset-bottom)',
          zIndex: 100
        }}>
          {[
            ['schedule', 'Schedule', Calendar],
            ['agenda', 'My Agenda', CheckSquare],
            ['site', 'Site', MapPin],
            ['guide', 'Guide', BookOpen],
            ['packing', 'Packing List', ShoppingBag],
          ].map(([tab, label, Icon]) => {
            const active = activeTab === tab
            return (
              <button key={tab} onClick={() => { setActiveTab(tab); window.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{
                flex: 1, height: 56, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 3,
                border: 'none', background: 'none', cursor: 'pointer', padding: 0
              }}>
                <Icon size={20} strokeWidth={1.75} color={active ? '#1a1a1a' : '#AAAAAA'} />
                <span style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: active ? '#1a1a1a' : '#AAAAAA' }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}