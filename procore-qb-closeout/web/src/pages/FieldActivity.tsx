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
  XCircle,
} from 'lucide-react'

/**
 * FieldActivity
 * --------------
 * Daily snapshot of what's happening on each active Procore job.
 *
 * Data flow:
 *   1. Pull active projects via /procore-data action=getActiveProjects.
 *   2. For each project, fan out a getFieldActivity call (concurrency-limited)
 *      with a 7-day rolling window.
 *   3. Render a sortable table grouped by project, with per-day cells showing
 *      counts and drill-in links to the corresponding Procore page.
 *
 * The Netlify function deliberately returns trimmed payloads, so the per-call
 * size stays reasonable even on jobs with hundreds of photos.
 */

// ---- Types ----

interface ActiveProject {
  id: number
  name: string
  display_name?: string
  project_number?: string
  active: boolean
}

interface FieldActivityResponse {
  projectId: number
  startDate: string
  endDate: string
  manpowerLogs: Array<{ id: number; date: string; vendor_name?: string; num_workers?: number; hours?: number }>
  weatherLogs: Array<{ id: number; date: string; high_temperature?: number; low_temperature?: number; conditions?: string }>
  photos: Array<{ id: number; name: string; created_at: string; url: string; thumbnail: string }>
  inspections: Array<{ id: number; name: string; status: string; closed_at?: string; inspection_date?: string; updated_at?: string }>
  observations: Array<{ id: number; name: string; status: string; type?: string; priority?: string; created_at: string; due_date?: string }>
  punchItems: Array<{ id: number; name: string; status: string; created_at: string; due_date?: string; closed_at?: string; priority?: string }>
  counts: {
    manpowerLogs: number
    weatherLogs: number
    photos: number
    inspections: number
    inspectionsCompleted: number
    observations: number
    punchItems: number
  }
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

function dayLabel(iso: string): { weekday: string; date: string } {
  const d = new Date(iso + 'T12:00:00')
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }
}

function procoreLink(projectId: number, sub: string): string {
  return `https://app.procore.com/${projectId}/project/${sub}`
}

// Run a list of async producers with a max concurrency cap.
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

// Group items by their date field (YYYY-MM-DD), tolerating ISO timestamps.
function groupByDay<T>(items: T[], dateKey: (item: T) => string | undefined): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of items) {
    const raw = dateKey(item)
    if (!raw) continue
    const day = raw.slice(0, 10)
    if (!out[day]) out[day] = []
    out[day].push(item)
  }
  return out
}

// ---- UI ----

const WINDOW_DAYS = 7

