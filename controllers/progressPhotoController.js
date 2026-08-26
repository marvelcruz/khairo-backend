import crypto from "crypto";
import mongoose from "mongoose";

const BUCKET =
  "clientProgressPhotos";

const TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

function bucket() {
  if (
    !mongoose.connection.db
  ) {
    throw new Error(
      "Database is not ready."
    );
  }

  return new mongoose.mongo.GridFSBucket(
    mongoose.connection.db,
    {
      bucketName: BUCKET,
    }
  );
}

function query(
  clientId,
  id
) {
  return {
    _id:
      new mongoose.Types.ObjectId(
        id
      ),
    "metadata.clientId":
      String(clientId),
  };
}

export const listProgressPhotos =
  async (req, res, next) => {
    try {
      const files =
        await bucket()
          .find({
            "metadata.clientId":
              String(
                req.client._id
              ),
          })
          .sort({
            uploadDate: -1,
          })
          .limit(30)
          .toArray();

      res.status(200).json({
        success: true,

        photos:
          files.map(
            (file) => ({
              _id:
                String(
                  file._id
                ),
              filename:
                file.filename,
              contentType:
                file.contentType ||
                "image/jpeg",
              size:
                file.length,
              uploadedAt:
                file.uploadDate,
              angle:
                file.metadata
                  ?.angle ||
                "front",
              note:
                file.metadata
                  ?.note ||
                "",
            })
          ),
      });
    } catch (error) {
      next(error);
    }
  };

export const uploadProgressPhoto =
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Choose a progress photo.",
          });
      }

      if (
        !TYPES.has(
          req.file.mimetype
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Use JPG, PNG, or WebP.",
          });
      }

      const allowed =
        new Set([
          "front",
          "side",
          "back",
          "other",
        ]);

      const angle =
        allowed.has(
          req.body.angle
        )
          ? req.body.angle
          : "front";

      const note = String(
        req.body.note || ""
      )
        .trim()
        .slice(0, 500);

      const extension =
        req.file.mimetype ===
        "image/png"
          ? "png"
          : req.file.mimetype ===
            "image/webp"
          ? "webp"
          : "jpg";

      const filename =
        `progress-${req.client._id}-` +
        `${Date.now()}-` +
        `${crypto.randomUUID()}.${extension}`;

      const stream =
        bucket().openUploadStream(
          filename,
          {
            contentType:
              req.file.mimetype,

            metadata: {
              clientId:
                String(
                  req.client._id
                ),
              angle,
              note,
            },
          }
        );

      await new Promise(
        (resolve, reject) => {
          stream.on(
            "error",
            reject
          );

          stream.on(
            "finish",
            resolve
          );

          stream.end(
            req.file.buffer
          );
        }
      );

      res.status(201).json({
        success: true,
        id:
          String(stream.id),
      });
    } catch (error) {
      next(error);
    }
  };

export const getProgressPhoto =
  async (req, res, next) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Photo not found.",
          });
      }

      const storage =
        bucket();

      const file =
        await storage
          .find(
            query(
              req.client._id,
              req.params.id
            )
          )
          .next();

      if (!file) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Photo not found.",
          });
      }

      res.setHeader(
        "Content-Type",
        file.contentType ||
          "image/jpeg"
      );

      res.setHeader(
        "Cache-Control",
        "private, max-age=300"
      );

      storage
        .openDownloadStream(
          file._id
        )
        .pipe(res);
    } catch (error) {
      next(error);
    }
  };

export const deleteProgressPhoto =
  async (req, res, next) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Photo not found.",
          });
      }

      const storage =
        bucket();

      const file =
        await storage
          .find(
            query(
              req.client._id,
              req.params.id
            )
          )
          .next();

      if (!file) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Photo not found.",
          });
      }

      await storage.delete(
        file._id
      );

      res.status(200).json({
        success: true,
      });
    } catch (error) {
      next(error);
    }
  };
