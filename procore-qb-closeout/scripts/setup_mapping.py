#!/usr/bin/env python3
"""
Interactive cost code mapping wizard for Procore to QuickBooks reconciliation.

This script guides users through mapping Procore cost codes to QuickBooks
chart of accounts, with AI-assisted suggestions based on name similarity
and CSI division conventions.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.prompt import Confirm, IntPrompt, Prompt
from rich.table import Table

from src.models import CostCode, CostCodeMapping, QBAccount
from src.procore_client import ProcoreClient, ProcoreAPIError
from src.qb_client import QuickBooksClient, QBOAPIError

load_dotenv()

console = Console()


# CSI Division reference for context
CSI_DIVISIONS = {
    "01": "General Requirements",
    "02": "Existing Conditions",
    "03": "Concrete",
    "04": "Masonry",
    "05": "Metals",
    "06": "Wood, Plastics, and Composites",
    "07": "Thermal and Moisture Protection",
    "08": "Openings",
    "09": "Finishes",
    "10": "Specialties",
    "11": "Equipment",
    "12": "Furnishings",
    "13": "Special Construction",
    "14": "Conveying Equipment",
    "21": "Fire Suppression",
    "22": "Plumbing",
    "23": "HVAC",
    "25": "Integrated Automation",
    "26": "Electrical",
    "27": "Communications",
    "28": "Electronic Safety and Security",
    "31": "Earthwork",
    "32": "Exterior Improvements",
    "33": "Utilities",
}


def get_ai_mapping_suggestions(
    cost_codes: list[CostCode],
    qb_accounts: list[QBAccount],
) -> list[CostCodeMapping]:
    """
    Use Claude AI to suggest mappings between cost codes and QB accounts.

    Args:
        cost_codes: List of Procore cost codes
        qb_accounts: List of QuickBooks accounts

    Returns:
        List of suggested CostCodeMapping objects
    """
    try:
        import anthropic
    except ImportError:
        console.print(
            "[yellow]anthropic package not installed. AI suggestions disabled.[/yellow]"
        )
        return []

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        console.print(
            "[yellow]ANTHROPIC_API_KEY not set. AI suggestions disabled.[/yellow]"
        )
        return []

    client = anthropic.Anthropic(api_key=api_key)

    # Prepare the data for Claude
    cost_code_list = [
        {"code": cc.code, "description": cc.description, "division": cc.csi_division}
        for cc in cost_codes
    ]

    account_list = [
        {"id": acc.id, "name": acc.name, "type": acc.account_type}
        for acc in qb_accounts
    ]

    prompt = f"""You are a construction financial expert helping map Procore cost codes to QuickBooks accounts.

CSI MasterFormat divisions are used in commercial construction for organizing work by trade/category.
Key divisions: 03=Concrete, 05=Metals, 06=Wood, 07=Roofing/Waterproofing, 08=Doors/Windows,
09=Finishes (drywall, paint, flooring), 22=Plumbing, 23=HVAC, 26=Electrical.

Procore Cost Codes:
{json.dumps(cost_code_list, indent=2)}

QuickBooks Accounts:
{json.dumps(account_list, indent=2)}

For each Procore cost code, suggest the best matching QuickBooks account.
Consider:
1. Name similarity and semantic meaning
2. CSI division conventions
3. Common construction accounting patterns (e.g., "Job Costs:" prefix in QB)

Return a JSON array with this structure:
[
  {{
    "procore_code": "03-100",
    "qb_account_id": "145",
    "confidence": 0.85,
    "reasoning": "Both refer to concrete work"
  }}
]

