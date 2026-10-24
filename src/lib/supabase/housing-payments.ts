import { supabase } from "./client";

type PaymentInitResult = {
  success?: boolean;
  already_paid?: boolean;
  reference?: string;
  purpose?: string;
  authorization_url?: string;
  access_code?: string;
  existing?: boolean;
  error?: string;
};

async function initializePaymentReference(reference: string) {
  const { data, error } = await supabase.functions.invoke("payment-init", {
    body: { reference },
  });
  if (!error) return { result: data as PaymentInitResult | null, error: null };
  let message = error.message || "Payment checkout could not start";
  try {
    const body = await (error as any).context?.json?.();
    if (body?.error) message = String(body.error);
  } catch {
    /* The network response may not contain JSON. */
  }
  return {
    result: { success: false, error: message } as PaymentInitResult,
    error: null,
  };
}

export async function initializeApartmentRentPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc(
    "create_apartment_rent_payment",
    {
      p_reservation_id: reservationId,
    },
  );
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid)
    return { result: bootstrap as PaymentInitResult, error: null };

  const reference = String(bootstrap.reference || "");
  if (!reference)
    return {
      result: { success: false, error: "Rent payment reference is missing" },
      error: null,
    };
  return initializePaymentReference(reference);
}

export async function initializeShortStayPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc(
    "create_short_stay_payment",
    {
      p_reservation_id: reservationId,
    },
  );
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid)
    return { result: bootstrap as PaymentInitResult, error: null };
  const reference = String(bootstrap.reference || "");
  if (!reference)
    return {
      result: {
        success: false,
        error: "Short Let payment reference is missing",
      },
      error: null,
    };
  return initializePaymentReference(reference);
}

