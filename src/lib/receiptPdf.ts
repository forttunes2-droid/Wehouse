import { jsPDF } from "jspdf";
import font from "./receiptFont";
import { displayDate, displayDateTime } from "./displayDate";
import type { PaymentReceipt } from "./supabase/receipts";
import receiptMark from "@/assets/receipt-mark.png?inline";

/** Loaded only on download. All amounts and identities come from the receipt RPC. */
export function buildReceiptPdf(r: PaymentReceipt) {
  const PAGE_WIDTH = 90;
  const MARGIN = 8;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: r.currency || "NGN" }).format(value);
  const makeDocument = (height: number) => {
    const doc = new jsPDF({ unit: "mm", format: [PAGE_WIDTH, height], orientation: "portrait", compress: true });
    doc.addFileToVFS("WeHouseReceipt.ttf", font);
    doc.addFont("WeHouseReceipt.ttf", "WeHouseReceipt", "normal");
    doc.setFont("WeHouseReceipt");
    doc.setProperties({ title: `WeHouse payment receipt ${r.reference}`, author: "WeHouse" });
    return doc;
  };
  // Measure with the same font and line breaks used to draw. The final page is
  // exactly as tall as the receipt, so ordinary receipts never split at A6.
  const draw = (doc: jsPDF) => {
    let y = 27;
    const write = (value: string, size = 10, color = "#25232B", x = MARGIN, width = CONTENT_WIDTH) => {
      doc.setFontSize(size);
      doc.setTextColor(color);
      const lines: string[] = doc.splitTextToSize(value, width);
      for (const line of lines) {
        doc.text(line, x, y);
        y += size * 0.43;
      }
    };
    const rule = () => { doc.setDrawColor("#E5E2EA"); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); y += 6; };
    const field = (label: string, value: string) => {
      write(label, 8, "#77717D");
      y += 2;
      write(value || "—", 10);
      y += 3;
    };
    doc.setFillColor("#6841C1"); doc.rect(0, 0, PAGE_WIDTH, 1.5, "F");
    doc.addImage(receiptMark, "PNG", MARGIN, 8, 13, 13);
    doc.setFontSize(16); doc.setTextColor("#5E39A8"); doc.text("WeHouse", MARGIN + 17, 15);
    doc.setFontSize(8); doc.setTextColor("#77717D"); doc.text("PAYMENT RECEIPT", MARGIN + 17, 21);
    doc.setFillColor(r.status.includes("refund") ? "#FFF3E2" : "#E8F7EF");
    doc.roundedRect(64, 9, 18, 8, 3, 3, "F");
    doc.setFontSize(7); doc.setTextColor(r.status.includes("refund") ? "#825000" : "#126341");
    doc.text(r.status.includes("refund") ? "REFUND" : "PAID", 73, 14.2, { align: "center" });
    rule();
    write("Amount paid", 9, "#77717D");
    y += 6;
    write(money(r.amount), 22);
    y += 3;
    write(displayDateTime(r.paid_at, "Africa/Lagos") + " WAT", 8, "#77717D");
    if (r.environment === "test") { y += 3; write("TEST PAYMENT · No real money was charged.", 8, "#925F0A"); }
    if (r.environment === null) { y += 3; write("Payment mode was not recorded for this transaction.", 8, "#77717D"); }
    if (r.status.includes("refund")) {
      y += 3;
      write((r.status === "refunded" ? "Refunded" : "Partially refunded") + (r.refund_processed_at ? ` · ${displayDate(r.refund_processed_at)}` : ""), 9, "#925F0A");
    }
    y += 5;
    rule();
    field("Paid to", r.merchant_name);
    field("Paid by", r.payer_name);
    field("For", [r.description, r.package_name].filter(Boolean).join(" · "));
    if (r.check_in || r.check_out) field("Stay dates", `${displayDate(r.check_in)} – ${displayDate(r.check_out)}`);
    if (r.nights) field("Stay", `${r.nights} night${r.nights === 1 ? "" : "s"}${r.guests ? ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}` : ""}`);
    if (r.stay_amount != null) field("Stay price", money(r.stay_amount));
    if (Number(r.deposit_amount) > 0) field("Refundable caution", money(Number(r.deposit_amount)));
    if (r.cancellation_snapshot) field("Booked cancellation terms", r.cancellation_snapshot.refundable && r.cancellation_snapshot.deadline
      ? `Full refund ${money(Number(r.cancellation_snapshot.refund_amount_ngn))} by ${new Date(r.cancellation_snapshot.deadline).toLocaleString('en-NG',{timeZone:r.cancellation_snapshot.timezone})} (${r.cancellation_snapshot.timezone})`
      : "Non-refundable for ordinary cancellation");
    field("Payment provider", "Paystack");
    field("Payment reference", r.reference);
    y += 1;
    rule();
    write("Payment collected through WeHouse. Keep this receipt for your records.", 8, "#77717D");
    y += 2;
    write("wehouse.com.ng", 8, "#5E39A8");
    return y + 5;
  };
  const height = Math.max(80, Math.ceil(draw(makeDocument(500))));
    const doc = makeDocument(height);
  draw(doc);
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
