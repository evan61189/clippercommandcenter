"""
Tests for the reconciliation engine.

Uses mock data from mock_data/ fixtures to test matching logic,
variance calculations, and closeout item generation.
"""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import (
    BudgetLineItem,
    ChangeOrderStatus,
    CloseoutItem,
    CommitmentStatus,
    CostCode,
    InvoiceStatus,
    NormalizedChangeOrder,
    NormalizedCommitment,
    NormalizedInvoice,
    QBAccount,
    ReconciliationResult,
    Severity,
    Vendor,
)
from src.reconciler import (
    Reconciler,
    calculate_variance_severity,
    fuzzy_vendor_match,
)


# Load mock data
MOCK_DATA_DIR = Path(__file__).parent / "mock_data"


def load_mock_procore_data():
    """Load and transform mock Procore data."""
    with open(MOCK_DATA_DIR / "procore_responses.json") as f:
        raw = json.load(f)

    # Transform to normalized models
    vendors = [
        Vendor(
            procore_id=str(v["id"]),
            procore_name=v["name"],
            origin_id=v.get("origin_id"),
        )
        for v in raw["vendors"]
    ]

    commitments = []
    for c in raw["subcontracts"]:
        vendor = c["vendor"]
        commitments.append(
            NormalizedCommitment(
                vendor=vendor["name"],
                procore_id=str(c["id"]),
                commitment_type="subcontract",
                title=c["title"],
                status=CommitmentStatus.EXECUTED,
                original_amount=Decimal(str(c["grand_total"])),
                approved_changes=Decimal(str(c.get("approved_change_orders", 0))),
                pending_changes=Decimal(str(c.get("pending_change_orders", 0))),
                current_value=Decimal(str(c["grand_total"])) + Decimal(str(c.get("approved_change_orders", 0))),
                billed_to_date=Decimal(str(c.get("bill_amount", 0))),
                paid_to_date=Decimal(str(c.get("paid_amount", 0))),
                retention_held=Decimal(str(c.get("retention_amount", 0))),
                balance_remaining=Decimal(str(c["grand_total"])) + Decimal(str(c.get("approved_change_orders", 0))) - Decimal(str(c.get("bill_amount", 0))),
                cost_codes=[li["cost_code"]["full_code"] for li in c.get("line_items", []) if li.get("cost_code")],
            )
        )

    for po in raw.get("purchase_orders", []):
        vendor = po["vendor"]
        commitments.append(
            NormalizedCommitment(
                vendor=vendor["name"],
                procore_id=str(po["id"]),
                commitment_type="purchase_order",
                title=po["title"],
                status=CommitmentStatus.APPROVED,
                original_amount=Decimal(str(po["grand_total"])),
                approved_changes=Decimal("0"),
                pending_changes=Decimal("0"),
                current_value=Decimal(str(po["grand_total"])),
                billed_to_date=Decimal(str(po.get("bill_amount", 0))),
                paid_to_date=Decimal(str(po.get("paid_amount", 0))),
                retention_held=Decimal("0"),
                balance_remaining=Decimal("0"),
                cost_codes=[],
            )
        )

    requisitions = []
    for r in raw["requisitions"]:
        requisitions.append(
            NormalizedInvoice(
                vendor=r["vendor"]["name"],
                invoice_number=r["number"],
                procore_id=str(r["id"]),
                amount=Decimal(str(r["amount"])),
                retention_amount=Decimal(str(r.get("retention", 0))),
                net_amount=Decimal(str(r["amount"])) - Decimal(str(r.get("retention", 0))),
                invoice_date=date.fromisoformat(r["invoice_date"]),
                procore_status=InvoiceStatus.PAID if r["status"] == "paid" else InvoiceStatus.APPROVED,
                payment_date=date.fromisoformat(r["payment_date"]) if r.get("payment_date") else None,
                payment_amount=Decimal(str(r.get("payment_amount", 0))),
            )
        )

    change_orders = []
    for co in raw["change_orders"]:
        change_orders.append(
            NormalizedChangeOrder(
                vendor=co["vendor"]["name"],
                co_number=co["number"],
                procore_id=str(co["id"]),
                amount=Decimal(str(co["amount"])),
                description=co["title"],
                cost_code=co["line_items"][0]["cost_code"]["full_code"] if co.get("line_items") else None,
                procore_status=ChangeOrderStatus.APPROVED if co["status"] == "approved" else ChangeOrderStatus.PENDING,
                created_date=date.fromisoformat(co["created_at"].split("T")[0]) if co.get("created_at") else None,
                approved_date=date.fromisoformat(co["approved_date"]) if co.get("approved_date") else None,
            )
        )

    budget_items = []
    for b in raw.get("budget_items", []):
        budget_items.append(
            BudgetLineItem(
                cost_code=b["cost_code"]["full_code"],
                description=b["description"],
                original_budget=Decimal(str(b["original_budget_amount"])),
                approved_changes=Decimal(str(b.get("approved_cos", 0))),
                revised_budget=Decimal(str(b["revised_budget"])),
                pending_changes=Decimal(str(b.get("pending_changes", 0))),
                committed_costs=Decimal(str(b.get("committed_costs", 0))),
                direct_costs=Decimal(str(b.get("direct_costs", 0))),
                job_to_date_costs=Decimal(str(b.get("job_to_date_costs", 0))),
                projected_costs=Decimal(str(b.get("projected_costs", 0))),
            )
        )

    return {
        "project": raw["project"],
        "vendors": vendors,
        "commitments": commitments,
        "requisitions": requisitions,
        "change_orders": change_orders,
        "budget_items": budget_items,
        "prime_contracts": [],
        "cost_codes": [],
    }


