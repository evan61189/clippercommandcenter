"""
Procore REST API client for financial closeout reconciliation.

Connects to Procore REST API v1.0+ using OAuth 2.0 authentication
to retrieve project financial data including commitments, change orders,
invoices, budget, and vendors.
"""

import logging
import os
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Generator, Optional
from urllib.parse import urljoin

import requests
from dotenv import load_dotenv

from .models import (
    BudgetLineItem,
    ChangeOrderStatus,
    CommitmentStatus,
    CostCode,
    DirectCost,
    InvoiceStatus,
    NormalizedChangeOrder,
    NormalizedCommitment,
    NormalizedInvoice,
    PrimeContract,
    TokenInfo,
    Vendor,
)

load_dotenv()

logger = logging.getLogger(__name__)


class ProcoreAPIError(Exception):
    """Exception raised for Procore API errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        response_body: Optional[dict] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class ProcoreRateLimitError(ProcoreAPIError):
    """Exception raised when rate limited by Procore."""

    def __init__(self, retry_after: int = 60):
        super().__init__(f"Rate limited. Retry after {retry_after} seconds.")
        self.retry_after = retry_after


class ProcoreClient:
    """
    Client for Procore REST API v1.0+.

    Handles OAuth 2.0 authentication, automatic token refresh,
    pagination, and rate limiting.
    """

    BASE_URL = "https://api.procore.com"
    DEFAULT_PAGE_SIZE = 100
    MAX_RETRIES = 3
    BACKOFF_BASE = 2

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        company_id: Optional[str] = None,
    ):
        """
        Initialize Procore client.

        Args:
            client_id: OAuth client ID (defaults to PROCORE_CLIENT_ID env var)
            client_secret: OAuth client secret (defaults to PROCORE_CLIENT_SECRET env var)
            access_token: OAuth access token (defaults to PROCORE_ACCESS_TOKEN env var)
            refresh_token: OAuth refresh token (defaults to PROCORE_REFRESH_TOKEN env var)
            company_id: Procore company ID (defaults to PROCORE_COMPANY_ID env var)
        """
        self.client_id = client_id or os.getenv("PROCORE_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("PROCORE_CLIENT_SECRET")
        self.access_token = access_token or os.getenv("PROCORE_ACCESS_TOKEN")
        self.refresh_token = refresh_token or os.getenv("PROCORE_REFRESH_TOKEN")
        self.company_id = company_id or os.getenv("PROCORE_COMPANY_ID")

        self._session = requests.Session()
        self._token_expires_at: Optional[datetime] = None

        if not self.access_token:
            raise ProcoreAPIError(
                "Access token required. Provide access_token or set PROCORE_ACCESS_TOKEN env var."
            )

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with authorization."""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Procore-Company-Id": str(self.company_id) if self.company_id else "",
        }

    def _refresh_access_token(self) -> None:
        """Refresh the OAuth access token using the refresh token."""
        if not self.refresh_token or not self.client_id or not self.client_secret:
            raise ProcoreAPIError(
                "Cannot refresh token: missing refresh_token, client_id, or client_secret"
            )

        url = f"{self.BASE_URL}/oauth/token"
        data = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }

        response = self._session.post(url, data=data)
        if response.status_code != 200:
            raise ProcoreAPIError(
                f"Token refresh failed: {response.text}",
                status_code=response.status_code,
            )

        token_data = response.json()
        self.access_token = token_data["access_token"]
        self.refresh_token = token_data.get("refresh_token", self.refresh_token)

        if "expires_in" in token_data:
            from datetime import timedelta

            self._token_expires_at = datetime.now() + timedelta(
                seconds=token_data["expires_in"]
            )

        logger.info("Successfully refreshed Procore access token")

    def _should_refresh_token(self) -> bool:
        """Check if token should be refreshed."""
        if not self._token_expires_at:
            return False
        from datetime import timedelta

        return datetime.now() >= self._token_expires_at - timedelta(minutes=5)

    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
        retry_count: int = 0,
    ) -> dict | list:
        """
        Make an authenticated API request with retry logic.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (will be joined with BASE_URL)
            params: Query parameters
            json_data: JSON body for POST/PUT requests
            retry_count: Current retry attempt

        Returns:
            Response JSON data

        Raises:
            ProcoreAPIError: On API errors
            ProcoreRateLimitError: When rate limited
        """
        if self._should_refresh_token():
            self._refresh_access_token()

        url = urljoin(self.BASE_URL, endpoint)
        headers = self._get_headers()

        logger.debug(f"Procore API request: {method} {url} params={params}")

        try:
            response = self._session.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_data,
                timeout=30,
            )

            # Handle rate limiting
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 60))
                if retry_count < self.MAX_RETRIES:
                    wait_time = min(retry_after, self.BACKOFF_BASE ** (retry_count + 1))
                    logger.warning(
                        f"Rate limited. Waiting {wait_time}s before retry {retry_count + 1}"
                    )
                    time.sleep(wait_time)
                    return self._request(
                        method, endpoint, params, json_data, retry_count + 1
                    )
                raise ProcoreRateLimitError(retry_after)

            # Handle token expiration
            if response.status_code == 401:
                if retry_count < 1:
                    logger.info("Token expired, attempting refresh")
                    self._refresh_access_token()
                    return self._request(
                        method, endpoint, params, json_data, retry_count + 1
                    )
                raise ProcoreAPIError(
                    "Authentication failed after token refresh",
                    status_code=401,
                )

            # Handle other errors
            if response.status_code >= 400:
                error_body = None
                try:
                    error_body = response.json()
                except Exception:
                    pass
                raise ProcoreAPIError(
                    f"API error: {response.status_code} - {response.text}",
                    status_code=response.status_code,
                    response_body=error_body,
                )

            return response.json()

        except requests.exceptions.RequestException as e:
            if retry_count < self.MAX_RETRIES:
                wait_time = self.BACKOFF_BASE ** (retry_count + 1)
                logger.warning(
                    f"Request failed: {e}. Waiting {wait_time}s before retry"
                )
                time.sleep(wait_time)
                return self._request(
                    method, endpoint, params, json_data, retry_count + 1
                )
            raise ProcoreAPIError(f"Request failed after retries: {e}")

    def _paginate(
        self,
        endpoint: str,
        params: Optional[dict] = None,
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> Generator[dict, None, None]:
        """
        Iterate through paginated results.

        Args:
            endpoint: API endpoint
            params: Base query parameters
            page_size: Number of results per page

        Yields:
            Individual records from paginated responses
        """
        params = params or {}
        params["per_page"] = page_size
        page = 1

        while True:
            params["page"] = page
            response = self._request("GET", endpoint, params=params)

            if isinstance(response, list):
                if not response:
                    break
                yield from response
                if len(response) < page_size:
                    break
            else:
                # Some endpoints return data in a nested structure
                data = response.get("data", response.get("items", []))
                if not data:
                    break
                yield from data
                if len(data) < page_size:
                    break

            page += 1

    def get_project(self, project_id: int) -> dict:
        """Get project details."""
        endpoint = f"/rest/v1.0/projects/{project_id}"
        return self._request("GET", endpoint)

    def get_vendors(self, project_id: int) -> list[Vendor]:
        """
        Get all vendors for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of normalized Vendor objects
        """
        endpoint = f"/rest/v1.0/vendors"
        params = {"project_id": project_id}

        vendors = []
        for vendor_data in self._paginate(endpoint, params):
            vendors.append(
                Vendor(
                    procore_id=str(vendor_data.get("id")),
                    procore_name=vendor_data.get("name"),
                    origin_id=vendor_data.get("origin_id"),
                    is_matched=False,
                )
            )

        logger.info(f"Retrieved {len(vendors)} vendors from Procore")
        return vendors

    def get_budget_view_detail(
        self, project_id: int, budget_view_id: int
    ) -> list[BudgetLineItem]:
        """
        Get budget line items from a budget view.

        Args:
            project_id: Procore project ID
            budget_view_id: Budget view ID

        Returns:
            List of BudgetLineItem objects
        """
        endpoint = f"/rest/v1.0/budget_views/{budget_view_id}/detail_rows"
        params = {"project_id": project_id}

        items = []
        for row in self._paginate(endpoint, params):
            cost_code = row.get("cost_code", {})
            items.append(
                BudgetLineItem(
                    cost_code=cost_code.get("full_code", ""),
                    description=cost_code.get("name", row.get("description", "")),
                    original_budget=Decimal(str(row.get("original_budget_amount", 0))),
                    approved_changes=Decimal(str(row.get("approved_cos", 0))),
                    revised_budget=Decimal(str(row.get("revised_budget", 0))),
                    pending_changes=Decimal(str(row.get("pending_changes", 0))),
                    committed_costs=Decimal(str(row.get("committed_costs", 0))),
                    direct_costs=Decimal(str(row.get("direct_costs", 0))),
                    job_to_date_costs=Decimal(str(row.get("job_to_date_costs", 0))),
                    projected_costs=Decimal(str(row.get("projected_costs", 0))),
                )
            )

        logger.info(f"Retrieved {len(items)} budget line items from Procore")
        return items

    def get_budget_views(self, project_id: int) -> list[dict]:
        """Get available budget views for a project."""
        endpoint = "/rest/v1.0/budget_views"
        params = {"project_id": project_id}
        views = list(self._paginate(endpoint, params))
        logger.info(f"Retrieved {len(views)} budget views")
        return views

    def get_cost_codes(self, project_id: int) -> list[CostCode]:
        """
        Get all cost codes for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of CostCode objects
        """
        endpoint = "/rest/v1.0/cost_codes"
        params = {"project_id": project_id}

        codes = []
        for code_data in self._paginate(endpoint, params):
            full_code = code_data.get("full_code", "")
            division = full_code.split("-")[0] if "-" in full_code else full_code[:2]

            codes.append(
                CostCode(
                    code=full_code,
                    description=code_data.get("name", ""),
                    csi_division=division,
                    parent_code=code_data.get("parent", {}).get("full_code"),
                )
            )

        logger.info(f"Retrieved {len(codes)} cost codes from Procore")
        return codes

    def _parse_commitment_status(self, status: str) -> CommitmentStatus:
        """Parse commitment status string to enum."""
        status_map = {
            "draft": CommitmentStatus.DRAFT,
            "pending": CommitmentStatus.PENDING,
            "approved": CommitmentStatus.APPROVED,
            "executed": CommitmentStatus.EXECUTED,
            "complete": CommitmentStatus.COMPLETE,
            "closed": CommitmentStatus.COMPLETE,
            "void": CommitmentStatus.VOID,
        }
        return status_map.get(status.lower(), CommitmentStatus.DRAFT)

    def get_subcontracts(self, project_id: int) -> list[NormalizedCommitment]:
        """
        Get all subcontracts (work order contracts) for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of NormalizedCommitment objects
        """
        endpoint = "/rest/v1.0/work_order_contracts"
        params = {"project_id": project_id}

        commitments = []
        for contract in self._paginate(endpoint, params):
            vendor = contract.get("vendor", {})
            vendor_name = vendor.get("name", "Unknown Vendor") if vendor else "Unknown Vendor"

            original = Decimal(str(contract.get("grand_total", 0) or 0))
            approved_cos = Decimal(str(contract.get("approved_change_orders", 0) or 0))
            pending_cos = Decimal(str(contract.get("pending_change_orders", 0) or 0))
            current_value = original + approved_cos
            billed = Decimal(str(contract.get("bill_amount", 0) or 0))
            paid = Decimal(str(contract.get("paid_amount", 0) or 0))
            retention = Decimal(str(contract.get("retention_amount", 0) or 0))

            # Get cost codes from line items
            cost_codes = []
            line_items = contract.get("line_items", [])
            for item in line_items:
                cc = item.get("cost_code", {})
                if cc and cc.get("full_code"):
                    cost_codes.append(cc.get("full_code"))

            execution_date = None
            if contract.get("executed_date"):
                try:
                    execution_date = date.fromisoformat(
                        contract["executed_date"].split("T")[0]
                    )
                except (ValueError, AttributeError):
                    pass

            commitments.append(
                NormalizedCommitment(
                    vendor=vendor_name,
                    procore_id=str(contract.get("id")),
                    commitment_type="subcontract",
                    title=contract.get("title", ""),
                    status=self._parse_commitment_status(contract.get("status", "draft")),
                    original_amount=original,
                    approved_changes=approved_cos,
                    pending_changes=pending_cos,
                    current_value=current_value,
                    billed_to_date=billed,
                    paid_to_date=paid,
                    retention_held=retention,
                    balance_remaining=current_value - billed,
                    cost_codes=list(set(cost_codes)),
                    execution_date=execution_date,
                )
            )

        logger.info(f"Retrieved {len(commitments)} subcontracts from Procore")
        return commitments

    def get_purchase_orders(self, project_id: int) -> list[NormalizedCommitment]:
        """
        Get all purchase orders for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of NormalizedCommitment objects
        """
        endpoint = "/rest/v1.0/purchase_order_contracts"
        params = {"project_id": project_id}

        commitments = []
        for contract in self._paginate(endpoint, params):
            vendor = contract.get("vendor", {})
            vendor_name = vendor.get("name", "Unknown Vendor") if vendor else "Unknown Vendor"

            original = Decimal(str(contract.get("grand_total", 0) or 0))
            approved_cos = Decimal(str(contract.get("approved_change_orders", 0) or 0))
            pending_cos = Decimal(str(contract.get("pending_change_orders", 0) or 0))
            current_value = original + approved_cos
            billed = Decimal(str(contract.get("bill_amount", 0) or 0))
            paid = Decimal(str(contract.get("paid_amount", 0) or 0))

            # Get cost codes from line items
            cost_codes = []
            line_items = contract.get("line_items", [])
            for item in line_items:
                cc = item.get("cost_code", {})
                if cc and cc.get("full_code"):
                    cost_codes.append(cc.get("full_code"))

            commitments.append(
                NormalizedCommitment(
                    vendor=vendor_name,
                    procore_id=str(contract.get("id")),
                    commitment_type="purchase_order",
                    title=contract.get("title", ""),
                    status=self._parse_commitment_status(contract.get("status", "draft")),
                    original_amount=original,
                    approved_changes=approved_cos,
                    pending_changes=pending_cos,
                    current_value=current_value,
                    billed_to_date=billed,
                    paid_to_date=paid,
                    retention_held=Decimal("0"),  # POs typically don't have retention
                    balance_remaining=current_value - billed,
                    cost_codes=list(set(cost_codes)),
                )
            )

        logger.info(f"Retrieved {len(commitments)} purchase orders from Procore")
        return commitments

    def get_all_commitments(self, project_id: int) -> list[NormalizedCommitment]:
        """
        Get all commitments (subcontracts and purchase orders) for a project.

        Args:
            project_id: Procore project ID

        Returns:
            Combined list of NormalizedCommitment objects
        """
        subcontracts = self.get_subcontracts(project_id)
        purchase_orders = self.get_purchase_orders(project_id)
        return subcontracts + purchase_orders

    def _parse_invoice_status(self, status: str) -> InvoiceStatus:
        """Parse invoice status string to enum."""
        status_map = {
            "draft": InvoiceStatus.DRAFT,
            "submitted": InvoiceStatus.SUBMITTED,
            "approved": InvoiceStatus.APPROVED,
            "paid": InvoiceStatus.PAID,
            "partially_paid": InvoiceStatus.PARTIALLY_PAID,
            "rejected": InvoiceStatus.REJECTED,
            "void": InvoiceStatus.VOID,
            "pending": InvoiceStatus.SUBMITTED,
        }
        return status_map.get(status.lower(), InvoiceStatus.DRAFT)

    def get_requisitions(
        self, project_id: int, contract_id: int, contract_type: str = "work_order"
    ) -> list[NormalizedInvoice]:
        """
        Get all requisitions (pay apps) for a specific contract.

        Args:
            project_id: Procore project ID
            contract_id: Contract ID
            contract_type: 'work_order' or 'purchase_order'

        Returns:
            List of NormalizedInvoice objects
        """
        if contract_type == "work_order":
            endpoint = f"/rest/v1.0/work_order_contracts/{contract_id}/requisitions"
        else:
            endpoint = f"/rest/v1.0/purchase_order_contracts/{contract_id}/requisitions"

        params = {"project_id": project_id}

        invoices = []
        for req in self._paginate(endpoint, params):
            vendor = req.get("vendor", {})
            vendor_name = vendor.get("name", "Unknown Vendor") if vendor else "Unknown Vendor"

            amount = Decimal(str(req.get("amount", 0) or 0))
            retention = Decimal(str(req.get("retention", 0) or 0))
            net_amount = amount - retention
            payment_amount = Decimal(str(req.get("payment_amount", 0) or 0))

            invoice_date = None
            if req.get("invoice_date") or req.get("created_at"):
                try:
                    date_str = req.get("invoice_date") or req.get("created_at")
                    invoice_date = date.fromisoformat(date_str.split("T")[0])
                except (ValueError, AttributeError):
                    invoice_date = date.today()

            payment_date = None
            if req.get("payment_date"):
                try:
                    payment_date = date.fromisoformat(
                        req["payment_date"].split("T")[0]
                    )
                except (ValueError, AttributeError):
                    pass

            invoices.append(
                NormalizedInvoice(
                    vendor=vendor_name,
                    invoice_number=str(req.get("number", req.get("id", ""))),
                    procore_id=str(req.get("id")),
                    commitment_id=str(contract_id),
                    amount=amount,
                    retention_amount=retention,
                    net_amount=net_amount,
                    invoice_date=invoice_date or date.today(),
                    procore_status=self._parse_invoice_status(req.get("status", "draft")),
                    payment_date=payment_date,
                    payment_amount=payment_amount,
                )
            )

        return invoices

    def get_all_requisitions(self, project_id: int) -> list[NormalizedInvoice]:
        """
        Get all requisitions across all commitments for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of all NormalizedInvoice objects
        """
        all_invoices = []

        # Get requisitions from subcontracts
        subcontracts = self.get_subcontracts(project_id)
        for commitment in subcontracts:
            if commitment.procore_id:
                invoices = self.get_requisitions(
                    project_id, int(commitment.procore_id), "work_order"
                )
                all_invoices.extend(invoices)

        # Get requisitions from purchase orders
        purchase_orders = self.get_purchase_orders(project_id)
        for commitment in purchase_orders:
            if commitment.procore_id:
                invoices = self.get_requisitions(
                    project_id, int(commitment.procore_id), "purchase_order"
                )
                all_invoices.extend(invoices)

        logger.info(f"Retrieved {len(all_invoices)} total requisitions from Procore")
        return all_invoices

    def _parse_co_status(self, status: str) -> ChangeOrderStatus:
        """Parse change order status string to enum."""
        status_map = {
            "draft": ChangeOrderStatus.DRAFT,
            "pending": ChangeOrderStatus.PENDING,
            "approved": ChangeOrderStatus.APPROVED,
            "rejected": ChangeOrderStatus.REJECTED,
            "void": ChangeOrderStatus.VOID,
        }
        return status_map.get(status.lower(), ChangeOrderStatus.DRAFT)

    def get_commitment_change_orders(
        self, project_id: int, contract_id: int, contract_type: str = "work_order"
    ) -> list[NormalizedChangeOrder]:
        """
        Get change orders for a specific commitment.

        Args:
            project_id: Procore project ID
            contract_id: Contract ID
            contract_type: 'work_order' or 'purchase_order'

        Returns:
            List of NormalizedChangeOrder objects
        """
        if contract_type == "work_order":
            endpoint = (
                f"/rest/v1.0/work_order_contracts/{contract_id}/change_order_packages"
            )
        else:
            endpoint = f"/rest/v1.0/purchase_order_contracts/{contract_id}/change_order_packages"

        params = {"project_id": project_id}

        change_orders = []
        for co in self._paginate(endpoint, params):
            vendor = co.get("vendor", {})
            vendor_name = vendor.get("name", "Unknown Vendor") if vendor else "Unknown Vendor"

            cost_code = None
            if co.get("line_items"):
                first_item = co["line_items"][0]
                cc = first_item.get("cost_code", {})
                cost_code = cc.get("full_code") if cc else None

            created_date = None
            if co.get("created_at"):
                try:
                    created_date = date.fromisoformat(co["created_at"].split("T")[0])
                except (ValueError, AttributeError):
                    pass

            approved_date = None
            if co.get("approved_date"):
                try:
                    approved_date = date.fromisoformat(
                        co["approved_date"].split("T")[0]
                    )
                except (ValueError, AttributeError):
                    pass

            change_orders.append(
                NormalizedChangeOrder(
                    vendor=vendor_name,
                    co_number=str(co.get("number", co.get("id", ""))),
                    procore_id=str(co.get("id")),
                    commitment_id=str(contract_id),
                    amount=Decimal(str(co.get("amount", 0) or 0)),
                    description=co.get("title", co.get("description", "")),
                    cost_code=cost_code,
                    procore_status=self._parse_co_status(co.get("status", "draft")),
                    created_date=created_date,
                    approved_date=approved_date,
                )
            )

        return change_orders

    def get_all_change_orders(self, project_id: int) -> list[NormalizedChangeOrder]:
        """
        Get all commitment change orders for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of all NormalizedChangeOrder objects
        """
        all_cos = []

        commitments = self.get_all_commitments(project_id)
        for commitment in commitments:
            if commitment.procore_id:
                contract_type = (
                    "work_order"
                    if commitment.commitment_type == "subcontract"
                    else "purchase_order"
                )
                cos = self.get_commitment_change_orders(
                    project_id, int(commitment.procore_id), contract_type
                )
                all_cos.extend(cos)

        logger.info(f"Retrieved {len(all_cos)} change orders from Procore")
        return all_cos

    def get_change_events(self, project_id: int) -> list[dict]:
        """
        Get all change events for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of change event dictionaries
        """
        endpoint = "/rest/v1.0/change_events"
        params = {"project_id": project_id}

        events = list(self._paginate(endpoint, params))
        logger.info(f"Retrieved {len(events)} change events from Procore")
        return events

    def get_direct_costs(self, project_id: int) -> list[DirectCost]:
        """
        Get all direct costs for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of DirectCost objects
        """
        endpoint = "/rest/v1.0/direct_costs"
        params = {"project_id": project_id}

        costs = []
        for cost_data in self._paginate(endpoint, params):
            vendor = cost_data.get("vendor", {})
            vendor_name = vendor.get("name") if vendor else None

            cost_code = cost_data.get("cost_code", {})
            code_str = cost_code.get("full_code", "") if cost_code else ""

            txn_date = date.today()
            if cost_data.get("invoice_date") or cost_data.get("created_at"):
                try:
                    date_str = cost_data.get("invoice_date") or cost_data.get(
                        "created_at"
                    )
                    txn_date = date.fromisoformat(date_str.split("T")[0])
                except (ValueError, AttributeError):
                    pass

            costs.append(
                DirectCost(
                    id=str(cost_data.get("id")),
                    vendor=vendor_name,
                    amount=Decimal(str(cost_data.get("amount", 0) or 0)),
                    cost_code=code_str,
                    description=cost_data.get("description", ""),
                    invoice_number=cost_data.get("invoice_number"),
                    transaction_date=txn_date,
                )
            )

        logger.info(f"Retrieved {len(costs)} direct costs from Procore")
        return costs

    def get_prime_contracts(self, project_id: int) -> list[PrimeContract]:
        """
        Get prime contracts for a project.

        Args:
            project_id: Procore project ID

        Returns:
            List of PrimeContract objects
        """
        endpoint = "/rest/v1.0/prime_contracts"
        params = {"project_id": project_id}

        contracts = []
        for contract_data in self._paginate(endpoint, params):
            original = Decimal(str(contract_data.get("grand_total", 0) or 0))
            approved_cos = Decimal(
                str(contract_data.get("approved_change_orders", 0) or 0)
            )

            contracts.append(
                PrimeContract(
                    id=str(contract_data.get("id")),
                    title=contract_data.get("title", ""),
                    number=contract_data.get("number"),
                    status=contract_data.get("status", ""),
                    original_value=original,
                    approved_changes=approved_cos,
                    revised_value=original + approved_cos,
                    billed_to_date=Decimal(
                        str(contract_data.get("billing_amount", 0) or 0)
                    ),
                    received_to_date=Decimal(
                        str(contract_data.get("received_amount", 0) or 0)
                    ),
                    retention_held=Decimal(
                        str(contract_data.get("retention_amount", 0) or 0)
                    ),
                )
            )

        logger.info(f"Retrieved {len(contracts)} prime contracts from Procore")
        return contracts

    def get_full_project_data(self, project_id: int) -> dict[str, Any]:
        """
        Retrieve all financial data for a project.

        Args:
            project_id: Procore project ID

        Returns:
            Dictionary containing all project financial data
        """
        logger.info(f"Fetching full project data for project {project_id}")

        project = self.get_project(project_id)
        vendors = self.get_vendors(project_id)
        cost_codes = self.get_cost_codes(project_id)
        commitments = self.get_all_commitments(project_id)
        requisitions = self.get_all_requisitions(project_id)
        change_orders = self.get_all_change_orders(project_id)
        direct_costs = self.get_direct_costs(project_id)
        prime_contracts = self.get_prime_contracts(project_id)
        change_events = self.get_change_events(project_id)

        # Try to get budget data
        budget_items = []
        try:
            budget_views = self.get_budget_views(project_id)
            if budget_views:
                # Use the first (usually default) budget view
                budget_view_id = budget_views[0].get("id")
                if budget_view_id:
                    budget_items = self.get_budget_view_detail(project_id, budget_view_id)
        except ProcoreAPIError as e:
            logger.warning(f"Could not fetch budget data: {e}")

        data = {
            "project": project,
            "vendors": vendors,
            "cost_codes": cost_codes,
            "commitments": commitments,
            "requisitions": requisitions,
            "change_orders": change_orders,
            "direct_costs": direct_costs,
            "prime_contracts": prime_contracts,
            "change_events": change_events,
            "budget_items": budget_items,
        }

        logger.info(
            f"Project data summary: {len(commitments)} commitments, "
            f"{len(requisitions)} invoices, {len(change_orders)} COs, "
            f"{len(direct_costs)} direct costs"
        )

        return data

    def get_token_info(self) -> TokenInfo:
        """Get current token information."""
        return TokenInfo(
            access_token=self.access_token or "",
            refresh_token=self.refresh_token or "",
            expires_at=self._token_expires_at,
        )