export default function FieldActivity() {
  const [projects, setProjects] = useState<ActiveProject[]>([])
  const [activity, setActivity] = useState<Record<number, ProjectActivity>>({})
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showInactiveDays, setShowInactiveDays] = useState(false)

  const days = useMemo(() => buildDateRange(WINDOW_DAYS), [])
  const startDate = days[0]
  const endDate = days[days.length - 1]

  // Step 1: load active projects.
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
            display_name: p.display_name,
            project_number: p.project_number,
            active: p.active === true,
          }))
          .sort((a: ActiveProject, b: ActiveProject) => a.name.localeCompare(b.name))
        setProjects(projectList)

        // Seed activity map with loading state.
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

  // Step 2: when projects arrive, fan out activity calls (4 at a time).
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

  const activityList = projects.map((p) => activity[p.id]).filter(Boolean)
  const stillLoading = activityList.filter((a) => a.loading).length

  return (
    <div className="space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <HardHat className="w-6 h-6 text-clipper-gold-dark" />
            <h1 className="text-2xl font-bold text-clipper-black">Field Activity</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {projects.length} active jobs · {days[0]} to {days[days.length - 1]}
            {stillLoading > 0 && (
              <span className="ml-2 text-clipper-gold-dark">· loading {stillLoading}…</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 mr-2 select-none">
            <input
              type="checkbox"
              className="accent-clipper-gold-dark"
              checked={showInactiveDays}
              onChange={(e) => setShowInactiveDays(e.target.checked)}
            />
            Show empty days
          </label>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="btn btn-gold flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Roll-up stat cards */}
      <RollupStats activity={activityList} />

      {/* Per-project rows */}
      {activityList.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <HardHat className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">No active projects</p>
          <p className="text-sm text-gray-500 mt-1">
            Procore returned 0 jobs flagged active. Check your Procore project list.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activityList.map((a) => (
            <ProjectRow
              key={a.project.id}
              activity={a}
              days={days}
              showInactiveDays={showInactiveDays}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Subcomponents ----

function RollupStats({ activity }: { activity: ProjectActivity[] }) {
  const totals = activity.reduce(
    (acc, a) => {
      if (!a.data) return acc
      acc.manpowerLogs += a.data.counts.manpowerLogs
      acc.photos += a.data.counts.photos
      acc.inspectionsCompleted += a.data.counts.inspectionsCompleted
      acc.observations += a.data.counts.observations
      acc.punchItems += a.data.counts.punchItems
      return acc
    },
    { manpowerLogs: 0, photos: 0, inspectionsCompleted: 0, observations: 0, punchItems: 0 }
  )

  const cards = [
    { label: 'Daily reports filed', value: totals.manpowerLogs, icon: ClipboardCheck },
    { label: 'Photos uploaded', value: totals.photos, icon: Camera },
    { label: 'Inspections completed', value: totals.inspectionsCompleted, icon: CheckCircle2 },
    { label: 'Observations', value: totals.observations, icon: Eye },
    { label: 'Punch items', value: totals.punchItems, icon: ListChecks },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => {
        const Icon = c.icon
        return (
          <div key={c.label} className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{c.label}</p>
                <p className="text-2xl font-bold mt-1 text-clipper-black">{c.value}</p>
                <p className="text-xs text-gray-500 mt-1">last 7 days</p>
              </div>
              <Icon className="w-5 h-5 text-clipper-gold-dark flex-shrink-0" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProjectRow({
  activity,
  days,
  showInactiveDays,
}: {
  activity: ProjectActivity
  days: string[]
  showInactiveDays: boolean
}) {
  const { project, loading, error, data } = activity

  // Group each item type by day for fast cell lookup.
  const byDay = useMemo(() => {
    if (!data) return null
    return {
      manpower: groupByDay(data.manpowerLogs, (m) => m.date),
      photos: groupByDay(data.photos, (p) => p.created_at),
      inspections: groupByDay(data.inspections, (i) => i.closed_at || i.inspection_date || i.updated_at),
      observations: groupByDay(data.observations, (o) => o.created_at),
      punch: groupByDay(data.punchItems, (p) => p.created_at),
    }
  }, [data])

  const totalActivity = data
    ? data.counts.manpowerLogs +
      data.counts.photos +
      data.counts.inspectionsCompleted +
      data.counts.observations +
      data.counts.punchItems
    : 0

  return (
    <div className="card">
      {/* Project header */}
      <div className="flex items-start justify-between mb-3 pb-3 border-b border-gray-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {project.project_number && (
              <span className="text-xs font-medium text-gray-500">{project.project_number}</span>
            )}
            <h3 className="text-base font-semibold text-clipper-black truncate">{project.name}</h3>
            <a
              href={procoreLink(project.id, '')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-clipper-gold-dark"
              title="Open in Procore"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {data && (
            <p className="text-xs text-gray-500 mt-1">
              7-day total: {totalActivity} items ·{' '}
              {data.counts.manpowerLogs} reports ·{' '}
              {data.counts.photos} photos ·{' '}
              {data.counts.inspectionsCompleted}/{data.counts.inspections} inspections ·{' '}
              {data.counts.observations} obs ·{' '}
              {data.counts.punchItems} punch
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-clipper-gold" />
          Pulling field data…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && byDay && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-gray-500">
                <th className="text-left font-medium py-2 pr-3 w-24">Day</th>
                <th className="text-left font-medium py-2 px-3">Daily report</th>
                <th className="text-left font-medium py-2 px-3">Photos</th>
                <th className="text-left font-medium py-2 px-3">Inspections done</th>
                <th className="text-left font-medium py-2 px-3">Observations</th>
                <th className="text-left font-medium py-2 px-3">Punch items</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const manpower = byDay.manpower[day] || []
                const photos = byDay.photos[day] || []
                const inspections = (byDay.inspections[day] || []).filter((i) => i.status === 'closed')
                const observations = byDay.observations[day] || []
                const punch = byDay.punch[day] || []
                const hasAny =
                  manpower.length || photos.length || inspections.length || observations.length || punch.length
                if (!hasAny && !showInactiveDays) return null

                const { weekday, date } = dayLabel(day)
                return (
                  <tr key={day} className="border-t border-gray-100">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-xs font-medium text-gray-700">{weekday}</div>
                      <div className="text-xs text-gray-500">{date}</div>
                    </td>
                    <td className="py-2 px-3 align-top">
                      <DailyReportCell projectId={project.id} entries={manpower} />
                    </td>
                    <td className="py-2 px-3 align-top">
                      <CountCell
                        count={photos.length}
                        href={photos.length ? procoreLink(project.id, 'photos') : undefined}
                        icon={Camera}
                      />
                    </td>
                    <td className="py-2 px-3 align-top">
                      <InspectionCell projectId={project.id} entries={inspections} />
                    </td>
                    <td className="py-2 px-3 align-top">
                      <CountCell
                        count={observations.length}
                        href={observations.length ? procoreLink(project.id, 'observations') : undefined}
                        icon={Eye}
                      />
                    </td>
                    <td className="py-2 px-3 align-top">
                      <CountCell
                        count={punch.length}
                        href={punch.length ? procoreLink(project.id, 'punch_list') : undefined}
                        icon={ListChecks}
                      />
                    </td>
                  </tr>
                )
              })}
              {/* If filter is on and nothing showed up, surface a hint row. */}
              {!showInactiveDays && days.every((day) => {
                const m = (byDay!.manpower[day] || []).length
                const p = (byDay!.photos[day] || []).length
                const i = (byDay!.inspections[day] || []).filter((x) => x.status === 'closed').length
                const o = (byDay!.observations[day] || []).length
                const pu = (byDay!.punch[day] || []).length
                return m + p + i + o + pu === 0
              }) && (
                <tr className="border-t border-gray-100">
                  <td colSpan={6} className="py-3 text-xs text-gray-500 italic">
                    No field activity in the last 7 days. Toggle "Show empty days" to confirm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CountCell({
  count,
  href,
  icon: Icon,
}: {
  count: number
  href?: string
  icon: any
}) {
  if (count === 0) {
    return <span className="text-gray-300">—</span>
  }
  const inner = (
    <span className="inline-flex items-center gap-1.5 text-clipper-black hover:text-clipper-gold-dark">
      <Icon className="w-3.5 h-3.5" />
      <span className="font-medium">{count}</span>
    </span>
  )
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Open in Procore">
      {inner}
    </a>
  ) : (
    inner
  )
}

function DailyReportCell({
  projectId,
  entries,
}: {
  projectId: number
  entries: Array<{ id: number; vendor_name?: string; num_workers?: number }>
}) {
  if (entries.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-500" title="No manpower log filed">
        <XCircle className="w-3.5 h-3.5" />
        <span className="text-xs">missing</span>
      </span>
    )
  }
  const totalWorkers = entries.reduce((s, e) => s + (Number(e.num_workers) || 0), 0)
  return (
    <a
      href={procoreLink(projectId, 'daily_log')}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-clipper-gold-dark"
      title={`${entries.length} manpower entries`}
    >
      <CheckCircle2 className="w-3.5 h-3.5" />
      <span className="text-xs font-medium">
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        {totalWorkers > 0 && ` · ${totalWorkers} workers`}
      </span>
    </a>
  )
}

function InspectionCell({
  projectId,
  entries,
}: {
  projectId: number
  entries: Array<{ id: number; name: string; status: string }>
}) {
  if (entries.length === 0) {
    return <span className="text-gray-300">—</span>
  }
  return (
    <a
      href={procoreLink(projectId, 'checklist/lists')}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-clipper-black hover:text-clipper-gold-dark"
      title={entries.map((e) => e.name).join('\n')}
    >
      <ClipboardCheck className="w-3.5 h-3.5" />
      <span className="font-medium">{entries.length}</span>
    </a>
  )
}