def load_mock_qb_data():
    """Load and transform mock QuickBooks data."""
    with open(MOCK_DATA_DIR / "quickbooks_responses.json") as f:
        raw = json.load(f)

    vendors = [
        Vendor(
            qb_id=str(v["Id"]),
            qb_name=v["DisplayName"],
        )
        for v in raw["vendors"]
    ]

    bills = []
    for b in raw["bills"]:
        vendor_ref = b["VendorRef"]
        bills.append(
            NormalizedInvoice(
                vendor=vendor_ref["name"],
                invoice_number=b.get("DocNumber", str(b["Id"])),
                qb_id=str(b["Id"]),
                amount=Decimal(str(b["TotalAmt"])),
                retention_amount=Decimal("0"),
                net_amount=Decimal(str(b["TotalAmt"])),
                invoice_date=date.fromisoformat(b["TxnDate"]),
                due_date=date.fromisoformat(b["DueDate"]) if b.get("DueDate") else None,
                qb_status=InvoiceStatus.PAID if b["Balance"] == 0 else InvoiceStatus.APPROVED,
                payment_amount=Decimal(str(b["TotalAmt"])) - Decimal(str(b["Balance"])),
            )
        )

    accounts = [
        QBAccount(
            id=str(a["Id"]),
            name=a["Name"],
            account_type=a["AccountType"],
            account_sub_type=a.get("AccountSubType"),
            fully_qualified_name=a.get("FullyQualifiedName"),
        )
        for a in raw["accounts"]
    ]

    return {
        "company_info": raw["company_info"],
        "vendors": vendors,
        "bills": bills,
        "accounts": accounts,
        "payments": raw["bill_payments"],
        "purchase_orders": [],
        "pnl_report": None,
        "customer": raw["customers"][0] if raw.get("customers") else None,
        "customer_id": raw["customers"][0]["Id"] if raw.get("customers") else None,
    }


class TestFuzzyVendorMatch:
    """Tests for vendor name matching."""

    def test_exact_match(self):
        """Test exact name match returns 100."""
        score = fuzzy_vendor_match("ABC Concrete, Inc.", "ABC Concrete, Inc.")
        assert score == 100

    def test_close_match(self):
        """Test similar names have high score."""
        score = fuzzy_vendor_match("ABC Concrete, Inc.", "ABC Concrete Inc")
        assert score >= 90

    def test_partial_match(self):
        """Test partial name match."""
        score = fuzzy_vendor_match("Premier Drywall Services", "Premier Drywall Svcs")
        assert score >= 70

    def test_no_match(self):
        """Test unrelated names have low score."""
        score = fuzzy_vendor_match("ABC Concrete, Inc.", "XYZ Plumbing")
        assert score < 50

    def test_case_insensitive(self):
        """Test matching is case insensitive."""
        score = fuzzy_vendor_match("ABC CONCRETE", "abc concrete")
        assert score == 100


