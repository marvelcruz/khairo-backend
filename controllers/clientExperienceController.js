import mongoose from "mongoose";
import ClientExperience from "../models/ClientExperience.js";
import ClientMessage from "../models/ClientMessage.js";
import Client from "../models/Client.js";
import Payment from "../models/Payment.js";
import Session from "../models/Session.js";

import { clientScopeForUser } from "../utils/careTeamAccess.js";
async function experienceFor(clientId) {
  let record =
    await ClientExperience.findOne({
      client: clientId,
    });

  if (!record) {
    record =
      await ClientExperience.create({
        client: clientId,
      });
  }

  return record;
}

function score(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 1 ||
    number > 5
  ) {
    return undefined;
  }

  return number;
}

function numberOrUndefined(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : undefined;
}

export const getMeasurements = async (
  req,
  res,
  next
) => {
  try {
    const record =
      await experienceFor(
        req.client._id
      );

    const measurements = [
      ...record.measurements,
    ].sort(
      (a, b) =>
        +new Date(b.date) -
        +new Date(a.date)
    );

    res.status(200).json({
      success: true,
      measurements,
    });
  } catch (error) {
    next(error);
  }
};

export const addMeasurement = async (
  req,
  res,
  next
) => {
  try {
    const record =
      await experienceFor(
        req.client._id
      );

    const measurement = {
      date:
        req.body.date
          ? new Date(
              req.body.date
            )
          : new Date(),

      waistCm:
        numberOrUndefined(
          req.body.waistCm
        ),

      hipsCm:
        numberOrUndefined(
          req.body.hipsCm
        ),

      chestCm:
        numberOrUndefined(
          req.body.chestCm
        ),

      thighCm:
        numberOrUndefined(
          req.body.thighCm
        ),

      energy:
        score(
          req.body.energy
        ),

      sleep:
        score(
          req.body.sleep
        ),

      mobility:
        score(
          req.body.mobility
        ),

      confidence:
        score(
          req.body.confidence
        ),

      notes: String(
        req.body.notes || ""
      )
        .trim()
        .slice(0, 1000),
    };

    record.measurements.push(
      measurement
    );

    if (
      record.measurements.length >
      100
    ) {
      record.measurements =
        record.measurements.slice(
          -100
        );
    }

    await record.save();

    res.status(201).json({
      success: true,
      measurement:
        record.measurements[
          record.measurements.length -
            1
        ],
    });
  } catch (error) {
    next(error);
  }
};

export const getMessages = async (
  req,
  res,
  next
) => {
  try {
    const messages =
      await ClientMessage.find({
        client: req.client._id,
      })
        .sort({ createdAt: 1 })
        .limit(200);

    await ClientMessage.updateMany(
      {
        client: req.client._id,
        senderType: "staff",
        readByClient: false,
      },
      {
        $set: {
          readByClient: true,
        },
      }
    );

    res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    next(error);
  }
};

export const sendClientMessage =
  async (req, res, next) => {
    try {
      const body = String(
        req.body.body || ""
      ).trim();

      if (!body) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Please enter a message.",
          });
      }

      const allowed =
        new Set([
          "general",
          "plan",
          "appointment",
          "billing",
          "technical",
          "help",
        ]);

      const category =
        allowed.has(
          req.body.category
        )
          ? req.body.category
          : "general";

      const message =
        await ClientMessage.create({
          client:
            req.client._id,
          senderType:
            "client",
          senderName:
            req.client.fullName,
          category,
          body:
            body.slice(0, 3000),
          readByClient: true,
          readByStaff: false,
        });

      res.status(201).json({
        success: true,
        message,
      });
    } catch (error) {
      next(error);
    }
  };

