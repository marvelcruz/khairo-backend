# Khairo Diet Clinic CRM Stage Transition Matrix

This document describes the allowed sales-pipeline stage transitions, who or what can make them, and the regression protections in place.

## Stages

| Stage | Meaning |
| --- | --- |
| New Lead | Lead captured, not yet qualified |
| Qualification | Qualification review or questionnaire in progress |
| Qualified | Lead passed qualification |
| Consultation Booked | Consultation scheduled |
| Consultation Completed | Consultation completed |
| Medical Review | Clinical clearance in progress |
| Payment Pending | Medical cleared, awaiting payment |
| Nurture | Long-term follow-up |
| Lost | Closed without current progression |

## Opportunity Status

| Status | Meaning |
| --- | --- |
| Open | Active opportunity |
| Won | Closed as won / client activation |
| Lost | Closed as lost |

## Allowed Transitions

| From | To | Trigger |
| --- | --- | --- |
| New Lead | Qualification | Automatic via form/workflow, or manual |
| New Lead | Nurture | Manual |
| New Lead | Lost | Manual |
| Qualification | Qualified | Qualification decision |
| Qualification | Nurture | Qualification decision |
| Qualification | Lost | Qualification decision |
| Qualified | Consultation Booked | Manual booking |
| Qualified | Nurture | Manual |
| Qualified | Lost | Manual |
| Consultation Booked | Consultation Completed | Consultation outcome: completed |
| Consultation Booked | Nurture | Consultation outcome |
| Consultation Booked | Lost | Consultation outcome |
| Consultation Booked | Qualified | Cancellation/booking regression only via cancellation flow |
| Consultation Completed | Medical Review | Manual stage change after completed consultation |
| Consultation Completed | Nurture | Manual |
| Consultation Completed | Lost | Manual |
| Medical Review | Payment Pending | Medical outcome: cleared |
| Medical Review | Nurture | Medical outcome: not cleared |
| Medical Review | Medical Review | Follow-up required |
| Payment Pending | Activated/closed appropriately | Successful payment or manual activation |
| Payment Pending | Nurture | Manual |
| Payment Pending | Lost | Manual |
| Nurture | Qualification | Deliberate re-entry |
| Nurture | Lost | Manual |
| Lost | New Lead / Qualification | Deliberate reopen only |

## Human vs Automatic

| Action | Owner |
| --- | --- |
| Qualification form moves New Lead → Qualification | Automatic workflow |
| Qualification decision moves Qualification → Qualified/Nurture/Lost | Human: Sales/Admin |
| Consultation booking/rescheduling/cancellation | Human: Sales/Admin/Staff/Coach |
| Consultation outcome | Human: Sales/Admin/Coach |
| Medical review assignment/creation | Automatic when stage enters Medical Review |
| Medical schedule and outcome | Human: Assigned Doctor |
| Payment success → activation | Automatic via Paystack webhook/verification |
| Manual activation | Human: Admin |
| Week 3 and other post-sale journeys | Automatic + Human follow-up |

## Regression Protections

- Advanced stages `consultation_booked`, `consultation_completed`, `medical_review`, `payment_pending` are protected from backwards qualification decisions.
- Qualification decisions are only allowed while the opportunity is in `qualification`.
- Consultation booking is restricted to `qualified` and `consultation_booked`.
- Consultation outcomes are only allowed from `consultation_booked`.
- Medical review outcomes require a signed clinical record.
- Lost opportunities require a deliberate reopen before returning to an active pipeline stage.
- Required-fields-by-stage policy blocks movement into key stages when mandatory fields are missing.
- Stage tags are lifecycle-managed and cleared appropriately after activation.

## Post-Sale Handoff

- After verified payment, the sales side closes appropriately:
  - CRM stage remains linked to the client journey.
  - Sales-stage tags are removed after activation.
  - Client lifecycle tags take over after activation.