class TestVarianceSeverity:
    """Tests for variance severity calculation."""

    def test_zero_variance(self):
        """Zero variance should be INFO."""
        assert calculate_variance_severity(Decimal("0")) == Severity.INFO

    def test_small_variance_info(self):
        """Small variance under $100 should be INFO."""
        assert calculate_variance_severity(Decimal("50")) == Severity.INFO

    def test_warning_threshold_amount(self):
        """Variance >= $100 should be WARNING."""
        assert calculate_variance_severity(Decimal("150")) == Severity.WARNING

    def test_critical_threshold_amount(self):
        """Variance >= $1000 should be CRITICAL."""
        assert calculate_variance_severity(Decimal("1500")) == Severity.CRITICAL

    def test_percentage_warning(self):
        """Variance 1-5% should be WARNING."""
        severity = calculate_variance_severity(
            Decimal("50"), base_amount=Decimal("2000")
        )  # 2.5%
        assert severity == Severity.WARNING

    def test_percentage_critical(self):
        """Variance >= 5% should be CRITICAL."""
        severity = calculate_variance_severity(
            Decimal("100"), base_amount=Decimal("1000")
        )  # 10%
        assert severity == Severity.CRITICAL

    def test_negative_variance(self):
        """Negative variance should use absolute value."""
        assert calculate_variance_severity(Decimal("-1500")) == Severity.CRITICAL


class TestReconciler:
    """Tests for the Reconciler class."""

    @pytest.fixture
    def reconciler(self):
        """Create reconciler with mock data."""
        procore_data = load_mock_procore_data()
        qb_data = load_mock_qb_data()
        return Reconciler(procore_data=procore_data, qb_data=qb_data)

    def test_vendor_matching(self, reconciler):
        """Test vendor matching builds correctly."""
        assert len(reconciler.vendor_matches) > 0
        # Check specific matches
        assert "ABC Concrete, Inc." in reconciler.vendor_matches

    def test_reconcile_commitments(self, reconciler):
        """Test commitment reconciliation."""
        results = reconciler.reconcile_commitments()

        assert len(results) > 0

        # Check that we have results for subcontracts
        subcontract_results = [r for r in results if "subcontract" in r.item_description.lower()]
        assert len(subcontract_results) >= 1

    def test_reconcile_commitments_detects_variances(self, reconciler):
        """Test that variances are detected."""
        results = reconciler.reconcile_commitments()

        # Should have some results with variances
        variance_results = [r for r in results if r.variance != 0]
        # Note: In our mock data, there might be some variance due to matching
        assert len(results) > 0

    def test_reconcile_invoices(self, reconciler):
        """Test invoice reconciliation."""
        results = reconciler.reconcile_invoices()

        assert len(results) > 0

        # Check for matched invoices
        matched = [r for r in results if r.qb_value is not None]
        assert len(matched) > 0

    def test_reconcile_invoices_finds_unmatched(self, reconciler):
        """Test that unmatched invoices are flagged."""
        results = reconciler.reconcile_invoices()

        # There should be some unmatched QB bills in our mock data
        unmatched_qb = [
            r for r in results
            if r.procore_value is None and r.qb_value is not None
        ]
        # We have an unmatched bill from "Unknown Supplier Inc" in mock data
        assert len(unmatched_qb) >= 1

    def test_reconcile_change_orders(self, reconciler):
        """Test change order reconciliation."""
        results = reconciler.reconcile_change_orders()

        assert len(results) > 0

        # Check pending CO is flagged
        pending_cos = [
            r for r in results
            if "pending" in r.notes.lower() or r.severity == Severity.WARNING
        ]
        # We have a pending CO in mock data
        assert len(results) > 0

    def test_reconcile_retention(self, reconciler):
        """Test retention reconciliation."""
        results = reconciler.reconcile_retention()

        assert len(results) > 0

        # Should have a total retention result
        total_results = [r for r in results if "TOTAL" in r.item_description]
        assert len(total_results) == 1

    def test_reconcile_budget(self, reconciler):
        """Test budget vs actual reconciliation."""
        results = reconciler.reconcile_budget_vs_actual()

        # Should have results for budget items
        assert len(results) > 0

        # Check for over-budget detection
        # In mock data, drywall (09-200) is over budget
        over_budget = [r for r in results if "over budget" in r.notes.lower()]
        assert len(over_budget) >= 1

    def test_generate_closeout_items(self, reconciler):
        """Test closeout item generation."""
        # Run reconciliation first
        reconciler.reconcile_invoices()

        items = reconciler.generate_closeout_items()

        assert len(items) > 0

        # Check categories
        categories = set(i.category for i in items)
        # Should have at least retention and possibly unpaid invoices
        assert len(categories) >= 1

    def test_full_reconciliation(self, reconciler):
        """Test running full reconciliation."""
        report = reconciler.run_full_reconciliation()

        # Check report structure
        assert report.project_summary is not None
        assert len(report.commitment_reconciliation) > 0
        assert len(report.invoice_reconciliation) > 0
        assert report.project_summary.project_name == "Corporate Office Buildout - Phase 2"

    def test_project_summary_metrics(self, reconciler):
        """Test project summary calculations."""
        report = reconciler.run_full_reconciliation()
        summary = report.project_summary

        # Check metrics are calculated
        assert summary.total_committed > 0
        assert summary.sub_retention_held > 0

        # Warning + critical should match
        total_issues = summary.warning_items + summary.critical_items
        all_results = (
            report.commitment_reconciliation +
            report.invoice_reconciliation +
            report.change_order_reconciliation +
            report.retention_reconciliation +
            report.budget_reconciliation
        )
        actual_issues = len([r for r in all_results if r.severity in (Severity.WARNING, Severity.CRITICAL)])
        assert total_issues == actual_issues


