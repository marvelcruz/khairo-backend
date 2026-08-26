import express from "express";
import { getPublicPageContent } from "../controllers/websiteContentController.js";

const router = express.Router();

router.get("/content/:pageKey", getPublicPageContent);

export default router;
