import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { normalizedProfile } from "../utils/roleProfiles.js";

const userSchema = new mongoose.Schema(
  {
    workspaceKey: {
      type: String,
      trim: true,
      lowercase: true,
      default: "business",
      index: true,
    },
    name: { type: String, required: [true, "Name is required"], trim: true },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    // New Khairo Diet Clinic accounts use only staff or doctor. Legacy values remain
    // accepted temporarily so existing accounts can be migrated safely.
    roles: {
      type: [String],
      enum: ["admin", "staff", "coach", "doctor", "sales"],
      default: ["staff"],
    },
    permissions: {
      type: [String],
      default: [],
    },
    phone: { type: String, trim: true },
    googleId: { type: String, select: false, default: "" },
    appleId: { type: String, select: false, default: "" },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  obj.accessProfile = normalizedProfile(obj.roles || []);
  return obj;
};

export default mongoose.model("User", userSchema);
