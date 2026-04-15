"""
AI-powered analysis for financial closeout reconciliation.

Uses Claude API to provide intelligent analysis of reconciliation discrepancies,
generate executive summaries, and suggest cost code mappings.
"""

import json
import logging
import os
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from dotenv import load_dotenv

from .models import (
    AIAnalysisResult,
    AIDiscrepancyAnalysis,
    CloseoutItem,
    CloseoutReport,
    CostCode,
    CostCodeMapping,
    ProjectSummary,
    QBAccount,
    ReconciliationResult,
    RiskLevel,
    Severity,
)

load_dotenv()

logger = logging.getLogger(__name__)


class AIAnalyzerError(Exception):
    """Exception raised for AI analysis errors."""

    pass


class AIAnalyzer:
    """
    AI-powered analyzer for construction financial reconciliation.

    Uses Claude to analyze discrepancies, generate summaries, and
    provide intelligent recommendations.
    """

    DEFAULT_MODEL = "claude-sonnet-4-20250514"
    MAX_RETRIES = 3

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ):
        """
        Initialize AI analyzer.

        Args:
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
            model: Model to use (defaults to claude-sonnet-4-20250514)
        """
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.model = model or self.DEFAULT_MODEL

        if not self.api_key:
            logger.warning(
                "ANTHROPIC_API_KEY not set. AI analysis features will be disabled."
            )
            self._client = None
        else:
            try:
                import anthropic

                self._client = anthropic.Anthropic(api_key=self.api_key)
            except ImportError:
                logger.warning(
                    "anthropic package not installed. AI analysis features will be disabled."
                )
                self._client = None

    def is_available(self) -> bool:
        """Check if AI analysis is available."""
        return self._client is not None

    def _make_request(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> str:
        """
        Make a request to Claude API.

        Args:
            system_prompt: System prompt for context
            user_prompt: User message content
            max_tokens: Maximum response tokens

        Returns:
            Response text

        Raises:
            AIAnalyzerError: On API errors
        """
        if not self._client:
            raise AIAnalyzerError("AI client not initialized")

        for attempt in range(self.MAX_RETRIES):
            try:
                response = self._client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_prompt}],
                )
                return response.content[0].text
            except Exception as e:
                logger.warning(f"AI request failed (attempt {attempt + 1}): {e}")
                if attempt == self.MAX_RETRIES - 1:
                    raise AIAnalyzerError(f"AI request failed after retries: {e}")

        raise AIAnalyzerError("Unexpected error in AI request")

    def _parse_json_response(self, response_text: str) -> Any:
        """Parse JSON from AI response, handling code blocks."""
        text = response_text.strip()

        # Extract from code block if present
        if "```" in text:
            lines = text.split("\n")
            json_lines = []
            in_json = False
            for line in lines:
                if line.startswith("```json") or line.startswith("```"):
                    if in_json:
                        break
                    in_json = True
                    continue
                if in_json:
                    json_lines.append(line)
            text = "\n".join(json_lines)

        return json.loads(text)

    def analyze_discrepancies(
        self,
        reconciliation_results: list[ReconciliationResult],
        project_context: Optional[dict] = None,
    ) -> AIAnalysisResult:
        """
        Analyze reconciliation discrepancies using AI.

        Args:
            reconciliation_results: List of reconciliation results to analyze
            project_context: Optional project context information

        Returns:
            AIAnalysisResult with analyzed discrepancies
        """
        if not self.is_available():
            logger.warning("AI not available, returning empty analysis")
            return AIAnalysisResult(
                summary="AI analysis not available",
                top_priorities=[],
            )

        # Filter to discrepancies needing analysis
        discrepancies = [
            r for r in reconciliation_results
            if r.severity in (Severity.WARNING, Severity.CRITICAL)
        ]

        if not discrepancies:
            return AIAnalysisResult(
                summary="No discrepancies require analysis. All items reconciled successfully.",
                top_priorities=[],
            )

        # Prepare data for AI
        discrepancy_data = []
        for d in discrepancies:
            discrepancy_data.append({
                "id": d.id,
                "type": d.item_type,
                "description": d.item_description,
                "vendor": d.vendor,
                "procore_value": str(d.procore_value) if d.procore_value else None,
                "qb_value": str(d.qb_value) if d.qb_value else None,
                "variance": str(d.variance),
                "variance_pct": d.variance_pct,
                "severity": d.severity.value,
                "notes": d.notes,
                "cost_code": d.cost_code,
            })

        system_prompt = """You are a construction financial analyst reviewing project closeout data for a commercial buildout project. You understand CSI divisions, GC accounting, subcontractor pay applications, retention, and change order workflows.

Your role is to analyze discrepancies between Procore (project management) and QuickBooks (accounting) and provide actionable insights.

Key construction accounting concepts:
- Commitments = subcontracts and purchase orders
- Requisitions = subcontractor pay applications (invoices)
- Retention is typically 5-10% held until project completion
- CSI divisions: 03=Concrete, 05=Metals, 09=Finishes, 22=Plumbing, 23=HVAC, 26=Electrical
- Change orders (COs) modify contract values and should be approved before billing"""

        user_prompt = f"""Analyze these reconciliation discrepancies between Procore and QuickBooks:

{json.dumps(discrepancy_data, indent=2)}

For each discrepancy:
1. Assess the likely root cause
2. Rate the financial risk (low / medium / high)
3. Recommend a specific action to resolve
4. Note if this is likely a timing issue vs. a real error

Return your analysis as JSON matching this exact schema:
{{
  "discrepancies": [
    {{
      "id": "string (matching input id)",
      "likely_cause": "string (1-2 sentences)",
      "risk_level": "low" | "medium" | "high",
      "recommended_action": "string (specific actionable step)",
      "is_timing_issue": true | false,
      "estimated_resolution_effort": "low" | "medium" | "high"
    }}
  ],
  "summary": "string (2-3 sentence overall assessment)",
  "top_priorities": ["string (top 3 items to address first)"]
}}

Return ONLY valid JSON, no other text."""

        try:
            response = self._make_request(system_prompt, user_prompt)
            data = self._parse_json_response(response)

            # Parse into AIAnalysisResult
            analyses = []
            for d in data.get("discrepancies", []):
                risk_map = {
                    "low": RiskLevel.LOW,
                    "medium": RiskLevel.MEDIUM,
                    "high": RiskLevel.HIGH,
                }
                analyses.append(
                    AIDiscrepancyAnalysis(
                        id=d.get("id", ""),
                        likely_cause=d.get("likely_cause", "Unknown"),
                        risk_level=risk_map.get(d.get("risk_level", "medium"), RiskLevel.MEDIUM),
                        recommended_action=d.get("recommended_action", "Review manually"),
                        is_timing_issue=d.get("is_timing_issue", False),
                        estimated_resolution_effort=d.get("estimated_resolution_effort", "medium"),
                    )
                )

            # Calculate total exposure
            total_exposure = sum(
                abs(d.variance) for d in discrepancies
            )

            return AIAnalysisResult(
                discrepancies=analyses,
                summary=data.get("summary", "Analysis complete."),
                top_priorities=data.get("top_priorities", []),
                total_financial_exposure=total_exposure,
            )

        except Exception as e:
            logger.error(f"Failed to analyze discrepancies: {e}")
            return AIAnalysisResult(
                summary=f"AI analysis failed: {e}",
                top_priorities=[],
            )

    def generate_executive_summary(
        self,
        report: CloseoutReport,
    ) -> str:
        """
        Generate an executive summary for the closeout report.

        Args:
            report: Complete closeout report

        Returns:
            Executive summary text
        """
        if not self.is_available():
            return self._generate_fallback_summary(report)

        summary = report.project_summary

        system_prompt = """You are a construction financial analyst writing an executive summary for a project manager reviewing financial closeout status. Be concise, professional, and action-oriented. Use dollar amounts with proper formatting."""

        # Prepare metrics
        metrics = {
            "project_name": summary.project_name,
            "total_contract_value": str(summary.revised_contract_value),
            "total_committed": str(summary.total_committed),
            "total_billed_by_subs": str(summary.total_billed_by_subs),
            "total_paid_to_subs": str(summary.total_paid_to_subs),
            "sub_retention_held": str(summary.sub_retention_held),
            "reconciled_items": summary.reconciled_items,
            "warning_items": summary.warning_items,
            "critical_items": summary.critical_items,
            "open_closeout_items": summary.open_closeout_items,
            "estimated_exposure": str(summary.estimated_exposure),
        }

        # Include top closeout items
        top_items = [
            {
                "category": item.category,
                "description": item.description,
                "amount": str(item.amount_at_risk),
                "action": item.action_required,
            }
            for item in report.closeout_items[:5]
        ]

        user_prompt = f"""Write a concise executive summary of this project's financial closeout status.

PROJECT METRICS:
{json.dumps(metrics, indent=2)}

TOP OPEN ITEMS:
{json.dumps(top_items, indent=2)}

Requirements:
- Keep it to one page maximum (about 300-400 words)
- Start with a brief status assessment
- Include key financial metrics in a clear format
- List top 3 action items with owners
- End with recommended next steps
- Use professional construction industry terminology
- Format dollar amounts properly (e.g., $1,234,567.89)

Write the summary directly, no JSON wrapping needed."""

        try:
            response = self._make_request(system_prompt, user_prompt, max_tokens=1500)
            return response.strip()
        except Exception as e:
            logger.error(f"Failed to generate executive summary: {e}")
            return self._generate_fallback_summary(report)

    def _generate_fallback_summary(self, report: CloseoutReport) -> str:
        """Generate a basic summary without AI."""
        summary = report.project_summary

        return f"""FINANCIAL CLOSEOUT SUMMARY
{'-' * 40}
Project: {summary.project_name}
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}

KEY METRICS:
  Revised Contract Value:  ${summary.revised_contract_value:,.2f}
  Total Committed:         ${summary.total_committed:,.2f}
  Billed by Subcontractors: ${summary.total_billed_by_subs:,.2f}
  Paid to Subcontractors:  ${summary.total_paid_to_subs:,.2f}
  Retention Held:          ${summary.sub_retention_held:,.2f}

RECONCILIATION STATUS:
  Items Reconciled:    {summary.reconciled_items}
  Warnings:           {summary.warning_items}
  Critical Issues:    {summary.critical_items}
  Open Closeout Items: {summary.open_closeout_items}

ESTIMATED EXPOSURE: ${summary.estimated_exposure:,.2f}

TOP ACTION ITEMS:
"""  + "\n".join(
            f"  {i+1}. {item.description} (${item.amount_at_risk:,.2f})"
            for i, item in enumerate(report.closeout_items[:5])
        )

    def suggest_cost_code_mappings(
        self,
        procore_codes: list[CostCode],
        qb_accounts: list[QBAccount],
    ) -> list[CostCodeMapping]:
        """
        Use AI to suggest cost code to account mappings.

        Args:
            procore_codes: List of Procore cost codes
            qb_accounts: List of QuickBooks accounts

        Returns:
            List of suggested CostCodeMapping objects
        """
        if not self.is_available():
            logger.warning("AI not available for mapping suggestions")
            return []

        # Prepare data
        codes_data = [
            {"code": c.code, "description": c.description, "division": c.csi_division}
            for c in procore_codes
        ]

        accounts_data = [
            {"id": a.id, "name": a.name, "type": a.account_type}
            for a in qb_accounts
        ]

        system_prompt = """You are a construction accounting expert helping map Procore cost codes to QuickBooks accounts.

CSI MasterFormat divisions are the standard for organizing construction work:
- 01: General Requirements (temp facilities, cleanup)
- 03: Concrete
- 04: Masonry
- 05: Metals (structural steel)
- 06: Wood/Plastics/Composites
- 07: Thermal/Moisture Protection (roofing, insulation)
- 08: Openings (doors, windows)
- 09: Finishes (drywall, paint, flooring)
- 10-14: Specialties, Equipment, Furnishings
- 21: Fire Suppression
- 22: Plumbing
- 23: HVAC
- 26: Electrical
- 27-28: Communications/Security
- 31-33: Site work, Utilities

QuickBooks "Job Costs" accounts typically mirror these categories."""

        user_prompt = f"""Map these Procore cost codes to the most appropriate QuickBooks accounts.

PROCORE COST CODES:
{json.dumps(codes_data, indent=2)}

QUICKBOOKS ACCOUNTS:
{json.dumps(accounts_data, indent=2)}

Return mappings as JSON array:
[
  {{
    "procore_code": "03-100",
    "qb_account_id": "145",
    "confidence": 0.85,
    "reasoning": "Both refer to concrete work"
  }}
]

Only include mappings with confidence >= 0.5.
Return ONLY valid JSON array, no other text."""

        try:
            response = self._make_request(system_prompt, user_prompt)
            suggestions = self._parse_json_response(response)

            # Convert to CostCodeMapping objects
            code_dict = {c.code: c for c in procore_codes}
            account_dict = {a.id: a for a in qb_accounts}

            mappings = []
            for s in suggestions:
                code = s.get("procore_code")
                acc_id = s.get("qb_account_id")

                if code in code_dict and acc_id in account_dict:
                    c = code_dict[code]
                    a = account_dict[acc_id]

                    mappings.append(
                        CostCodeMapping(
                            procore_cost_code=c.code,
                            procore_description=c.description,
                            csi_division=c.csi_division,
                            qb_account_id=a.id,
                            qb_account_name=a.name,
                            confidence=s.get("confidence", 0.5),
                            manually_verified=False,
                            notes=s.get("reasoning"),
                        )
                    )

            logger.info(f"AI suggested {len(mappings)} cost code mappings")
            return mappings

        except Exception as e:
            logger.error(f"Failed to generate mapping suggestions: {e}")
            return []

    def analyze_closeout_items(
        self,
        items: list[CloseoutItem],
        project_summary: ProjectSummary,
    ) -> dict[str, Any]:
        """
        Analyze closeout items and provide prioritized recommendations.

        Args:
            items: List of closeout items
            project_summary: Project summary information

        Returns:
            Analysis results with prioritized recommendations
        """
        if not self.is_available():
            return {
                "priorities": [item.description for item in items[:5]],
                "summary": "AI analysis not available",
                "risk_assessment": "Unable to assess",
            }

        items_data = [
            {
                "id": item.id,
                "category": item.category,
                "description": item.description,
                "vendor": item.vendor,
                "amount": str(item.amount_at_risk),
                "action": item.action_required,
                "priority": item.priority,
            }
            for item in items
        ]

        system_prompt = """You are a construction project manager reviewing closeout items for a commercial buildout. Prioritize items by financial risk and criticality to project completion."""

        user_prompt = f"""Analyze these project closeout items and provide recommendations:

PROJECT: {project_summary.project_name}
Total Contract Value: ${project_summary.revised_contract_value:,.2f}
Open Items: {len(items)}

CLOSEOUT ITEMS:
{json.dumps(items_data, indent=2)}

Provide analysis as JSON:
{{
  "priorities": ["top 5 items to address immediately, by ID and reason"],
  "risk_assessment": "overall risk level and explanation",
  "recommended_sequence": ["suggested order to address items"],
  "estimated_days_to_close": number,
  "key_dependencies": ["items that block others"]
}}

Return ONLY valid JSON."""

        try:
            response = self._make_request(system_prompt, user_prompt)
            return self._parse_json_response(response)
        except Exception as e:
            logger.error(f"Failed to analyze closeout items: {e}")
            return {
                "priorities": [item.description for item in items[:5]],
                "summary": f"Analysis failed: {e}",
                "risk_assessment": "Unable to assess",
            }

    def enhance_report(self, report: CloseoutReport) -> CloseoutReport:
        """
        Enhance a closeout report with AI analysis.

        Args:
            report: Base closeout report

        Returns:
            Enhanced report with AI analysis
        """
        if not self.is_available():
            logger.warning("AI not available, returning report without AI enhancements")
            report.executive_summary = self._generate_fallback_summary(report)
            return report

        # Gather all reconciliation results
        all_results = (
            report.commitment_reconciliation
            + report.invoice_reconciliation
            + report.change_order_reconciliation
            + report.retention_reconciliation
            + report.budget_reconciliation
        )

        # Analyze discrepancies
        logger.info("Running AI discrepancy analysis...")
        report.ai_analysis = self.analyze_discrepancies(all_results)

        # Generate executive summary
        logger.info("Generating AI executive summary...")
        report.executive_summary = self.generate_executive_summary(report)

        return report
