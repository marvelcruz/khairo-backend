import Supplement from "../models/Supplement.js";
import SupplementAdjustment from "../models/SupplementAdjustment.js";
import Stocktake from "../models/Stocktake.js";
import ClientSupplement from "../models/ClientSupplement.js";
import Client from "../models/Client.js";
import { logAudit } from "../utils/auditLogger.js";
import { sendEmail } from "../utils/mailer.js";

const adminEmail = () => process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;

const notifyLowStock = async (supplement, oldStock) => {
  if (supplement.stock > supplement.reorderThreshold || oldStock <= supplement.reorderThreshold) return;
  const to = adminEmail();
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: `LOW STOCK: ${supplement.name} — ${supplement.stock} ${supplement.unit} left`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;padding:24px;color:#f5f5f5;"><div style="max-width:480px;margin:0 auto;background:#171717;border:1px solid #78350f;border-radius:8px;padding:24px;"><p style="font-size:16px;font-weight:700;color:#fbbf24;margin:0 0 12px;"> Low stock alert</p><p style="margin:0 0 8px;"><strong>${supplement.name}</strong> is down to <strong>${supplement.stock} ${supplement.unit}</strong> (reorder at ${supplement.reorderThreshold}).</p><p style="margin:0;color:#a3a3a3;font-size:13px;">Restock before your next inventory check.</p></div></div>`,
      text: `LOW STOCK: ${supplement.name} — ${supplement.stock} ${supplement.unit} left (reorder at ${supplement.reorderThreshold}).`,
    });
  } catch (e) { console.error("low stock email failed", e); }
};

export const getSupplements = async (req, res, next) => {
  try { res.json({ success: true, supplements: await Supplement.find({ isActive: true }).sort({ name: 1 }) }); } catch (err) { next(err); }
};

export const listAvailable = async (req, res, next) => {
  try { res.json({ success: true, supplements: await Supplement.find({ isActive: true, stock: { $gt: 0 } }).select("name price unit stock") }); } catch (err) { next(err); }
};

export const createSupplement = async (req, res, next) => {
  try {
    const { name, description, price, costPerUnit, stock, reorderThreshold, unit } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: "Name and price required" });
    const supplement = await Supplement.create({ name, description, price, costPerUnit: costPerUnit || 0, stock: stock || 0, reorderThreshold: reorderThreshold || 10, unit: unit || "units" });
    await logAudit(req, "Created supplement", "Supplement", supplement._id, `${name} - ${stock} ${unit}`);
    res.status(201).json({ success: true, supplement });
  } catch (err) { next(err); }
};

export const updateSupplement = async (req, res, next) => {
  try {
    const supplement = await Supplement.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!supplement) return res.status(404).json({ success: false, message: "Supplement not found" });
    await logAudit(req, "Updated supplement", "Supplement", supplement._id, supplement.name);
    res.json({ success: true, supplement });
  } catch (err) { next(err); }
};

export const deleteSupplement = async (req, res, next) => {
  try {
    const supplement = await Supplement.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!supplement) return res.status(404).json({ success: false, message: "Supplement not found" });
    await logAudit(req, "Deleted supplement", "Supplement", supplement._id, supplement.name);
    res.json({ success: true, supplement });
  } catch (err) { next(err); }
};

export const adjustStock = async (req, res, next) => {
  try {
    const { type, quantity, reason, category, clientId, orderId } = req.body;
    if (!type || !quantity) return res.status(400).json({ success: false, message: "Type and quantity required" });
    const supplement = await Supplement.findById(req.params.id);
    if (!supplement) return res.status(404).json({ success: false, message: "Supplement not found" });
    const cat = category || (type === "add" ? "restock" : "correction");
    if (["sent_to_client", "sold"].includes(cat) && !clientId) return res.status(400).json({ success: false, message: "Select which client this was sent to." });
    const oldStock = supplement.stock;
    if (type === "add") supplement.stock += Number(quantity);
    else if (type === "remove") supplement.stock = Math.max(0, supplement.stock - Number(quantity));
    else supplement.stock = Math.max(0, Number(quantity));
    await supplement.save();
    await SupplementAdjustment.create({ supplement: supplement._id, type, quantity: Number(quantity), reason, category: cat, client: clientId || null, order: orderId || null, adjustedBy: req.user._id });
    const clientName = clientId ? ((await Client.findById(clientId).select("fullName")) || {}).fullName : null;
    await logAudit(req, `Adjusted supplement stock (${type})`, "Supplement", supplement._id, `${supplement.name}: ${oldStock} → ${supplement.stock} · ${cat.replace("_", " ")}${clientName ? " → " + clientName : ""}${reason ? " · " + reason : ""}`);
    await notifyLowStock(supplement, oldStock);
    res.json({ success: true, supplement });
  } catch (err) { next(err); }
};

export const getAdjustments = async (req, res, next) => {
  try {
    const adjustments = await SupplementAdjustment.find({ supplement: req.params.id }).populate("adjustedBy", "name").populate("client", "fullName").sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, adjustments });
  } catch (err) { next(err); }
};

