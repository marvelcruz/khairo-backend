import Pricing from "../models/Pricing.js";
import CatalogueItem from "../models/CatalogueItem.js";
import {
  listCataloguePrograms,
  ensureLegacyCataloguePrograms,
} from "../services/cataloguePricingService.js";

const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "program";

export const getPublicPricing = async (req, res, next) => {
  try {
    let pricing = await Pricing.findOne();
    if (!pricing) pricing = await Pricing.create({});

    await ensureLegacyCataloguePrograms();

    const programs = await listCataloguePrograms();

    const response = {
      success: true,
      pricing: {
        ...(pricing.toObject ? pricing.toObject() : pricing),
        programs,
        sourceMode: "catalogue",
        consultationFee: pricing.consultationFee || 15000,
      },
    };

    res.status(200).json(response);
  } catch (err) { next(err); }
};

export const updatePricing = async (req, res, next) => {
  try {
    const { programs, consultationFee } = req.body;
    let pricing = await Pricing.findOne();
    if (!pricing) pricing = await Pricing.create({});

    if (consultationFee !== undefined) {
      pricing.consultationFee = Math.max(0, Number(consultationFee) || 0);
    }

    if (Array.isArray(programs)) {
      const seen = new Set();
      const clean = [];

      for (const p of programs.slice(0, 20)) {
        const name = String(p.name || p.key || "Program").trim() || "Program";
        const key = slug(p.key || name);
        if (seen.has(key)) continue;
        seen.add(key);

        const price = Math.max(0, Number(p.price) || 0);
        const weeks = Math.max(1, Number(p.weeks) || 12);
        const popular = Boolean(p.popular);

        clean.push({ key, name, price, weeks, popular });

        await CatalogueItem.findOneAndUpdate(
          {
            "legacySource.sourceType": "pricing_program",
            "legacySource.sourceKey": key,
          },
          {
            $set: {
              name,
              price,
              durationWeeks: weeks,
              isActive: true,
              isFeatured: popular,
            },
            $setOnInsert: {
              slug: `program-${key}`,
              type: "program",
              currency: "NGN",
              billing: {
                type: "one_time",
                interval: null,
                intervalCount: 1,
                cycleDays: null,
              },
              legacySource: {
                sourceType: "pricing_program",
                sourceKey: key,
                sourceId: pricing._id,
              },
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      // Keep a compatibility shadow only, no longer the source of truth.
      pricing.programs = clean;
      for (const pr of clean) pricing.set(pr.key, pr.price);
    }

    pricing.updatedAt = new Date();
    await pricing.save();

    const resultPrograms = await listCataloguePrograms();

    res.status(200).json({
      success: true,
      pricing: {
        ...(pricing.toObject ? pricing.toObject() : pricing),
        programs: resultPrograms,
        sourceMode: "catalogue",
      },
    });
  } catch (err) { next(err); }
};
