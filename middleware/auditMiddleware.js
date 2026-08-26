import AuditLog from "../models/AuditLog.js";

export const globalAuditTracker = (req, res, next) => {
  // Ignore GET requests (just viewing pages) and unauthenticated users
  if (req.method === "GET" || !req.user) return next();

  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    // Only log if the action was successful (Status 200-399)
    if (res.statusCode >= 200 && res.statusCode < 400) {
      try {
        let action = `${req.method} ${req.originalUrl.split('?')[0]}`; // Fallback
        
        // Translate technical routes into human-readable actions
        if (req.originalUrl.includes("/custom-fields/definitions") && req.method === "POST") action = "Created custom field";
        else if (req.originalUrl.includes("/custom-fields/definitions") && req.method === "PATCH") action = "Updated custom field";
        else if (req.originalUrl.includes("/custom-fields/records") && ["PUT", "PATCH"].includes(req.method)) action = "Updated custom field values";
        else if (req.originalUrl.includes("/crm/contacts") && req.originalUrl.includes("/activities") && req.method === "POST") action = "Added CRM activity";
        else if (req.originalUrl.includes("/crm/contacts") && req.originalUrl.includes("/to-application") && req.method === "POST") action = "Moved CRM lead to Requests";
        else if (req.originalUrl.includes("/crm/contacts") && req.method === "POST") action = "Created CRM lead";
        else if (req.originalUrl.includes("/crm/contacts") && req.method === "DELETE") action = "Archived CRM lead";
        else if (req.originalUrl.includes("/crm/opportunities") && req.method === "PATCH") action = "Updated CRM pipeline";
        else if (req.originalUrl.includes("/crm/activities") && req.method === "PATCH") action = "Updated CRM task";
        else if (req.originalUrl.includes("/clients") && req.method === "POST") action = "Created new client";
        else if (req.originalUrl.includes("/clients") && req.method === "DELETE") action = "Archived/Deleted client";
        else if (req.originalUrl.includes("/exercises")) action = "Modified client exercises";
        else if (req.originalUrl.includes("/timetable")) action = "Updated client meal timetable";
        else if (req.originalUrl.includes("/staff") && req.method === "POST") action = "Created staff account";
        else if (req.originalUrl.includes("/staff") && req.method === "PATCH") action = "Updated staff account";
        else if (req.originalUrl.includes("/reports/goal")) action = "Updated monthly revenue goal";
        else if (req.originalUrl.includes("/payments") && req.method === "POST") action = "Processed manual payment";
        else if (req.originalUrl.includes("/checkin")) action = "Recorded client check-in";
        else if (req.originalUrl.includes("/notes")) action = "Updated client notes";

        AuditLog.create({
          user: req.user._id,
          userName: req.user.name || "Staff",
          action,
          entityType: "System",
          entityId: req.params.id || ""
        }).catch(() => {});
      } catch (err) {}
    }
    originalEnd.call(this, chunk, encoding);
  };
  next();
};
