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
} from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * FieldActivity — daily grid of active jobs × last 7 days, backed by Supabase.
 *
 * Data flow:
 *   1. List of active projects comes from Procore live (small, single call).
 *   2. Field activity itself (daily logs, photos, inspections, observations,
 *      punch items) is read from Supabase tables — populated by the
 *      field-sync Netlify function which the user triggers manually via
 *      the "Sync from Procore" button.
 *   3. Clicking any count cell opens a modal showing the actual items
 *      from Supabase (photo thumbnails, daily-report rows, inspection
 *      titles, etc.) — no more relying on Procore's web URLs.
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

function shortDay(iso: string): { weekday: string; date: string; isToday: boolean } {
  const d = new Date(iso + 'T12:00:00')
  const today = ymd(new Date())
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    date: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    isToday: iso === today,
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

  // Per-table caches keyed by project_procore_id.
  const [dailyByProject, setDailyByProject] = useState<Record<number, DailyLogRow[]>>({})
  const [photosByProject, setPhotosByProject] = useState<Record<number, PhotoRow[]>>({})
  const [inspByProject, setInspByProject] = useState<Record<number, InspectionRow[]>>({})
  const [obsByProject, setObsByProject] = useState<Record<number, ObservationRow[]>>({})
  const [punchByProject, setPunchByProject] = useState<Record<number, PunchRow[]>>({})

  // Latest sync run per project (so we can render "synced 5m ago").
  const [latestRunByProject, setLatestRunByProject] = useState<Record<number, SyncRun | null>>({})

  // Drill-in modal state
  const [drill, setDrill] = useState<DrillTarget | null>(null)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; current?: string }>({ done: 0, total: 0 })

  const days = useMemo(() => buildDateRange(WINDOW_DAYS), [])
  const startDate = days[0]

  // ---- Load active projects from Procore ----
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

  // ---- Read field data from Supabase whenever projects change ----
  useEffect(() => {
    if (projects.length === 0) return
    let cancelled = false
    async function load() {
      const ids = projects.map((p) => p.id)

      // Pull last 7 days only for performance.
      const sinceISO = startDate

      const [dailyRes, photosRes, inspRes, obsRes, punchRes, runsRes] = await Promise.all([
        supabase.from('field_daily_logs').select('*').in('project_procore_id', ids).gte('entry_date', sinceISO).order('entry_date', { ascending: false }),
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

      // Take only the FIRST (most recent) run per project.
      const latest: Record<number, SyncRun | null> = {}
      for (const r of (runsRes.data as SyncRun[]) || []) {
        if (!(r.project_procore_id in latest)) latest[r.project_procore_id] = r
      }
      setLatestRunByProject(latest)
    }
    load()
    return () => { cancelled = true }
  }, [projects, startDate, refreshKey])

  // ---- Sync handler: walk projects sequentially, refresh when done ----
  async function handleSync() {
    if (syncing || projects.length === 0) return
    setSyncing(true)
    setSyncProgress({ done: 0, total: projects.length })
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]
      setSyncProgress({ done: i, total: projects.length, current: p.name })
      try {
        await syncProject(p.id)
      } catch (e) {
        console.warn(`Sync failed for project ${p.id}:`, e)
        // Continue with the rest — partial syncs are still useful.
      }
    }
    setSyncProgress({ done: projects.length, total: projects.length })
    setSyncing(false)
    // Reload from Supabase to pick up the new rows.
    setRefreshKey((k) => k + 1)
  }

  // ---- Render ----

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

  // Find the most recent sync time across all projects, for the header label.
  const mostRecentSync = Object.values(latestRunByProject).reduce<string | null>((acc, r) => {
    if (!r) return acc
    const t = r.finished_at || r.started_at
    if (!acc || (t && t > acc)) return t
    return acc
  }, null)

  return (
    <div className="space-y-4 max-w-[1800px]">
      {/* Slim header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardHat className="w-6 h-6 text-clipper-gold-dark" />
          <h1 className="text-2xl font-bold text-clipper-black">Field</h1>
          <span className="text-sm text-gray-500 ml-2">
            {projects.length} active jobs (Course of Construction) · last 7 days
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            Last sync: <span className="font-medium text-gray-700">{relTime(mostRecentSync)}</span>
          </span>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn btn-gold flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
            title="Pull fresh data from Procore into Supabase"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? `Syncing… ${syncProgress.done}/${syncProgress.total}${syncProgress.current ? ` (${syncProgress.current.substring(0, 24)})` : ''}`
              : 'Sync from Procore'}
          </button>
        </div>
      </div>

      {/* Grid */}
      {projects.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <HardHat className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">No active projects</p>
          <p className="text-sm text-gray-500 mt-1">
            Procore returned 0 jobs in Course of Construction.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-gray-500 py-3 px-4 sticky left-0 bg-gray-50 z-20 min-w-[220px]">
                  Job
                </th>
                {days.map((d) => {
                  const { weekday, date, isToday } = shortDay(d)
                  return (
                    <th
                      key={d}
                      className={`text-center font-medium text-xs uppercase tracking-wider py-3 px-2 min-w-[120px] ${
                        isToday ? 'text-clipper-gold-dark' : 'text-gray-500'
                      }`}
                    >
                      <div>{weekday}</div>
                      <div className="text-[10px] font-normal">{date}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const run = latestRunByProject[p.id]
                return (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="py-3 px-4 align-top sticky left-0 bg-white hover:bg-gray-50/50 z-10 border-r border-gray-100">
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
                          <div className="text-sm font-medium text-clipper-black group-hover:text-clipper-gold-dark leading-tight">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            synced {relTime(run?.finished_at || run?.started_at || null)}
                          </div>
                        </div>
                        <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-clipper-gold-dark mt-0.5 flex-shrink-0" />
                      </a>
                    </td>
                    {days.map((day) => (
                      <td key={day} className="py-2 px-2 align-top">
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
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          daily report filed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3.5 h-3.5 rounded-full border border-red-300 bg-red-50" />
          no daily report
        </span>
        <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> photos</span>
        <span className="inline-flex items-center gap-1"><ClipboardCheck className="w-3.5 h-3.5" /> inspections completed</span>
        <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> observations</span>
        <span className="inline-flex items-center gap-1"><ListChecks className="w-3.5 h-3.5" /> punch items</span>
        <span className="ml-auto text-gray-400 italic">click any number to view items</span>
      </div>

      {/* Drill-in modal */}
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

function onDay(raw: string | null | undefined, day: string): boolean {
  if (!raw) return false
  return String(raw).slice(0, 10) === day
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

  return (
    <div className="flex flex-col items-start gap-0.5 text-xs">
      {reportFiled ? (
        <button
          onClick={() => open('reports')}
          className="inline-flex items-center gap-1 text-emerald-700 hover:text-clipper-gold-dark"
          title={`${dailyToday.length} daily log entries`}
        >
          <CheckCircle2 className="w-3 h-3" />
          <span>report</span>
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 text-red-400" title="No daily report">
          <span className="w-3 h-3 rounded-full border border-red-300 bg-red-50" />
          <span>missing</span>
        </span>
      )}
      <Stat icon={Camera} count={photosToday.length} onClick={() => open('photos')} />
      <Stat icon={ClipboardCheck} count={inspectionsClosedToday.length} onClick={() => open('inspections')} />
      <Stat icon={Eye} count={observationsToday.length} onClick={() => open('observations')} />
      <Stat icon={ListChecks} count={punchToday.length} onClick={() => open('punch')} />
    </div>
  )
}

function Stat({ icon: Icon, count, onClick }: { icon: any; count: number; onClick: () => void }) {
  if (count === 0) return null
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-gray-700 hover:text-clipper-gold-dark"
    >
      <Icon className="w-3 h-3" />
      <span className="font-medium tabular-nums">{count}</span>
    </button>
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
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500">{titles[target.kind]}</div>
            <div className="text-base font-semibold text-clipper-black">{target.projectName}</div>
            <div className="text-xs text-gray-500">{target.day}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
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
