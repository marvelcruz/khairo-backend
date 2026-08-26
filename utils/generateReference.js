export function generatePaymentReference() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FL-${Date.now()}-${rand}`;
}

export async function generateReceiptNumber(PaymentModel) {
  const year = new Date().getFullYear();
  const count = await PaymentModel.countDocuments({
    receiptNumber: { $regex: `^FL-PAY-${year}-` },
  });
  return `FL-PAY-${year}-${String(count + 1).padStart(4, "0")}`;
}
