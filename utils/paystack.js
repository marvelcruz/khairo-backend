import https from "https";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

function paystackRequest({ method, path, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.paystack.co",
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Failed to parse Paystack response"));
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

export const initializeTransaction = ({ email, amountKobo, reference, callback_url, metadata }) =>
  paystackRequest({
    method: "POST",
    path: "/transaction/initialize",
    body: { email, amount: amountKobo, reference, callback_url, metadata },
  });

export const verifyTransaction = (reference) =>
  paystackRequest({ method: "GET", path: `/transaction/verify/${encodeURIComponent(reference)}` });

export const chargeAuthorization = ({ email, amountKobo, authorization_code, reference }) =>
  paystackRequest({
    method: "POST",
    path: "/transaction/charge_authorization",
    body: { email, amount: amountKobo, authorization_code, reference },
  });
