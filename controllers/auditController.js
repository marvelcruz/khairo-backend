import AuditLog from "../models/AuditLog.js";

export const getAuditLogs = async (req, res, next) => {
  try {
    const query = {};
    // Admins see EVERYONE's trail. Coaches/Staff only see their OWN trail.
    if (req.user.role !== "admin") {
      query.user = req.user._id;
    }
    
    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
      
    res.status(200).json({ 
      success: true, 
      logs, 
      isGlobalView: req.user.role === "admin" 
    });
  } catch (err) {
    next(err);
  }
};