export const stocktake = async (req, res, next) => {
  try {
    const { items, notes } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: "No items submitted" });
    const results = [];
    for (const it of items) {
      const s = await Supplement.findById(it.supplementId);
      if (!s) continue;
      const expected = s.stock;
      const counted = Math.max(0, Number(it.counted) || 0);
      const discrepancy = counted - expected;
      if (discrepancy !== 0) {
        const old = s.stock;
        s.stock = counted;
        await s.save();
        await SupplementAdjustment.create({ supplement: s._id, type: "set", quantity: counted, reason: `Stocktake ${discrepancy > 0 ? "surplus" : "shortage"}`, category: "correction", adjustedBy: req.user._id });
        await notifyLowStock(s, old);
      }
      results.push({ supplement: s._id, name: s.name, expected, counted, discrepancy });
    }
    const st = await Stocktake.create({ performedBy: req.user._id, items: results, notes: notes || "" });
    await logAudit(req, "Completed inventory check", "Stocktake", st._id, `${results.length} items counted, ${results.filter((r) => r.discrepancy !== 0).length} discrepancies`);
    res.json({ success: true, stocktake: st });
  } catch (err) { next(err); }
};

export const getStocktakes = async (req, res, next) => {
  try { res.json({ success: true, stocktakes: await Stocktake.find().populate("performedBy", "name").sort({ createdAt: -1 }).limit(20) }); } catch (err) { next(err); }
};

const assignSupplement = async (client, supplementId, quantity, user, viaPortal) => {
  if (!client?.reconciled || client?.isArchived) {
    throw Object.assign(
      new Error(
        "Supplements are available only after enrollment reconciliation is complete."
      ),
      { status: 409 }
    );
  }

  const supplement = await Supplement.findById(supplementId);
  if (!supplement) throw Object.assign(new Error("Supplement not found"), { status: 404 });
  const qty = Math.max(1, Number(quantity) || 1);
  if (supplement.stock < qty) throw Object.assign(new Error(`Not enough stock: only ${supplement.stock} ${supplement.unit} left.`), { status: 400 });
  const oldStock = supplement.stock;
  supplement.stock -= qty;
  await supplement.save();
  const rec = await ClientSupplement.create({ client: client._id, supplement: supplement._id, quantity: qty, addedBy: user ? user._id : null, viaPortal });
  await SupplementAdjustment.create({ supplement: supplement._id, type: "remove", quantity: qty, category: "sent_to_client", client: client._id, reason: viaPortal ? "Added via client portal" : "Assigned by staff", adjustedBy: user ? user._id : client._id });
  await notifyLowStock(supplement, oldStock);
  return rec;
};

export const assignToClient = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.clientId);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    const rec = await assignSupplement(client, req.body.supplementId, req.body.quantity, req.user, false);
    await logAudit(req, "Assigned supplement to client", "Client", client._id, client.fullName);
    res.status(201).json({ success: true, record: rec });
  } catch (err) { next(err); }
};

export const getClientSupplements = async (req, res, next) => {
  try { res.json({ success: true, records: await ClientSupplement.find({ client: req.params.clientId }).populate("supplement").sort({ createdAt: -1 }) }); } catch (err) { next(err); }
};

export const removeClientSupplement = async (req, res, next) => {
  try {
    const rec = await ClientSupplement.findById(req.params.itemId);
    if (!rec) return res.status(404).json({ success: false, message: "Not found" });
    const supplement = await Supplement.findById(rec.supplement);
    if (supplement) {
      supplement.stock += rec.quantity;
      await supplement.save();
      await SupplementAdjustment.create({ supplement: supplement._id, type: "add", quantity: rec.quantity, category: "restock", reason: "Returned from client subscription", adjustedBy: req.user ? req.user._id : rec.client });
    }
    await rec.deleteOne();
    res.json({ success: true });
  } catch (err) { next(err); }
};

export const mySupplements = async (req, res, next) => {
  try { res.json({ success: true, records: await ClientSupplement.find({ client: req.client._id }).populate("supplement").sort({ createdAt: -1 }) }); } catch (err) { next(err); }
};

export const addMySupplement = async (req, res, next) => {
  try { res.status(201).json({ success: true, record: await assignSupplement(req.client, req.body.supplementId, req.body.quantity, null, true) }); } catch (err) { next(err); }
};

export const removeMySupplement = async (req, res, next) => {
  try {
    const rec = await ClientSupplement.findOne({ _id: req.params.itemId, client: req.client._id });
    if (!rec) return res.status(404).json({ success: false, message: "Not found" });
    const supplement = await Supplement.findById(rec.supplement);
    if (supplement) {
      supplement.stock += rec.quantity;
      await supplement.save();
      await SupplementAdjustment.create({ supplement: supplement._id, type: "add", quantity: rec.quantity, category: "restock", reason: "Client removed from subscription", adjustedBy: rec.client });
    }
    await rec.deleteOne();
    res.json({ success: true });
  } catch (err) { next(err); }
};
