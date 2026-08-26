export const getMyProgress = async (req, res) => {
  const client = req.client;

  res.status(200).json({
    success: true,
    client: {
      _id: client._id,
      fullName: client.fullName,
      program: client.program,
      startDate: client.startDate,
      cycleWeeks: client.cycleWeeks,
      startingWeightKg: client.startingWeightKg,
      goalWeightKg: client.goalWeightKg,
      currentWeightKg: client.currentWeightKg,
      checkIns: (client.checkIns || []).sort((a, b) => new Date(a.date) - new Date(b.date)),
      mealPlanNotes: client.mealPlanNotes,
      mealChecklist: client.mealChecklist || [],
      mealTimetableMode: client.mealTimetableMode || "weekly",
      mealTimetable: client.mealTimetable || [],
      status: client.status,
    },
  });
};

export const addMyCheckIn = async (req, res, next) => {
  try {
    const { weightKg, notes } = req.body;
    if (!weightKg) {
      return res.status(400).json({ success: false, message: "Weight is required for a check-in." });
    }

    const client = req.client;
    client.checkIns.push({ weightKg, notes, date: new Date() });
    await client.save();

    res.status(201).json({ success: true, message: "Check-in recorded." });
  } catch (err) {
    next(err);
  }
};
