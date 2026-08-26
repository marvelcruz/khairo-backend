#!/bin/bash
set -e

echo "============================================="
echo "  Khairo Diet Clinic – Full Setup Script"
echo "============================================="

# Check environment variables
if [[ -z "$MONGO_URI" || -z "$FITLUNGE_MONGO_URI" ]]; then
  echo "❌ Missing MONGO_URI or FITLUNGE_MONGO_URI"
  echo "Please set them in .env before running this script."
  exit 1
fi

# 1. Seed default data
echo ""
echo "1/6 Seeding default workflows..."
node scripts/seedWorkflowTemplates.js
node scripts/seedAdditionalWorkflowTemplates.js
node scripts/seedRemainingWorkflowTemplates.js
node scripts/activateWorkflowTemplates.js

echo ""
echo "2/6 Seeding CRM tags..."
node scripts/seedCrmTags.js

echo ""
echo "3/6 Seeding qualification form..."
node scripts/seedQualificationForm.js

# 2. Migrate custom settings from FitLunge
echo ""
echo "4/6 Migrating custom settings from FitLunge..."
node migrateFromFitLunge.mjs

# 3. Fix roles and permissions
echo ""
echo "5/6 Fixing staff and doctor roles..."
node fixRoles.mjs

# 4. Activate all client portals (so clients can log in)
echo ""
echo "6/6 Activating client portal access..."
node activateAllClients.mjs

echo ""
echo "✅ Setup complete."
echo "--------------------------------------------------"
echo "Admin login: admin@khairodietclinic.com / Khairo@2026"
echo "Doctor login: doctor@khairodietclinic.com / Doctor@2026"
echo "--------------------------------------------------"
echo "You can now deploy the frontend and backend."
