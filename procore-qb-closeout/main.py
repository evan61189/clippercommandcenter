#!/usr/bin/env python3
"""
CLI entry point for Procore-QuickBooks Closeout Reconciliation Tool.

Provides commands for running reconciliation, generating reports,
and managing cost code mappings.
"""

import json
import logging
import sys
from pathlib import Path
from typing import Optional

import click
from dotenv import load_dotenv
from rich.console import Console
from rich.logging import RichHandler
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[RichHandler(rich_tracebacks=True)],
)
logger = logging.getLogger(__name__)

console = Console()


def setup_logging(verbose: bool = False):
    """Configure logging level."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.getLogger().setLevel(level)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)


@click.group()
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose logging")
@click.version_option(version="1.0.0")
def cli(verbose: bool):
    """
    Procore-QuickBooks Financial Closeout Reconciliation Tool.

    AI-assisted reconciliation between Procore (project management)
    and QuickBooks Online (accounting) for construction project closeout.
    """
    setup_logging(verbose)


@cli.command()
@click.option(
    "--project-id",
    required=True,
    type=int,
    help="Procore project ID",
)
@click.option(
    "--qb-project",
    type=str,
    help="QuickBooks project/customer name (optional)",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(),
    default="./reports",
    help="Output directory for reports",
)
@click.option(
    "--skip-ai",
    is_flag=True,
    help="Skip AI analysis (faster, no API costs)",
)
@click.option(
    "--excel/--no-excel",
    default=True,
    help="Generate Excel report",
)
@click.option(
    "--pdf/--no-pdf",
    default=True,
    help="Generate PDF report",
)
@click.option(
    "--mapping-file",
    type=click.Path(exists=True),
    help="Path to cost code mapping file",
)
def closeout(
    project_id: int,
    qb_project: Optional[str],
    output: str,
    skip_ai: bool,
    excel: bool,
    pdf: bool,
    mapping_file: Optional[str],
):
    """
    Run full closeout reconciliation and generate reports.

    This command fetches data from both Procore and QuickBooks,
    performs reconciliation, and generates closeout reports.

    Example:
        python main.py closeout --project-id 12345 --output ./reports/
    """
    from src.ai_analyzer import AIAnalyzer
    from src.closeout_report import generate_reports
    from src.procore_client import ProcoreClient, ProcoreAPIError
    from src.qb_client import QuickBooksClient, QBOAPIError
    from src.reconciler import Reconciler

    console.print(
        Panel.fit(
            "[bold blue]Procore-QuickBooks Closeout Reconciliation[/bold blue]\n"
            f"Project ID: {project_id}",
            title="Starting",
        )
    )

    output_path = Path(output)
    mapping_path = Path(mapping_file) if mapping_file else Path("config/cost_code_mapping.json")

    try:
        # Fetch Procore data
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Connecting to Procore...", total=None)

            procore = ProcoreClient()
            progress.update(task, description="Fetching Procore project data...")
            procore_data = procore.get_full_project_data(project_id)

            console.print(
                f"[green]✓ Procore:[/green] "
                f"{len(procore_data.get('commitments', []))} commitments, "
                f"{len(procore_data.get('requisitions', []))} invoices"
            )

        # Fetch QuickBooks data
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Connecting to QuickBooks...", total=None)

            qb = QuickBooksClient()
            progress.update(task, description="Fetching QuickBooks data...")
            qb_data = qb.get_full_project_data(project_name=qb_project)

            console.print(
                f"[green]✓ QuickBooks:[/green] "
                f"{len(qb_data.get('vendors', []))} vendors, "
                f"{len(qb_data.get('bills', []))} bills"
            )

        # Run reconciliation
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Running reconciliation...", total=None)

            reconciler = Reconciler(
                procore_data=procore_data,
                qb_data=qb_data,
                mapping_file_path=mapping_path if mapping_path.exists() else None,
            )
            report = reconciler.run_full_reconciliation()

            console.print(
                f"[green]✓ Reconciliation:[/green] "
                f"{report.project_summary.reconciled_items} reconciled, "
                f"{report.project_summary.warning_items} warnings, "
                f"{report.project_summary.critical_items} critical"
            )

        # AI Analysis
        if not skip_ai:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                task = progress.add_task("Running AI analysis...", total=None)

                analyzer = AIAnalyzer()
                if analyzer.is_available():
                    report = analyzer.enhance_report(report)
                    console.print("[green]✓ AI analysis complete[/green]")
                else:
                    console.print("[yellow]⚠ AI analysis skipped (API key not configured)[/yellow]")
        else:
            console.print("[yellow]⚠ AI analysis skipped (--skip-ai flag)[/yellow]")

        # Generate reports
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Generating reports...", total=None)

            results = generate_reports(
                report=report,
                output_dir=output_path,
                generate_excel=excel,
                generate_pdf=pdf,
            )

        # Summary
        console.print("\n")
        console.print(
            Panel.fit(
                f"[bold green]Closeout Complete![/bold green]\n\n"
                f"Project: {report.project_summary.project_name}\n"
                f"Contract Value: ${report.project_summary.revised_contract_value:,.2f}\n"
                f"Total Committed: ${report.project_summary.total_committed:,.2f}\n"
                f"Open Items: {report.project_summary.open_closeout_items}\n"
                f"Estimated Exposure: ${report.project_summary.estimated_exposure:,.2f}\n\n"
                + "\n".join(f"Report: {path}" for fmt, path in results.items()),
                title="Summary",
            )
        )

    except ProcoreAPIError as e:
        console.print(f"[red]Procore API Error: {e}[/red]")
        sys.exit(1)
    except QBOAPIError as e:
        console.print(f"[red]QuickBooks API Error: {e}[/red]")
        sys.exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        logger.exception("Unexpected error")
        sys.exit(1)


@cli.command()
@click.option(
    "--project-id",
    required=True,
    type=int,
    help="Procore project ID",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(),
    default="./config/cost_code_mapping.json",
    help="Output path for mapping file",
)
@click.option(
    "--mock",
    is_flag=True,
    help="Use mock data for testing",
)
def setup_mapping(project_id: int, output: str, mock: bool):
    """
    Run the interactive cost code mapping wizard.

    Maps Procore cost codes to QuickBooks chart of accounts
    with AI-assisted suggestions.

    Example:
        python main.py setup-mapping --project-id 12345
    """
    from scripts.setup_mapping import run_mapping_wizard

    run_mapping_wizard(
        project_id=project_id,
        output_path=Path(output),
        use_mock_data=mock,
    )


@cli.command()
@click.option(
    "--project-id",
    required=True,
    type=int,
    help="Procore project ID",
)
def preview_procore(project_id: int):
    """
    Preview Procore data without reconciliation.

    Useful for testing API connectivity and viewing project structure.

    Example:
        python main.py preview-procore --project-id 12345
    """
    from src.procore_client import ProcoreClient, ProcoreAPIError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Fetching Procore data...", total=None)

            procore = ProcoreClient()
            data = procore.get_full_project_data(project_id)

        # Display summary
        project = data.get("project", {})
        console.print(
            Panel.fit(
                f"[bold]Project:[/bold] {project.get('name', 'Unknown')}\n"
                f"[bold]ID:[/bold] {project.get('id')}\n"
                f"[bold]Number:[/bold] {project.get('project_number', '-')}",
                title="Procore Project",
            )
        )

        # Commitments table
        commitments = data.get("commitments", [])
        if commitments:
            table = Table(title=f"Commitments ({len(commitments)})")
            table.add_column("Vendor")
            table.add_column("Type")
            table.add_column("Value", justify="right")
            table.add_column("Billed", justify="right")
            table.add_column("Status")

            for c in commitments[:10]:
                table.add_row(
                    c.vendor[:30],
                    c.commitment_type,
                    f"${c.current_value:,.2f}",
                    f"${c.billed_to_date:,.2f}",
                    c.status.value,
                )

            if len(commitments) > 10:
                table.add_row("...", f"({len(commitments) - 10} more)", "", "", "")

            console.print(table)

        # Summary stats
        console.print(f"\n[bold]Summary:[/bold]")
        console.print(f"  Commitments: {len(commitments)}")
        console.print(f"  Invoices: {len(data.get('requisitions', []))}")
        console.print(f"  Change Orders: {len(data.get('change_orders', []))}")
        console.print(f"  Cost Codes: {len(data.get('cost_codes', []))}")
        console.print(f"  Vendors: {len(data.get('vendors', []))}")

    except ProcoreAPIError as e:
        console.print(f"[red]Procore API Error: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.option(
    "--project-name",
    type=str,
    help="QuickBooks project/customer name to filter",
)
def preview_qb(project_name: Optional[str]):
    """
    Preview QuickBooks data without reconciliation.

    Useful for testing API connectivity and viewing account structure.

    Example:
        python main.py preview-qb --project-name "Project ABC"
    """
    from src.qb_client import QuickBooksClient, QBOAPIError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Fetching QuickBooks data...", total=None)

            qb = QuickBooksClient()
            data = qb.get_full_project_data(project_name=project_name)

        # Company info
        company = data.get("company_info", {})
        console.print(
            Panel.fit(
                f"[bold]Company:[/bold] {company.get('CompanyName', 'Unknown')}\n"
                f"[bold]Realm ID:[/bold] {company.get('Id', '-')}",
                title="QuickBooks Company",
            )
        )

        # Vendors table
        vendors = data.get("vendors", [])
        if vendors:
            table = Table(title=f"Vendors ({len(vendors)})")
            table.add_column("Name")
            table.add_column("QB ID")

            for v in vendors[:15]:
                table.add_row(v.qb_name or "-", v.qb_id or "-")

            if len(vendors) > 15:
                table.add_row("...", f"({len(vendors) - 15} more)")

            console.print(table)

        # Bills summary
        bills = data.get("bills", [])
        if bills:
            total_billed = sum(b.amount for b in bills)
            total_paid = sum(b.payment_amount for b in bills)

            console.print(f"\n[bold]Bills Summary:[/bold]")
            console.print(f"  Total Bills: {len(bills)}")
            console.print(f"  Total Amount: ${total_billed:,.2f}")
            console.print(f"  Total Paid: ${total_paid:,.2f}")
            console.print(f"  Outstanding: ${total_billed - total_paid:,.2f}")

        # Accounts summary
        accounts = data.get("accounts", [])
        console.print(f"\n[bold]Accounts:[/bold] {len(accounts)} expense/COGS accounts")

    except QBOAPIError as e:
        console.print(f"[red]QuickBooks API Error: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.option(
    "--project-id",
    required=True,
    type=int,
    help="Procore project ID",
)
@click.option(
    "--qb-project",
    type=str,
    help="QuickBooks project/customer name",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(),
    default="./data/reconciliation.json",
    help="Output path for reconciliation JSON",
)
@click.option(
    "--mapping-file",
    type=click.Path(exists=True),
    help="Path to cost code mapping file",
)
def reconcile(
    project_id: int,
    qb_project: Optional[str],
    output: str,
    mapping_file: Optional[str],
):
    """
    Run reconciliation and save results to JSON (no reports).

    Useful for running reconciliation separately from report generation.

    Example:
        python main.py reconcile --project-id 12345 --output ./data/recon.json
    """
    from src.procore_client import ProcoreClient, ProcoreAPIError
    from src.qb_client import QuickBooksClient, QBOAPIError
    from src.reconciler import Reconciler

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path = Path(mapping_file) if mapping_file else None

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Fetching data...", total=None)

            procore = ProcoreClient()
            procore_data = procore.get_full_project_data(project_id)

            progress.update(task, description="Fetching QuickBooks data...")
            qb = QuickBooksClient()
            qb_data = qb.get_full_project_data(project_name=qb_project)

            progress.update(task, description="Running reconciliation...")
            reconciler = Reconciler(
                procore_data=procore_data,
                qb_data=qb_data,
                mapping_file_path=mapping_path,
            )
            reconciler.export_results_to_json(output_path)

        console.print(f"[green]✓ Reconciliation saved to: {output_path}[/green]")

    except (ProcoreAPIError, QBOAPIError) as e:
        console.print(f"[red]API Error: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.option(
    "--input",
    "-i",
    "input_file",
    required=True,
    type=click.Path(exists=True),
    help="Path to reconciliation JSON file",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(),
    default="./reports",
    help="Output directory for reports",
)
@click.option(
    "--excel/--no-excel",
    default=True,
    help="Generate Excel report",
)
@click.option(
    "--pdf/--no-pdf",
    default=True,
    help="Generate PDF report",
)
@click.option(
    "--skip-ai",
    is_flag=True,
    help="Skip AI analysis",
)
def report(
    input_file: str,
    output: str,
    excel: bool,
    pdf: bool,
    skip_ai: bool,
):
    """
    Generate reports from saved reconciliation data.

    Use this after running 'reconcile' to generate reports without
    re-fetching data from APIs.

    Example:
        python main.py report --input ./data/recon.json --output ./reports/
    """
    from src.ai_analyzer import AIAnalyzer
    from src.closeout_report import generate_reports
    from src.models import CloseoutReport

    try:
        # Load reconciliation data
        with open(input_file) as f:
            data = json.load(f)

        report_data = CloseoutReport(**data)

        # AI enhancement
        if not skip_ai:
            analyzer = AIAnalyzer()
            if analyzer.is_available():
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    console=console,
                ) as progress:
                    task = progress.add_task("Running AI analysis...", total=None)
                    report_data = analyzer.enhance_report(report_data)
                console.print("[green]✓ AI analysis complete[/green]")

        # Generate reports
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Generating reports...", total=None)

            results = generate_reports(
                report=report_data,
                output_dir=Path(output),
                generate_excel=excel,
                generate_pdf=pdf,
            )

        for fmt, path in results.items():
            console.print(f"[green]✓ Generated {fmt}: {path}[/green]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        logger.exception("Failed to generate report")
        sys.exit(1)


@cli.command()
def check_config():
    """
    Verify API configuration and connectivity.

    Tests connections to Procore, QuickBooks, and Anthropic APIs.
    """
    import os

    console.print("[bold]Checking configuration...[/bold]\n")

    # Check environment variables
    checks = [
        ("PROCORE_CLIENT_ID", os.getenv("PROCORE_CLIENT_ID")),
        ("PROCORE_ACCESS_TOKEN", os.getenv("PROCORE_ACCESS_TOKEN")),
        ("QBO_CLIENT_ID", os.getenv("QBO_CLIENT_ID")),
        ("QBO_ACCESS_TOKEN", os.getenv("QBO_ACCESS_TOKEN")),
        ("QBO_REALM_ID", os.getenv("QBO_REALM_ID")),
        ("ANTHROPIC_API_KEY", os.getenv("ANTHROPIC_API_KEY")),
    ]

    table = Table(title="Environment Variables")
    table.add_column("Variable")
    table.add_column("Status")

    all_ok = True
    for name, value in checks:
        if value:
            table.add_row(name, "[green]✓ Set[/green]")
        else:
            table.add_row(name, "[red]✗ Missing[/red]")
            all_ok = False

    console.print(table)

    # Test API connectivity
    console.print("\n[bold]Testing API connectivity...[/bold]\n")

    # Test Procore
    if os.getenv("PROCORE_ACCESS_TOKEN"):
        try:
            from src.procore_client import ProcoreClient

            procore = ProcoreClient()
            console.print("[green]✓ Procore: Connected[/green]")
        except Exception as e:
            console.print(f"[red]✗ Procore: {e}[/red]")
            all_ok = False
    else:
        console.print("[yellow]⚠ Procore: Skipped (no token)[/yellow]")

    # Test QuickBooks
    if os.getenv("QBO_ACCESS_TOKEN") and os.getenv("QBO_REALM_ID"):
        try:
            from src.qb_client import QuickBooksClient

            qb = QuickBooksClient()
            company = qb.get_company_info()
            console.print(
                f"[green]✓ QuickBooks: Connected ({company.get('CompanyName', 'OK')})[/green]"
            )
        except Exception as e:
            console.print(f"[red]✗ QuickBooks: {e}[/red]")
            all_ok = False
    else:
        console.print("[yellow]⚠ QuickBooks: Skipped (no token/realm)[/yellow]")

    # Test Anthropic
    if os.getenv("ANTHROPIC_API_KEY"):
        try:
            from src.ai_analyzer import AIAnalyzer

            analyzer = AIAnalyzer()
            if analyzer.is_available():
                console.print("[green]✓ Anthropic: Connected[/green]")
            else:
                console.print("[red]✗ Anthropic: Package not installed[/red]")
        except Exception as e:
            console.print(f"[red]✗ Anthropic: {e}[/red]")
    else:
        console.print("[yellow]⚠ Anthropic: Skipped (no API key)[/yellow]")

    if all_ok:
        console.print("\n[green]All checks passed![/green]")
    else:
        console.print("\n[yellow]Some checks failed. Review configuration.[/yellow]")
        sys.exit(1)


if __name__ == "__main__":
    cli()
