#!/bin/bash
# Run all default seeds, then migrate custom data from FitLunge
set -e

echo "Seeding default workflows..."
node scripts/seedWorkflowTemplates.js
node scripts/seedAdditionalWorkflowTemplates.js
node scripts/seedRemainingWorkflowTemplates.js
node scripts/activateWorkflowTemplates.js

echo "Seeding CRM tags..."
node scripts/seedCrmTags.js

echo "Seeding qualification form..."
node scripts/seedQualificationForm.js

echo "Migrating custom settings from FitLunge..."
node migrateFromFitLunge.mjs

echo "✅ Setup complete."
