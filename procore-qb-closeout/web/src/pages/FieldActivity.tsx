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
} from 'lucide-react'

/**
 * FieldActivity — single compact grid of active jobs × last 7 days.
 *
 * Each cell is a job-day intersection showing five stats stacked vertically:
 *   - Daily report (✓ green if filed, red dash if missing)
 *   - Photos uploaded
 *   - Inspections completed
 *   - Observations created
 *   - Punch items created
 *
 * Numbers link straight to the matching Procore section. No roll-up cards,
 * no per-project drill-downs — one page, one grid, scan-and-go.
 */

// ---- Types ----

interface ActiveProject {
  id: number
  name: string
  project_number?: string
  active: boolean
}

interface DiagnosticEntry {
  label: string
  path: string
  ok: boolean
  count: number
  error?: string
}

interface FieldActivityResponse {
  projectId: number
  manpowerLogs: Array<{ id: number; date: string; num_workers?: number; log_type?: string }>
  photos: Array<{ id: number; created_at: string }>
  inspections: Array<{ id: number; status: string; closed_at?: string; inspection_date?: string; updated_at?: string }>
  observations: Array<{ id: number; created_at: string }>
  punchItems: Array<{ id: number; created_at: string }>
  _diagnostics?: DiagnosticEntry[]
}

interface ProjectActivity {
  project: ActiveProject
  loading: boolean
  error?: string
  data?: FieldActivityResponse
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

function procoreLink(projectId: number, sub: string): string {
  return `https://app.procore.com/${projectId}/project/${sub}`
}

async function pmap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onResult?: (item: T, result: R) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      const r = await fn(items[i])
      results[i] = r
      onResult?.(items[i], r)
    }
  })
  await Promise.all(workers)
  return results
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

// Count how many items in the array fall on a given YYYY-MM-DD.
function countOnDay<T>(items: T[] | undefined, dateKey: (item: T) => string | undefined, day: string): number {
  if (!items) return 0
  let n = 0
  for (const item of items) {
    const raw = dateKey(item)
    if (raw && raw.slice(0, 10) === day) n++
  }
  return n
}

// ---- UI ----

const WINDOW_DAYS = 7