Only include mappings with confidence >= 0.5. Return ONLY valid JSON, no other text."""

    try:
        with console.status("[bold green]Getting AI mapping suggestions..."):
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )

        response_text = response.content[0].text.strip()

        # Parse JSON from response
        if response_text.startswith("```"):
            # Extract from code block
            lines = response_text.split("\n")
            json_lines = []
            in_json = False
            for line in lines:
                if line.startswith("```json"):
                    in_json = True
                elif line.startswith("```"):
                    in_json = False
                elif in_json:
                    json_lines.append(line)
            response_text = "\n".join(json_lines)

        suggestions = json.loads(response_text)

        # Convert to CostCodeMapping objects
        mappings = []
        cc_dict = {cc.code: cc for cc in cost_codes}
        acc_dict = {acc.id: acc for acc in qb_accounts}

        for suggestion in suggestions:
            procore_code = suggestion.get("procore_code")
            qb_id = suggestion.get("qb_account_id")
            confidence = suggestion.get("confidence", 0.5)

            if procore_code in cc_dict and qb_id in acc_dict:
                cc = cc_dict[procore_code]
                acc = acc_dict[qb_id]

                mappings.append(
                    CostCodeMapping(
                        procore_cost_code=cc.code,
                        procore_description=cc.description,
                        csi_division=cc.csi_division,
                        qb_account_id=acc.id,
                        qb_account_name=acc.name,
                        confidence=confidence,
                        manually_verified=False,
                        notes=suggestion.get("reasoning"),
                    )
                )

        console.print(f"[green]AI suggested {len(mappings)} mappings[/green]")
        return mappings

    except json.JSONDecodeError as e:
        console.print(f"[red]Failed to parse AI response: {e}[/red]")
        return []
    except Exception as e:
        console.print(f"[red]AI suggestion error: {e}[/red]")
        return []


def simple_fuzzy_match(
    cost_codes: list[CostCode], qb_accounts: list[QBAccount]
) -> list[CostCodeMapping]:
    """
    Simple fuzzy matching based on keyword overlap.

    Args:
        cost_codes: List of Procore cost codes
        qb_accounts: List of QuickBooks accounts

    Returns:
        List of suggested CostCodeMapping objects
    """
    try:
        from fuzzywuzzy import fuzz
    except ImportError:
        console.print(
            "[yellow]fuzzywuzzy not installed. Using basic matching.[/yellow]"
        )
        return basic_keyword_match(cost_codes, qb_accounts)

    mappings = []

    for cc in cost_codes:
        best_match = None
        best_score = 0

        cc_text = f"{cc.code} {cc.description}".lower()

        for acc in qb_accounts:
            acc_text = acc.name.lower()

            # Try different fuzzy matching methods
            ratio = fuzz.ratio(cc_text, acc_text)
            partial = fuzz.partial_ratio(cc.description.lower(), acc_text)
            token_sort = fuzz.token_sort_ratio(cc.description.lower(), acc_text)

            score = max(ratio, partial, token_sort)

            if score > best_score and score >= 50:
                best_score = score
                best_match = acc

        if best_match:
            mappings.append(
                CostCodeMapping(
                    procore_cost_code=cc.code,
                    procore_description=cc.description,
                    csi_division=cc.csi_division,
                    qb_account_id=best_match.id,
                    qb_account_name=best_match.name,
                    confidence=best_score / 100.0,
                    manually_verified=False,
                )
            )

    return mappings


def basic_keyword_match(
    cost_codes: list[CostCode], qb_accounts: list[QBAccount]
) -> list[CostCodeMapping]:
    """
    Basic keyword matching fallback.

    Args:
        cost_codes: List of Procore cost codes
        qb_accounts: List of QuickBooks accounts

    Returns:
        List of suggested CostCodeMapping objects
    """
    # Common construction keywords to match
    keywords = {
        "concrete": ["concrete", "cement", "foundation"],
        "steel": ["steel", "metal", "structural"],
        "electrical": ["electrical", "electric", "power", "lighting"],
        "plumbing": ["plumbing", "pipe", "piping", "water"],
        "hvac": ["hvac", "mechanical", "heating", "cooling", "air"],
        "drywall": ["drywall", "gypsum", "wall", "partition"],
        "paint": ["paint", "painting", "finish", "coat"],
        "flooring": ["flooring", "floor", "carpet", "tile"],
        "roofing": ["roof", "roofing"],
        "insulation": ["insulation", "insulating"],
        "doors": ["door", "doors", "hardware"],
        "windows": ["window", "windows", "glazing", "glass"],
        "fire": ["fire", "sprinkler", "suppression"],
        "sitework": ["site", "sitework", "excavation", "grading"],
    }

    mappings = []

    for cc in cost_codes:
        cc_words = set(cc.description.lower().split())
        best_match = None
        best_score = 0

        for acc in qb_accounts:
            acc_words = set(acc.name.lower().split())
            score = 0

            # Check for keyword matches
            for category, kw_list in keywords.items():
                cc_has = any(kw in cc.description.lower() for kw in kw_list)
                acc_has = any(kw in acc.name.lower() for kw in kw_list)
                if cc_has and acc_has:
                    score += 30

            # Check for direct word overlap
            overlap = cc_words & acc_words
            score += len(overlap) * 10

            if score > best_score:
                best_score = score
                best_match = acc

        if best_match and best_score >= 20:
            mappings.append(
                CostCodeMapping(
                    procore_cost_code=cc.code,
                    procore_description=cc.description,
                    csi_division=cc.csi_division,
                    qb_account_id=best_match.id,
                    qb_account_name=best_match.name,
                    confidence=min(best_score / 100.0, 0.8),
                    manually_verified=False,
                )
            )

    return mappings


def display_mapping_table(
    mappings: list[CostCodeMapping], unmapped_codes: list[CostCode]
) -> None:
    """Display current mappings in a table."""
    table = Table(title="Cost Code Mappings")
    table.add_column("Procore Code", style="cyan")
    table.add_column("Description", style="white")
    table.add_column("CSI Div", style="yellow")
    table.add_column("QB Account", style="green")
    table.add_column("Confidence", style="magenta")
    table.add_column("Verified", style="blue")

    for m in sorted(mappings, key=lambda x: x.procore_cost_code):
        conf_str = f"{m.confidence:.0%}" if m.confidence else "-"
        verified = "✓" if m.manually_verified else ""
        table.add_row(
            m.procore_cost_code,
            m.procore_description[:30] + "..." if len(m.procore_description) > 30 else m.procore_description,
            m.csi_division,
            m.qb_account_name or "[unmapped]",
            conf_str,
            verified,
        )

    # Add unmapped codes
    for cc in unmapped_codes:
        table.add_row(
            cc.code,
            cc.description[:30] + "..." if len(cc.description) > 30 else cc.description,
            cc.csi_division,
            "[red]UNMAPPED[/red]",
            "-",
            "",
        )

    console.print(table)


def interactive_mapping_session(
    cost_codes: list[CostCode],
    qb_accounts: list[QBAccount],
    existing_mappings: list[CostCodeMapping],
) -> tuple[list[CostCodeMapping], list[str], list[str]]:
    """
    Run interactive mapping session.

    Args:
        cost_codes: List of Procore cost codes
        qb_accounts: List of QuickBooks accounts
        existing_mappings: Existing mappings to start with

    Returns:
        Tuple of (mappings, unmapped_procore_codes, unmapped_qb_accounts)
    """
    # Create lookup dictionaries
    mappings_dict = {m.procore_cost_code: m for m in existing_mappings}
    accounts_by_id = {acc.id: acc for acc in qb_accounts}
    accounts_by_name = {acc.name.lower(): acc for acc in qb_accounts}

    # Track what's been mapped
    mapped_procore = set(mappings_dict.keys())
    mapped_qb = set(m.qb_account_id for m in existing_mappings if m.qb_account_id)

    while True:
        console.clear()
        console.print(
            Panel.fit(
                "[bold]Cost Code Mapping Wizard[/bold]\n"
                f"Procore codes: {len(cost_codes)} | QB accounts: {len(qb_accounts)} | "
                f"Mapped: {len(mapped_procore)}",
                title="Status",
            )
        )

        unmapped_codes = [cc for cc in cost_codes if cc.code not in mapped_procore]

        console.print("\n[bold]Options:[/bold]")
        console.print("1. View current mappings")
        console.print("2. Map a specific cost code")
        console.print("3. Auto-suggest mappings for unmapped codes (AI)")
        console.print("4. Auto-suggest mappings for unmapped codes (fuzzy match)")
        console.print("5. Verify/edit a mapping")
        console.print("6. Remove a mapping")
        console.print("7. Save and exit")
        console.print("8. Exit without saving")

        choice = Prompt.ask(
            "\nSelect option", choices=["1", "2", "3", "4", "5", "6", "7", "8"]
        )

        if choice == "1":
            display_mapping_table(list(mappings_dict.values()), unmapped_codes)
            Prompt.ask("\nPress Enter to continue")

        elif choice == "2":
            # Manual mapping
            console.print("\n[bold]Unmapped cost codes:[/bold]")
            for i, cc in enumerate(unmapped_codes[:20], 1):
                console.print(f"  {i}. {cc.code}: {cc.description}")
            if len(unmapped_codes) > 20:
                console.print(f"  ... and {len(unmapped_codes) - 20} more")

            code_input = Prompt.ask(
                "\nEnter cost code to map (or number from list)"
            )

            # Find the cost code
            target_cc = None
            if code_input.isdigit() and 1 <= int(code_input) <= len(unmapped_codes):
                target_cc = unmapped_codes[int(code_input) - 1]
            else:
                for cc in cost_codes:
                    if cc.code == code_input:
                        target_cc = cc
                        break

            if not target_cc:
                console.print("[red]Cost code not found[/red]")
                continue

            # Show QB accounts
            console.print(f"\n[bold]Map: {target_cc.code} - {target_cc.description}[/bold]")
            console.print(f"CSI Division: {target_cc.csi_division} ({CSI_DIVISIONS.get(target_cc.csi_division, 'Unknown')})")
            console.print("\n[bold]QuickBooks accounts:[/bold]")

            for i, acc in enumerate(qb_accounts[:30], 1):
                marker = " *" if acc.id in mapped_qb else ""
                console.print(f"  {i}. {acc.name} ({acc.account_type}){marker}")
            if len(qb_accounts) > 30:
                console.print(f"  ... and {len(qb_accounts) - 30} more")

            acc_input = Prompt.ask(
                "\nEnter account number, name, or 'skip'"
            )

            if acc_input.lower() == "skip":
                continue

            target_acc = None
            if acc_input.isdigit() and 1 <= int(acc_input) <= len(qb_accounts):
                target_acc = qb_accounts[int(acc_input) - 1]
            elif acc_input.lower() in accounts_by_name:
                target_acc = accounts_by_name[acc_input.lower()]
            else:
                # Search by partial name
                for acc in qb_accounts:
                    if acc_input.lower() in acc.name.lower():
                        target_acc = acc
                        break

            if target_acc:
                mappings_dict[target_cc.code] = CostCodeMapping(
                    procore_cost_code=target_cc.code,
                    procore_description=target_cc.description,
                    csi_division=target_cc.csi_division,
                    qb_account_id=target_acc.id,
                    qb_account_name=target_acc.name,
                    confidence=1.0,
                    manually_verified=True,
                )
                mapped_procore.add(target_cc.code)
                mapped_qb.add(target_acc.id)
                console.print(f"[green]Mapped {target_cc.code} → {target_acc.name}[/green]")
            else:
                console.print("[red]Account not found[/red]")

            Prompt.ask("\nPress Enter to continue")

        elif choice == "3":
            # AI suggestions
            if not unmapped_codes:
                console.print("[yellow]All codes are already mapped![/yellow]")
            else:
                suggestions = get_ai_mapping_suggestions(unmapped_codes, qb_accounts)
                for suggestion in suggestions:
                    if suggestion.procore_cost_code not in mappings_dict:
                        mappings_dict[suggestion.procore_cost_code] = suggestion
                        mapped_procore.add(suggestion.procore_cost_code)
                        if suggestion.qb_account_id:
                            mapped_qb.add(suggestion.qb_account_id)
                console.print(f"[green]Added {len(suggestions)} AI suggestions[/green]")

            Prompt.ask("\nPress Enter to continue")

        elif choice == "4":
            # Fuzzy match suggestions
            if not unmapped_codes:
                console.print("[yellow]All codes are already mapped![/yellow]")
            else:
                suggestions = simple_fuzzy_match(unmapped_codes, qb_accounts)
                for suggestion in suggestions:
                    if suggestion.procore_cost_code not in mappings_dict:
                        mappings_dict[suggestion.procore_cost_code] = suggestion
                        mapped_procore.add(suggestion.procore_cost_code)
                        if suggestion.qb_account_id:
                            mapped_qb.add(suggestion.qb_account_id)
                console.print(f"[green]Added {len(suggestions)} fuzzy match suggestions[/green]")

            Prompt.ask("\nPress Enter to continue")

        elif choice == "5":
            # Verify/edit mapping
            code = Prompt.ask("Enter cost code to verify/edit")
            if code in mappings_dict:
                m = mappings_dict[code]
                console.print(f"\nCurrent mapping: {m.procore_cost_code} → {m.qb_account_name}")
                console.print(f"Confidence: {m.confidence:.0%}")

                if Confirm.ask("Mark as verified?"):
                    m.manually_verified = True
                    console.print("[green]Marked as verified[/green]")

                if Confirm.ask("Change QB account?"):
                    acc_input = Prompt.ask("Enter new account name or number")
                    target_acc = None
                    if acc_input.isdigit() and 1 <= int(acc_input) <= len(qb_accounts):
                        target_acc = qb_accounts[int(acc_input) - 1]
                    else:
                        for acc in qb_accounts:
                            if acc_input.lower() in acc.name.lower():
                                target_acc = acc
                                break

                    if target_acc:
                        m.qb_account_id = target_acc.id
                        m.qb_account_name = target_acc.name
                        m.confidence = 1.0
                        m.manually_verified = True
                        mapped_qb.add(target_acc.id)
                        console.print(f"[green]Updated to {target_acc.name}[/green]")
            else:
                console.print("[red]Mapping not found[/red]")

            Prompt.ask("\nPress Enter to continue")

        elif choice == "6":
            # Remove mapping
            code = Prompt.ask("Enter cost code to remove")
            if code in mappings_dict:
                del mappings_dict[code]
                mapped_procore.discard(code)
                console.print(f"[green]Removed mapping for {code}[/green]")
            else:
                console.print("[red]Mapping not found[/red]")

            Prompt.ask("\nPress Enter to continue")

        elif choice == "7":
            # Save and exit
            unmapped_procore = [cc.code for cc in cost_codes if cc.code not in mapped_procore]
            unmapped_qb = [acc.name for acc in qb_accounts if acc.id not in mapped_qb]
            return list(mappings_dict.values()), unmapped_procore, unmapped_qb

        elif choice == "8":
            # Exit without saving
            if Confirm.ask("Are you sure you want to exit without saving?"):
                return [], [], []


def save_mapping(
    mappings: list[CostCodeMapping],
    unmapped_procore: list[str],
    unmapped_qb: list[str],
    project_id: Optional[int],
    project_name: Optional[str],
    output_path: Path,
) -> None:
    """Save mapping to JSON file."""
    data = {
        "project_id": project_id,
        "project_name": project_name,
        "last_updated": datetime.now().isoformat(),
        "mappings": [m.model_dump() for m in mappings],
        "unmapped_procore": unmapped_procore,
        "unmapped_qb": unmapped_qb,
        "metadata": {
            "procore_cost_code_count": len(mappings) + len(unmapped_procore),
            "qb_account_count": len(set(m.qb_account_id for m in mappings if m.qb_account_id)) + len(unmapped_qb),
            "mapped_count": len(mappings),
            "confidence_threshold": 0.7,
        },
    }

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    console.print(f"[green]Saved mapping to {output_path}[/green]")


def load_existing_mapping(path: Path) -> list[CostCodeMapping]:
    """Load existing mappings from JSON file."""
    if not path.exists():
        return []

    try:
        with open(path) as f:
            data = json.load(f)

        mappings = []
        for m in data.get("mappings", []):
            mappings.append(CostCodeMapping(**m))
        return mappings
    except Exception as e:
        console.print(f"[yellow]Could not load existing mapping: {e}[/yellow]")
        return []


def run_mapping_wizard(
    project_id: int,
    output_path: Optional[Path] = None,
    use_mock_data: bool = False,
) -> None:
    """
    Main entry point for the mapping wizard.

    Args:
        project_id: Procore project ID
        output_path: Path to save mapping file
        use_mock_data: Whether to use mock data for testing
    """
    console.print(
        Panel.fit(
            "[bold blue]Procore-QuickBooks Cost Code Mapping Wizard[/bold blue]\n"
            "This wizard helps you map Procore cost codes to QuickBooks accounts.",
            title="Welcome",
        )
    )

    if output_path is None:
        output_path = Path(__file__).parent.parent / "config" / "cost_code_mapping.json"

    # Load existing mappings
    existing_mappings = load_existing_mapping(output_path)
    if existing_mappings:
        console.print(f"[green]Loaded {len(existing_mappings)} existing mappings[/green]")

    # Fetch data from APIs
    cost_codes: list[CostCode] = []
    qb_accounts: list[QBAccount] = []
    project_name: Optional[str] = None

    if use_mock_data:
        # Use mock data for testing
        console.print("[yellow]Using mock data for testing[/yellow]")
        cost_codes = [
            CostCode(code="03-100", description="Concrete Formwork", csi_division="03"),
            CostCode(code="03-200", description="Concrete Reinforcing", csi_division="03"),
            CostCode(code="03-300", description="Cast-in-Place Concrete", csi_division="03"),
            CostCode(code="09-100", description="Metal Stud Framing", csi_division="09"),
            CostCode(code="09-200", description="Drywall", csi_division="09"),
            CostCode(code="09-300", description="Painting", csi_division="09"),
            CostCode(code="26-100", description="Electrical Rough-In", csi_division="26"),
            CostCode(code="26-200", description="Electrical Finish", csi_division="26"),
        ]
        qb_accounts = [
            QBAccount(id="1", name="Job Costs:Concrete", account_type="Expense"),
            QBAccount(id="2", name="Job Costs:Finishes", account_type="Expense"),
            QBAccount(id="3", name="Job Costs:Electrical", account_type="Expense"),
            QBAccount(id="4", name="Job Costs:Framing", account_type="Expense"),
            QBAccount(id="5", name="Job Costs:Painting", account_type="Expense"),
        ]
        project_name = "Test Project"
    else:
        # Fetch from Procore
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            try:
                task = progress.add_task("Connecting to Procore...", total=None)
                procore = ProcoreClient()

                progress.update(task, description="Fetching project info...")
                project = procore.get_project(project_id)
                project_name = project.get("name", f"Project {project_id}")

                progress.update(task, description="Fetching cost codes from Procore...")
                cost_codes = procore.get_cost_codes(project_id)
                console.print(f"[green]Retrieved {len(cost_codes)} cost codes from Procore[/green]")
            except ProcoreAPIError as e:
                console.print(f"[red]Procore API error: {e}[/red]")
                return

        # Fetch from QuickBooks
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            try:
                task = progress.add_task("Connecting to QuickBooks...", total=None)
                qb = QuickBooksClient()

                progress.update(task, description="Fetching accounts from QuickBooks...")
                qb_accounts = qb.get_expense_accounts()
                console.print(f"[green]Retrieved {len(qb_accounts)} expense accounts from QuickBooks[/green]")
            except QBOAPIError as e:
                console.print(f"[red]QuickBooks API error: {e}[/red]")
                return

    if not cost_codes:
        console.print("[red]No cost codes found. Cannot continue.[/red]")
        return

    if not qb_accounts:
        console.print("[red]No QuickBooks accounts found. Cannot continue.[/red]")
        return

    # Run interactive session
    mappings, unmapped_procore, unmapped_qb = interactive_mapping_session(
        cost_codes, qb_accounts, existing_mappings
    )

    if mappings:
        save_mapping(
            mappings, unmapped_procore, unmapped_qb, project_id, project_name, output_path
        )
        console.print(
            Panel.fit(
                f"[bold green]Mapping complete![/bold green]\n"
                f"Total mappings: {len(mappings)}\n"
                f"Unmapped Procore codes: {len(unmapped_procore)}\n"
                f"Unmapped QB accounts: {len(unmapped_qb)}",
                title="Summary",
            )
        )
    else:
        console.print("[yellow]No mappings saved.[/yellow]")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Cost Code Mapping Wizard")
    parser.add_argument("--project-id", type=int, help="Procore project ID")
    parser.add_argument("--output", type=Path, help="Output file path")
    parser.add_argument("--mock", action="store_true", help="Use mock data for testing")

    args = parser.parse_args()

    if not args.project_id and not args.mock:
        console.print("[red]Please provide --project-id or use --mock for testing[/red]")
        sys.exit(1)

    run_mapping_wizard(
        project_id=args.project_id or 0,
        output_path=args.output,
        use_mock_data=args.mock,
    )
