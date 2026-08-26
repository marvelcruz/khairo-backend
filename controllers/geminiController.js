import { generateGeminiText } from "../services/geminiService.js";

export const testGemini = async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt || "Reply with exactly: Khairo Diet Clinic Gemini test OK");
    const text = await generateGeminiText(prompt);
    res.status(200).json({ success: true, text });
  } catch (error) {
    next(error);
  }
};