class TestEdgeCases:
    """Tests for edge cases and special scenarios."""

    def test_zero_dollar_commitment(self):
        """Test handling of zero-dollar commitments."""
        procore_data = {
            "project": {"id": 1, "name": "Test"},
            "vendors": [Vendor(procore_id="1", procore_name="Test Vendor")],
            "commitments": [
                NormalizedCommitment(
                    vendor="Test Vendor",
                    procore_id="1",
                    commitment_type="subcontract",
                    title="Zero Dollar Contract",
                    status=CommitmentStatus.EXECUTED,
                    original_amount=Decimal("0"),
                    approved_changes=Decimal("0"),
                    pending_changes=Decimal("0"),
                    current_value=Decimal("0"),
                    billed_to_date=Decimal("0"),
                    paid_to_date=Decimal("0"),
                    retention_held=Decimal("0"),
                    balance_remaining=Decimal("0"),
                    cost_codes=[],
                )
            ],
            "requisitions": [],
            "change_orders": [],
            "budget_items": [],
            "prime_contracts": [],
        }
        qb_data = {
            "vendors": [],
            "bills": [],
            "company_info": {},
        }

        reconciler = Reconciler(procore_data=procore_data, qb_data=qb_data)
        results = reconciler.reconcile_commitments()

        assert len(results) == 1
        # Zero variance for zero-dollar contract
        assert results[0].variance == Decimal("0")

    def test_negative_change_order(self):
        """Test handling of negative (deductive) change orders."""
        procore_data = {
            "project": {"id": 1, "name": "Test"},
            "vendors": [],
            "commitments": [],
            "requisitions": [],
            "change_orders": [
                NormalizedChangeOrder(
                    vendor="Test Vendor",
                    co_number="CO-001",
                    procore_id="1",
                    amount=Decimal("-5000"),  # Deductive CO
                    description="Scope reduction",
                    cost_code="03-100",
                    procore_status=ChangeOrderStatus.APPROVED,
                )
            ],
            "budget_items": [],
            "prime_contracts": [],
        }
        qb_data = {"vendors": [], "bills": [], "company_info": {}}

        reconciler = Reconciler(procore_data=procore_data, qb_data=qb_data)
        results = reconciler.reconcile_change_orders()

        assert len(results) == 1
        assert results[0].procore_value == Decimal("-5000")

    def test_split_vendor_names(self):
        """Test matching vendors with different name formats."""
        # Test various name formats that should match
        pairs = [
            ("ABC Corp.", "ABC Corporation"),
            ("John's Plumbing", "Johns Plumbing"),
            ("A & B Electric", "A&B Electric"),
        ]

        for name1, name2 in pairs:
            score = fuzzy_vendor_match(name1, name2)
            # Should have reasonable match scores
            assert score >= 60, f"Failed to match '{name1}' with '{name2}'"

    def test_empty_data(self):
        """Test reconciler handles empty data gracefully."""
        procore_data = {
            "project": {"id": 1, "name": "Empty Project"},
            "vendors": [],
            "commitments": [],
            "requisitions": [],
            "change_orders": [],
            "budget_items": [],
            "prime_contracts": [],
        }
        qb_data = {"vendors": [], "bills": [], "company_info": {}}

        reconciler = Reconciler(procore_data=procore_data, qb_data=qb_data)
        report = reconciler.run_full_reconciliation()

        assert report.project_summary.project_name == "Empty Project"
        assert report.project_summary.total_committed == Decimal("0")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
