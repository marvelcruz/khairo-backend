import jwt from "jsonwebtoken";
import Client from "../models/Client.js";
import { syncClientPortalAccess } from "../utils/clientPortalAccess.js";
import { ensurePortalSignupFollowUp } from "../services/clientLeadFollowupService.js";

const generateClientToken = (clientId) =>
  jwt.sign(
    {
      id: clientId,
      type: "client",
    },
    process.env.JWT_SECRET,
    {
      expiresIn:
        process.env.JWT_EXPIRES_IN ||
        "8h",
    }
  );

const sendClientTokenCookie = (
  res,
  token
) => {
  const expiresDays =
    Number(
      process.env.COOKIE_EXPIRES_DAYS
    ) || 1;

  res.cookie(
    "clientToken",
    token,
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV ===
        "production",
      sameSite:
        process.env.NODE_ENV ===
        "production"
          ? "none"
          : "lax",
      maxAge:
        expiresDays *
        24 *
        60 *
        60 *
        1000,
    }
  );
};

const safeId = (value) =>
  value === undefined || value === null
    ? undefined
    : String(value);

const toSafeClient = (
  client,
  portalAccess = null
) => {
  const obj =
    client.toObject({
      virtuals: true,
    });

  const checkIns =
    Array.isArray(obj.checkIns)
      ? obj.checkIns.map(
          (checkIn) => ({
            _id: safeId(
              checkIn._id
            ),
            date: checkIn.date,
            weightKg:
              checkIn.weightKg,
            notes: checkIn.notes,
          })
        )
      : [];

  const mealChecklist =
    Array.isArray(
      obj.mealChecklist
    )
      ? obj.mealChecklist.map(
          (item) => ({
            _id: safeId(
              item._id
            ),
            text: item.text,
            period: item.period,
          })
        )
      : [];

  const mealTimetable =
    Array.isArray(
      obj.mealTimetable
    )
      ? obj.mealTimetable.map(
          (day) => ({
            dayNumber:
              day.dayNumber,
            items: Array.isArray(
              day.items
            )
              ? day.items.map(
                  (item) => ({
                    _id: safeId(
                      item._id
                    ),
                    text: item.text,
                    period:
                      item.period,
                  })
                )
              : [],
            exercises:
              Array.isArray(
                day.exercises
              )
                ? day.exercises.map(
                    (exercise) => ({
                      _id: safeId(
                        exercise._id
                      ),
                      text:
                        exercise.text,
                      reps:
                        exercise.reps,
                      duration:
                        exercise.duration,
                    })
                  )
                : [],
          })
        )
      : [];

  return {
    _id: safeId(obj._id),
    id:
      obj.id ||
      safeId(obj._id),
    fullName: obj.fullName,
    email: obj.email,
    phone: obj.phone,
    program: obj.program,
    startDate: obj.startDate,
    cycleWeeks: obj.cycleWeeks,
    startingWeightKg:
      obj.startingWeightKg,
    goalWeightKg:
      obj.goalWeightKg,
    currentWeightKg:
      obj.currentWeightKg,
    checkIns,
    mealPlanNotes:
      obj.mealPlanNotes,
    mealChecklist,
    mealTimetableMode:
      obj.mealTimetableMode,
    mealTimetable,
    status: obj.status,
    accountStage:
      obj.accountStage,
    programStartedAt:
      obj.programStartedAt,
    programEndsAt:
      obj.programEndsAt,
    onboarding: obj.onboarding || {},
    week3Review: obj.week3Review || {},
    portalAccess,
  };
};

export const registerPreviewAccount =
  async (req, res, next) => {
    try {
      const {
        fullName,
        email,
        phone,
        password,
        referralCode,
      } = req.body;

      if (
        !fullName ||
        !email ||
        !phone ||
        !password
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Name, email, phone number and password are required.",
          });
      }

      if (
        String(password).length <
        8
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Password must be at least 8 characters.",
          });
      }

      const normalizedEmail =
        String(email)
          .toLowerCase()
          .trim();

      let client =
        await Client.findOne({
          email:
            normalizedEmail,
          isArchived: false,
        }).select("+password");

      if (client) {
        if (
          client.portalActive &&
          client.password
        ) {
          return res
            .status(409)
            .json({
              success: false,
              code:
                "ACCOUNT_EXISTS",
              message:
                "An account already exists with this email. Please sign in.",
            });
        }

        const savedPhone =
          String(
            client.phone || ""
          ).replace(/\D/g, "");

        const submittedPhone =
          String(phone).replace(
            /\D/g,
            ""
          );

        if (
          savedPhone &&
          savedPhone !==
            submittedPhone
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "The phone number does not match the KhairoDietClinic record for this email.",
            });
        }

        client.password =
          password;

        client.portalActive =
          true;

        if (
          !client.reconciled
        ) {
          client.accountStage =
            "preview";
        }
      } else {
        client =
          await Client.create({
            fullName:
              String(fullName).trim(),
            email:
              normalizedEmail,
            phone:
              String(phone).trim(),
            password,
            program:
              "not_sure",
            cycleWeeks: 8,
            portalActive: true,
            accountStage:
              "preview",
            registeredFromPortal:
              true,
            reconciled: false,
          });
      }

      if (!client.referralCode) {
        client.referralCode =
          "FL" +
          client._id
            .toString()
            .slice(-6)
            .toUpperCase();
      }

      if (referralCode) {
        const cleanCode = String(referralCode).trim().toUpperCase();
        const referrer = await Client.findOne({
          referralCode: cleanCode,
          isArchived: false,
        }).select("_id fullName referralCode").lean();

        if (referrer && String(referrer._id) !== String(client._id)) {
          client.referredBy = referrer.referralCode || cleanCode;
        }
      }

      client.portalLastLogin =
        new Date();

      await client.save();

      const access =
        await syncClientPortalAccess(
          client
        );

      await ensurePortalSignupFollowUp(client);

      const token =
        generateClientToken(
          client._id
        );

      sendClientTokenCookie(
        res,
        token
      );

      res.status(201).json({
        success: true,
        token,
        client:
          toSafeClient(
            client,
            access
          ),
      });
    } catch (error) {
      next(error);
    }
  };

