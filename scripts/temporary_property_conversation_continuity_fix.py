from pathlib import Path

# 1. Make the client helper respect the canonical property/reservation identities.
path=Path('src/lib/supabase/support.ts')
source=path.read_text()
old='''export async function createSupportConversation(\n  input: SupportOpenContext = {},\n) {\n  const canonicalContextType = ["reservation", "apartment_payment"].includes(\n    input.contextType || "",\n  )\n    ? "apartment_reservation"\n    : input.contextType;\n  if (\n    ["apartment_reservation", "hotel_booking"].includes(\n      canonicalContextType || "",\n    )\n  ) {\n    const { data, error } = await supabase.rpc(\n      "open_my_reservation_conversation",\n      {\n        p_context_type: canonicalContextType,\n        p_context_id: input.contextId,\n      },\n    );\n    return { conversationId: data as string | null, error };\n  }\n  const snapshot = sanitizeSupportSnapshot(input.contextSnapshot);\n  const { data, error } = await supabase.rpc("create_my_support_case", {'''
new='''export async function createSupportConversation(\n  input: SupportOpenContext = {},\n) {\n  const snapshot = sanitizeSupportSnapshot(input.contextSnapshot);\n  const rawContextType = input.contextType || "general";\n  const canonicalContextType = ["reservation", "apartment_payment"].includes(\n    rawContextType,\n  )\n    ? "apartment_reservation"\n    : rawContextType === "listing"\n      ? "property_listing"\n      : rawContextType;\n\n  // Inspection help belongs to the reservation journey when there is one.\n  // The inspection remains its own operational record; this prevents a second\n  // customer-facing WeHouse thread from being invented for the same stay.\n  if (\n    canonicalContextType === "property_inspection" &&\n    typeof snapshot.reservation_id === "string" &&\n    snapshot.reservation_id\n  ) {\n    const { data, error } = await supabase.rpc(\n      "open_my_reservation_conversation",\n      {\n        p_context_type: "apartment_reservation",\n        p_context_id: snapshot.reservation_id,\n      },\n    );\n    return { conversationId: data as string | null, error };\n  }\n\n  if (\n    ["apartment_reservation", "hotel_booking"].includes(\n      canonicalContextType || "",\n    )\n  ) {\n    const { data, error } = await supabase.rpc(\n      "open_my_reservation_conversation",\n      {\n        p_context_type: canonicalContextType,\n        p_context_id: input.contextId,\n      },\n    );\n    return { conversationId: data as string | null, error };\n  }\n\n  if (canonicalContextType === "property_listing") {\n    const { data, error } = await supabase.rpc(\n      "open_property_operations_conversation",\n      {\n        p_subject_type: "apartment",\n        p_subject_id: input.contextId,\n        p_snapshot: snapshot,\n      },\n    );\n    return { conversationId: data as string | null, error };\n  }\n\n  if (["hotel_property", "hotel_operations"].includes(canonicalContextType)) {\n    const { data, error } = await supabase.rpc(\n      "open_property_operations_conversation",\n      {\n        p_subject_type: "hotel",\n        p_subject_id: input.contextId,\n        p_snapshot: snapshot,\n      },\n    );\n    return { conversationId: data as string | null, error };\n  }\n\n  const { data, error } = await supabase.rpc("create_my_support_case", {'''
if old not in source: raise SystemExit('createSupportConversation block not found')
source=source.replace(old,new,1)
# Remove the mistaken dedicated generic hotel-help presentation so no UI can normalize a booking into another product.
start=source.find('  if (contextType === "hotel_booking_help")')
if start!=-1:
    end=source.find('  return {\n    kind: "support",',start)
    if end==-1: raise SystemExit('hotel booking help presentation end not found')
    source=source[:start]+source[end:]
path.write_text(source)

# 2. Make the atomic first-Send authority preserve the same canonical conversation.
path=Path('supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql')
source=path.read_text()
source=source.replace("  if v_context in('reservation','apartment_payment') then\n    v_context:='apartment_reservation';\n  end if;", "  if v_context in('reservation','apartment_payment') then\n    v_context:='apartment_reservation';\n  elsif v_context='listing' then\n    v_context:='property_listing';\n  end if;")
old='''  if v_context in('apartment_reservation','hotel_booking') then\n    select c.id into v_conversation_id\n    from public.partner_support_conversations c\n    where c.partner_id=v_actor.user_id\n      and (case when c.context_type in('reservation','apartment_payment')\n        then 'apartment_reservation' else c.context_type end)=v_context\n      and coalesce(c.context_id,'')=coalesce(p_context_id,'')\n    order by c.created_at\n    limit 1;\n\n    if v_conversation_id is null then\n      v_conversation_id:=public.open_my_reservation_conversation(v_context,p_context_id);\n    end if;\n  else\n    select c.id into v_conversation_id'''
new='''  if v_context='property_inspection'\n     and nullif(btrim(coalesce(v_snapshot->>'reservation_id','')),'') is not null then\n    v_conversation_id:=public.open_my_reservation_conversation(\n      'apartment_reservation',v_snapshot->>'reservation_id'\n    );\n  elsif v_context in('apartment_reservation','hotel_booking') then\n    select c.id into v_conversation_id\n    from public.partner_support_conversations c\n    where c.partner_id=v_actor.user_id\n      and (case when c.context_type in('reservation','apartment_payment')\n        then 'apartment_reservation' else c.context_type end)=v_context\n      and coalesce(c.context_id,'')=coalesce(p_context_id,'')\n    order by c.created_at\n    limit 1;\n\n    if v_conversation_id is null then\n      v_conversation_id:=public.open_my_reservation_conversation(v_context,p_context_id);\n    end if;\n  elsif v_context='property_listing' then\n    v_conversation_id:=public.open_property_operations_conversation(\n      'apartment',p_context_id,v_snapshot\n    );\n  elsif v_context in('hotel_property','hotel_operations') then\n    v_conversation_id:=public.open_property_operations_conversation(\n      'hotel',p_context_id,v_snapshot\n    );\n  else\n    select c.id into v_conversation_id'''
if old not in source: raise SystemExit('atomic routing branch not found')
source=source.replace(old,new,1)
path.write_text(source)

