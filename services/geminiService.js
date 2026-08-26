const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

export async function generateGeminiText(prompt) {
  const apiKey = process.env.GEMMA_API_KEY;

  if (!apiKey) {
    throw new Error("Gemini API key is not configured.");
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini request failed.");
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