export const getPayments = async (
  req,
  res,
  next
) => {
  try {
    const payments =
      await Payment.find({
        client: req.client._id,
      })
        .select(
          "receiptNumber purpose amount currency status channel paidAt createdAt"
        )
        .sort({
          createdAt: -1,
        })
        .limit(50)
        .lean();

    res.status(200).json({
      success: true,
      payments,
    });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (
  req,
  res,
  next
) => {
  try {
    const record =
      await experienceFor(
        req.client._id
      );

    res.status(200).json({
      success: true,

      profile: {
        fullName:
          req.client.fullName,
        email:
          req.client.email,
        phone:
          req.client.phone,
        program:
          req.client.program,
        startDate:
          req.client.startDate,
        cycleWeeks:
          req.client.cycleWeeks,
        status:
          req.client.status,
        referralCode:
          req.client.referralCode || "",
        referredBy:
          req.client.referredBy || "",
      },

      preferences:
        record.preferences,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile =
  async (req, res, next) => {
    try {
      const client =
        await Client.findById(
          req.client._id
        );

      if (!client) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Client not found.",
          });
      }

      if (
        req.body.fullName !==
        undefined
      ) {
        const name = String(
          req.body.fullName
        ).trim();

        if (!name) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Name cannot be blank.",
            });
        }

        client.fullName =
          name.slice(0, 160);
      }

      if (
        req.body.phone !==
        undefined
      ) {
        const phone = String(
          req.body.phone
        ).trim();

        if (!phone) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Phone number cannot be blank.",
            });
        }

        client.phone =
          phone.slice(0, 50);
      }

      await client.save();

      const record =
        await experienceFor(
          client._id
        );

      const prefs =
        req.body.preferences ||
        {};

      const keys = [
        "emailReminders",
        "smsReminders",
        "portalReminders",
        "weeklyCheckInReminder",
        "progressPhotoReminder",
        "appointmentReminder",
      ];

      for (const key of keys) {
        if (
          typeof prefs[key] ===
          "boolean"
        ) {
          record.preferences[key] =
            prefs[key];
        }
      }

      await record.save();

      res.status(200).json({
        success: true,

        profile: {
          fullName:
            client.fullName,
          email:
            client.email,
          phone:
            client.phone,
          program:
            client.program,
          startDate:
            client.startDate,
          cycleWeeks:
            client.cycleWeeks,
          status:
            client.status,
          referralCode:
            client.referralCode || "",
          referredBy:
            client.referredBy || "",
        },

        preferences:
          record.preferences,
      });
    } catch (error) {
      next(error);
    }
  };

export const getSharedItems =
  async (req, res, next) => {
    try {
      const record =
        await experienceFor(
          req.client._id
        );

      const payments =
        await Payment.find({
          client: req.client._id,
          status: "success",
        })
          .select(
            "receiptNumber amount currency purpose paidAt createdAt"
          )
          .sort({
            createdAt: -1,
          })
          .lean();

      res.status(200).json({
        success: true,

        programSummary: {
          program:
            req.client.program,
          startDate:
            req.client.startDate,
          cycleWeeks:
            req.client.cycleWeeks,
          status:
            req.client.status,
        },

        items:
          record.sharedItems,

        receipts:
          payments,
      });
    } catch (error) {
      next(error);
    }
  };

export const getNotifications =
  async (req, res, next) => {
    try {
      const notifications = [];

      const checkIns =
        req.client.checkIns || [];

      const latestCheckIn =
        [...checkIns]
          .sort(
            (a, b) =>
              +new Date(b.date) -
              +new Date(a.date)
          )[0];

      const weekMs =
        7 * 24 * 60 * 60 * 1000;

      if (
        !latestCheckIn ||
        Date.now() -
          new Date(
            latestCheckIn.date
          ).getTime() >=
          weekMs
      ) {
        notifications.push({
          key:
            "weekly-checkin",
          type: "action",
          title:
            "Weekly check-in due",
          body:
            "Share your official weekly progress update.",
          href:
            "/portal/log#weekly-checkin",
        });
      }

      try {
        const collection =
          mongoose.connection.db.collection(
            "clientProgressPhotos.files"
          );

        const latestPhoto =
          await collection.findOne(
            {
              "metadata.clientId":
                String(
                  req.client._id
                ),
            },
            {
              sort: {
                uploadDate: -1,
              },
            }
          );

        const photoMs =
          14 *
          24 *
          60 *
          60 *
          1000;

        if (
          !latestPhoto ||
          Date.now() -
            new Date(
              latestPhoto.uploadDate
            ).getTime() >=
            photoMs
        ) {
          notifications.push({
            key:
              "progress-photo",
            type: "action",
            title:
              "Progress photo due",
            body:
              "It is time for your bi-weekly progress photo.",
            href:
              "/portal/log#progress-photos",
          });
        }
      } catch {
      }

      const nextSession =
        await Session.findOne({
          client: req.client._id,
          startsAt: {
            $gte: new Date(),
          },
          status: {
            $nin: [
              "cancelled",
              "declined",
              "completed",
            ],
          },
        })
          .sort({
            startsAt: 1,
          })
          .select(
            "startsAt status sessionType"
          )
          .lean();

      if (nextSession) {
        notifications.push({
          key:
            "next-appointment",
          type: "info",
          title:
            "Next appointment",
          body:
            new Date(
              nextSession.startsAt
            ).toLocaleString(),
          href:
            "/portal/book",
        });
      }

      const unread =
        await ClientMessage.countDocuments(
          {
            client:
              req.client._id,
            senderType:
              "staff",
            readByClient:
              false,
          }
        );

      if (unread > 0) {
        notifications.push({
          key:
            "new-messages",
          type: "info",
          title:
            `${unread} new message${
              unread === 1
                ? ""
                : "s"
            }`,
          body:
            "Your Khairo Diet Clinic team has replied.",
          href:
            "/portal/messages",
        });
      }

      res.status(200).json({
        success: true,
        notifications,
      });
    } catch (error) {
      next(error);
    }
  };

