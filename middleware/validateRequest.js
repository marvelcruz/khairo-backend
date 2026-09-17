const formatIssuePath = (source, path) =>
  [source, ...path.map(String)].join(".");

const formatIssues = (source, issues) =>
  issues.map((issue) => ({
    path: formatIssuePath(source, issue.path),
    code: issue.code,
    message: issue.message,
  }));

/**
 * Central request validation for Express routes.
 *
 * Schemas are applied before controllers and parsed values replace the raw
 * request values. This gives controllers normalized data (trimmed/lower-cased
 * strings, coerced numbers where explicitly allowed) and prevents unexpected
 * object keys from reaching business logic when schemas use `.strict()`.
 */
export const validateRequest = ({ body, params, query } = {}) => {
  const validators = [
    ["body", body],
    ["params", params],
    ["query", query],
  ].filter(([, schema]) => Boolean(schema));

  if (!validators.length) {
    throw new Error("validateRequest requires at least one schema.");
  }

  return (req, res, next) => {
    for (const [source, schema] of validators) {
      const result = schema.safeParse(req[source]);

      if (!result.success) {
        const errors = formatIssues(source, result.error.issues);
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: errors[0]?.message || "Invalid request.",
          errors,
        });
      }

      req[source] = result.data;
    }

    next();
  };
};
