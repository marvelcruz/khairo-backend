import PerformanceReview from "../models/PerformanceReview.js";
import Client from "../models/Client.js";
import DailyLog from "../models/DailyLog.js";

export const generateClientReview = async (clientId) => {
  try {
    const client = await Client.findById(clientId);
    if (!client) return null;

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30); // Look at the last 30 days

    const logs = await DailyLog.find({ 
      client: clientId, 
      logDate: { $gte: start, $lte: end } 
    }).sort({ logDate: 1 });

    if (logs.length === 0) return null;

    const startWeight = client.startingWeightKg || logs[0].weightKg || 0;
    const endWeight = logs[logs.length - 1].weightKg || startWeight;
    
    const daysLogged = logs.length;
    const totalCals = logs.reduce((sum, l) => sum + (l.calories || 0), 0);
    const avgCals = daysLogged > 0 ? Math.round(totalCals / daysLogged) : 0;
    
    const workoutsDone = logs.filter(l => l.workoutDone).length;
    const adherence = daysLogged > 0 ? Math.round((workoutsDone / daysLogged) * 100) : 0;
    
    const weightChange = Number((endWeight - startWeight).toFixed(1));

    let summary = "";
    if (weightChange < 0) summary += `Lost ${Math.abs(weightChange)}kg. `;
    else if (weightChange > 0) summary += `Gained ${weightChange}kg. `;
    else summary += `Maintained weight. `;
    
    if (adherence >= 80) summary += "Excellent adherence!";
    else if (adherence >= 50) summary += "Good effort, keep pushing!";
    else summary += "Needs more consistency.";

    const review = await PerformanceReview.create({
      client: clientId,
      periodStart: start,
      periodEnd: end,
      startingWeight: startWeight,
      endingWeight: endWeight,
      weightChange,
      averageCalories: avgCals,
      adherencePercent: adherence,
      totalWorkouts: workoutsDone,
      daysLogged,
      summary
    });

    return review;
  } catch (err) {
    console.error("Error generating review:", err);
    return null;
  }
};

export const getAllReviews = async (req, res, next) => {
  try {
    const reviews = await PerformanceReview.find({})
      .populate("client", "fullName email program")
      .sort({ generatedAt: -1 })
      .limit(50);
    res.status(200).json({ success: true, reviews });
  } catch (err) {
    next(err);
  }
};

export const getClientReviews = async (req, res, next) => {
  try {
    const reviews = await PerformanceReview.find({ client: req.params.id })
      .sort({ generatedAt: -1 });
    res.status(200).json({ success: true, reviews });
  } catch (err) {
    next(err);
  }
};

export const triggerManualReview = async (req, res, next) => {
  try {
    const review = await generateClientReview(req.params.id);
    if (!review) return res.status(400).json({ success: false, message: "No daily logs found for this client in the last 30 days." });
    res.status(201).json({ success: true, review });
  } catch (err) {
    next(err);
  }
};
