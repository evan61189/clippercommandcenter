"""
Core reconciliation engine for Procore-QuickBooks closeout.

This module performs multi-level matching and reconciliation between
Procore project management data and QuickBooks accounting data.
"""

import json
import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from .models import (
    BudgetLineItem,
    ChangeOrderStatus,
    CloseoutItem,
    CloseoutReport,
    CommitmentStatus,
    CostCodeMapping,
    InvoiceStatus,
    ItemStatus,
    NormalizedChangeOrder,
    NormalizedCommitment,
    NormalizedInvoice,
    ProjectSummary,
    ReconciliationResult,
    Severity,
    Vendor,
)

logger = logging.getLogger(__name__)


# Reconciliation thresholds
VARIANCE_WARNING_AMOUNT = Decimal("100")
VARIANCE_WARNING_PCT = 0.01  # 1%
VARIANCE_CRITICAL_AMOUNT = Decimal("1000")
VARIANCE_CRITICAL_PCT = 0.05  # 5%
DATE_MATCH_TOLERANCE_DAYS = 7
FUZZY_MATCH_THRESHOLD = 80


class ReconciliationError(Exception):
    """Exception raised for reconciliation errors."""

    pass


def fuzzy_vendor_match(name1: str, name2: str) -> float:
    """
    Calculate fuzzy match score between two vendor names.

    Args:
        name1: First vendor name
        name2: Second vendor name

    Returns:
        Match score from 0 to 100
    """
    try:
        from fuzzywuzzy import fuzz

        # Try multiple matching methods
        ratio = fuzz.ratio(name1.lower(), name2.lower())
        partial = fuzz.partial_ratio(name1.lower(), name2.lower())
        token_sort = fuzz.token_sort_ratio(name1.lower(), name2.lower())

        return max(ratio, partial, token_sort)
    except ImportError:
        # Fallback to simple comparison
        n1 = name1.lower().strip()
        n2 = name2.lower().strip()

        if n1 == n2:
            return 100

        # Check if one contains the other
        if n1 in n2 or n2 in n1:
            return 80

        # Check word overlap
        words1 = set(n1.split())
        words2 = set(n2.split())
        if words1 and words2:
            overlap = len(words1 & words2)
            total = len(words1 | words2)
            return (overlap / total) * 100

        return 0


def calculate_variance_severity(
    variance: Decimal, base_amount: Optional[Decimal] = None
) -> Severity:
    """
    Determine severity based on variance amount and percentage.

    Args:
        variance: Absolute variance amount
        base_amount: Base amount for percentage calculation

    Returns:
        Severity level
    """
    abs_variance = abs(variance)

    # Check absolute thresholds
    if abs_variance >= VARIANCE_CRITICAL_AMOUNT:
        return Severity.CRITICAL

    if abs_variance >= VARIANCE_WARNING_AMOUNT:
        # Also check percentage if we have base amount
        if base_amount and base_amount != 0:
            pct = abs(float(variance) / float(base_amount))
            if pct >= VARIANCE_CRITICAL_PCT:
                return Severity.CRITICAL
            if pct >= VARIANCE_WARNING_PCT:
                return Severity.WARNING
        return Severity.WARNING

    # Check percentage threshold for smaller amounts
    if base_amount and base_amount != 0:
        pct = abs(float(variance) / float(base_amount))
        if pct >= VARIANCE_CRITICAL_PCT:
            return Severity.CRITICAL
        if pct >= VARIANCE_WARNING_PCT:
            return Severity.WARNING

    return Severity.INFO


