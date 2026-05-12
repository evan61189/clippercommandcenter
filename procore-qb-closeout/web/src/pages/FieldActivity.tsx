import { useEffect, useMemo, useState } from 'react'
import {
  HardHat,
  ClipboardCheck,
  Camera,
  Eye,
  ListChecks,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  X,
  Search,
  ChevronDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * FieldActivity — daily grid of active jobs × last 7 days, backed by Supabase.
 *
 * Redesign goals:
 *  - One-line pill cells: status icon on left, count chips on right.
 *  - Today column visually distinct (subtle gold band).
 *  - Search + sort controls above the grid.
 *  - Less visual noise overall — softer borders, tighter spacing,
 *    consistent muted color for zero-state items.
 *
 * Data flow stays the same: active projects from Procore live; field
 * activity from Supabase; modal drill-ins read from the in-memory cache.
 */

// ---- Types ----

interface ActiveProject {
  id: number
  name: string
  project_number?: string
}

interface DailyLogRow {
  id: string
  procore_id: number
  project_procore_id: number
  log_type: string
  entry_date: string
  vendor_name: string | null
  num_workers: number | null
  hours: number | null
  notes: string | null
}

interface PhotoRow {
  id: string
  procore_id: number
  project_procore_id: number
  name: string | null
  taken_at: string | null
  procore_created_at: string | null
  url: string | null
  thumbnail_url: string | null
}

interface InspectionRow {
  id: string
  procore_id: number
  project_procore_id: number
  name: string | null
  status: string | null
  inspection_date: string | null
  closed_at: string | null
  procore_updated_at: string | null
}

interface ObservationRow {
  id: string
  procore_id: number
  project_procore_id: number
  name: string | null
  status: string | null
  type_name: string | null
  priority: string | null
  procore_created_at: string | null
  due_date: string | null
}

interface PunchRow {
  id: string
  procore_id: number
  project_procore_id: number
  name: string | null
  status: string | null
  priority: string | null
  procore_created_at: string | null
  due_date: string | null
  closed_at: string | null
}

interface SyncRun {
  id: string
  project_procore_id: number
  started_at: string
  finished_at: string | null
  status: string
  daily_logs_count: number | null
  photos_count: number | null
  inspections_count: number | null
  observations_count: number | null
  punch_items_count: number | null
  error_message: string | null
}

type DataKind = 'reports' | 'photos' | 'inspections' | 'observations' | 'punch'
type SortMode = 'alpha' | 'most_active' | 'missing_today'

interface DrillTarget {
  projectId: number
  projectName: string
  day: string
  kind: DataKind
}

// ---- Helpers ----

function getUserId(): string {
  let userId = localStorage.getItem('closeout_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('closeout_user_id', userId)
  }
  return userId
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function buildDateRange(days: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push(ymd(d))
  }
  return out
}

function shortDay(iso: string): { weekday: string; date: string; isToday: boolean; isWeekend: boolean } {
  const d = new Date(iso + 'T12:00:00')
  const today = ymd(new Date())
  const wd = d.getDay()
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    date: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    isToday: iso === today,
    isWeekend: wd === 0 || wd === 6,
  }
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function onDay(raw: string | null | undefined, day: string): boolean {
  if (!raw) return false
  return String(raw).slice(0, 10) === day
}

async function callProcore(action: string, body: Record<string, any> = {}) {
  const userId = getUserId()
  const res = await fetch('/.netlify/functions/procore-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId, ...body }),
  })
  const text = await res.text()
  let parsed: any = {}
  try { parsed = JSON.parse(text) } catch { /* keep raw */ }
  if (!res.ok) {
    throw new Error(parsed?.error || `Procore call failed (${res.status})`)
  }
  return parsed
}

async function syncProject(projectId: number) {
  const userId = getUserId()
  const res = await fetch('/.netlify/functions/field-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, projectId }),
  })
  const text = await res.text()
  let parsed: any = {}
  try { parsed = JSON.parse(text) } catch { /* keep raw */ }
  if (!res.ok) throw new Error(parsed?.error || `Sync failed (${res.status})`)
  return parsed
}

// ---- UI ----

const WINDOW_DAYS = 7

