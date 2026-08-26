import Client from "../models/Client.js";
import CrmActivity from "../models/CrmActivity.js";
import MedicalReviewCase from "../models/MedicalReviewCase.js";
import Session from "../models/Session.js";

function hasMedicalIntake(client) {
  return Boolean(
    client.healthNotes ||
    client.qualificationSummary?.healthNotes ||
    client.goals
  );
}

async function hasFirstAppointment(clientId) {
  if (!clientId) return false;
  const session = await Session.exists({ client: clientId });
  return Boolean(session);
}

async function hasWelcomeEmail(clientId) {
  if (!clientId) return false;
  return CrmActivity.exists({
    client: clientId,
    type: "email",
    subject: { $regex: /welcome|onboarding/i },
  });
}

function hasMealPlan(client) {
  return Boolean(
    (client.mealTimetable && client.mealTimetable.length > 0) ||
    (client.mealChecklist && client.mealChecklist.length > 0) ||
    client.mealPlanNotes
  );
}

function hasBaselineInfo(client) {
  return Boolean(
    (client.checkIns && client.checkIns.length > 0) ||
    client.startingWeightKg ||
    client.goalWeightKg
  );
}

function hasWeek1Started(client) {
  return Boolean(client.programStartedAt || client.startDate);
}

function hasWeek3Checkin(client) {
  return Boolean(client.week3Review?.completed);
}

export async function buildClientOnboardingChecklist(client) {
  if (!client) return [];

  const steps = [
    {
      key: "payment_successful",
      title: "Payment successful",
      description: "Program payment has been verified and reconciled.",
      complete: Boolean(client.reconciled),
    },
    {
      key: "account_created",
      title: "Account created",
      description: "Client record exists in KhairoDietClinic.",
      complete: Boolean(client._id),
    },
    {
      key: "welcome_email",
      title: "Welcome email",
      description: "Welcome email has been sent.",
      complete: await hasWelcomeEmail(client._id),
    },
    {
      key: "portal_activated",
      title: "Portal activated",
      description: "Client can log in to the portal.",
      complete: Boolean(client.portalActive),
    },
    {
      key: "medical_intake",
      title: "Medical intake",
      description: "Medical/health information has been provided.",
      complete: hasMedicalIntake(client),
    },
    {
      key: "baseline_information",
      title: "Baseline information",
      description: "Starting weight, goal weight, or first check-in recorded.",
      complete: hasBaselineInfo(client),
    },
    {
      key: "doctor_assigned",
      title: "Doctor assigned",
      description: "Medical review doctor is assigned.",
      complete: Boolean(client.assignedDoctor),
    },
    {
      key: "coach_assigned",
      title: "Coach assigned",
      description: "Program coach is assigned.",
      complete: Boolean(client.assignedCoach),
    },
    {
      key: "meal_plan_assigned",
      title: "Meal plan assigned",
      description: "Meal timetable, checklist, or meal notes are set.",
      complete: hasMealPlan(client),
    },
    {
      key: "first_appointment",
      title: "First appointment",
      description: "First appointment has been created.",
      complete: await hasFirstAppointment(client._id),
    },
    {
      key: "week1_started",
      title: "Week 1 started",
      description: "Program start date has been set.",
      complete: hasWeek1Started(client),
    },
    {
      key: "week3_checkin",
      title: "Week 3 check-in",
      description: "Week 3 review has been completed.",
      complete: hasWeek3Checkin(client),
    },
  ];

  return steps;
}