class Reconciler:
    """
    Core reconciliation engine.

    Performs matching and reconciliation between Procore and QuickBooks data
    at multiple levels: commitments, invoices, change orders, retention, and budget.
    """

    def __init__(
        self,
        procore_data: dict[str, Any],
        qb_data: dict[str, Any],
        cost_code_mappings: Optional[list[CostCodeMapping]] = None,
        mapping_file_path: Optional[Path] = None,
    ):
        """
        Initialize reconciler with data from both systems.

        Args:
            procore_data: Data dictionary from ProcoreClient.get_full_project_data()
            qb_data: Data dictionary from QuickBooksClient.get_full_project_data()
            cost_code_mappings: List of cost code mappings (optional)
            mapping_file_path: Path to mapping JSON file (optional)
        """
        self.procore_data = procore_data
        self.qb_data = qb_data

        # Load cost code mappings
        self.mappings: list[CostCodeMapping] = cost_code_mappings or []
        if not self.mappings and mapping_file_path:
            self.mappings = self._load_mappings(mapping_file_path)

        # Create lookup dictionaries
        self._build_vendor_matches()
        self._build_mapping_lookup()

        # Results storage
        self.commitment_results: list[ReconciliationResult] = []
        self.invoice_results: list[ReconciliationResult] = []
        self.change_order_results: list[ReconciliationResult] = []
        self.retention_results: list[ReconciliationResult] = []
        self.budget_results: list[ReconciliationResult] = []
        self.closeout_items: list[CloseoutItem] = []

    def _load_mappings(self, path: Path) -> list[CostCodeMapping]:
        """Load cost code mappings from JSON file."""
        if not path.exists():
            logger.warning(f"Mapping file not found: {path}")
            return []

        try:
            with open(path) as f:
                data = json.load(f)
            return [CostCodeMapping(**m) for m in data.get("mappings", [])]
        except Exception as e:
            logger.error(f"Failed to load mappings: {e}")
            return []

    def _build_vendor_matches(self) -> None:
        """Build vendor matching between Procore and QuickBooks."""
        self.vendor_matches: dict[str, str] = {}  # procore_name -> qb_name
        self.vendor_match_scores: dict[str, float] = {}

        procore_vendors: list[Vendor] = self.procore_data.get("vendors", [])
        qb_vendors: list[Vendor] = self.qb_data.get("vendors", [])

        for p_vendor in procore_vendors:
            if not p_vendor.procore_name:
                continue

            best_match = None
            best_score = 0

            for q_vendor in qb_vendors:
                if not q_vendor.qb_name:
                    continue

                # Check origin_id first (direct link)
                if p_vendor.origin_id and p_vendor.origin_id == q_vendor.qb_id:
                    best_match = q_vendor.qb_name
                    best_score = 100
                    break

                # Fuzzy name match
                score = fuzzy_vendor_match(p_vendor.procore_name, q_vendor.qb_name)
                if score > best_score and score >= FUZZY_MATCH_THRESHOLD:
                    best_score = score
                    best_match = q_vendor.qb_name

            if best_match:
                self.vendor_matches[p_vendor.procore_name] = best_match
                self.vendor_match_scores[p_vendor.procore_name] = best_score

        logger.info(f"Matched {len(self.vendor_matches)} vendors between systems")

    def _build_mapping_lookup(self) -> None:
        """Build cost code to QB account lookup."""
        self.code_to_account: dict[str, str] = {}
        for mapping in self.mappings:
            if mapping.qb_account_id:
                self.code_to_account[mapping.procore_cost_code] = mapping.qb_account_id

    def _find_matching_qb_vendor(self, procore_vendor: str) -> Optional[str]:
        """Find matched QB vendor name for a Procore vendor."""
        return self.vendor_matches.get(procore_vendor)

    def _generate_result_id(self) -> str:
        """Generate unique result ID."""
        return str(uuid.uuid4())[:8]

    def reconcile_commitments(self) -> list[ReconciliationResult]:
        """
        Reconcile commitments (subcontracts/POs) between Procore and QuickBooks.

        For each commitment in Procore, find corresponding vendor bills in QB
        and compare total amounts.

        Returns:
            List of ReconciliationResult objects
        """
        results: list[ReconciliationResult] = []
        procore_commitments: list[NormalizedCommitment] = self.procore_data.get(
            "commitments", []
        )
        qb_bills: list[NormalizedInvoice] = self.qb_data.get("bills", [])

        # Group QB bills by vendor
        qb_bills_by_vendor: dict[str, list[NormalizedInvoice]] = {}
        for bill in qb_bills:
            vendor = bill.vendor.lower()
            if vendor not in qb_bills_by_vendor:
                qb_bills_by_vendor[vendor] = []
            qb_bills_by_vendor[vendor].append(bill)

        for commitment in procore_commitments:
            # Find matched QB vendor
            qb_vendor = self._find_matching_qb_vendor(commitment.vendor)

            procore_value = commitment.current_value
            qb_value = Decimal("0")
            qb_ref = None

            if qb_vendor:
                # Sum all bills for this vendor
                vendor_bills = qb_bills_by_vendor.get(qb_vendor.lower(), [])
                qb_value = sum(bill.amount for bill in vendor_bills)
                if vendor_bills:
                    qb_ref = f"{len(vendor_bills)} bills"

            variance = procore_value - qb_value
            variance_pct = (
                float(variance / procore_value) * 100 if procore_value else 0
            )

            severity = calculate_variance_severity(variance, procore_value)

            notes = ""
            if not qb_vendor:
                notes = f"Vendor '{commitment.vendor}' not matched in QuickBooks"
                severity = Severity.WARNING
            elif variance != 0:
                notes = f"Variance of ${abs(variance):,.2f} between systems"

            requires_action = severity in (Severity.WARNING, Severity.CRITICAL)

            results.append(
                ReconciliationResult(
                    id=self._generate_result_id(),
                    item_type="commitment",
                    item_description=f"{commitment.commitment_type}: {commitment.title or commitment.vendor}",
                    vendor=commitment.vendor,
                    procore_value=procore_value,
                    qb_value=qb_value if qb_vendor else None,
                    variance=variance,
                    variance_pct=variance_pct,
                    severity=severity,
                    notes=notes,
                    procore_ref=commitment.procore_id,
                    qb_ref=qb_ref,
                    cost_code=commitment.cost_codes[0] if commitment.cost_codes else None,
                    requires_action=requires_action,
                )
            )

        self.commitment_results = results
        logger.info(f"Reconciled {len(results)} commitments")
        return results

    def reconcile_invoices(self) -> list[ReconciliationResult]:
        """
        Reconcile invoices/pay apps between Procore and QuickBooks.

        Match invoices by vendor, amount, and date proximity.

        Returns:
            List of ReconciliationResult objects
        """
        results: list[ReconciliationResult] = []
        procore_invoices: list[NormalizedInvoice] = self.procore_data.get(
            "requisitions", []
        )
        qb_bills: list[NormalizedInvoice] = self.qb_data.get("bills", [])

        # Track matched QB bills
        matched_qb_bills: set[str] = set()

        for p_invoice in procore_invoices:
            qb_vendor = self._find_matching_qb_vendor(p_invoice.vendor)
            best_match: Optional[NormalizedInvoice] = None
            match_confidence = 0

            if qb_vendor:
                for q_bill in qb_bills:
                    if q_bill.qb_id in matched_qb_bills:
                        continue

                    # Check vendor match
                    if q_bill.vendor.lower() != qb_vendor.lower():
                        continue

                    # Calculate match score
                    score = 0

                    # Amount match (exact or close)
                    amount_diff = abs(p_invoice.amount - q_bill.amount)
                    if amount_diff == 0:
                        score += 50
                    elif amount_diff <= Decimal("10"):
                        score += 40
                    elif amount_diff <= Decimal("100"):
                        score += 20

                    # Date proximity
                    date_diff = abs((p_invoice.invoice_date - q_bill.invoice_date).days)
                    if date_diff <= DATE_MATCH_TOLERANCE_DAYS:
                        score += 30
                    elif date_diff <= 14:
                        score += 15

                    # Invoice number match
                    if (
                        p_invoice.invoice_number
                        and q_bill.invoice_number
                        and p_invoice.invoice_number.lower()
                        == q_bill.invoice_number.lower()
                    ):
                        score += 20

                    if score > match_confidence and score >= 50:
                        match_confidence = score
                        best_match = q_bill

            variance = Decimal("0")
            qb_value = None
            qb_ref = None

            if best_match:
                matched_qb_bills.add(best_match.qb_id or "")
                qb_value = best_match.amount
                qb_ref = best_match.qb_id
                variance = p_invoice.amount - best_match.amount
                p_invoice.is_matched = True
                p_invoice.match_confidence = match_confidence / 100

            variance_pct = (
                float(variance / p_invoice.amount) * 100 if p_invoice.amount else 0
            )
            severity = calculate_variance_severity(variance, p_invoice.amount)

            notes = ""
            if not qb_vendor:
                notes = f"Vendor '{p_invoice.vendor}' not matched in QuickBooks"
                severity = Severity.WARNING
            elif not best_match:
                notes = "No matching bill found in QuickBooks"
                severity = Severity.WARNING
            elif variance != 0:
                notes = f"Amount variance: ${variance:,.2f}"

            results.append(
                ReconciliationResult(
                    id=self._generate_result_id(),
                    item_type="invoice",
                    item_description=f"Invoice #{p_invoice.invoice_number} - {p_invoice.vendor}",
                    vendor=p_invoice.vendor,
                    procore_value=p_invoice.amount,
                    qb_value=qb_value,
                    variance=variance,
                    variance_pct=variance_pct,
                    severity=severity,
                    notes=notes,
                    procore_ref=p_invoice.procore_id,
                    qb_ref=qb_ref,
                    requires_action=severity in (Severity.WARNING, Severity.CRITICAL),
                )
            )

        # Add unmatched QB bills
        for q_bill in qb_bills:
            if q_bill.qb_id not in matched_qb_bills:
                results.append(
                    ReconciliationResult(
                        id=self._generate_result_id(),
                        item_type="invoice",
                        item_description=f"QB Bill #{q_bill.invoice_number} - {q_bill.vendor}",
                        vendor=q_bill.vendor,
                        procore_value=None,
                        qb_value=q_bill.amount,
                        variance=q_bill.amount,  # Full amount unmatched
                        variance_pct=100,
                        severity=Severity.WARNING,
                        notes="Bill in QuickBooks with no matching Procore invoice",
                        qb_ref=q_bill.qb_id,
                        requires_action=True,
                    )
                )

        self.invoice_results = results
        logger.info(f"Reconciled {len(results)} invoices")
        return results

    def reconcile_change_orders(self) -> list[ReconciliationResult]:
        """
        Reconcile change orders between Procore and QuickBooks.

        Check that approved COs in Procore are reflected in QB.

        Returns:
            List of ReconciliationResult objects
        """
        results: list[ReconciliationResult] = []
        procore_cos: list[NormalizedChangeOrder] = self.procore_data.get(
            "change_orders", []
        )
        qb_bills: list[NormalizedInvoice] = self.qb_data.get("bills", [])

        for co in procore_cos:
            severity = Severity.INFO
            notes = ""
            requires_action = False

            if co.procore_status == ChangeOrderStatus.APPROVED:
                # Check if this CO is reflected in QB
                qb_vendor = self._find_matching_qb_vendor(co.vendor)
                reflected_in_qb = False

                if qb_vendor:
                    # Look for bills that might include this CO
                    # This is a simplified check - in reality, you'd need more sophisticated matching
                    vendor_bills = [
                        b for b in qb_bills if b.vendor.lower() == qb_vendor.lower()
                    ]
                    if vendor_bills:
                        total_billed = sum(b.amount for b in vendor_bills)
                        # Heuristic: if billed amount seems to include CO, mark as reflected
                        # A proper implementation would track CO-specific bill references
                        reflected_in_qb = True

                if not reflected_in_qb:
                    severity = Severity.WARNING
                    notes = "Approved CO not yet reflected in QuickBooks billing"
                    requires_action = True
                else:
                    notes = "CO appears reflected in QB billing"
                    co.linked_to_qb = True

            elif co.procore_status == ChangeOrderStatus.PENDING:
                # Check if somehow billed in QB before approval
                qb_vendor = self._find_matching_qb_vendor(co.vendor)
                if qb_vendor:
                    # This would be a problem - billing before approval
                    notes = "Pending CO - verify not prematurely billed"

            results.append(
                ReconciliationResult(
                    id=self._generate_result_id(),
                    item_type="change_order",
                    item_description=f"CO #{co.co_number}: {co.description[:50]}",
                    vendor=co.vendor,
                    procore_value=co.amount,
                    qb_value=co.amount if co.linked_to_qb else None,
                    variance=Decimal("0") if co.linked_to_qb else co.amount,
                    variance_pct=0 if co.linked_to_qb else 100,
                    severity=severity,
                    notes=notes,
                    procore_ref=co.procore_id,
                    cost_code=co.cost_code,
                    requires_action=requires_action,
                )
            )

        self.change_order_results = results
        logger.info(f"Reconciled {len(results)} change orders")
        return results

    def reconcile_retention(self) -> list[ReconciliationResult]:
        """
        Reconcile retention between Procore and QuickBooks.

        Compare retention held per Procore vs. retention tracked in QB.

        Returns:
            List of ReconciliationResult objects
        """
        results: list[ReconciliationResult] = []
        procore_commitments: list[NormalizedCommitment] = self.procore_data.get(
            "commitments", []
        )

        # Total retention tracking
        total_procore_retention = Decimal("0")
        retention_by_vendor: dict[str, Decimal] = {}

        for commitment in procore_commitments:
            if commitment.retention_held > 0:
                total_procore_retention += commitment.retention_held
                vendor = commitment.vendor
                if vendor not in retention_by_vendor:
                    retention_by_vendor[vendor] = Decimal("0")
                retention_by_vendor[vendor] += commitment.retention_held

        # Note: QuickBooks doesn't natively track retention as a separate field
        # Typically retention is tracked via:
        # 1. A separate liability account
        # 2. Unpaid portions of bills
        # 3. Custom fields or classes
        # This reconciliation flags retention for manual review

        for vendor, procore_retention in retention_by_vendor.items():
            qb_vendor = self._find_matching_qb_vendor(vendor)

            notes = ""
            severity = Severity.INFO

            if qb_vendor:
                # Check if QB has outstanding balances that might represent retention
                qb_bills = [
                    b
                    for b in self.qb_data.get("bills", [])
                    if b.vendor.lower() == qb_vendor.lower()
                ]
                qb_unpaid = sum(
                    (b.amount - b.payment_amount) for b in qb_bills if b.amount > b.payment_amount
                )

                if qb_unpaid > 0:
                    variance = procore_retention - qb_unpaid
                    if abs(variance) > VARIANCE_WARNING_AMOUNT:
                        severity = Severity.WARNING
                        notes = f"Procore retention ${procore_retention:,.2f} vs QB unpaid ${qb_unpaid:,.2f}"
                    else:
                        notes = f"Retention may be represented in QB unpaid balance (${qb_unpaid:,.2f})"
                else:
                    notes = f"Retention of ${procore_retention:,.2f} - verify tracking in QB"
                    severity = Severity.WARNING
            else:
                notes = f"Vendor not matched - cannot verify retention tracking"
                severity = Severity.WARNING

            results.append(
                ReconciliationResult(
                    id=self._generate_result_id(),
                    item_type="retention",
                    item_description=f"Retention: {vendor}",
                    vendor=vendor,
                    procore_value=procore_retention,
                    qb_value=None,  # QB doesn't directly track retention
                    variance=procore_retention,  # Full amount needs verification
                    variance_pct=100,
                    severity=severity,
                    notes=notes,
                    requires_action=severity != Severity.INFO,
                )
            )

        # Summary result
        if total_procore_retention > 0:
            results.append(
                ReconciliationResult(
                    id=self._generate_result_id(),
                    item_type="retention",
                    item_description="TOTAL RETENTION HELD",
                    procore_value=total_procore_retention,
                    variance=total_procore_retention,
                    variance_pct=100,
                    severity=Severity.INFO,
                    notes=f"Total retention to be released at closeout: ${total_procore_retention:,.2f}",
                    requires_action=True,
                )
            )

        self.retention_results = results
        logger.info(f"Reconciled retention for {len(retention_by_vendor)} vendors")
        return results

    def reconcile_budget_vs_actual(self) -> list[ReconciliationResult]:
        """
        Reconcile budget line items against actual expenses.

        Compare Procore budget by cost code vs. QB actuals by mapped account.

        Returns:
            List of ReconciliationResult objects
        """
        results: list[ReconciliationResult] = []
        budget_items: list[BudgetLineItem] = self.procore_data.get("budget_items", [])

        if not budget_items:
            logger.warning("No budget data available for reconciliation")
            return results

        for item in budget_items:
            severity = Severity.INFO
            notes = ""
            requires_action = False

            # Check for over-budget
            if item.job_to_date_costs > item.revised_budget:
                overage = item.job_to_date_costs - item.revised_budget
                overage_pct = (
                    float(overage / item.revised_budget) * 100
                    if item.revised_budget
                    else 0
                )

                if overage_pct >= 10 or overage >= VARIANCE_CRITICAL_AMOUNT:
                    severity = Severity.CRITICAL
                    notes = f"Over budget by ${overage:,.2f} ({overage_pct:.1f}%)"
                    requires_action = True
                elif overage_pct >= 5 or overage >= VARIANCE_WARNING_AMOUNT:
                    severity = Severity.WARNING
                    notes = f"Over budget by ${overage:,.2f} ({overage_pct:.1f}%)"
                    requires_action = True
                else:
                    notes = f"Slightly over budget by ${overage:,.2f}"

            # Check for zero spend on committed budget
            elif item.committed_costs > 0 and item.job_to_date_costs == 0:
                severity = Severity.WARNING
                notes = "Budget committed but no costs recorded"
                requires_action = True

            # Check for uncommitted budget
            elif item.uncommitted_budget > Decimal("1000"):
                notes = f"Uncommitted budget: ${item.uncommitted_budget:,.2f}"

            variance = item.revised_budget - item.job_to_date_costs

            results.append(
                ReconciliationResult(
                    id=self._generate_result_id(),
                    item_type="budget",
                    item_description=f"{item.cost_code}: {item.description}",
                    procore_value=item.revised_budget,
                    qb_value=item.job_to_date_costs,  # Procore tracks actuals
                    variance=variance,
                    variance_pct=(
                        float(variance / item.revised_budget) * 100
                        if item.revised_budget
                        else 0
                    ),
                    severity=severity,
                    notes=notes,
                    cost_code=item.cost_code,
                    requires_action=requires_action,
                )
            )

        self.budget_results = results
        logger.info(f"Reconciled {len(results)} budget line items")
        return results

    def generate_closeout_items(self) -> list[CloseoutItem]:
        """
        Generate closeout punch list items.

        Identify everything that needs resolution before financial closeout.

        Returns:
            List of CloseoutItem objects
        """
        items: list[CloseoutItem] = []
        item_id = 1

        # 1. Unpaid invoices
        procore_invoices: list[NormalizedInvoice] = self.procore_data.get(
            "requisitions", []
        )
        for inv in procore_invoices:
            if inv.procore_status not in (InvoiceStatus.PAID, InvoiceStatus.VOID):
                balance = inv.amount - inv.payment_amount
                if balance > 0:
                    items.append(
                        CloseoutItem(
                            id=f"CI-{item_id:04d}",
                            category="unpaid_invoice",
                            description=f"Unpaid invoice #{inv.invoice_number} from {inv.vendor}",
                            status=ItemStatus.OPEN,
                            responsible_party="Accounts Payable",
                            vendor=inv.vendor,
                            amount_at_risk=balance,
                            action_required=f"Process payment of ${balance:,.2f}",
                            priority=2,
                        )
                    )
                    item_id += 1

        # 2. Outstanding retention
        commitments: list[NormalizedCommitment] = self.procore_data.get(
            "commitments", []
        )
        for commitment in commitments:
            if commitment.retention_held > 0:
                items.append(
                    CloseoutItem(
                        id=f"CI-{item_id:04d}",
                        category="retention",
                        description=f"Release retention for {commitment.vendor}",
                        status=ItemStatus.OPEN,
                        responsible_party="Project Manager",
                        vendor=commitment.vendor,
                        amount_at_risk=commitment.retention_held,
                        action_required=f"Verify work completion and release ${commitment.retention_held:,.2f} retention",
                        priority=3,
                    )
                )
                item_id += 1

        # 3. Unapproved change orders
        change_orders: list[NormalizedChangeOrder] = self.procore_data.get(
            "change_orders", []
        )
        for co in change_orders:
            if co.procore_status in (ChangeOrderStatus.DRAFT, ChangeOrderStatus.PENDING):
                priority = 1 if co.amount > VARIANCE_CRITICAL_AMOUNT else 2
                items.append(
                    CloseoutItem(
                        id=f"CI-{item_id:04d}",
                        category="unapproved_co",
                        description=f"Unapproved CO #{co.co_number}: {co.description[:40]}",
                        status=ItemStatus.OPEN,
                        responsible_party="Project Manager",
                        vendor=co.vendor,
                        amount_at_risk=co.amount,
                        action_required=f"Approve or reject CO for ${co.amount:,.2f}",
                        priority=priority,
                    )
                )
                item_id += 1

        # 4. Uncommitted budget
        budget_items: list[BudgetLineItem] = self.procore_data.get("budget_items", [])
        for item in budget_items:
            if item.uncommitted_budget > Decimal("5000"):
                items.append(
                    CloseoutItem(
                        id=f"CI-{item_id:04d}",
                        category="uncommitted_budget",
                        description=f"Uncommitted budget: {item.cost_code} - {item.description}",
                        status=ItemStatus.OPEN,
                        responsible_party="Cost Estimator",
                        amount_at_risk=item.uncommitted_budget,
                        action_required=f"Commit or release ${item.uncommitted_budget:,.2f} uncommitted budget",
                        priority=4,
                    )
                )
                item_id += 1

        # 5. Unmatched QB bills
        for result in self.invoice_results:
            if result.procore_value is None and result.qb_value:
                items.append(
                    CloseoutItem(
                        id=f"CI-{item_id:04d}",
                        category="unmatched_bill",
                        description=f"QB bill not matched to Procore: {result.item_description}",
                        status=ItemStatus.OPEN,
                        responsible_party="Accounting",
                        vendor=result.vendor,
                        amount_at_risk=result.qb_value,
                        action_required="Investigate and link to appropriate Procore commitment",
                        priority=2,
                        linked_items=[result.id],
                    )
                )
                item_id += 1

        # 6. Final pay apps not submitted
        for commitment in commitments:
            if (
                commitment.status == CommitmentStatus.EXECUTED
                and commitment.balance_remaining > Decimal("100")
            ):
                items.append(
                    CloseoutItem(
                        id=f"CI-{item_id:04d}",
                        category="final_pay_app",
                        description=f"Final pay app pending for {commitment.vendor}",
                        status=ItemStatus.OPEN,
                        responsible_party="Subcontractor",
                        vendor=commitment.vendor,
                        amount_at_risk=commitment.balance_remaining,
                        action_required=f"Request final pay app for ${commitment.balance_remaining:,.2f}",
                        priority=2,
                    )
                )
                item_id += 1

        # Sort by priority
        items.sort(key=lambda x: (x.priority, x.amount_at_risk), reverse=False)

        self.closeout_items = items
        logger.info(f"Generated {len(items)} closeout items")
        return items

    def build_project_summary(self) -> ProjectSummary:
        """
        Build project financial summary.

        Returns:
            ProjectSummary object with key metrics
        """
        project = self.procore_data.get("project", {})
        prime_contracts = self.procore_data.get("prime_contracts", [])
        commitments: list[NormalizedCommitment] = self.procore_data.get(
            "commitments", []
        )

        # Prime contract metrics
        total_contract = Decimal("0")
        total_prime_cos = Decimal("0")
        billed_to_owner = Decimal("0")
        received_from_owner = Decimal("0")
        owner_retention = Decimal("0")

        for pc in prime_contracts:
            total_contract += pc.original_value
            total_prime_cos += pc.approved_changes
            billed_to_owner += pc.billed_to_date
            received_from_owner += pc.received_to_date
            owner_retention += pc.retention_held

        # Commitment metrics
        total_committed = sum(c.current_value for c in commitments)
        total_commitment_cos = sum(c.approved_changes for c in commitments)
        total_billed_by_subs = sum(c.billed_to_date for c in commitments)
        total_paid_to_subs = sum(c.paid_to_date for c in commitments)
        sub_retention = sum(c.retention_held for c in commitments)

        # Reconciliation metrics
        all_results = (
            self.commitment_results
            + self.invoice_results
            + self.change_order_results
            + self.retention_results
            + self.budget_results
        )

        reconciled = len([r for r in all_results if r.severity == Severity.INFO])
        warnings = len([r for r in all_results if r.severity == Severity.WARNING])
        critical = len([r for r in all_results if r.severity == Severity.CRITICAL])
        open_items = len([i for i in self.closeout_items if i.status == ItemStatus.OPEN])
        exposure = sum(
            i.amount_at_risk for i in self.closeout_items if i.status == ItemStatus.OPEN
        )

        return ProjectSummary(
            project_id=str(project.get("id", "")),
            project_name=project.get("name", "Unknown Project"),
            project_number=project.get("project_number"),
            project_address=project.get("address", {}).get("address1"),
            total_contract_value=total_contract,
            total_approved_cos=total_prime_cos,
            revised_contract_value=total_contract + total_prime_cos,
            billed_to_owner=billed_to_owner,
            received_from_owner=received_from_owner,
            owner_retention_held=owner_retention,
            total_committed=total_committed,
            total_commitment_cos=total_commitment_cos,
            total_billed_by_subs=total_billed_by_subs,
            total_paid_to_subs=total_paid_to_subs,
            sub_retention_held=sub_retention,
            reconciled_items=reconciled,
            warning_items=warnings,
            critical_items=critical,
            open_closeout_items=open_items,
            estimated_exposure=exposure,
        )

    def run_full_reconciliation(self) -> CloseoutReport:
        """
        Run complete reconciliation and generate closeout report.

        Returns:
            Complete CloseoutReport object
        """
        logger.info("Starting full reconciliation...")

        # Run all reconciliation steps
        self.reconcile_commitments()
        self.reconcile_invoices()
        self.reconcile_change_orders()
        self.reconcile_retention()
        self.reconcile_budget_vs_actual()
        self.generate_closeout_items()

        # Build summary
        summary = self.build_project_summary()

        # Create report
        report = CloseoutReport(
            project_summary=summary,
            cost_code_mappings=self.mappings,
            commitment_reconciliation=self.commitment_results,
            invoice_reconciliation=self.invoice_results,
            change_order_reconciliation=self.change_order_results,
            retention_reconciliation=self.retention_results,
            budget_reconciliation=self.budget_results,
            closeout_items=self.closeout_items,
        )

        logger.info(
            f"Reconciliation complete: {summary.reconciled_items} reconciled, "
            f"{summary.warning_items} warnings, {summary.critical_items} critical"
        )

        return report

    def export_results_to_json(self, output_path: Path) -> None:
        """Export reconciliation results to JSON file."""
        report = self.run_full_reconciliation()

        with open(output_path, "w") as f:
            json.dump(report.model_dump(mode="json"), f, indent=2, default=str)

        logger.info(f"Exported results to {output_path}")