# 3. Hotel booking Message WeHouse returns to the canonical hotel-booking identity.
path=Path('src/pages/MyReservations.tsx')
source=path.read_text()
source=source.replace('category: "hotel_booking_help",','category: "hotel_booking",',1)
source=source.replace('subject: `Hotel booking help · ${','subject: `Hotel · ${',1)
source=source.replace('contextType: "hotel_booking_help",','contextType: "hotel_booking",',1)
source=source.replace('source_type: "hotel_booking_help",','source_type: "hotel_booking",',1)
path.write_text(source)

# 4. Restore the missing pre-booking Hotel -> WeHouse entry point.
path=Path('src/pages/HotelDetailExperience.tsx')
source=path.read_text()
marker='''  function proceed() {\n    if (!selectedRoom) return toast.error("Choose a room type first");'''
insert='''  function messageWeHouse() {\n    if (!hotel) return;\n    window.dispatchEvent(\n      new CustomEvent("openSupportChat", {\n        detail: {\n          category: "hotel_enquiry",\n          subject: `Question about · ${hotel.name}`,\n          contextType: "hotel_property",\n          contextId: String(hotelId),\n          contextSnapshot: {\n            source_type: "hotel_property",\n            source_id: String(hotelId),\n            hotel_id: hotelId,\n            hotel_name: hotel.name,\n            location: [hotel.area, hotel.city, hotel.state].filter(Boolean).join(", "),\n          },\n        },\n      }),\n    );\n  }\n\n  function proceed() {\n    if (!selectedRoom) return toast.error("Choose a room type first");'''
if marker not in source: raise SystemExit('hotel proceed marker not found')
source=source.replace(marker,insert,1)
old='''      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[.08] bg-[#090B12]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">\n        <div className="mx-auto max-w-5xl">\n          <button\n            onClick={proceed}\n            disabled={!selectedRoom}\n            className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40"\n          >\n            Continue to guest details\n          </button>\n        </div>\n      </div>'''
new='''      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[.08] bg-[#090B12]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">\n        <div className="mx-auto grid max-w-5xl grid-cols-[auto_minmax(0,1fr)] gap-2">\n          <button\n            type="button"\n            onClick={messageWeHouse}\n            className="h-12 rounded-2xl border border-violet-400/20 bg-violet-500/[.07] px-4 text-[10px] font-semibold text-violet-200"\n          >\n            Message WeHouse\n          </button>\n          <button\n            onClick={proceed}\n            disabled={!selectedRoom}\n            className="h-12 min-w-0 rounded-2xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40"\n          >\n            Continue to guest details\n          </button>\n        </div>\n      </div>'''
if old not in source: raise SystemExit('hotel sticky action block not found')
source=source.replace(old,new,1)
path.write_text(source)

# 5. Permanent regression coverage.
Path('tests/property-conversation-continuity.test.mjs').write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("Apartment and Hotel Message WeHouse preserve one property-to-booking conversation",async()=>{
  const [support,migration,hotel,reservations,apartment]=await Promise.all([
    read("src/lib/supabase/support.ts"),
    read("supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql"),
    read("src/pages/HotelDetailExperience.tsx"),
    read("src/pages/MyReservations.tsx"),
    read("src/pages/ListingDetailCore.tsx"),
  ]);
  assert.match(apartment,/Message WeHouse here\. Your conversation stays connected to[\s\S]*this apartment/);
  assert.match(hotel,/contextType: "hotel_property"/);
  assert.match(hotel,/Message WeHouse/);
  assert.match(reservations,/contextType: "hotel_booking"/);
  assert.doesNotMatch(reservations,/hotel_booking_help/);
  assert.match(support,/open_property_operations_conversation/);
  assert.match(support,/p_subject_type: "apartment"/);
  assert.match(support,/p_subject_type: "hotel"/);
  assert.match(migration,/v_context='property_listing'[\s\S]*open_property_operations_conversation\([\s\S]*'apartment'/);
  assert.match(migration,/v_context in\('hotel_property','hotel_operations'\)[\s\S]*open_property_operations_conversation\([\s\S]*'hotel'/);
  assert.match(migration,/v_context in\('apartment_reservation','hotel_booking'\)[\s\S]*open_my_reservation_conversation/);
});

test("Inspection help with a reservation stays on that reservation conversation",async()=>{
  const [support,migration]=await Promise.all([
    read("src/lib/supabase/support.ts"),
    read("supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql"),
  ]);
  assert.match(support,/canonicalContextType === "property_inspection"[\s\S]*snapshot\.reservation_id[\s\S]*open_my_reservation_conversation/);
  assert.match(migration,/v_context='property_inspection'[\s\S]*v_snapshot->>'reservation_id'[\s\S]*open_my_reservation_conversation/);
});
''')

print('canonical property conversation continuity patched')
