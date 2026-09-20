import { jsPDF } from "jspdf";
import font from "./receiptFont";
import { displayDate, displayDateTime } from "./displayDate";
import type { PaymentReceipt } from "./supabase/receipts";

/** Loaded only on download. All amounts and identities come from the receipt RPC. */
export function buildReceiptPdf(r: PaymentReceipt) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("WeHouseReceipt.ttf", font);
  doc.addFont("WeHouseReceipt.ttf", "WeHouseReceipt", "normal");
  doc.setFont("WeHouseReceipt");
  doc.setProperties({ title: `WeHouse payment receipt ${r.reference}`, author: "WeHouse" });
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: r.currency || "NGN" }).format(value);
  let y = 24;
  const write = (value: string, size = 10, color = "#25232B", x = 20, width = 170) => {
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines: string[] = doc.splitTextToSize(value, width);
    for (const line of lines) {
      if (y > 269) { doc.addPage(); y = 24; }
      doc.text(line, x, y);
      y += size * 0.46;
    }
  };
  const rule = () => { doc.setDrawColor("#E5E2EA"); doc.line(20, y, 190, y); y += 9; };
  write("WeHouse", 18, "#5E39A8");
  write("PAYMENT RECEIPT", 9, "#77717D");
  y += 6;
  rule();
  write("Amount paid", 10, "#77717D");
  y += 5;
  write(money(r.amount), 25);
  y += 3;
  write(displayDateTime(r.paid_at, "Africa/Lagos") + " WAT", 9, "#77717D");
  if (r.environment === "test") { y += 4; write("TEST PAYMENT · No real money was charged.", 10, "#925F0A"); }
  if (r.environment === null) { y += 4; write("Payment mode was not recorded for this transaction.", 9, "#77717D"); }
  if (r.status.includes("refund")) {
    y += 4;
    write((r.status === "refunded" ? "Refunded" : "Partially refunded") + (r.refund_processed_at ? ` · ${displayDate(r.refund_processed_at)}` : ""), 10, "#925F0A");
  }
  y += 8;
  rule();
  const field = (label: string, value: string) => {
    if (y > 250) { doc.addPage(); y = 24; }
    write(label, 9, "#77717D");
    write(value || "—", 11);
    y += 5;
  };
  field("Paid to", r.merchant_name);
  field("Paid by", r.payer_name);
  field("For", [r.description, r.package_name].filter(Boolean).join(" · "));
  if (r.check_in || r.check_out) field("Stay dates", `${displayDate(r.check_in)} – ${displayDate(r.check_out)}`);
  if (r.nights) field("Stay", `${r.nights} night${r.nights === 1 ? "" : "s"}${r.guests ? ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}` : ""}`);
  if (r.stay_amount != null) field("Stay price", money(r.stay_amount));
  if (Number(r.deposit_amount) > 0) field("Refundable caution", money(Number(r.deposit_amount)));
  field("Payment provider", "Paystack");
  field("Payment reference", r.reference);
  if (y > 240) { doc.addPage(); y = 24; }
  rule();
  write("Payment collected through WeHouse. Keep this receipt for your records.", 9, "#77717D");
  write("wehouse.com.ng", 9, "#5E39A8");
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor("#77717D");
    doc.text(`WeHouse · Payment receipt     ${page} / ${count}`, 20, 286);
  }
  return doc;
}

export function downloadReceiptPdf(receipt: PaymentReceipt) {
  const reference = receipt.reference.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "payment";
  const url = URL.createObjectURL(buildReceiptPdf(receipt).output("blob"));
  const link = document.createElement("a");
  link.href = url;
  link.download = `WeHouse-receipt-${reference}.pdf`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
