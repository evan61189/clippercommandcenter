import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/" className="flex items-center text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Dashboard
      </Link>

      <div className="card prose prose-sm max-w-none">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">End-User License Agreement (EULA)</h1>
        <p className="text-sm text-gray-500 mb-6">Last updated: February 5, 2026</p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">1. Agreement to Terms</h2>
        <p className="text-gray-700 mb-4">
          By accessing or using Financial Closeout Reconciliation ("the App"), you agree to be bound
          by these Terms of Service and our Privacy Policy. If you do not agree to these terms,
          do not use the App.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">2. Description of Service</h2>
        <p className="text-gray-700 mb-4">
          The App provides financial reconciliation services between Procore (construction project
          management) and QuickBooks Online (accounting software). The App retrieves data from both
          systems, compares financial records, and generates reconciliation reports with AI-assisted
          analysis.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">3. User Responsibilities</h2>
        <p className="text-gray-700 mb-2">You agree to:</p>
        <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-1">
          <li>Provide accurate account credentials for Procore and QuickBooks Online</li>
          <li>Ensure you have proper authorization to access the connected accounts</li>
          <li>Use the App only for lawful business purposes</li>
          <li>Review reconciliation results and not rely solely on automated analysis</li>
          <li>Maintain the confidentiality of your account access</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">4. Account Authorization</h2>
        <p className="text-gray-700 mb-4">
          By connecting your Procore and QuickBooks Online accounts, you authorize the App to
          access, retrieve, and process financial data from these accounts for the purpose of
          generating reconciliation reports. This authorization can be revoked at any time by
          disconnecting your accounts in the Settings page.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">5. Disclaimer of Warranties</h2>
        <p className="text-gray-700 mb-4">
          THE APP IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. WE DO NOT GUARANTEE THAT
          THE APP WILL BE ERROR-FREE, UNINTERRUPTED, OR THAT RECONCILIATION RESULTS WILL BE
          100% ACCURATE. THE APP IS A TOOL TO ASSIST WITH RECONCILIATION AND SHOULD NOT REPLACE
          PROFESSIONAL ACCOUNTING JUDGMENT.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">6. Limitation of Liability</h2>
        <p className="text-gray-700 mb-4">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO
          LOSS OF PROFITS, DATA, OR BUSINESS OPPORTUNITIES, ARISING FROM YOUR USE OF THE APP.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">7. Data Accuracy</h2>
        <p className="text-gray-700 mb-4">
          The App retrieves data from Procore and QuickBooks Online as provided by those services.
          We are not responsible for the accuracy of data in your source systems. Reconciliation
          results are based on the data available at the time of processing.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">8. AI-Assisted Analysis</h2>
        <p className="text-gray-700 mb-4">
          The App uses artificial intelligence to provide analysis and recommendations.
          AI-generated content is provided for informational purposes only and should be
          reviewed by qualified personnel before making business decisions.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">9. Intellectual Property</h2>
        <p className="text-gray-700 mb-4">
          The App and its original content, features, and functionality are owned by us and
          are protected by copyright, trademark, and other intellectual property laws.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">10. Termination</h2>
        <p className="text-gray-700 mb-4">
          We may terminate or suspend your access to the App at any time, without prior notice,
          for conduct that we believe violates these Terms or is harmful to other users, us,
          or third parties.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">11. Changes to Terms</h2>
        <p className="text-gray-700 mb-4">
          We reserve the right to modify these Terms at any time. We will provide notice of
          significant changes by posting the new Terms on this page. Your continued use of the
          App after such modifications constitutes acceptance of the updated Terms.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">12. Governing Law</h2>
        <p className="text-gray-700 mb-4">
          These Terms shall be governed by and construed in accordance with applicable laws,
          without regard to conflict of law principles.
        </p>

        <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">13. Contact</h2>
        <p className="text-gray-700 mb-4">
          For questions about these Terms, please contact us through the application support channels.
        </p>
      </div>
    </div>
  )
}
