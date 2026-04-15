# Project Closeout Feature Rollout Plan

## Overview
This document outlines an incremental rollout strategy for the closeout feature enhancements. Each phase is designed to be independently deployable and testable.

---

## Phase 1: Backend Summary Totals (Low Risk)
**Goal**: Add new calculated totals to the report without changing existing functionality

### 1.1 Add New Summary Fields
Add these calculated values to the report response:

```
Procore Subcontractors Invoiced (from procoreInvoices sum)
QBO Subcontractors Invoiced (from matched QB bills sum)
Procore Subcontractors Paid (from commitments.paidToDate sum)
QBO Subcontractors Paid (need to fetch QB bill payments)
Procore Retention Held (already have: sub_retention_held)
QBO Retention Held (need to calculate from QB data)
Procore Retention Paid (need to add to commitment tracking)
QBO Retention Paid (from QB bill payments for retention)
```

### 1.2 Files to Modify
- `run-reconciliation.ts`: Add new summary calculations after line 2107
- `supabase.ts`: Add new fields to `ReconciliationReport` interface
- DB migration: Add columns to `reconciliation_reports` table

### 1.3 Testing
- Verify existing report still works
- Verify new fields appear in API response (can be null initially)

---

## Phase 2: Labor Tracking - Backend (Low Risk)
**Goal**: Separate payroll direct costs into a new "labor" category

### 2.1 Identify Payroll Direct Costs from Procore
- In `normalizeDirectCosts()`, check if cost type is "Payroll"
- Add new `matchType: 'labor'` for payroll direct costs

### 2.2 Fetch Labor Accounts from QBO
Add QB expense query for accounts:
- 5010.00 Direct Labor Wages
- 5011.00 Direct Labor Social Security Tax Expense
- 5012.00 Direct Labor Medicare Tax Expense

### 2.3 Files to Modify
- `run-reconciliation.ts`:
  - Update `MatchResult.matchType` to include `'labor'`
  - Add `matchLaborCosts()` function
  - Separate payroll from direct costs in results

### 2.4 Testing
- Verify direct costs without payroll still work
- Verify labor costs appear with new matchType

---

## Phase 3: Frontend Summary Cards (Low Risk)
**Goal**: Display new totals in the Summary tab

### 3.1 Update Summary Section
Add new summary cards for:
- Procore vs QBO Subcontractor Invoiced
- Procore vs QBO Subcontractor Paid
- Procore vs QBO Retention Held
- Procore vs QBO Retention Paid
- Procore vs QBO Labor

### 3.2 Files to Modify
- `ReportDetail.tsx`: Add new cards in summary section (lines 154-208)
- Style with comparison layout (Procore | QBO | Variance)

### 3.3 Testing
- Verify summary tab displays new values
- Verify null values handled gracefully

---

## Phase 4: Labor Tab - Frontend (Low Risk)
**Goal**: Add Labor tab to display labor costs

### 4.1 Add Tab Definition
```typescript
type TabType = 'summary' | 'sub_invoices' | 'owner_invoices' | 'direct_costs' | 'labor' | 'warnings' | 'closeout'
```

### 4.2 Filter Labor Results
```typescript
const laborResults = results?.filter(r => r.item_type === 'labor') || []
```

### 4.3 Files to Modify
- `ReportDetail.tsx`:
  - Add 'labor' to TabType
  - Add Labor tab after Direct Costs
  - Add laborResults filtering
  - Add Labor tab content section

### 4.4 Testing
- Verify new tab appears
- Verify labor items filtered correctly
- Verify Direct Costs no longer shows payroll items

---

## Phase 5: Sub-Invoice Grouping by Subcontractor (Medium Risk)
**Goal**: Group sub-invoices by vendor with totals

### 5.1 Create Grouping Logic
```typescript
interface VendorGroup {
  vendor: string;
  procoreTotal: number;
  qbTotal: number;
  variance: number;
  status: 'Reconciled' | 'Conditionally Reconciled' | 'Unreconciled';
  notes: string;
  invoices: ReconciliationResult[];
}
```

### 5.2 Grouping Algorithm
1. Group results by vendor name
2. Calculate totals for each vendor
3. Determine status:
   - **Reconciled**: All individual invoices match exactly
   - **Conditionally Reconciled**: Individual invoices differ but totals match
   - **Unreconciled**: Totals don't match
4. Generate notes explaining variances

### 5.3 Files to Modify
- `ReportDetail.tsx`:
  - Create `groupByVendor()` function
  - Create `VendorGroupHeader` component
  - Update `ResultsTable` to support collapsible groups

### 5.4 Testing
- Verify grouping works with existing data
- Verify expand/collapse functionality
- Verify status logic is correct

---

## Phase 6: Invoice Retainage Display (Low Risk)
**Goal**: Show retainage on invoice lines

### 6.1 Add Retainage to Match Results
In backend, add fields:
- `procore_retainage: number`
- `qb_retainage: number`