export default function FieldActivity() {
  const [projects, setProjects] = useState<ActiveProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [dailyByProject, setDailyByProject] = useState<Record<number, DailyLogRow[]>>({})
  const [photosByProject, setPhotosByProject] = useState<Record<number, PhotoRow[]>>({})
  const [inspByProject, setInspByProject] = useState<Record<number, InspectionRow[]>>({})
  const [obsByProject, setObsByProject] = useState<Record<number, ObservationRow[]>>({})
  const [punchByProject, setPunchByProject] = useState<Record<number, PunchRow[]>>({})
  const [latestRunByProject, setLatestRunByProject] = useState<Record<number, SyncRun | null>>({})

  const [drill, setDrill] = useState<DrillTarget | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; current?: string }>({ done: 0, total: 0 })

  // New controls
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem('field_sort_mode') as SortMode) || 'alpha'
  })

  useEffect(() => {
    localStorage.setItem('field_sort_mode', sortMode)
  }, [sortMode])

  const days = useMemo(() => buildDateRange(WINDOW_DAYS), [])
  const startDate = days[0]
  const today = days[days.length - 1]

  // Load active projects
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingProjects(true)
      setError(null)
      try {
        const data = await callProcore('getActiveProjects')
        if (cancelled) return
        const projectList: ActiveProject[] = (Array.isArray(data) ? data : [])
          .map((p: any) => ({ id: Number(p.id), name: p.name, project_number: p.project_number }))
          .sort((a: ActiveProject, b: ActiveProject) => a.name.localeCompare(b.name))
        setProjects(projectList)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load active projects')
      } finally {
        if (!cancelled) setLoadingProjects(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [refreshKey])

  // Read field data from Supabase
  useEffect(() => {
    if (projects.length === 0) return
    let cancelled = false
    async function load() {
      const ids = projects.map((p) => p.id)
      const [dailyRes, photosRes, inspRes, obsRes, punchRes, runsRes] = await Promise.all([
        supabase.from('field_daily_logs').select('*').in('project_procore_id', ids).gte('entry_date', startDate).order('entry_date', { ascending: false }),
        supabase.from('field_photos').select('*').in('project_procore_id', ids).order('procore_created_at', { ascending: false }).limit(2000),
        supabase.from('field_inspections').select('*').in('project_procore_id', ids).order('procore_updated_at', { ascending: false }).limit(2000),
        supabase.from('field_observations').select('*').in('project_procore_id', ids).order('procore_created_at', { ascending: false }).limit(2000),
        supabase.from('field_punch_items').select('*').in('project_procore_id', ids).order('procore_created_at', { ascending: false }).limit(2000),
        supabase.from('field_sync_runs').select('*').in('project_procore_id', ids).order('started_at', { ascending: false }),
      ])
      if (cancelled) return
      const groupBy = <T extends { project_procore_id: number }>(rows: T[]): Record<number, T[]> => {
        const out: Record<number, T[]> = {}
        for (const row of rows || []) {
          if (!out[row.project_procore_id]) out[row.project_procore_id] = []
          out[row.project_procore_id].push(row)
        }
        return out
      }
      setDailyByProject(groupBy<DailyLogRow>((dailyRes.data as DailyLogRow[]) || []))
      setPhotosByProject(groupBy<PhotoRow>((photosRes.data as PhotoRow[]) || []))
      setInspByProject(groupBy<InspectionRow>((inspRes.data as InspectionRow[]) || []))
      setObsByProject(groupBy<ObservationRow>((obsRes.data as ObservationRow[]) || []))
      setPunchByProject(groupBy<PunchRow>((punchRes.data as PunchRow[]) || []))
      const latest: Record<number, SyncRun | null> = {}
      for (const r of (runsRes.data as SyncRun[]) || []) {
        if (!(r.project_procore_id in latest)) latest[r.project_procore_id] = r
      }
      setLatestRunByProject(latest)
    }
    load()
    return () => { cancelled = true }
  }, [projects, startDate, refreshKey])

  // Sync handler
  async function handleSync() {
    if (syncing || projects.length === 0) return
    setSyncing(true)
    setSyncProgress({ done: 0, total: projects.length })
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]
      setSyncProgress({ done: i, total: projects.length, current: p.name })
      try { await syncProject(p.id) } catch (e) { console.warn(`Sync failed for ${p.id}:`, e) }
    }
    setSyncProgress({ done: projects.length, total: projects.length })
    setSyncing(false)
    setRefreshKey((k) => k + 1)
  }

  // Compute activity totals + filtering + sorting (memoized)
  const orderedProjects = useMemo(() => {
    // Per-project activity totals over the 7-day window.
    const activityByProject: Record<number, { weekTotal: number; reportToday: boolean }> = {}
    for (const p of projects) {
      const daily = dailyByProject[p.id] || []
      const photos = (photosByProject[p.id] || []).filter((r) => {
        const d = (r.taken_at || r.procore_created_at || '').slice(0, 10)
        return d >= startDate
      })
      const insp = (inspByProject[p.id] || []).filter((r) => {
        if (r.status !== 'closed') return false
        const d = (r.closed_at || r.procore_updated_at || r.inspection_date || '').slice(0, 10)
        return d >= startDate
      })
      const obs = (obsByProject[p.id] || []).filter((r) => (r.procore_created_at || '').slice(0, 10) >= startDate)
      const punch = (punchByProject[p.id] || []).filter((r) => (r.procore_created_at || '').slice(0, 10) >= startDate)
      activityByProject[p.id] = {
        weekTotal: daily.length + photos.length + insp.length + obs.length + punch.length,
        reportToday: daily.some((r) => r.entry_date === today),
      }
    }

    const term = search.trim().toLowerCase()
    const filtered = term
      ? projects.filter((p) =>
          p.name.toLowerCase().includes(term) || (p.project_number || '').toLowerCase().includes(term)
        )
      : projects

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'most_active') {
        const ax = activityByProject[a.id]?.weekTotal || 0
        const bx = activityByProject[b.id]?.weekTotal || 0
        if (ax !== bx) return bx - ax
        return a.name.localeCompare(b.name)
      }
      if (sortMode === 'missing_today') {
        // Projects missing today's report first; tie-break by name.
        const aM = !activityByProject[a.id]?.reportToday
        const bM = !activityByProject[b.id]?.reportToday
        if (aM !== bM) return aM ? -1 : 1
        return a.name.localeCompare(b.name)
      }
      return a.name.localeCompare(b.name)
    })

    return { sorted, activityByProject }
  }, [projects, search, sortMode, dailyByProject, photosByProject, inspByProject, obsByProject, punchByProject, startDate, today])

  if (loadingProjects) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card max-w-2xl">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="font-semibold text-gray-900">Couldn't load Procore</h2>
            <p className="text-sm text-gray-600 mt-1">{error}</p>
            <p className="text-sm text-gray-500 mt-2">
              Check that Procore is connected in <a className="text-clipper-gold-dark underline" href="/settings">Settings</a>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const mostRecentSync = Object.values(latestRunByProject).reduce<string | null>((acc, r) => {
    if (!r) return acc
    const t = r.finished_at || r.started_at
    if (!acc || (t && t > acc)) return t
    return acc
  }, null)

  // Headline counts for the small stats strip
  const summary = projects.reduce(
    (acc, p) => {
      const a = orderedProjects.activityByProject[p.id]
      if (a?.reportToday) acc.reportedToday++
      acc.weekTotal += a?.weekTotal || 0
      return acc
    },
    { reportedToday: 0, weekTotal: 0 }
  )

  return (
    <div className="space-y-5 max-w-[1800px]">
      {/* Header — title left, sync state right */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-clipper-gold/10 flex items-center justify-center">
            <HardHat className="w-5 h-5 text-clipper-gold-dark" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-clipper-black leading-tight">Field</h1>
            <p className="text-xs text-gray-500">
              {projects.length} active jobs · {summary.reportedToday}/{projects.length} reported today · last 7 days
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden sm:block">
            Last sync <span className="font-medium text-gray-700">{relTime(mostRecentSync)}</span>
          </span>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn btn-gold flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? `Syncing ${syncProgress.done}/${syncProgress.total}`
              : 'Sync from Procore'}
          </button>
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs by name or number…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-clipper-gold/30 focus:border-clipper-gold"
          />
        </div>
        <SortDropdown sortMode={sortMode} setSortMode={setSortMode} />
        <span className="ml-auto text-xs text-gray-400">
          {orderedProjects.sorted.length === projects.length
            ? `${projects.length} jobs`
            : `${orderedProjects.sorted.length} of ${projects.length} jobs`}
        </span>
      </div>

      {/* Grid */}
      {orderedProjects.sorted.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12">
          <HardHat className="w-10 h-10 text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-700">
            {projects.length === 0 ? 'No active projects' : 'No jobs match your search'}
          </p>
          {projects.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">Procore returned 0 jobs in an active stage.</p>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left font-medium text-[11px] uppercase tracking-wider text-gray-500 py-2.5 px-4 sticky left-0 bg-gray-50 z-20 min-w-[220px]">
                  Job
                </th>
                {days.map((d) => {
                  const { weekday, date, isToday, isWeekend } = shortDay(d)
                  return (
                    <th
                      key={d}
                      className={`text-center font-medium text-[11px] uppercase tracking-wider py-2.5 px-2 min-w-[136px] ${
                        isToday ? 'bg-clipper-gold/5 text-clipper-gold-dark' : isWeekend ? 'text-gray-400' : 'text-gray-500'
                      }`}
                    >
                      <div>{weekday}</div>
                      <div className="text-[10px] font-normal opacity-80">{date}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {orderedProjects.sorted.map((p) => {
                const run = latestRunByProject[p.id]
                const act = orderedProjects.activityByProject[p.id]
                return (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="py-2.5 px-4 align-middle sticky left-0 bg-white hover:bg-gray-50/60 z-10 border-r border-gray-100">
                      <a
                        href={`https://app.procore.com/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-start gap-1.5"
                      >
                        <div className="min-w-0">
                          {p.project_number && (
                            <div className="text-[10px] font-medium text-gray-400 leading-tight">
                              {p.project_number}
                            </div>
                          )}
                          <div className="text-sm font-medium text-clipper-black group-hover:text-clipper-gold-dark leading-snug">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {act?.weekTotal ?? 0} items · synced {relTime(run?.finished_at || run?.started_at || null)}
                          </div>
                        </div>
                        <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-clipper-gold-dark mt-0.5 flex-shrink-0" />
                      </a>
                    </td>
                    {days.map((day) => {
                      const { isToday } = shortDay(day)
                      return (
                        <td
                          key={day}
                          className={`py-2 px-2 align-middle ${isToday ? 'bg-clipper-gold/[0.04]' : ''}`}
                        >
                          <DayCell
                            projectId={p.id}
                            projectName={p.name}
                            day={day}
                            daily={dailyByProject[p.id] || []}
                            photos={photosByProject[p.id] || []}
                            inspections={inspByProject[p.id] || []}
                            observations={obsByProject[p.id] || []}
                            punch={punchByProject[p.id] || []}
                            onDrill={setDrill}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend — quiet, single row */}
      <div className="flex items-center gap-x-5 gap-y-1 text-[11px] text-gray-400 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> daily report filed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full border border-red-300 bg-red-50" /> no report
        </span>
        <span className="inline-flex items-center gap-1"><Camera className="w-3 h-3" /> photos</span>
        <span className="inline-flex items-center gap-1"><ClipboardCheck className="w-3 h-3" /> inspections completed</span>
        <span className="inline-flex items-center gap-1"><Eye className="w-3 h-3" /> observations</span>
        <span className="inline-flex items-center gap-1"><ListChecks className="w-3 h-3" /> punch items</span>
        <span className="ml-auto italic">click any chip to drill in</span>
      </div>

      {drill && (
        <DrillModal
          target={drill}
          onClose={() => setDrill(null)}
          daily={(dailyByProject[drill.projectId] || []).filter((r) => r.entry_date === drill.day)}
          photos={(photosByProject[drill.projectId] || []).filter((r) => onDay(r.taken_at || r.procore_created_at, drill.day))}
          inspections={(inspByProject[drill.projectId] || []).filter((r) => r.status === 'closed' && onDay(r.closed_at || r.procore_updated_at || r.inspection_date, drill.day))}
          observations={(obsByProject[drill.projectId] || []).filter((r) => onDay(r.procore_created_at, drill.day))}
          punch={(punchByProject[drill.projectId] || []).filter((r) => onDay(r.procore_created_at, drill.day))}
        />
      )}
    </div>
  )
}

// ---- Day cell ----

function DayCell({
  projectId,
  projectName,
  day,
  daily,
  photos,
  inspections,
  observations,
  punch,
  onDrill,
}: {
  projectId: number
  projectName: string
  day: string
  daily: DailyLogRow[]
  photos: PhotoRow[]
  inspections: InspectionRow[]
  observations: ObservationRow[]
  punch: PunchRow[]
  onDrill: (t: DrillTarget) => void
}) {
  const dailyToday = daily.filter((r) => r.entry_date === day)
  const photosToday = photos.filter((r) => onDay(r.taken_at || r.procore_created_at, day))
  const inspectionsClosedToday = inspections.filter((r) => r.status === 'closed' && onDay(r.closed_at || r.procore_updated_at || r.inspection_date, day))
  const observationsToday = observations.filter((r) => onDay(r.procore_created_at, day))
  const punchToday = punch.filter((r) => onDay(r.procore_created_at, day))

  const reportFiled = dailyToday.length > 0
  const open = (kind: DataKind) => onDrill({ projectId, projectName, day, kind })

  // Single-row layout: status pill on left, count chips on right.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Status pill */}
      {reportFiled ? (
        <button
          onClick={() => open('reports')}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium hover:bg-emerald-100 transition-colors"
          title={`${dailyToday.length} log entr${dailyToday.length === 1 ? 'y' : 'ies'}`}
        >
          <CheckCircle2 className="w-3 h-3" />
          report
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-[11px] font-medium opacity-80"
          title="No daily log filed"
        >
          <span className="w-2 h-2 rounded-full bg-red-300" />
          missing
        </span>
      )}

      {/* Count chips — only render if non-zero, keeps cell quiet on empty days */}
      <CountChip icon={Camera} count={photosToday.length} label="photos" onClick={() => open('photos')} />
      <CountChip icon={ClipboardCheck} count={inspectionsClosedToday.length} label="inspections" onClick={() => open('inspections')} />
      <CountChip icon={Eye} count={observationsToday.length} label="observations" onClick={() => open('observations')} />
      <CountChip icon={ListChecks} count={punchToday.length} label="punch" onClick={() => open('punch')} />
    </div>
  )
}

function CountChip({
  icon: Icon,
  count,
  label,
  onClick,
}: {
  icon: any
  count: number
  label: string
  onClick: () => void
}) {
  if (count === 0) return null
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-700 hover:bg-clipper-gold/10 hover:text-clipper-gold-dark transition-colors"
      title={`${count} ${label}`}
    >
      <Icon className="w-3 h-3" />
      <span className="font-medium tabular-nums">{count}</span>
    </button>
  )
}

// ---- Sort dropdown ----

function SortDropdown({ sortMode, setSortMode }: { sortMode: SortMode; setSortMode: (s: SortMode) => void }) {
  const labels: Record<SortMode, string> = {
    alpha: 'Alphabetical',
    most_active: 'Most active this week',
    missing_today: 'Missing report today first',
  }
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-md hover:border-gray-300 transition-colors"
      >
        <span className="text-gray-500 text-xs">Sort:</span> {labels[sortMode]}
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 min-w-[220px] bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          {(Object.keys(labels) as SortMode[]).map((mode) => (
            <button
              key={mode}
              onMouseDown={() => { setSortMode(mode); setOpen(false) }}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                sortMode === mode ? 'text-clipper-gold-dark font-medium' : 'text-gray-700'
              }`}
            >
              {labels[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Drill modal ----

function DrillModal({
  target,
  onClose,
  daily,
  photos,
  inspections,
  observations,
  punch,
}: {
  target: DrillTarget
  onClose: () => void
  daily: DailyLogRow[]
  photos: PhotoRow[]
  inspections: InspectionRow[]
  observations: ObservationRow[]
  punch: PunchRow[]
}) {
  const titles: Record<DataKind, string> = {
    reports: 'Daily reports',
    photos: 'Photos',
    inspections: 'Completed inspections',
    observations: 'Observations',
    punch: 'Punch items',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{titles[target.kind]}</div>
            <div className="text-base font-semibold text-clipper-black leading-snug">{target.projectName}</div>
            <div className="text-xs text-gray-500">
              {new Date(target.day + 'T12:00:00').toLocaleDateString(undefined, {
                weekday: 'long', month: 'long', day: 'numeric',
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-1 -m-1 rounded hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {target.kind === 'reports' && <ReportsView rows={daily} />}
          {target.kind === 'photos' && <PhotosView rows={photos} />}
          {target.kind === 'inspections' && <InspectionsView rows={inspections} projectId={target.projectId} />}
          {target.kind === 'observations' && <ObservationsView rows={observations} projectId={target.projectId} />}
          {target.kind === 'punch' && <PunchView rows={punch} projectId={target.projectId} />}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return <div className="text-sm text-gray-500 italic py-8 text-center">{msg}</div>
}

function ReportsView({ rows }: { rows: DailyLogRow[] }) {
  if (rows.length === 0) return <EmptyState msg="No daily log entries for this day." />
  const manpower = rows.filter((r) => r.log_type === 'manpower_logs')
  const notes = rows.filter((r) => r.log_type === 'notes_logs')
  const other = rows.filter((r) => r.log_type !== 'manpower_logs' && r.log_type !== 'notes_logs')

  return (
    <div className="space-y-5">
      {manpower.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Manpower</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="text-left py-1.5 pr-3 font-medium">Vendor</th>
                <th className="text-right py-1.5 px-3 font-medium">Workers</th>
                <th className="text-right py-1.5 pl-3 font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {manpower.map((m) => (
                <tr key={m.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3 text-gray-900">{m.vendor_name || '—'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{m.num_workers ?? '—'}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{m.hours ?? '—'}</td>
                </tr>
              ))}
              <tr className="font-semibold text-gray-700">
                <td className="py-1.5 pr-3">Total</td>
                <td className="py-1.5 px-3 text-right tabular-nums">
                  {manpower.reduce((s, m) => s + (Number(m.num_workers) || 0), 0)}
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums">
                  {manpower.reduce((s, m) => s + (Number(m.hours) || 0), 0).toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Notes</div>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="text-sm text-gray-800 whitespace-pre-wrap border border-gray-100 rounded p-3 bg-gray-50">
                {n.notes || <span className="italic text-gray-400">No content</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {other.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Other entries</div>
          <ul className="space-y-1.5 text-sm">
            {other.map((o) => (
              <li key={o.id} className="text-gray-700">
                <span className="text-xs text-gray-400 mr-2">{o.log_type.replace(/_logs$/, '')}</span>
                {o.notes || o.vendor_name || `entry #${o.procore_id}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function PhotosView({ rows }: { rows: PhotoRow[] }) {
  if (rows.length === 0) return <EmptyState msg="No photos uploaded this day." />
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {rows.map((p) => (
        <a
          key={p.id}
          href={p.url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="group block"
          title={p.name || 'photo'}
        >
          <div className="aspect-square bg-gray-100 rounded overflow-hidden border border-gray-200 group-hover:border-clipper-gold-dark transition-colors">
            {p.thumbnail_url ? (
              <img src={p.thumbnail_url} alt={p.name || ''} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300">
                <Camera className="w-8 h-8" />
              </div>
            )}
          </div>
          {p.name && (
            <div className="text-[10px] text-gray-500 mt-1 truncate group-hover:text-clipper-gold-dark">{p.name}</div>
          )}
        </a>
      ))}
    </div>
  )
}

function InspectionsView({ rows, projectId }: { rows: InspectionRow[]; projectId: number }) {
  if (rows.length === 0) return <EmptyState msg="No inspections completed this day." />
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((i) => (
        <li key={i.id} className="py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-clipper-black">{i.name || `Inspection #${i.procore_id}`}</div>
            <div className="text-xs text-gray-500">
              {i.status} · closed {i.closed_at ? new Date(i.closed_at).toLocaleString() : '—'}
            </div>
          </div>
          <a
            href={`https://app.procore.com/${projectId}/project/checklist/lists/${i.procore_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-clipper-gold-dark inline-flex items-center gap-1"
            title="Open in Procore"
          >
            Procore <ExternalLink className="w-3 h-3" />
          </a>
        </li>
      ))}
    </ul>
  )
}

function ObservationsView({ rows, projectId }: { rows: ObservationRow[]; projectId: number }) {
  if (rows.length === 0) return <EmptyState msg="No observations on this day." />
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((o) => (
        <li key={o.id} className="py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-clipper-black">{o.name || `Observation #${o.procore_id}`}</div>
            <div className="text-xs text-gray-500">
              {o.type_name && <span>{o.type_name} · </span>}
              {o.status} · {o.priority || 'no priority'}
              {o.due_date && <> · due {o.due_date}</>}
            </div>
          </div>
          <a
            href={`https://app.procore.com/${projectId}/project/observations/items/${o.procore_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-clipper-gold-dark inline-flex items-center gap-1"
          >
            Procore <ExternalLink className="w-3 h-3" />
          </a>
        </li>
      ))}
    </ul>
  )
}

function PunchView({ rows, projectId }: { rows: PunchRow[]; projectId: number }) {
  if (rows.length === 0) return <EmptyState msg="No punch items added this day." />
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((p) => (
        <li key={p.id} className="py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-clipper-black">{p.name || `Punch #${p.procore_id}`}</div>
            <div className="text-xs text-gray-500">
              {p.status} · {p.priority || 'no priority'}
              {p.due_date && <> · due {p.due_date}</>}
            </div>
          </div>
          <a
            href={`https://app.procore.com/${projectId}/project/punch_list/${p.procore_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-clipper-gold-dark inline-flex items-center gap-1"
          >
            Procore <ExternalLink className="w-3 h-3" />
          </a>
        </li>
      ))}
    </ul>
  )
}