export const staffListMessages =
  async (req, res, next) => {
    try {
      const scope = clientScopeForUser(
        req.user,
        { allowStaff: true, allowSales: false }
      );

      let messageFilter = {};

      if (Object.keys(scope).length > 0) {
        const allowedClients = await Client.find(scope)
          .select("_id")
          .lean();

        messageFilter = {
          client: {
            $in: allowedClients.map((client) => client._id),
          },
        };
      }

      const messages =
        await ClientMessage.find(messageFilter)
          .populate(
            "client",
            "fullName email phone"
          )
          .sort({
            createdAt: -1,
          })
          .limit(500);

      res.status(200).json({
        success: true,
        messages,
      });
    } catch (error) {
      next(error);
    }
  };

export const staffReply =
  async (req, res, next) => {
    try {
      const body = String(
        req.body.body || ""
      ).trim();

      if (!body) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Reply cannot be blank.",
          });
      }

      const client =
        await Client.findById(
          req.params.clientId
        );

      if (!client) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Client not found.",
          });
      }

      const message =
        await ClientMessage.create({
          client:
            client._id,
          senderType:
            "staff",
          senderName:
            req.user?.name ||
            "Khairo Diet Clinic Team",
          category:
            req.body.category ||
            "general",
          body:
            body.slice(0, 3000),
          readByClient: false,
          readByStaff: true,
        });

      res.status(201).json({
        success: true,
        message,
      });
    } catch (error) {
      next(error);
    }
  };

export const staffListSharedItems =
  async (req, res, next) => {
    try {
      const records =
        await ClientExperience.find({
          "sharedItems.0": {
            $exists: true,
          },
        })
          .populate(
            "client",
            "fullName email status isArchived"
          )
          .lean();

      const items = records
        .flatMap((record) =>
          (record.sharedItems || []).map(
            (item) => ({
              _id: item._id,
              kind: item.kind,
              title: item.title,
              url: item.url || "",
              status: item.status,
              createdAt:
                item.createdAt,
              client:
                record.client
                  ? {
                      _id:
                        record.client
                          ._id,
                      fullName:
                        record.client
                          .fullName,
                      email:
                        record.client
                          .email,
                      status:
                        record.client
                          .status,
                      isArchived:
                        Boolean(
                          record
                            .client
                            .isArchived
                        ),
                    }
                  : null,
            })
          )
        )
        .filter(
          (item) => item.client
        )
        .sort(
          (a, b) =>
            new Date(
              b.createdAt
            ).getTime() -
            new Date(
              a.createdAt
            ).getTime()
        );

      const counts = {
        total: items.length,
        documents:
          items.filter(
            (item) =>
              item.kind ===
              "document"
          ).length,
        forms:
          items.filter(
            (item) =>
              item.kind === "form"
          ).length,
        actionRequired:
          items.filter(
            (item) =>
              item.status ===
              "action_required"
          ).length,
        completed:
          items.filter(
            (item) =>
              item.status ===
              "completed"
          ).length,
      };

      res.status(200).json({
        success: true,
        count: items.length,
        counts,
        items,
      });
    } catch (error) {
      next(error);
    }
  };


export const staffAddSharedItem =
  async (req, res, next) => {
    try {
      const record =
        await experienceFor(
          req.params.clientId
        );

      const kind =
        req.body.kind ===
        "form"
          ? "form"
          : "document";

      const title = String(
        req.body.title || ""
      ).trim();

      if (!title) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Title is required.",
          });
      }

      record.sharedItems.push({
        kind,
        title,
        url: String(
          req.body.url || ""
        ).trim(),
        status:
          req.body.status ||
          "available",
      });

      await record.save();

      res.status(201).json({
        success: true,
        items:
          record.sharedItems,
      });
    } catch (error) {
      next(error);
    }
  };
