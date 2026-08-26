import mongoose from "mongoose";
import BuddyPair from "../models/BuddyPair.js";
import Client from "../models/Client.js";

const activeParticipantQuery = (ids) => ({
  status: "active",
  $or: [
    { mentee: { $in: ids } },
    { mentor: { $in: ids } },
  ],
});

export const getMyBuddy = async (req, res, next) => {
  try {
    const id = req.client._id;

    let pair = await BuddyPair.findOne({
      mentee: id,
      status: "active",
    }).populate(
      "mentor",
      "fullName phone email"
    );

    if (!pair) {
      pair = await BuddyPair.findOne({
        mentor: id,
        status: "active",
      }).populate(
        "mentee",
        "fullName phone email"
      );

      if (pair) {
        return res.json({
          success: true,
          role: "mentor",
          buddy: pair.mentee,
          pair,
        });
      }
    }

    if (!pair) {
      return res.json({
        success: true,
        buddy: null,
      });
    }

    res.json({
      success: true,
      role: "mentee",
      buddy: pair.mentor,
      pair,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllPairs = async (req, res, next) => {
  try {
    const pairs =
      await BuddyPair.find({})
        .populate(
          "mentee",
          "fullName phone email status reconciled createdAt"
        )
        .populate(
          "mentor",
          "fullName phone email status reconciled"
        )
        .sort({ pairedAt: -1 });

    res.json({
      success: true,
      pairs,
    });
  } catch (err) {
    next(err);
  }
};

export const createPair = async (req, res, next) => {
  try {
    const {
      menteeId,
      mentorId,
    } = req.body;

    if (
      !menteeId ||
      !mentorId ||
      !mongoose.isValidObjectId(menteeId) ||
      !mongoose.isValidObjectId(mentorId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Select a valid mentee and graduate mentor.",
      });
    }

    if (String(menteeId) === String(mentorId)) {
      return res.status(400).json({
        success: false,
        message:
          "A client cannot be their own buddy.",
      });
    }

    const [
      mentee,
      mentor,
    ] = await Promise.all([
      Client.findOne({
        _id: menteeId,
        isArchived: false,
        reconciled: true,
        status: "active",
      }),

      Client.findOne({
        _id: mentorId,
        isArchived: false,
        reconciled: true,
        status: "completed",
      }),
    ]);

    if (!mentee) {
      return res.status(409).json({
        success: false,
        message:
          "The mentee must be an active, reconciled Khairo Diet Clinic client.",
      });
    }

    if (!mentor) {
      return res.status(409).json({
        success: false,
        message:
          "The mentor must be a reconciled client whose program status is Completed.",
      });
    }

    const existing =
      await BuddyPair.findOne(
        activeParticipantQuery([
          mentee._id,
          mentor._id,
        ])
      );

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          "One of these clients already has an active buddy pairing.",
      });
    }

    const pair =
      await BuddyPair.create({
        mentee: mentee._id,
        mentor: mentor._id,
      });

    const populated =
      await BuddyPair.findById(
        pair._id
      )
        .populate(
          "mentee",
          "fullName phone email status"
        )
        .populate(
          "mentor",
          "fullName phone email status"
        );

    res.status(201).json({
      success: true,
      pair: populated,
    });
  } catch (err) {
    next(err);
  }
};

export const updatePair = async (req, res, next) => {
  try {
    const { pairId } = req.params;
    const { status, notes } = req.body;

    if (!mongoose.isValidObjectId(pairId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid buddy pairing.",
      });
    }

    if (
      status &&
      !["completed", "cancelled"].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "An active pairing can only be completed or cancelled.",
      });
    }

    const pair =
      await BuddyPair.findById(pairId);

    if (!pair) {
      return res.status(404).json({
        success: false,
        message: "Pair not found.",
      });
    }

    if (
      status &&
      pair.status !== "active"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Only an active buddy pairing can change status.",
      });
    }

    if (status) {
      pair.status = status;
    }

    if (notes !== undefined) {
      pair.notes =
        String(notes || "")
          .trim()
          .slice(0, 2000);
    }

    await pair.save();

    await pair.populate(
      "mentee",
      "fullName phone email status"
    );

    await pair.populate(
      "mentor",
      "fullName phone email status"
    );

    res.json({
      success: true,
      pair,
    });
  } catch (err) {
    next(err);
  }
};

export const getUnpairedClients = async (req, res, next) => {
  try {
    const [
      mentees,
      mentors,
      activePairs,
    ] = await Promise.all([
      Client.find({
        isArchived: false,
        reconciled: true,
        status: "active",
      })
        .select(
          "fullName phone email createdAt status"
        )
        .sort({ createdAt: 1 }),

      Client.find({
        isArchived: false,
        reconciled: true,
        status: "completed",
      })
        .select(
          "fullName phone email createdAt status"
        )
        .sort({ fullName: 1 }),

      BuddyPair.find({
        status: "active",
      }).select(
        "mentee mentor"
      ),
    ]);

    const pairedIds =
      new Set();

    activePairs.forEach((pair) => {
      pairedIds.add(
        String(pair.mentee)
      );

      pairedIds.add(
        String(pair.mentor)
      );
    });

    const availableMentees =
      mentees.filter(
        (client) =>
          !pairedIds.has(
            String(client._id)
          )
      );

    const availableMentors =
      mentors.filter(
        (client) =>
          !pairedIds.has(
            String(client._id)
          )
      );

    res.json({
      success: true,
      mentees: availableMentees,
      mentors: availableMentors,
      clients: availableMentees,
    });
  } catch (err) {
    next(err);
  }
};
