import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle,
  AlertCircle,
  Clock,
  Filter,
  Building2,
} from 'lucide-react'
import {
  getAllOpenCloseoutItems,
  updateCloseoutItemStatus,
  type CloseoutItem,
} from '../lib/supabase'
import {
  formatCurrency,
  formatDate,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
} from '../lib/utils'

export default function CloseoutItems() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const { data: items, isLoading } = useQuery({
    queryKey: ['all-closeout-items'],
    queryFn: getAllOpenCloseoutItems,
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: CloseoutItem['status']
    }) => updateCloseoutItemStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-closeout-items'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
      </div>
    )
  }

  // Get unique categories
  const categories = [...new Set(items?.map((i: any) => i.category) || [])]

  // Filter items
  let filteredItems = items || []
  if (statusFilter !== 'all') {
    filteredItems = filteredItems.filter((i: any) => i.status === statusFilter)
  }
  if (categoryFilter !== 'all') {
    filteredItems = filteredItems.filter((i: any) => i.category === categoryFilter)
  }

  // Calculate totals
  const totalAtRisk = filteredItems.reduce(
    (sum: number, i: any) => sum + (i.amount_at_risk || 0),
    0
  )

  const statusCounts = {
    open: items?.filter((i: any) => i.status === 'open').length || 0,
    in_progress: items?.filter((i: any) => i.status === 'in_progress').length || 0,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Closeout Items</h1>
        <p className="mt-1 text-sm text-gray-500">
          All open action items across projects requiring attention for closeout
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card flex items-center justify-between">
          <div className="flex items-center">
            <div className="bg-red-100 rounded-lg p-3 mr-4">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Open</p>
              <p className="text-xl font-semibold text-red-600">
                {statusCounts.open}
              </p>
            </div>
          </div>
        </div>
        <div className="card flex items-center justify-between">
          <div className="flex items-center">
            <div className="bg-yellow-100 rounded-lg p-3 mr-4">
              <Clock className="w-6 h-6 text-yellow-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">In Progress</p>
              <p className="text-xl font-semibold text-yellow-600">
                {statusCounts.in_progress}
              </p>
            </div>
          </div>
        </div>
        <div className="card flex items-center justify-between">
          <div className="flex items-center">
            <div className="bg-red-100 rounded-lg p-3 mr-4">
              <span className="text-xl font-bold text-red-500">$</span>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total at Risk</p>
              <p className="text-xl font-semibold text-red-600">
                {formatCurrency(totalAtRisk)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center space-x-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <div>
            <label className="text-sm text-gray-500 mr-2">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border-gray-300 rounded-md text-sm"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500 mr-2">Category:</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border-gray-300 rounded-md text-sm"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {(cat as string).replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Items List */}
      {filteredItems.length === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">All Clear!</h3>
          <p className="text-gray-500 mt-1">
            No open closeout items matching your filters.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item: any) => (
            <div key={item.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <span
                      className={`badge ${getPriorityColor(item.priority)}`}
                    >
                      {getPriorityLabel(item.priority)}
                    </span>
                    <span className="text-sm text-gray-500">
                      {item.category.replace(/_/g, ' ')}
                    </span>
                    {item.reconciliation_reports?.projects && (
                      <Link
                        to={`/project/${item.reconciliation_reports.projects.id}`}
                        className="flex items-center text-sm text-procore-blue hover:underline"
                      >
                        <Building2 className="w-4 h-4 mr-1" />
                        {item.reconciliation_reports.projects.name}
                      </Link>
                    )}
                  </div>

                  <h3 className="font-medium text-gray-900">
                    {item.description}
                  </h3>

                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    {item.vendor && (
                      <span>Vendor: {item.vendor}</span>
                    )}
                    {item.responsible_party && (
                      <span>Owner: {item.responsible_party}</span>
                    )}
                    {item.due_date && (
                      <span>Due: {formatDate(item.due_date)}</span>
                    )}
                  </div>

                  {item.action_required && (
                    <p className="mt-2 text-sm text-gray-600">
                      <strong>Action:</strong> {item.action_required}
                    </p>
                  )}
                </div>

                <div className="text-right ml-4">
                  <p className="text-lg font-semibold text-red-600">
                    {formatCurrency(item.amount_at_risk)}
                  </p>
                  <div className="mt-2">
                    <select
                      value={item.status}
                      onChange={(e) =>
                        updateMutation.mutate({
                          id: item.id,
                          status: e.target.value as CloseoutItem['status'],
                        })
                      }
                      className={`text-sm rounded-md border-0 ${getStatusColor(
                        item.status
                      )}`}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