### 6.2 Display in Table
Add columns or inline display for retainage values

### 6.3 Files to Modify
- `run-reconciliation.ts`: Add retainage to MatchResult
- `ReportDetail.tsx`: Display retainage in invoice rows

---

## Phase 7: Status Terminology Update (Low Risk)
**Goal**: Change "info" severity to "reconciled" terminology

### 7.1 Update Status Display
- Keep backend severity as 'info' (no migration needed)
- Change frontend display text from "Info" to "Reconciled"

### 7.2 Files to Modify
- `ReportDetail.tsx`: Update `getStatusText()` or equivalent
- CSS: Update any status-specific styling

---

## Phase 8: Soft Close Logic (Medium Risk)
**Goal**: Add Soft Close button with enablement logic

### 8.1 Calculate Soft Close Eligibility
```typescript
const canSoftClose =
  subInvoicesAllReconciled &&
  ownerInvoicesAllReconciled &&
  directCostsAllReconciled &&
  laborMatches;
```

### 8.2 Add Soft Close Button
- Position: Top right corner of report
- State: Disabled until all conditions met
- Action: Update project status in database

### 8.3 Files to Modify
- `run-reconciliation.ts`: Calculate soft_close_eligible boolean
- `ReportDetail.tsx`: Add SoftCloseButton component
- DB migration: Add `soft_close_status` to projects table

---

## Phase 9: Hard Close Logic (Medium Risk)
**Goal**: Add Hard Close button with full payment verification

### 9.1 Calculate Hard Close Eligibility
```typescript
const canHardClose =
  canSoftClose &&
  subcontractorsFullyBilled &&
  ownerFullyBilled &&
  allSubInvoicesPaid &&
  allOwnerInvoicesPaid;
```

### 9.2 Add Hard Close Button
- Position: Next to Soft Close button
- State: Disabled until all conditions met
- Action: Finalize project, lock from further changes

### 9.3 Files to Modify
- `run-reconciliation.ts`: Calculate hard_close_eligible boolean
- `ReportDetail.tsx`: Add HardCloseButton component
- DB migration: Add `hard_close_status` and `closed_at` to projects table

---

## Recommended Implementation Order

```
Week 1: Phase 1 (Backend Summary) + Phase 3 (Frontend Summary)
Week 2: Phase 2 (Labor Backend) + Phase 4 (Labor Tab)
Week 3: Phase 5 (Sub-Invoice Grouping)
Week 4: Phase 6 (Retainage) + Phase 7 (Status Terminology)
Week 5: Phase 8 (Soft Close) + Phase 9 (Hard Close)
```

---

## Database Migrations Required

### Migration 1: New Summary Fields
```sql
ALTER TABLE reconciliation_reports ADD COLUMN procore_sub_invoiced DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN qbo_sub_invoiced DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN procore_sub_paid DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN qbo_sub_paid DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN qbo_retention_held DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN procore_retention_paid DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN qbo_retention_paid DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN procore_labor DECIMAL(12,2);
ALTER TABLE reconciliation_reports ADD COLUMN qbo_labor DECIMAL(12,2);
```

### Migration 2: Closeout Status
```sql
ALTER TABLE reconciliation_reports ADD COLUMN soft_close_eligible BOOLEAN DEFAULT FALSE;
ALTER TABLE reconciliation_reports ADD COLUMN hard_close_eligible BOOLEAN DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN close_status VARCHAR(20) DEFAULT 'open'; -- 'open', 'soft_closed', 'hard_closed'
ALTER TABLE projects ADD COLUMN closed_at TIMESTAMP;
ALTER TABLE projects ADD COLUMN closed_by UUID REFERENCES auth.users(id);
```

### Migration 3: Result Enhancements
```sql
ALTER TABLE reconciliation_results ADD COLUMN procore_retainage DECIMAL(12,2);
ALTER TABLE reconciliation_results ADD COLUMN qb_retainage DECIMAL(12,2);
-- Update item_type enum to include 'labor'
```

---

## Risk Assessment

| Phase | Risk Level | Rollback Strategy |
|-------|------------|-------------------|
| 1 | Low | New fields are additive, old code ignores them |
| 2 | Low | New matchType value, filtered separately |
| 3 | Low | Frontend only, no data changes |
| 4 | Low | Frontend only, new tab is isolated |
| 5 | Medium | Grouping is frontend logic, can revert component |
| 6 | Low | Additive fields to existing results |
| 7 | Low | Display text change only |
| 8 | Medium | New button, status field is additive |
| 9 | Medium | New button, builds on Phase 8 |

---

## Notes for Implementation

1. **Each phase should be a separate PR** for easy review and rollback
2. **Feature flags** can be added if needed for gradual rollout
3. **Backend changes first**, then frontend to consume them
4. **Keep existing fields/behavior** until new features are stable
5. **Add logging** for new calculations to aid debugging
