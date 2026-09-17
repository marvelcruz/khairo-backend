const DEFAULT_MESSAGE = "Invalid request data.";

const formatIssues = (target, issues = []) =>
  issues.map((issue) => ({
    field: [target, ...(issue.path || [])].join("."),
    message: issue.message,
    code: issue.code,
  }));

/**
 * Central request validation middleware.
 *
 * Pass any combination of Zod schemas for body, query, and params. Parsed
 * values replace the original Express request values so normalization and
 * coercion happen once at the route boundary rather than inside controllers.
 */
export const validate = ({ body, query, params } = {}) => {
  const schemas = { body, query, params };

  return async (req, res, next) => {
    try {
      const errors = [];

      for (const [target, schema] of Object.entries(schemas)) {
        if (!schema) continue;

        const result = await schema.safeParseAsync(req[target]);
        if (!result.success) {
          errors.push(...formatIssues(target, result.error?.issues));
          continue;
        }

        req[target] = result.data;
      }

      if (errors.length) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: DEFAULT_MESSAGE,
          errors,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