export const activatePortal =
  async (req, res, next) => {
    try {
      const {
        email,
        phone,
        password,
      } = req.body;

      if (
        !email ||
        !phone ||
        !password
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Email, phone, and a new password are required.",
          });
      }

      if (
        password.length < 8
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Password must be at least 8 characters.",
          });
      }

      const client =
        await Client.findOne({
          email:
            email
              .toLowerCase()
              .trim(),
          isArchived: false,
        });

      if (!client) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "No existing KhairoDietClinic client record was found with that email.",
          });
      }

      if (
        client.phone.replace(
          /\D/g,
          ""
        ) !==
        phone.replace(/\D/g, "")
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Phone number doesn't match our records.",
          });
      }

      if (
        client.portalActive
      ) {
        return res
          .status(409)
          .json({
            success: false,
            message:
              "This account is already activated. Please sign in instead.",
          });
      }

      client.password =
        password;

      client.portalActive =
        true;

      client.portalLastLogin =
        new Date();

      await client.save();

      const access =
        await syncClientPortalAccess(
          client
        );

      await ensurePortalSignupFollowUp(client);

      const token =
        generateClientToken(
          client._id
        );

      sendClientTokenCookie(
        res,
        token
      );

      res.status(201).json({
        success: true,
        token,
        client:
          toSafeClient(
            client,
            access
          ),
      });
    } catch (error) {
      next(error);
    }
  };

export const clientLogin =
  async (req, res, next) => {
    try {
      const {
        email,
        password,
      } = req.body;

      if (
        !email ||
        !password
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Email and password are required.",
          });
      }

      const client =
        await Client.findOne({
          email:
            email
              .toLowerCase()
              .trim(),
          isArchived: false,
        }).select("+password");

      if (!client) {
        return res
          .status(401)
          .json({
            success: false,
            message:
              "No account found with that email.",
            code:
              "NO_ACCOUNT",
          });
      }

      if (
        !client.portalActive
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Your account hasn't been activated yet.",
            code:
              "NOT_ACTIVATED",
          });
      }

      const passwordValid =
        client.comparePassword
          ? await client.comparePassword(
              password
            )
          : false;

      if (!passwordValid) {
        return res
          .status(401)
          .json({
            success: false,
            message:
              "Incorrect password.",
            code:
              "WRONG_PASSWORD",
          });
      }

      client.portalLastLogin =
        new Date();

      await client.save({
        validateBeforeSave:
          false,
      });

      const access =
        await syncClientPortalAccess(
          client
        );

      const token =
        generateClientToken(
          client._id
        );

      sendClientTokenCookie(
        res,
        token
      );

      res.status(200).json({
        success: true,
        token,
        client:
          toSafeClient(
            client,
            access
          ),
      });
    } catch (error) {
      next(error);
    }
  };

export const clientLogout = (
  req,
  res
) => {
  res.clearCookie(
    "clientToken"
  );

  res.status(200).json({
    success: true,
    message:
      "Logged out.",
  });
};

export const getClientMe =
  async (req, res, next) => {
    try {
      const access =
        await syncClientPortalAccess(
          req.client
        );

      res.status(200).json({
        success: true,
        client:
          toSafeClient(
            req.client,
            access
          ),
      });
    } catch (error) {
      next(error);
    }
  };

export const forgotPassword =
  async (req, res, next) => {
    try {
      const {
        email,
        phone,
        newPassword,
      } = req.body;

      if (
        !email ||
        !phone ||
        !newPassword
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Email, phone, and new password are required.",
          });
      }

      if (
        newPassword.length < 8
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Password must be at least 8 characters.",
          });
      }

      const client =
        await Client.findOne({
          email:
            email
              .toLowerCase()
              .trim(),
          isArchived: false,
        });

      if (!client) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "No account found with that email.",
          });
      }

      if (
        client.phone.replace(
          /\D/g,
          ""
        ) !==
        phone.replace(/\D/g, "")
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Phone number doesn't match our records.",
          });
      }

      client.password =
        newPassword;

      await client.save();

      res.status(200).json({
        success: true,
        message:
          "Password updated. You can now sign in.",
      });
    } catch (error) {
      next(error);
    }
  };
