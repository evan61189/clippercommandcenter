/**
 * Format a number as USD currency
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Format a number as percentage
 */
export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${value.toFixed(1)}%`
}

/**
 * Format a date string
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format a date/time string
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Get severity color class
 */
export function getSeverityColor(severity: string | null | undefined): string {
  if (!severity) return 'text-gray-600 bg-gray-100'
  switch (severity.toLowerCase()) {
    case 'info':
      return 'text-green-600 bg-green-100'
    case 'warning':
      return 'text-yellow-700 bg-yellow-100'
    case 'critical':
      return 'text-red-700 bg-red-100'
    default:
      return 'text-gray-600 bg-gray-100'
  }
}

/**
 * Get severity display text (Phase 7: "info" -> "Reconciled")
 */
export function getSeverityText(severity: string | null | undefined): string {
  if (!severity) return 'Unknown'
  switch (severity.toLowerCase()) {
    case 'info':
      return 'Reconciled'
    case 'warning':
      return 'Warning'
    case 'critical':
      return 'Critical'
    default:
      return severity || 'Unknown'
  }
}

/**
 * Get status color class
 */
export function getStatusColor(status: string | null | undefined): string {
  if (!status) return 'text-gray-600 bg-gray-100'
  switch (status.toLowerCase()) {
    case 'open':
      return 'text-red-600 bg-red-100'
    case 'in_progress':
      return 'text-yellow-700 bg-yellow-100'
    case 'resolved':
      return 'text-green-600 bg-green-100'
    default:
      return 'text-gray-600 bg-gray-100'
  }
}

/**
 * Get priority label
 */
export function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return 'Critical'
    case 2:
      return 'High'
    case 3:
      return 'Medium'
    case 4:
      return 'Low'
    case 5:
      return 'Minimal'
    default:
      return 'Unknown'
  }
}

/**
 * Get priority color
 */
export function getPriorityColor(priority: number): string {
  switch (priority) {
    case 1:
      return 'text-red-700 bg-red-100'
    case 2:
      return 'text-orange-700 bg-orange-100'
    case 3:
      return 'text-yellow-700 bg-yellow-100'
    case 4:
      return 'text-blue-700 bg-blue-100'
    case 5:
      return 'text-gray-600 bg-gray-100'
    default:
      return 'text-gray-600 bg-gray-100'
  }
}

/**
 * Truncate text to specified length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}
