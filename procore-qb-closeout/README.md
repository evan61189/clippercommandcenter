# Procore-QuickBooks Financial Closeout Reconciliation Tool

A Python CLI application for AI-assisted financial project closeout reconciliation between Procore (construction project management) and QuickBooks Online (accounting).

## Overview

This tool helps commercial general contractors reconcile all financial data at project completion:
- Commitments (subcontracts and purchase orders)
- Change orders
- Invoices/pay applications
- Payments
- Retention
- Budget vs. actual costs

It generates closeout reports flagging discrepancies and open items requiring attention.

## Features

- **API Integration**: Connect to Procore REST API and QuickBooks Online API
- **Smart Matching**: Fuzzy vendor name matching between systems
- **Cost Code Mapping**: Interactive wizard with AI-assisted suggestions to map Procore cost codes to QB accounts
- **Multi-Level Reconciliation**:
  - Commitment-level (contract values vs. QB bills)
  - Invoice-level (pay apps vs. individual bills)
  - Change order tracking
  - Retention reconciliation
  - Budget vs. actual analysis
- **AI Analysis**: Claude-powered discrepancy analysis and executive summaries
- **Report Generation**: Excel workbooks and PDF summaries

## Installation

### Prerequisites

- Python 3.11+
- Procore API credentials (OAuth 2.0)
- QuickBooks Online API credentials (OAuth 2.0)
- Anthropic API key (for AI features)

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd procore-qb-closeout
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate  # Windows
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Configure environment variables:
```bash
cp config/.env.example config/.env
# Edit config/.env with your API credentials
```

## Configuration

### Environment Variables

Create a `.env` file in the `config/` directory:

```env
# Procore API Configuration
PROCORE_CLIENT_ID=your_procore_client_id
PROCORE_CLIENT_SECRET=your_procore_client_secret
PROCORE_ACCESS_TOKEN=your_procore_access_token
PROCORE_REFRESH_TOKEN=your_procore_refresh_token
PROCORE_COMPANY_ID=your_procore_company_id

# QuickBooks Online API Configuration
QBO_CLIENT_ID=your_qbo_client_id
QBO_CLIENT_SECRET=your_qbo_client_secret
QBO_ACCESS_TOKEN=your_qbo_access_token
QBO_REFRESH_TOKEN=your_qbo_refresh_token
QBO_REALM_ID=your_qbo_realm_id

# Anthropic API Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Getting API Credentials

#### Procore
1. Go to [Procore Developer Portal](https://developers.procore.com/)
2. Create an application
3. Configure OAuth 2.0 with authorization code grant
4. Obtain access and refresh tokens

#### QuickBooks Online
1. Go to [Intuit Developer Portal](https://developer.intuit.com/)
2. Create an app for QuickBooks Online Accounting
3. Configure OAuth 2.0 settings
4. Obtain access and refresh tokens

#### Anthropic
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an API key

## Usage

### Full Closeout Reconciliation

```bash
python main.py closeout --project-id 12345 --output ./reports/
```

Options:
- `--project-id`: Procore project ID (required)
- `--qb-project`: QuickBooks project/customer name
- `--output`: Output directory for reports (default: ./reports)
- `--skip-ai`: Skip AI analysis (faster, no API costs)
- `--excel/--no-excel`: Generate Excel report (default: yes)
- `--pdf/--no-pdf`: Generate PDF report (default: yes)
- `--mapping-file`: Path to cost code mapping file

### Cost Code Mapping Wizard

Map Procore cost codes to QuickBooks accounts:

```bash
python main.py setup-mapping --project-id 12345
```

The wizard provides:
- Side-by-side comparison of Procore codes and QB accounts
- AI-suggested mappings based on name similarity
- Manual override capability
- Confidence scores for each mapping

### Preview Data (Testing)

Preview Procore data:
```bash
python main.py preview-procore --project-id 12345
```

Preview QuickBooks data:
```bash
python main.py preview-qb --project-name "Project Name"
```

### Run Reconciliation Only (No Reports)

```bash
python main.py reconcile --project-id 12345 --output ./data/reconciliation.json
```

### Generate Reports from Saved Data

```bash
python main.py report --input ./data/reconciliation.json --output ./reports/
```

### Check Configuration

Verify API connectivity:
```bash
python main.py check-config
```

## Report Outputs

### Excel Workbook (.xlsx)

Multi-sheet workbook with:
- **Executive Summary**: Key metrics and AI-generated summary
- **Commitment Reconciliation**: Side-by-side Procore vs. QB by vendor
- **Invoice Detail**: Invoice/pay app matching status
- **Change Order Log**: All COs with approval and QB status
- **Retention Summary**: Retention by vendor
- **Budget vs Actual**: By cost code
- **Open Items**: Closeout punch list

Color coding:
- Green: Reconciled/OK
- Yellow: Warning
- Red: Critical discrepancy

### PDF Summary

1-2 page executive summary with:
- Project header and key metrics
- Dashboard-style financial overview
- Top 10 action items
- AI-generated narrative summary

## Project Structure

```
procore-qb-closeout/
├── config/
│   ├── .env.example          # Environment template
│   └── cost_code_mapping.json # Cost code mappings
├── src/
│   ├── __init__.py
│   ├── procore_client.py     # Procore REST API integration
│   ├── qb_client.py          # QuickBooks Online API integration
│   ├── reconciler.py         # Core matching/reconciliation engine
│   ├── ai_analyzer.py        # Claude API integration for analysis
│   ├── closeout_report.py    # Report generation (Excel + PDF)
│   └── models.py             # Shared Pydantic data models
├── scripts/
│   └── setup_mapping.py      # Interactive cost code mapping wizard
├── tests/
│   ├── test_reconciler.py    # Reconciliation tests
│   └── mock_data/            # Sample API response fixtures
├── requirements.txt
├── README.md
└── main.py                   # CLI entry point
```

## CSI Division Reference

This tool uses CSI MasterFormat divisions standard in commercial construction:

| Division | Description |
|----------|-------------|
| 01 | General Requirements |
| 03 | Concrete |
| 04 | Masonry |
| 05 | Metals |
| 06 | Wood, Plastics, Composites |
| 07 | Thermal & Moisture Protection |
| 08 | Openings |
| 09 | Finishes |
| 10-14 | Specialties, Equipment, Furnishings |
| 21 | Fire Suppression |
| 22 | Plumbing |
| 23 | HVAC |
| 26 | Electrical |
| 27-28 | Communications, Security |
| 31-33 | Earthwork, Site, Utilities |

## Testing

Run tests:
```bash
pytest tests/ -v
```

Run with coverage:
```bash
pytest tests/ --cov=src --cov-report=html
```

## Troubleshooting

### API Connection Issues

1. Check credentials in `.env` file
2. Verify tokens haven't expired
3. Run `python main.py check-config` to test connectivity
4. Check Procore company ID is correct

### Token Refresh

Both Procore and QuickBooks tokens expire:
- Procore: Access tokens expire, refresh automatically
- QuickBooks: Access tokens expire in 1 hour, refresh automatically

If refresh fails, you may need to re-authorize through OAuth flow.

### Vendor Matching

If vendors aren't matching correctly:
1. Check for name variations between systems
2. Use `origin_id` in Procore to store QB vendor ID
3. Adjust fuzzy matching threshold in `reconciler.py`

### Cost Code Mapping

For better mapping results:
1. Run the mapping wizard before reconciliation
2. Verify high-confidence mappings
3. Manually map important cost codes

## License

MIT License

## Support

For issues and feature requests, please use the GitHub issue tracker.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request
