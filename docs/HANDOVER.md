# Khairo Diet Clinic Production Handover Summary

## Live URLs

- Website: https://khairo-frontend-kappa.vercel.app
- Staff Dashboard: https://khairo-frontend-kappa.vercel.app/login
- Client Portal: https://khairo-frontend-kappa.vercel.app/portal/login
- Backend API: https://khairo-backend.onrender.com
- Backend Health: https://khairo-backend.onrender.com/api/health

## Key Features Delivered

- Client portal with email and Google login
- Staff dashboard with CRM, consultations, medical review, payments, activation
- Daily client tracking, meal plans, appointments, messages
- Workflow automation engine
- Action Centre, reports, broadcast, newsletters
- Revenue Growth dashboard with toggles for:
  - Promo codes
  - Abandoned payment recovery
  - Referral program
  - Win-back offers
  - One-click renewal
  - Gift cards
  - Upsells/add-ons
- Gift card checkout redemption
- Business Configuration and Growth Features settings
- Roles, permissions, audit logs
- Terms, Privacy, What You Get pages

## Setup Still Required

- Brevo email for sending actual emails
- Apple Developer credentials for Apple Sign In
- Verify Google OAuth credentials and redirect URIs
- Paystack live keys
- WhatsApp Cloud API credentials
- UptimeRobot frontend monitor if not already added

## Security Note

Rotate any exposed credentials before production:
- Google AI API key
- MongoDB password
- Any API keys shared during development

## Documentation

- docs/SOP-OVERVIEW.md
- docs/LAUNCH-CHECKLIST.md
- docs/DATA-GOVERNANCE.md
- docs/STAGE-TRANSITIONS.md
- docs/PRODUCTION-HARDENING.md
- docs/GROWTH-IDEAS.md
