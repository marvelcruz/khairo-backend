# KhairoDietClinic Data Governance

This document defines how KhairoDietClinic handles CRM, client, clinical, payment, and communication data.

## Scope

- CRM contacts, opportunities, activities, tags, and imports/exports
- Applications and qualification records
- Client records and onboarding data
- Medical review cases and signed clinical records
- Payments, subscriptions, orders, and reconciliation data
- Messages, broadcasts, consent, and communication logs
- Staff accounts, roles, permissions, and audit logs

## Data Classification

| Classification | Examples | Handling |
| --- | --- | --- |
| Public | Website content, public pricing, public forms | Publicly visible |
| Operational | CRM contacts, tasks, notes, source, stage, owner | Restricted by role |
| Sensitive | Client contact details, payment data, engagement logs | Restricted, audited |
| Clinical | Medical review findings, medications, restrictions, signed records | Doctor-only, strict isolation |

## Retention

| Record type | Minimum retention | Notes |
| --- | --- | --- |
| CRM contacts and opportunities | Active business need + 12 months after last activity | Archived contacts remain readable for reporting |
| Applications | 24 months after decision | Retained for conversion and audit history |
| Clients | 24 months after last active status | Former clients remain protected |
| Payments/subscriptions | 7 years or local legal requirement | Financial records retained |
| Audit logs | 12 months minimum | Do not delete without legal review |
| Medical review cases | 7 years or local clinical record requirement | Never delete casually |

## Archived Contact Policy

- Archived contacts remain in MongoDB with `isArchived: true`.
- Archived contacts are excluded from normal CRM search and duplicate detection.
- Historical archived tags and exports remain readable for audit.
- Archived contacts can be restored if reactivation is appropriate.
- A contact should be archived, not permanently deleted, unless legal deletion is required.

## Deletion

- Permanent deletion is allowed only where legally required or where a contact was created in error.
- Before deletion:
  - Export or archive the record
  - Confirm no linked client, application, payment, or medical review case
  - Record an audit entry
- Do not hard-delete financial or clinical records through normal application paths.

## Export Permissions

- CRM export is restricted to Admin and Sales.
- Financial export is restricted to Admin.
- Clinical data must never be included in standard CRM or financial exports.
- Exports containing personal data must be handled securely and deleted after use.

## Clinical Data Governance

- Medical review data is isolated from CRM and financial views.
- Only the assigned doctor can complete and sign a medical review.
- Clinical records are read-only after signing.
- Corrections use signed addenda, not editing.
- Do not copy clinical findings into CRM notes, tasks, or emails.
- Doctor-only queries must remain enforced in controllers and services.

## Consent and Communication Data

- WhatsApp marketing consent is stored separately from preferred contact method.
- Consent status: `unknown`, `opted_in`, `opted_out`.
- Consent source and date must be recorded.
- Business-initiated WhatsApp broadcasts require approved templates and explicit opt-in.
- 24-hour service-window rules apply to inbound WhatsApp handling.

## Shared Accounts and Secrets

- Do not commit `.env`, service credentials, or database connection strings.
- Rotate credentials if they are exposed.
- Use least-privilege roles for new staff.

## Enforcement

- API permission checks must remain in place.
- Audit logs must record sensitive updates.
- Changes to this policy require admin and clinical sign-off before implementation.