export default function FieldActivity() {
  const [projects, setProjects] = useState<ActiveProject[]>([])
  const [activity, setActivity] = useState<Record<number, ProjectActivity>>({})
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const days = useMemo(() => buildDateRange(WINDOW_DAYS), [])
  const startDate = days[0]
  const endDate = days[days.length - 1]

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingProjects(true)
      setError(null)
      try {
        const data = await callProcore('getActiveProjects')
        if (cancelled) return
        const projectList: ActiveProject[] = (Array.isArray(data) ? data : [])
          .map((p: any) => ({
            id: Number(p.id),
            name: p.name,
            project_number: p.project_number,
            active: p.active === true,
          }))
          .sort((a: ActiveProject, b: ActiveProject) => a.name.localeCompare(b.name))
        setProjects(projectList)
        const seed: Record<number, ProjectActivity> = {}
        for (const p of projectList) {
          seed[p.id] = { project: p, loading: true }
        }
        setActivity(seed)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load active projects')
      } finally {
        if (!cancelled) setLoadingProjects(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => {
    if (projects.length === 0) return
    let cancelled = false
    pmap(
      projects,
      4,
      async (p) => {
        try {
          const data: FieldActivityResponse = await callProcore('getFieldActivity', {
            projectId: String(p.id),
            startDate,
            endDate,
          })
          return { ok: true as const, projectId: p.id, data }
        } catch (e: any) {
          return { ok: false as const, projectId: p.id, error: e.message || 'Failed' }
        }
      },
      (p, result) => {
        if (cancelled) return
        setActivity((prev) => ({
          ...prev,
          [p.id]: result.ok
            ? { project: p, loading: false, data: result.data }
            : { project: p, loading: false, error: result.error },
        }))
      }
    )
    return () => {
      cancelled = true
    }
  }, [projects, startDate, endDate])

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

  const stillLoading = projects.filter((p) => activity[p.id]?.loading).length

  return (
    <div className="space-y-4 max-w-[1800px]">
      {/* Slim header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardHat className="w-6 h-6 text-clipper-gold-dark" />
          <h1 className="text-2xl font-bold text-clipper-black">Field</h1>
          <span className="text-sm text-gray-500 ml-2">
            {projects.length} active jobs (Course of Construction) · last 7 days
            {stillLoading > 0 && <span className="ml-2 text-clipper-gold-dark">· {stillLoading} loading…</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDiagnostics((v) => !v)}
            className="text-xs text-gray-500 hover:text-clipper-gold-dark px-3 py-1.5 rounded border border-gray-200 hover:border-clipper-gold-dark transition-colors"
            title="Show which Procore endpoints succeeded/failed for each project"
          >
            {showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics'}
          </button>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="btn btn-gold flex items-center gap-2"
            title="Refresh from Procore"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* The grid */}
      {projects.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <HardHat className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">No active projects</p>
          <p className="text-sm text-gray-500 mt-1">
            Procore returned 0 jobs flagged active.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-gray-500 py-3 px-4 sticky left-0 bg-gray-50 z-20 min-w-[200px]">
                  Job
                </th>
                {days.map((d) => {
                  const { weekday, date, isToday } = shortDay(d)
                  return (
                    <th
                      key={d}
                      className={`text-center font-medium text-xs uppercase tracking-wider py-3 px-2 min-w-[110px] ${
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
                const a = activity[p.id]
                return (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    {/* Job name cell — sticky left so the row label stays visible while scrolling. */}
                    <td className="py-3 px-4 align-top sticky left-0 bg-white hover:bg-gray-50/50 z-10 border-r border-gray-100">
                      <a
                        href={procoreLink(p.id, '')}
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
                        </div>
                        <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-clipper-gold-dark mt-0.5 flex-shrink-0" />
                      </a>
                    </td>

                    {days.map((day) => (
                      <td key={day} className="py-2 px-2 align-top">
                        <DayCell projectId={p.id} day={day} activity={a} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Diagnostics panel — shows per-endpoint success/failure for each project */}
      {showDiagnostics && (
        <div className="card text-xs space-y-3">
          <div className="font-semibold text-gray-700">Endpoint diagnostics</div>
          <div className="text-gray-500">
            Each row below shows what Procore returned for that project's six data sources. If a row says
            "0 / failed" check the path — most empty cells are caused by a 404 on the wrong API path.
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {projects.map((p) => {
              const a = activity[p.id]
              const diag = a?.data?._diagnostics
              if (!diag || diag.length === 0) return null
              // Group by label so multiple path attempts collapse together.
              const byLabel: Record<string, DiagnosticEntry[]> = {}
              for (const d of diag) {
                if (!byLabel[d.label]) byLabel[d.label] = []
                byLabel[d.label].push(d)
              }
              return (
                <div key={p.id} className="border-t border-gray-100 pt-2">
                  <div className="font-medium text-gray-700 mb-1">
                    {p.name} <span className="text-gray-400 font-normal">(#{p.id})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(byLabel).map(([label, attempts]) => {
                      const successful = attempts.find((x) => x.ok)
                      const ok = !!successful
                      return (
                        <div key={label} className="flex items-start gap-2">
                          <span className={ok ? 'text-emerald-600' : 'text-red-500'}>
                            {ok ? '✓' : '✗'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-gray-700">
                              <span className="font-medium">{label}</span>{' '}
                              <span className="text-gray-400">→</span>{' '}
                              <span className="tabular-nums">{successful?.count ?? 0}</span>
                              {!ok && <span className="text-red-500 ml-1">all paths failed</span>}
                            </div>
                            {attempts.map((att, i) => (
                              <div key={i} className="text-[10px] text-gray-400 truncate">
                                {att.ok ? '✓' : '✗'} <code>{att.path}</code>
                                {att.error && <span className="text-red-400"> — {att.error.substring(0, 80)}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Compact legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          daily report filed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3.5 h-3.5 rounded-full border border-red-300 bg-red-50" />
          no daily report
        </span>
        <span className="inline-flex items-center gap-1">
          <Camera className="w-3.5 h-3.5" /> photos
        </span>
        <span className="inline-flex items-center gap-1">
          <ClipboardCheck className="w-3.5 h-3.5" /> inspections completed
        </span>
        <span className="inline-flex items-center gap-1">
          <Eye className="w-3.5 h-3.5" /> observations
        </span>
        <span className="inline-flex items-center gap-1">
          <ListChecks className="w-3.5 h-3.5" /> punch items
        </span>
      </div>
    </div>
  )
}

// ---- Cell ----

function DayCell({
  projectId,
  day,
  activity,
}: {
  projectId: number
  day: string
  activity?: ProjectActivity
}) {
  if (!activity) return <span className="text-gray-200">—</span>
  if (activity.loading) {
    return <div className="h-4 w-4 mx-auto rounded-full bg-gray-100 animate-pulse" />
  }
  if (activity.error || !activity.data) {
    return <span className="text-red-300 text-xs" title={activity.error}>err</span>
  }

  const data = activity.data
  const reports = countOnDay(data.manpowerLogs, (m) => m.date, day)
  const photos = countOnDay(data.photos, (p) => p.created_at, day)
  const inspectionsCompleted = countOnDay(
    (data.inspections || []).filter((i) => i.status === 'closed'),
    (i) => i.closed_at || i.inspection_date || i.updated_at,
    day
  )
  const observations = countOnDay(data.observations, (o) => o.created_at, day)
  const punch = countOnDay(data.punchItems, (p) => p.created_at, day)

  const reportFiled = reports > 0
  const hasAnyActivity = reports + photos + inspectionsCompleted + observations + punch > 0

  return (
    <div className="flex flex-col items-start gap-0.5 text-xs">
      {/* Daily report status — first line, always present, color-coded. */}
      {reportFiled ? (
        <a
          href={procoreLink(projectId, 'daily_log')}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-emerald-700 hover:text-clipper-gold-dark"
          title={`${reports} daily log entr${reports === 1 ? 'y' : 'ies'}`}
        >
          <CheckCircle2 className="w-3 h-3" />
          <span>report</span>
        </a>
      ) : (
        <span className="inline-flex items-center gap-1 text-red-400" title="No daily report">
          <span className="w-3 h-3 rounded-full border border-red-300 bg-red-50" />
          <span>missing</span>
        </span>
      )}

      {/* Stats — only render rows with non-zero counts to keep cells clean. */}
      <Stat icon={Camera} count={photos} href={photos ? procoreLink(projectId, 'photos') : undefined} />
      <Stat
        icon={ClipboardCheck}
        count={inspectionsCompleted}
        href={inspectionsCompleted ? procoreLink(projectId, 'checklist/lists') : undefined}
      />
      <Stat icon={Eye} count={observations} href={observations ? procoreLink(projectId, 'observations') : undefined} />
      <Stat icon={ListChecks} count={punch} href={punch ? procoreLink(projectId, 'punch_list') : undefined} />

      {!hasAnyActivity && !reportFiled && (
        <span className="text-gray-300 text-[10px]">no activity</span>
      )}
    </div>
  )
}

function Stat({
  icon: Icon,
  count,
  href,
}: {
  icon: any
  count: number
  href?: string
}) {
  if (count === 0) return null
  const inner = (
    <span className="inline-flex items-center gap-1 text-gray-700 hover:text-clipper-gold-dark">
      <Icon className="w-3 h-3" />
      <span className="font-medium tabular-nums">{count}</span>
    </span>
  )
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    inner
  )
}
