import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/" className="flex items-center text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Dashboard
      </Link>

      <div className="card prose prose-sm max-w-none">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-6">Last updated: February 5, 2026</p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">1. Introduction</h2>
        <p className="text-gray-700 mb-4">
          This Privacy Policy describes how Financial Closeout Reconciliation ("we", "our", or "the App")
          collects, uses, and protects information when you use our service to reconcile financial data
          between Procore and QuickBooks Online.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">2. Information We Collect</h2>
        <p className="text-gray-700 mb-2">We collect the following types of information:</p>
        <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-1">
          <li><strong>Account Credentials:</strong> OAuth tokens for Procore and QuickBooks Online to access your financial data</li>
          <li><strong>Financial Data:</strong> Project information, vendors, commitments, invoices, bills, and payment data from your connected accounts</li>
          <li><strong>Usage Data:</strong> Information about how you use the App, including reconciliation reports generated</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">3. How We Use Your Information</h2>
        <p className="text-gray-700 mb-2">We use your information to:</p>
        <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-1">
          <li>Connect to your Procore and QuickBooks Online accounts</li>
          <li>Retrieve financial data necessary for reconciliation</li>
          <li>Generate reconciliation reports comparing data between systems</li>
          <li>Provide AI-assisted analysis of discrepancies</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">4. Data Storage and Security</h2>
        <p className="text-gray-700 mb-4">
          Your OAuth credentials are securely stored in our database with encryption.
          Financial data retrieved from Procore and QuickBooks is processed in real-time and
          stored only as necessary for generating reports. We implement industry-standard
          security measures to protect your data.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">5. Data Sharing</h2>
        <p className="text-gray-700 mb-4">
          We do not sell, trade, or otherwise transfer your personal or financial information
          to third parties. Your data is only used within the App for the purposes described
          in this policy.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">6. Third-Party Services</h2>
        <p className="text-gray-700 mb-2">This App integrates with:</p>
        <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-1">
          <li><strong>Procore:</strong> For construction project management data</li>
          <li><strong>QuickBooks Online:</strong> For accounting and financial data</li>
          <li><strong>OpenAI:</strong> For AI-assisted analysis (no personal data is shared)</li>
        </ul>
        <p className="text-gray-700 mb-4">
          Each of these services has their own privacy policies that govern their use of your data.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">7. Your Rights</h2>
        <p className="text-gray-700 mb-2">You have the right to:</p>
        <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-1">
          <li>Disconnect your Procore or QuickBooks accounts at any time</li>
          <li>Request deletion of your stored credentials and data</li>
          <li>Access information about what data we have collected</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">8. Data Retention</h2>
        <p className="text-gray-700 mb-4">
          We retain your OAuth credentials until you disconnect your accounts.
          Reconciliation reports may be retained for your reference.
          When you disconnect an account, the associated credentials are immediately deleted.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">9. Changes to This Policy</h2>
        <p className="text-gray-700 mb-4">
          We may update this Privacy Policy from time to time. We will notify you of any
          changes by posting the new Privacy Policy on this page and updating the
          "Last updated" date.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">10. Contact Us</h2>
        <p className="text-gray-700 mb-4">
          If you have any questions about this Privacy Policy, please contact us through
          the application support channels.
        </p>
      </div>
    </div>
  )
}
