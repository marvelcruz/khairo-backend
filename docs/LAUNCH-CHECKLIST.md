# Khairo Diet Clinic Production Launch Checklist

Use this checklist before declaring the system ready for production.

## 1. Environment
- [ ] Render backend deploy is live
- [ ] Vercel frontend deploy is live
- [ ] `MONGODB_URI` is set in Render
- [ ] `JWT_SECRET` is set and not a placeholder
- [ ] `CLIENT_URL` matches the Vercel domain
- [ ] `PAYSTACK_SECRET_KEY` is set
- [ ] `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set
- [ ] `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` are set
- [ ] `ADMIN_EMAIL` is set

## 2. CRM / Sales
- [ ] Admin can create or import CRM leads
- [ ] Duplicate email and phone protection works
- [ ] Qualification decision routes to Qualified / Nurture / Lost
- [ ] Consultation booking/reschedule/cancel works
- [ ] Consultation reminders are enabled
- [ ] Payment pending queue shows correct clients
- [ ] Paystack payment link can be generated and copied
- [ ] Manual payment activation works

## 3. Clinical
- [ ] Doctor can see only assigned medical reviews
- [ ] Doctor can schedule and sign clinical record
- [ ] Medical outcome routes to Payment Pending / Nurture
- [ ] Medical records are not visible to non-clinical staff

## 4. Client Journey
- [ ] Onboarding queue shows active clients
- [ ] Activation creates subscription and order
- [ ] Week 3 review queue shows clients at day 21
- [ ] Week 3 reminders and escalations work
- [ ] Client portal login works
- [ ] Daily tracking and retention alerts work

## 5. Communications
- [ ] Broadcast consent badges display correctly
- [ ] Approved WhatsApp template selector works
- [ ] Template sending respects consent and valid phone
- [ ] Broadcast history records sent messages

## 6. Automations
- [ ] Workflow Builder loads reference data
- [ ] Workflow trigger/action/conditions/retry controls exist
- [ ] Wait action can be configured
- [ ] Failure alerts email admin
- [ ] Action Centre scan runs

## 7. Reporting
- [ ] Revenue dashboard loads
- [ ] KPI conversion/retention/LTV shows data
- [ ] Pipeline table shows stages and sources
- [ ] Staff performance data loads

## 8. Roles
- [ ] Admin access works
- [ ] Sales access works
- [ ] Staff access works
- [ ] Coach access works
- [ ] Doctor access works
- [ ] Client portal access works
- [ ] Unauthorized routes are blocked

## 9. Data Safety
- [ ] `.env` is not committed to GitHub
- [ ] MongoDB password is secure
- [ ] Backups are enabled
- [ ] Export permissions are reviewed
- [ ] Production error monitoring is configured
