"""
QuickBooks Online API client for financial closeout reconciliation.

Connects to QuickBooks Online Accounting API using OAuth 2.0 authentication
to retrieve financial data including vendors, bills, payments, and accounts.
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
    InvoiceStatus,
    NormalizedCommitment,
    NormalizedInvoice,
    QBAccount,
    TokenInfo,
    Vendor,
)

load_dotenv()

logger = logging.getLogger(__name__)


class QBOAPIError(Exception):
    """Exception raised for QuickBooks Online API errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        error_code: Optional[str] = None,
        response_body: Optional[dict] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.response_body = response_body


class QBORateLimitError(QBOAPIError):
    """Exception raised when rate limited by QuickBooks Online."""

    def __init__(self, retry_after: int = 60):
        super().__init__(f"Rate limited. Retry after {retry_after} seconds.")
        self.retry_after = retry_after


class QuickBooksClient:
    """
    Client for QuickBooks Online Accounting API.

    Handles OAuth 2.0 authentication, automatic token refresh,
    query execution, and rate limiting.
    """

    PRODUCTION_BASE_URL = "https://quickbooks.api.intuit.com"
    SANDBOX_BASE_URL = "https://sandbox-quickbooks.api.intuit.com"
    TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

    MAX_RETRIES = 3
    BACKOFF_BASE = 2
    MAX_QUERY_RESULTS = 1000

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        realm_id: Optional[str] = None,
        sandbox: bool = False,
    ):
        """
        Initialize QuickBooks Online client.

        Args:
            client_id: OAuth client ID (defaults to QBO_CLIENT_ID env var)
            client_secret: OAuth client secret (defaults to QBO_CLIENT_SECRET env var)
            access_token: OAuth access token (defaults to QBO_ACCESS_TOKEN env var)
            refresh_token: OAuth refresh token (defaults to QBO_REFRESH_TOKEN env var)
            realm_id: QuickBooks company/realm ID (defaults to QBO_REALM_ID env var)
            sandbox: Whether to use sandbox environment
        """
        self.client_id = client_id or os.getenv("QBO_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("QBO_CLIENT_SECRET")
        self.access_token = access_token or os.getenv("QBO_ACCESS_TOKEN")
        self.refresh_token = refresh_token or os.getenv("QBO_REFRESH_TOKEN")
        self.realm_id = realm_id or os.getenv("QBO_REALM_ID")
        self.sandbox = sandbox

        self.base_url = self.SANDBOX_BASE_URL if sandbox else self.PRODUCTION_BASE_URL
        self._session = requests.Session()
        self._token_expires_at: Optional[datetime] = None

        if not self.access_token:
            raise QBOAPIError(
                "Access token required. Provide access_token or set QBO_ACCESS_TOKEN env var."
            )
        if not self.realm_id:
            raise QBOAPIError(
                "Realm ID required. Provide realm_id or set QBO_REALM_ID env var."
            )

    def _get_api_url(self, endpoint: str) -> str:
        """Build full API URL with realm ID."""
        return f"{self.base_url}/v3/company/{self.realm_id}/{endpoint}"

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with authorization."""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _refresh_access_token(self) -> None:
        """Refresh the OAuth access token using the refresh token."""
        if not self.refresh_token or not self.client_id or not self.client_secret:
            raise QBOAPIError(
                "Cannot refresh token: missing refresh_token, client_id, or client_secret"
            )

        import base64

        auth_header = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()

        headers = {
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }

        data = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
        }

        response = self._session.post(self.TOKEN_URL, headers=headers, data=data)

        if response.status_code != 200:
            raise QBOAPIError(
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

        logger.info("Successfully refreshed QuickBooks access token")

    def _should_refresh_token(self) -> bool:
        """Check if token should be refreshed (QBO tokens expire in 1 hour)."""
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
    ) -> dict:
        """
        Make an authenticated API request with retry logic.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint
            params: Query parameters
            json_data: JSON body for POST requests
            retry_count: Current retry attempt

        Returns:
            Response JSON data

        Raises:
            QBOAPIError: On API errors
            QBORateLimitError: When rate limited
        """
        if self._should_refresh_token():
            self._refresh_access_token()

        url = self._get_api_url(endpoint)
        headers = self._get_headers()

        logger.debug(f"QBO API request: {method} {url}")

        try:
            response = self._session.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_data,
                timeout=30,
            )

            # Handle rate limiting (HTTP 429 or specific Intuit throttle codes)
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
                raise QBORateLimitError(retry_after)

            # Handle token expiration
            if response.status_code == 401:
                if retry_count < 1:
                    logger.info("Token expired, attempting refresh")
                    self._refresh_access_token()
                    return self._request(
                        method, endpoint, params, json_data, retry_count + 1
                    )
                raise QBOAPIError(
                    "Authentication failed after token refresh",
                    status_code=401,
                )

            # Handle other errors
            if response.status_code >= 400:
                error_body = None
                error_code = None
                try:
                    error_body = response.json()
                    fault = error_body.get("Fault", {})
                    if fault.get("Error"):
                        error_code = fault["Error"][0].get("code")
                except Exception:
                    pass
                raise QBOAPIError(
                    f"API error: {response.status_code} - {response.text}",
                    status_code=response.status_code,
                    error_code=error_code,
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
            raise QBOAPIError(f"Request failed after retries: {e}")

    def _query(
        self, query: str, start_position: int = 1, max_results: int = MAX_QUERY_RESULTS
    ) -> dict:
        """
        Execute a QBO query.

        Args:
            query: SQL-like query string
            start_position: Starting position for pagination (1-indexed)
            max_results: Maximum results to return

        Returns:
            Query response
        """
        # Add pagination to query if not present
        if "STARTPOSITION" not in query.upper():
            query = f"{query} STARTPOSITION {start_position} MAXRESULTS {max_results}"

        endpoint = "query"
        params = {"query": query}

        return self._request("GET", endpoint, params=params)

    def _paginated_query(
        self, base_query: str, entity_name: str
    ) -> Generator[dict, None, None]:
        """
        Execute a paginated query and yield all results.

        Args:
            base_query: Base query without pagination
            entity_name: Entity name for accessing results

        Yields:
            Individual entity records
        """
        start_position = 1
        max_results = self.MAX_QUERY_RESULTS

        while True:
            query = f"{base_query} STARTPOSITION {start_position} MAXRESULTS {max_results}"
            response = self._query(query, start_position, max_results)

            query_response = response.get("QueryResponse", {})
            entities = query_response.get(entity_name, [])

            if not entities:
                break

            yield from entities

            if len(entities) < max_results:
                break

            start_position += max_results

    def get_company_info(self) -> dict:
        """Get company/realm information."""
        endpoint = f"companyinfo/{self.realm_id}"
        response = self._request("GET", endpoint)
        return response.get("CompanyInfo", {})

    def get_accounts(self, account_type: Optional[str] = None) -> list[QBAccount]:
        """
        Get chart of accounts.

        Args:
            account_type: Optional filter by account type (Expense, Income, etc.)

        Returns:
            List of QBAccount objects
        """
        query = "SELECT * FROM Account WHERE Active = true"
        if account_type:
            query += f" AND AccountType = '{account_type}'"

        accounts = []
        for account in self._paginated_query(query, "Account"):
            accounts.append(
                QBAccount(
                    id=str(account.get("Id")),
                    name=account.get("Name", ""),
                    account_type=account.get("AccountType", ""),
                    account_sub_type=account.get("AccountSubType"),
                    fully_qualified_name=account.get("FullyQualifiedName"),
                    active=account.get("Active", True),
                )
            )

        logger.info(f"Retrieved {len(accounts)} accounts from QuickBooks")
        return accounts

    def get_expense_accounts(self) -> list[QBAccount]:
        """Get expense and COGS accounts (for cost code mapping)."""
        accounts = []

        # Get Expense accounts
        expense_accounts = self.get_accounts("Expense")
        accounts.extend(expense_accounts)

        # Get Cost of Goods Sold accounts
        cogs_accounts = self.get_accounts("Cost of Goods Sold")
        accounts.extend(cogs_accounts)

        return accounts

    def get_vendors(self) -> list[Vendor]:
        """
        Get all active vendors.

        Returns:
            List of normalized Vendor objects
        """
        query = "SELECT * FROM Vendor WHERE Active = true"

        vendors = []
        for vendor_data in self._paginated_query(query, "Vendor"):
            vendors.append(
                Vendor(
                    qb_id=str(vendor_data.get("Id")),
                    qb_name=vendor_data.get("DisplayName", ""),
                    is_matched=False,
                )
            )

        logger.info(f"Retrieved {len(vendors)} vendors from QuickBooks")
        return vendors

    def get_vendor_by_name(self, name: str) -> Optional[dict]:
        """Get a vendor by display name."""
        # Escape single quotes in the name
        safe_name = name.replace("'", "\\'")
        query = f"SELECT * FROM Vendor WHERE DisplayName = '{safe_name}'"
        response = self._query(query)

        vendors = response.get("QueryResponse", {}).get("Vendor", [])
        return vendors[0] if vendors else None

    def get_customers(self) -> list[dict]:
        """
        Get all customers (used as projects in job costing).

        Returns:
            List of customer dictionaries
        """
        query = "SELECT * FROM Customer WHERE Active = true"
        customers = list(self._paginated_query(query, "Customer"))
        logger.info(f"Retrieved {len(customers)} customers from QuickBooks")
        return customers

    def get_customer_by_name(self, name: str) -> Optional[dict]:
        """Get a customer/project by display name."""
        safe_name = name.replace("'", "\\'")
        query = f"SELECT * FROM Customer WHERE DisplayName LIKE '%{safe_name}%'"
        response = self._query(query)

        customers = response.get("QueryResponse", {}).get("Customer", [])
        return customers[0] if customers else None

    def _parse_bill_status(self, bill: dict) -> InvoiceStatus:
        """Determine bill payment status."""
        total = Decimal(str(bill.get("TotalAmt", 0)))
        balance = Decimal(str(bill.get("Balance", 0)))

        if balance == 0:
            return InvoiceStatus.PAID
        elif balance < total:
            return InvoiceStatus.PARTIALLY_PAID
        else:
            return InvoiceStatus.APPROVED  # In QB, a bill is "approved" when entered

    def get_bills(
        self,
        vendor_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> list[NormalizedInvoice]:
        """
        Get bills (accounts payable).

        Args:
            vendor_id: Optional filter by vendor ID
            customer_id: Optional filter by customer/project ID
            start_date: Optional start date filter
            end_date: Optional end date filter

        Returns:
            List of NormalizedInvoice objects
        """
        query = "SELECT * FROM Bill"
        conditions = []

        if vendor_id:
            conditions.append(f"VendorRef = '{vendor_id}'")
        if start_date:
            conditions.append(f"TxnDate >= '{start_date.isoformat()}'")
        if end_date:
            conditions.append(f"TxnDate <= '{end_date.isoformat()}'")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        invoices = []
        for bill in self._paginated_query(query, "Bill"):
            vendor_ref = bill.get("VendorRef", {})
            vendor_name = vendor_ref.get("name", "Unknown Vendor")

            # Parse transaction date
            txn_date = date.today()
            if bill.get("TxnDate"):
                try:
                    txn_date = date.fromisoformat(bill["TxnDate"])
                except (ValueError, AttributeError):
                    pass

            # Parse due date
            due_date = None
            if bill.get("DueDate"):
                try:
                    due_date = date.fromisoformat(bill["DueDate"])
                except (ValueError, AttributeError):
                    pass

            amount = Decimal(str(bill.get("TotalAmt", 0)))
            balance = Decimal(str(bill.get("Balance", 0)))
            paid_amount = amount - balance

            # Check if this bill is associated with a customer/project
            customer_ref = None
            for line in bill.get("Line", []):
                if line.get("AccountBasedExpenseLineDetail", {}).get("CustomerRef"):
                    customer_ref = line["AccountBasedExpenseLineDetail"]["CustomerRef"]
                    break
                if line.get("ItemBasedExpenseLineDetail", {}).get("CustomerRef"):
                    customer_ref = line["ItemBasedExpenseLineDetail"]["CustomerRef"]
                    break

            # Filter by customer if specified
            if customer_id and customer_ref:
                if customer_ref.get("value") != customer_id:
                    continue

            invoices.append(
                NormalizedInvoice(
                    vendor=vendor_name,
                    invoice_number=bill.get("DocNumber", str(bill.get("Id", ""))),
                    qb_id=str(bill.get("Id")),
                    amount=amount,
                    retention_amount=Decimal("0"),  # QB doesn't track retention directly
                    net_amount=amount,
                    invoice_date=txn_date,
                    due_date=due_date,
                    qb_status=self._parse_bill_status(bill),
                    payment_amount=paid_amount,
                    is_matched=False,
                )
            )

        logger.info(f"Retrieved {len(invoices)} bills from QuickBooks")
        return invoices

    def get_bills_by_vendor(self, vendor_id: str) -> list[NormalizedInvoice]:
        """Get all bills for a specific vendor."""
        return self.get_bills(vendor_id=vendor_id)

    def get_bill_payments(
        self,
        vendor_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> list[dict]:
        """
        Get bill payments.

        Args:
            vendor_id: Optional filter by vendor ID
            start_date: Optional start date filter
            end_date: Optional end date filter

        Returns:
            List of bill payment dictionaries
        """
        query = "SELECT * FROM BillPayment"
        conditions = []

        if vendor_id:
            conditions.append(f"VendorRef = '{vendor_id}'")
        if start_date:
            conditions.append(f"TxnDate >= '{start_date.isoformat()}'")
        if end_date:
            conditions.append(f"TxnDate <= '{end_date.isoformat()}'")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        payments = list(self._paginated_query(query, "BillPayment"))
        logger.info(f"Retrieved {len(payments)} bill payments from QuickBooks")
        return payments

    def get_purchase_orders(
        self,
        vendor_id: Optional[str] = None,
        customer_id: Optional[str] = None,
    ) -> list[dict]:
        """
        Get purchase orders.

        Args:
            vendor_id: Optional filter by vendor ID
            customer_id: Optional filter by customer/project ID

        Returns:
            List of purchase order dictionaries
        """
        query = "SELECT * FROM PurchaseOrder"
        conditions = []

        if vendor_id:
            conditions.append(f"VendorRef = '{vendor_id}'")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        pos = list(self._paginated_query(query, "PurchaseOrder"))
        logger.info(f"Retrieved {len(pos)} purchase orders from QuickBooks")

        # Filter by customer if needed (done post-query since it's in line items)
        if customer_id:
            filtered = []
            for po in pos:
                for line in po.get("Line", []):
                    detail = line.get("ItemBasedExpenseLineDetail", {})
                    if detail.get("CustomerRef", {}).get("value") == customer_id:
                        filtered.append(po)
                        break
            return filtered

        return pos

    def get_purchases(
        self,
        vendor_id: Optional[str] = None,
        account_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> list[dict]:
        """
        Get purchases (checks, credit card charges, etc.).

        Args:
            vendor_id: Optional filter by vendor/entity ID
            account_id: Optional filter by account ID
            start_date: Optional start date filter
            end_date: Optional end date filter

        Returns:
            List of purchase dictionaries
        """
        query = "SELECT * FROM Purchase"
        conditions = []

        if vendor_id:
            conditions.append(f"EntityRef = '{vendor_id}'")
        if start_date:
            conditions.append(f"TxnDate >= '{start_date.isoformat()}'")
        if end_date:
            conditions.append(f"TxnDate <= '{end_date.isoformat()}'")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        purchases = list(self._paginated_query(query, "Purchase"))
        logger.info(f"Retrieved {len(purchases)} purchases from QuickBooks")

        # Filter by account if needed
        if account_id:
            filtered = []
            for purchase in purchases:
                for line in purchase.get("Line", []):
                    detail = line.get("AccountBasedExpenseLineDetail", {})
                    if detail.get("AccountRef", {}).get("value") == account_id:
                        filtered.append(purchase)
                        break
            return filtered

        return purchases

    def get_profit_loss_by_customer(
        self,
        customer_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> dict:
        """
        Get Profit and Loss report by customer (project).

        Args:
            customer_id: Customer/project ID
            start_date: Report start date
            end_date: Report end date

        Returns:
            P&L report data
        """
        endpoint = "reports/ProfitAndLossDetail"
        params = {"customer": customer_id}

        if start_date:
            params["start_date"] = start_date.isoformat()
        if end_date:
            params["end_date"] = end_date.isoformat()

        response = self._request("GET", endpoint, params=params)
        logger.info(f"Retrieved P&L report for customer {customer_id}")
        return response

    def get_vendor_balance_detail(self, vendor_id: Optional[str] = None) -> dict:
        """
        Get vendor balance detail report.

        Args:
            vendor_id: Optional specific vendor ID

        Returns:
            Vendor balance report data
        """
        endpoint = "reports/VendorBalanceDetail"
        params = {}
        if vendor_id:
            params["vendor"] = vendor_id

        response = self._request("GET", endpoint, params=params)
        logger.info("Retrieved vendor balance detail report")
        return response

    def get_expenses_by_vendor(
        self,
        vendor_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> dict:
        """
        Get total expenses by vendor.

        Args:
            vendor_id: Vendor ID
            start_date: Optional start date
            end_date: Optional end date

        Returns:
            Dictionary with bills, payments, and purchases
        """
        bills = self.get_bills(vendor_id=vendor_id, start_date=start_date, end_date=end_date)
        payments = self.get_bill_payments(vendor_id=vendor_id, start_date=start_date, end_date=end_date)
        purchases = self.get_purchases(vendor_id=vendor_id, start_date=start_date, end_date=end_date)

        total_billed = sum(inv.amount for inv in bills)
        total_paid = sum(Decimal(str(p.get("TotalAmt", 0))) for p in payments)

        return {
            "vendor_id": vendor_id,
            "bills": bills,
            "payments": payments,
            "purchases": purchases,
            "total_billed": total_billed,
            "total_paid": total_paid,
            "balance": total_billed - total_paid,
        }

    def get_transactions_by_account(
        self,
        account_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> list[dict]:
        """
        Get all transactions for a specific account.

        This is useful for reconciling cost codes to QB accounts.

        Args:
            account_id: Account ID
            start_date: Optional start date
            end_date: Optional end date

        Returns:
            List of transaction dictionaries
        """
        endpoint = "reports/TransactionList"
        params = {
            "account": account_id,
            "columns": "tx_date,txn_type,doc_num,name,memo,account,split_acc,subt_nat_amount",
        }

        if start_date:
            params["start_date"] = start_date.isoformat()
        if end_date:
            params["end_date"] = end_date.isoformat()

        response = self._request("GET", endpoint, params=params)
        return response.get("Rows", {}).get("Row", [])

    def get_vendor_summary_for_project(
        self, customer_id: str
    ) -> list[dict[str, Any]]:
        """
        Get a summary of vendor expenses for a specific project/customer.

        Args:
            customer_id: Customer/project ID

        Returns:
            List of vendor summary dictionaries with totals
        """
        # Get all bills, then filter by customer
        all_bills = self.get_bills()

        # Group by vendor
        vendor_totals: dict[str, dict[str, Any]] = {}

        for bill in all_bills:
            # We need to re-fetch the full bill to check customer association
            vendor = bill.vendor
            if vendor not in vendor_totals:
                vendor_totals[vendor] = {
                    "vendor_name": vendor,
                    "total_billed": Decimal("0"),
                    "total_paid": Decimal("0"),
                    "bill_count": 0,
                }

            vendor_totals[vendor]["total_billed"] += bill.amount
            vendor_totals[vendor]["total_paid"] += bill.payment_amount
            vendor_totals[vendor]["bill_count"] += 1

        return list(vendor_totals.values())

    def get_full_project_data(
        self, project_name: Optional[str] = None, customer_id: Optional[str] = None
    ) -> dict[str, Any]:
        """
        Retrieve all financial data for a project.

        Args:
            project_name: Project name to search for
            customer_id: Direct customer ID if known

        Returns:
            Dictionary containing all project financial data
        """
        logger.info(f"Fetching full project data from QuickBooks")

        # Get company info
        company_info = self.get_company_info()

        # Get all vendors
        vendors = self.get_vendors()

        # Get all expense accounts
        accounts = self.get_expense_accounts()

        # Get customer/project if name provided
        customer = None
        if project_name and not customer_id:
            customer = self.get_customer_by_name(project_name)
            if customer:
                customer_id = customer.get("Id")
        elif customer_id:
            # Fetch customer by ID
            query = f"SELECT * FROM Customer WHERE Id = '{customer_id}'"
            response = self._query(query)
            customers = response.get("QueryResponse", {}).get("Customer", [])
            customer = customers[0] if customers else None

        # Get all bills
        bills = self.get_bills(customer_id=customer_id)

        # Get all bill payments
        payments = self.get_bill_payments()

        # Get purchase orders
        purchase_orders = self.get_purchase_orders(customer_id=customer_id)

        # Get P&L by customer if we have a customer ID
        pnl_report = None
        if customer_id:
            try:
                pnl_report = self.get_profit_loss_by_customer(customer_id)
            except QBOAPIError as e:
                logger.warning(f"Could not fetch P&L report: {e}")

        data = {
            "company_info": company_info,
            "customer": customer,
            "customer_id": customer_id,
            "vendors": vendors,
            "accounts": accounts,
            "bills": bills,
            "payments": payments,
            "purchase_orders": purchase_orders,
            "pnl_report": pnl_report,
        }

        logger.info(
            f"QBO data summary: {len(vendors)} vendors, {len(bills)} bills, "
            f"{len(purchase_orders)} POs"
        )

        return data

    def get_token_info(self) -> TokenInfo:
        """Get current token information."""
        return TokenInfo(
            access_token=self.access_token or "",
            refresh_token=self.refresh_token or "",
            expires_at=self._token_expires_at,
        )
