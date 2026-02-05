"""
Shared data models for Procore-QuickBooks closeout reconciliation.

This module defines Pydantic models for normalized financial records used
throughout the reconciliation process.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class Severity(str, Enum):
    """Severity level for reconciliation discrepancies."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class RiskLevel(str, Enum):
    """Risk level for AI-assessed discrepancies."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ItemStatus(str, Enum):
    """Status for closeout items."""

    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"


class CommitmentStatus(str, Enum):
    """Status for commitments (subcontracts/POs)."""

    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    EXECUTED = "executed"
    COMPLETE = "complete"
    VOID = "void"


class InvoiceStatus(str, Enum):
    """Status for invoices/pay applications."""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    PAID = "paid"
    PARTIALLY_PAID = "partially_paid"
    REJECTED = "rejected"
    VOID = "void"


class ChangeOrderStatus(str, Enum):
    """Status for change orders."""

    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    VOID = "void"


class CostCode(BaseModel):
    """CSI division cost code from Procore."""

    code: str = Field(..., description="Cost code identifier (e.g., '03-100')")
    description: str = Field(..., description="Cost code description")
    csi_division: str = Field(..., description="CSI division number (01-49)")
    parent_code: Optional[str] = Field(None, description="Parent cost code if hierarchical")

    @field_validator("csi_division")
    @classmethod
    def validate_csi_division(cls, v: str) -> str:
        """Validate CSI division is in expected range."""
        if v and not v.isdigit():
            v = v.split("-")[0] if "-" in v else v[:2]
        return v


class QBAccount(BaseModel):
    """QuickBooks chart of accounts entry."""

    id: str = Field(..., description="QuickBooks account ID")
    name: str = Field(..., description="Account name")
    account_type: str = Field(..., description="Account type (Expense, COGS, etc.)")
    account_sub_type: Optional[str] = Field(None, description="Account sub-type")
    fully_qualified_name: Optional[str] = Field(None, description="Full account path")
    active: bool = Field(True, description="Whether account is active")


class CostCodeMapping(BaseModel):
    """Mapping between Procore cost codes and QB chart of accounts."""

    procore_cost_code: str = Field(..., description="Procore cost code")
    procore_description: str = Field(..., description="Procore cost code description")
    csi_division: str = Field(..., description="CSI division number")
    qb_account_id: Optional[str] = Field(None, description="QuickBooks account ID")
    qb_account_name: Optional[str] = Field(None, description="QuickBooks account name")
    confidence: float = Field(0.0, ge=0.0, le=1.0, description="Mapping confidence score")
    manually_verified: bool = Field(False, description="Whether mapping was manually verified")
    notes: Optional[str] = Field(None, description="Additional notes about mapping")


class Vendor(BaseModel):
    """Normalized vendor record."""

    procore_id: Optional[str] = Field(None, description="Procore vendor ID")
    procore_name: Optional[str] = Field(None, description="Vendor name in Procore")
    qb_id: Optional[str] = Field(None, description="QuickBooks vendor ID")
    qb_name: Optional[str] = Field(None, description="Vendor name in QuickBooks")
    origin_id: Optional[str] = Field(None, description="External system ID for mapping")
    match_confidence: float = Field(0.0, ge=0.0, le=1.0, description="Match confidence")
    is_matched: bool = Field(False, description="Whether vendor is matched between systems")


class NormalizedCommitment(BaseModel):
    """Normalized commitment (subcontract or PO) for reconciliation."""

    vendor: str = Field(..., description="Vendor/subcontractor name")
    procore_id: Optional[str] = Field(None, description="Procore commitment ID")
    qb_id: Optional[str] = Field(None, description="QuickBooks bill/PO ID")
    commitment_type: str = Field(..., description="Type: subcontract or purchase_order")
    title: Optional[str] = Field(None, description="Commitment title/description")
    status: CommitmentStatus = Field(..., description="Commitment status")
    original_amount: Decimal = Field(..., description="Original contract amount")
    approved_changes: Decimal = Field(Decimal("0"), description="Sum of approved change orders")
    pending_changes: Decimal = Field(Decimal("0"), description="Sum of pending change orders")
    current_value: Decimal = Field(..., description="Current contract value (original + approved COs)")
    billed_to_date: Decimal = Field(Decimal("0"), description="Total amount billed")
    paid_to_date: Decimal = Field(Decimal("0"), description="Total amount paid")
    retention_held: Decimal = Field(Decimal("0"), description="Retention currently held")
    retention_released: Decimal = Field(Decimal("0"), description="Retention released")
    balance_remaining: Decimal = Field(..., description="Remaining balance to bill")
    cost_codes: list[str] = Field(default_factory=list, description="Associated cost codes")
    execution_date: Optional[date] = Field(None, description="Contract execution date")

    @property
    def retention_balance(self) -> Decimal:
        """Calculate remaining retention to be released."""
        return self.retention_held - self.retention_released


class NormalizedInvoice(BaseModel):
    """Normalized invoice/pay application for reconciliation."""

    vendor: str = Field(..., description="Vendor name")
    invoice_number: str = Field(..., description="Invoice or pay app number")
    procore_id: Optional[str] = Field(None, description="Procore requisition ID")
    qb_id: Optional[str] = Field(None, description="QuickBooks bill ID")
    commitment_id: Optional[str] = Field(None, description="Parent commitment ID")
    amount: Decimal = Field(..., description="Invoice gross amount")
    retention_amount: Decimal = Field(Decimal("0"), description="Retention withheld this invoice")
    net_amount: Decimal = Field(..., description="Net amount after retention")
    invoice_date: date = Field(..., description="Invoice date")
    due_date: Optional[date] = Field(None, description="Payment due date")
    procore_status: Optional[InvoiceStatus] = Field(None, description="Status in Procore")
    qb_status: Optional[InvoiceStatus] = Field(None, description="Status in QuickBooks")
    payment_date: Optional[date] = Field(None, description="Date payment was made")
    payment_amount: Decimal = Field(Decimal("0"), description="Amount paid")
    is_matched: bool = Field(False, description="Whether matched between systems")
    match_confidence: float = Field(0.0, ge=0.0, le=1.0, description="Match confidence score")


class NormalizedChangeOrder(BaseModel):
    """Normalized change order for reconciliation."""

    vendor: str = Field(..., description="Vendor/subcontractor name")
    co_number: str = Field(..., description="Change order number")
    procore_id: Optional[str] = Field(None, description="Procore CO ID")
    commitment_id: Optional[str] = Field(None, description="Parent commitment ID")
    amount: Decimal = Field(..., description="Change order amount (can be negative)")
    description: str = Field(..., description="Change order description")
    cost_code: Optional[str] = Field(None, description="Associated cost code")
    procore_status: ChangeOrderStatus = Field(..., description="Status in Procore")
    linked_to_qb: bool = Field(False, description="Whether reflected in QuickBooks")
    qb_reference: Optional[str] = Field(None, description="QB transaction reference if linked")
    created_date: Optional[date] = Field(None, description="CO creation date")
    approved_date: Optional[date] = Field(None, description="CO approval date")


class BudgetLineItem(BaseModel):
    """Budget line item from Procore."""

    cost_code: str = Field(..., description="Cost code")
    description: str = Field(..., description="Line item description")
    original_budget: Decimal = Field(..., description="Original budget amount")
    approved_changes: Decimal = Field(Decimal("0"), description="Approved budget changes")
    revised_budget: Decimal = Field(..., description="Revised budget (original + changes)")
    pending_changes: Decimal = Field(Decimal("0"), description="Pending budget changes")
    committed_costs: Decimal = Field(Decimal("0"), description="Costs committed via contracts")
    direct_costs: Decimal = Field(Decimal("0"), description="Direct costs (non-committed)")
    job_to_date_costs: Decimal = Field(Decimal("0"), description="Total costs to date")
    projected_costs: Decimal = Field(Decimal("0"), description="Projected final costs")

    @property
    def uncommitted_budget(self) -> Decimal:
        """Budget not yet committed to contracts."""
        return self.revised_budget - self.committed_costs

    @property
    def variance(self) -> Decimal:
        """Budget variance (positive = under budget)."""
        return self.revised_budget - self.job_to_date_costs


class PrimeContract(BaseModel):
    """Prime contract information from Procore."""

    id: str = Field(..., description="Procore prime contract ID")
    title: str = Field(..., description="Contract title")
    number: Optional[str] = Field(None, description="Contract number")
    status: str = Field(..., description="Contract status")
    original_value: Decimal = Field(..., description="Original contract value")
    approved_changes: Decimal = Field(Decimal("0"), description="Approved change orders")
    revised_value: Decimal = Field(..., description="Revised contract value")
    billed_to_date: Decimal = Field(Decimal("0"), description="Amount billed to owner")
    received_to_date: Decimal = Field(Decimal("0"), description="Amount received from owner")
    retention_held: Decimal = Field(Decimal("0"), description="Retention held by owner")


class DirectCost(BaseModel):
    """Direct cost entry from Procore."""

    id: str = Field(..., description="Procore direct cost ID")
    vendor: Optional[str] = Field(None, description="Vendor name")
    amount: Decimal = Field(..., description="Cost amount")
    cost_code: str = Field(..., description="Associated cost code")
    description: Optional[str] = Field(None, description="Cost description")
    invoice_number: Optional[str] = Field(None, description="Invoice number if applicable")
    transaction_date: date = Field(..., description="Transaction date")


class ReconciliationResult(BaseModel):
    """Individual reconciliation comparison result."""

    id: str = Field(..., description="Unique result identifier")
    item_type: str = Field(
        ..., description="Type: commitment, invoice, change_order, retention, budget"
    )
    item_description: str = Field(..., description="Description of the item being reconciled")
    vendor: Optional[str] = Field(None, description="Vendor name if applicable")
    procore_value: Optional[Decimal] = Field(None, description="Value in Procore")
    qb_value: Optional[Decimal] = Field(None, description="Value in QuickBooks")
    variance: Decimal = Field(Decimal("0"), description="Difference between values")
    variance_pct: float = Field(0.0, description="Variance as percentage")
    severity: Severity = Field(Severity.INFO, description="Discrepancy severity")
    notes: str = Field("", description="Explanation or notes")
    procore_ref: Optional[str] = Field(None, description="Procore reference ID")
    qb_ref: Optional[str] = Field(None, description="QuickBooks reference ID")
    cost_code: Optional[str] = Field(None, description="Related cost code")
    requires_action: bool = Field(False, description="Whether action is required")

    @field_validator("variance_pct")
    @classmethod
    def round_variance_pct(cls, v: float) -> float:
        """Round variance percentage to 2 decimal places."""
        return round(v, 2)


class AIDiscrepancyAnalysis(BaseModel):
    """AI-generated analysis of a discrepancy."""

    id: str = Field(..., description="Matches ReconciliationResult id")
    likely_cause: str = Field(..., description="Probable cause of discrepancy")
    risk_level: RiskLevel = Field(..., description="Financial risk assessment")
    recommended_action: str = Field(..., description="Specific action to resolve")
    is_timing_issue: bool = Field(False, description="Whether likely a timing difference")
    estimated_resolution_effort: str = Field(..., description="Effort to resolve (low/medium/high)")
    additional_context: Optional[str] = Field(None, description="Additional AI insights")


class AIAnalysisResult(BaseModel):
    """Complete AI analysis result."""

    discrepancies: list[AIDiscrepancyAnalysis] = Field(
        default_factory=list, description="Analysis of each discrepancy"
    )
    summary: str = Field(..., description="Overall analysis summary")
    top_priorities: list[str] = Field(default_factory=list, description="Top priority items")
    total_financial_exposure: Decimal = Field(
        Decimal("0"), description="Total estimated exposure"
    )
    analysis_timestamp: datetime = Field(
        default_factory=datetime.now, description="When analysis was performed"
    )


class CloseoutItem(BaseModel):
    """Individual item requiring attention for closeout."""

    id: str = Field(..., description="Unique item identifier")
    category: str = Field(
        ...,
        description="Category: unpaid_invoice, retention, unapproved_co, uncommitted_budget, unmatched_bill, lien_waiver, final_pay_app",
    )
    description: str = Field(..., description="Item description")
    status: ItemStatus = Field(ItemStatus.OPEN, description="Resolution status")
    responsible_party: Optional[str] = Field(None, description="Who needs to resolve")
    vendor: Optional[str] = Field(None, description="Related vendor")
    amount_at_risk: Decimal = Field(Decimal("0"), description="Financial amount at risk")
    action_required: str = Field(..., description="What needs to be done")
    due_date: Optional[date] = Field(None, description="Resolution due date")
    priority: int = Field(1, ge=1, le=5, description="Priority 1 (highest) to 5 (lowest)")
    linked_items: list[str] = Field(
        default_factory=list, description="Related reconciliation result IDs"
    )


class ProjectSummary(BaseModel):
    """High-level project financial summary."""

    project_id: str = Field(..., description="Project identifier")
    project_name: str = Field(..., description="Project name")
    project_number: Optional[str] = Field(None, description="Project number")
    project_address: Optional[str] = Field(None, description="Project address")
    start_date: Optional[date] = Field(None, description="Project start date")
    completion_date: Optional[date] = Field(None, description="Project completion date")

    # Prime contract metrics
    total_contract_value: Decimal = Field(..., description="Total prime contract value")
    total_approved_cos: Decimal = Field(Decimal("0"), description="Total approved prime COs")
    revised_contract_value: Decimal = Field(..., description="Revised contract value")
    billed_to_owner: Decimal = Field(Decimal("0"), description="Total billed to owner")
    received_from_owner: Decimal = Field(Decimal("0"), description="Total received from owner")
    owner_retention_held: Decimal = Field(Decimal("0"), description="Retention held by owner")

    # Commitment metrics
    total_committed: Decimal = Field(..., description="Total committed to subs/vendors")
    total_commitment_cos: Decimal = Field(Decimal("0"), description="Total commitment COs")
    total_billed_by_subs: Decimal = Field(Decimal("0"), description="Total billed by subs")
    total_paid_to_subs: Decimal = Field(Decimal("0"), description="Total paid to subs")
    sub_retention_held: Decimal = Field(Decimal("0"), description="Retention held from subs")

    # Reconciliation metrics
    reconciled_items: int = Field(0, description="Number of reconciled items")
    warning_items: int = Field(0, description="Number of warnings")
    critical_items: int = Field(0, description="Number of critical issues")
    open_closeout_items: int = Field(0, description="Number of open closeout items")
    estimated_exposure: Decimal = Field(Decimal("0"), description="Total estimated exposure")


class CloseoutReport(BaseModel):
    """Complete closeout reconciliation report."""

    generated_at: datetime = Field(
        default_factory=datetime.now, description="Report generation timestamp"
    )
    project_summary: ProjectSummary = Field(..., description="Project summary")
    cost_code_mappings: list[CostCodeMapping] = Field(
        default_factory=list, description="Cost code mappings used"
    )
    commitment_reconciliation: list[ReconciliationResult] = Field(
        default_factory=list, description="Commitment-level reconciliation"
    )
    invoice_reconciliation: list[ReconciliationResult] = Field(
        default_factory=list, description="Invoice/pay app reconciliation"
    )
    change_order_reconciliation: list[ReconciliationResult] = Field(
        default_factory=list, description="Change order reconciliation"
    )
    retention_reconciliation: list[ReconciliationResult] = Field(
        default_factory=list, description="Retention reconciliation"
    )
    budget_reconciliation: list[ReconciliationResult] = Field(
        default_factory=list, description="Budget vs actual reconciliation"
    )
    closeout_items: list[CloseoutItem] = Field(
        default_factory=list, description="Open closeout items"
    )
    ai_analysis: Optional[AIAnalysisResult] = Field(
        None, description="AI-generated analysis"
    )
    executive_summary: Optional[str] = Field(None, description="Executive summary text")


class TokenInfo(BaseModel):
    """OAuth token information."""

    access_token: str = Field(..., description="OAuth access token")
    refresh_token: str = Field(..., description="OAuth refresh token")
    token_type: str = Field("Bearer", description="Token type")
    expires_at: Optional[datetime] = Field(None, description="Token expiration time")
    scope: Optional[str] = Field(None, description="Token scope")


class APIError(BaseModel):
    """API error information."""

    status_code: int = Field(..., description="HTTP status code")
    error_type: str = Field(..., description="Error type/code")
    message: str = Field(..., description="Error message")
    details: Optional[dict] = Field(None, description="Additional error details")
    timestamp: datetime = Field(
        default_factory=datetime.now, description="When error occurred"
    )
    retryable: bool = Field(False, description="Whether request can be retried")
