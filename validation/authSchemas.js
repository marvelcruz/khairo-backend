import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254, "Email is too long.");

const loginPassword = z
  .string()
  .min(1, "Password is required.")
  .max(256, "Password is too long.");

const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(256, "Password is too long.");

const token = z
  .string()
  .trim()
  .min(1, "Token is required.")
  .max(4096, "Token is too long.");

const phone = z.string().trim().max(40, "Phone number is too long.");
const name = z.string().trim().min(1, "Name is required.").max(120, "Name is too long.");

const accessRoles = ["staff", "doctor"];
const permissionKeys = [
  "view_dashboard",
  "view_requests",
  "view_crm",
  "view_action_centre",
  "view_clients",
  "view_medical_review",
  "view_orders",
  "view_coaching",
  "view_appointments",
  "view_messages",
  "view_trials",
  "view_buddies",
  "view_broadcast",
  "view_social_media",
  "view_billing",
  "view_pricing",
  "view_supplements",
  "view_reports",
  "view_contact_info",
  "view_financials",
];

const accessRole = z.enum(accessRoles);
const permission = z.enum(permissionKeys);

export const loginSchema = z
  .object({
    email,
    password: loginPassword,
  })
  .strict();

export const emailOnlySchema = z
  .object({
    email,
  })
  .strict();

export const passwordResetSchema = z
  .object({
    token,
    newPassword: password,
  })
  .strict();

export const clientActivationSchema = z
  .object({
    token,
    password,
  })
  .strict();

export const clientRegistrationSchema = z
  .object({
    fullName: name,
    email,
    phone: phone.min(1, "Phone number is required."),
    password,
    referralCode: z.string().trim().max(100).optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: loginPassword,
    newPassword: password,
  })
  .strict();

export const createStaffSchema = z
  .object({
    name,
    email,
    password,
    role: accessRole.optional(),
    roles: z.array(accessRole).max(1).optional(),
    phone: phone.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role && value.roles?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["roles"],
        message: "Send either role or roles, not both.",
      });
    }
  });

export const updateStaffSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    role: accessRole.optional(),
    roles: z.array(accessRole).max(1).optional(),
    isActive: z.boolean().optional(),
    phone: phone.optional(),
    permissions: z.array(permission).max(permissionKeys.length).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role && value.roles?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["roles"],
        message: "Send either role or roles, not both.",
      });
    }

    if (!Object.keys(value).length) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "At least one field is required.",
      });
    }
  });

export const mongoIdParamsSchema = z
  .object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid resource id."),
  })
  .strict();

export const pushSubscriptionSchema = z
  .object({
    subscription: z
      .object({
        endpoint: z.string().url().max(2048),
        expirationTime: z.number().nullable().optional(),
        keys: z
          .object({
            p256dh: z.string().min(1).max(1024),
            auth: z.string().min(1).max(1024),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const pushUnsubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048),
  })
  .strict();
