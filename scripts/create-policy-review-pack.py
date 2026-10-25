"""Build a factual legal-review pack from the existing decision register."""
from pathlib import Path
import sys, re, html, json
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tmp/pdf-runtime'))
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
import pypdfium2 as pdfium
from PIL import Image, ImageOps, ImageDraw

OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW = ROOT / 'tmp/pdfs/policy-review'
PREVIEW.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='CoverTitle', fontName='Helvetica-Bold', fontSize=29, leading=34, textColor=colors.HexColor('#242038'), spaceAfter=20))
styles.add(ParagraphStyle(name='Deck', fontSize=12, leading=18, textColor=colors.HexColor('#59536c'), spaceAfter=14))
styles.add(ParagraphStyle(name='Rule', fontSize=10.5, leading=15, spaceAfter=9))
styles.add(ParagraphStyle(name='SmallNote', fontSize=8, leading=11, textColor=colors.HexColor('#656071'), spaceAfter=8))
styles['Heading1'].textColor = colors.HexColor('#49349c')
styles['Heading1'].spaceBefore = 16
styles['Heading1'].spaceAfter = 12
styles['Heading1'].keepWithNext = True
styles['Heading2'].fontSize = 12
styles['Heading2'].leading = 16
styles['Heading2'].keepWithNext = True
story = []
rules = {}
def clean(text):
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = text.replace('**','').replace('`','').replace('—',' - ').replace('–','-').replace('→',' > ').replace('₦','[naira currency symbol]')
    return text
def p(text, style='Rule'):
    story.append(Paragraph(html.escape(clean(text)).replace('\n','<br/>'), styles[style]))
def h(text): p(text, 'Heading1')
def rule(title, text):
    rules[title] = text
    story.append(KeepTogether([Paragraph(html.escape(title), styles['Heading2']), Paragraph(html.escape(text), styles['Rule'])]))

# The delivered document is ONLY confirmed policy. Open legal questions and
# implementation history are excluded from this publication data.
rules.update({
 'Account and staff access': 'WeHouse accounts are for adults aged 18 or older. One person keeps one Personal identity and may separately hold Property Partner, Service Worker or authorized Team access. Staff membership is granted by authorized operators, never by self-selection. Creator has global authority. Admin and staff access follows assigned geography, capabilities and records. Sensitive financial and privileged decisions record the actor, reason and outcome.',
 'Identity verification': 'NIN is not required for Personal signup, browsing, Friends or ordinary customer payment. Provider approval is required before public supply or accepting work; recipient KYC is required before payout activation. Nigerian Property Partners and Service Workers may use NIN with approved identity alternatives. Identity belongs to the person and can be reused across eligible workspaces. Property authority, business credentials, professional licences and bank ownership are separate checks. No identity-check fee is charged.',
 'Sign-in and recovery': 'Email users can confirm their account, recover access and approve a new device without Google or Apple. Provider sign-in, email confirmation, device approval and password recovery are separate purposes. Device/recovery proofs expire after 10 minutes and allow at most five guesses. Password recovery revokes existing sessions before success. A password-account email change requires proof of control and verification of the new address; the old address remains until confirmation. Google/Apple account addresses follow their linked provider.',
 'Privacy and data choices': 'Identity documents, verification evidence, bank details, precise access instructions and internal notes remain private. Access is limited to entitled participants and authorized reviewers. Users have a clear route to request access/export, correction, account closure and deletion of their data. Explain any financial, dispute or legally required records retained and why. Optional marketing and followed-search alerts can be controlled by the user. Public listing media must not expose private verification documents.',
 'Property structure': 'A compound or apartment building may contain independent Short Let units, Long Let units or a mixture. Similar units can share descriptions and default prices while retaining separate availability, tenants, agreements and payments. A physical unit offered under more than one rental arrangement still has one occupancy record. Entire-home and private-bedroom offers must not sell overlapping space twice. Studio / self-contained has zero separate bedrooms; penthouse is a home style within the same structure.',
 'Listing information': 'Disclose the exact bookable unit or obtain explicit allocation agreement before binding checkout. State entire-unit or private-bedroom scope, shared areas, beds, bathrooms, maximum occupancy, amenities, accessibility limitations and accurate photos/video. Show the rental basis, charged currency, compulsory fees/taxes, deposit/caution, house rules, check-in/out and cancellation terms. Public map information and entitled private entrance/access details are separate.',
 'Property authority and documents': 'The responsible person provides an approved identity method and evidence of authority: accepted ownership evidence or a current signed letting/management authorization. A tenant-host needs applicable permission to sublet. A business provides applicable registration and representative authority. A utility bill supports address matching, not ownership. Hotels provide authorized operator details and locally applicable accommodation/tourism, fire, health, planning or other operating evidence. Short Lets disclose permitted short-stay use and relevant building restrictions. Collect appropriate accepted evidence, not every possible alternative.',
 'Review and management responsibility': 'The owner cannot approve their own property or evidence. Record the independent decision, reason, reviewer and relevant expiry. Material changes require renewed review. Missing, rejected or expired required evidence prevents the relevant new publication/acceptance without deleting existing commitments or financial records. Host manages and WeHouse manages are distinct responsibilities. Show the responsible operator; property layout or a Team invitation does not grant commercial or financial authority.',
 'Short Let and Hotel stays': 'Short Let is booked by dates and nightly price, including longer stays up to 90 days. A 30-day Short Let does not automatically become Long Let. Hotel dates, local check-in/out times, sellable room types and physical room assignment are separate. A room cannot have two current occupants. Checkout moves it to cleaning before it can be marked ready.',
 'Long Let payment rule': 'Offer only tenancy lengths accepted by the landlord, including supported shorter and multi-year terms. One-year rent is always paid in full before handover. Accepted three- or six-month terms are also paid in full. Monthly payment is never offered for a one-year tenancy. Without landlord opt-in, collect the full multi-year contract upfront.',
 'Later-year monthly rent': 'Only a landlord-approved multi-year agreement may use monthly payments for later years. Year 1 is still paid in full before handover. Each later year is funded by eight payments during months 5-12 of the preceding year, starting four months after actual handover. Pay the Partner each confirmed payment through the approved processor arrangement; do not hold the entire future-year balance. The accepted term, rent, amounts and dates stay together in the tenancy agreement.',
 'Rent example': 'At annual rent of NGN 1,200,000 with no discount: a two-year agreement is NGN 2,400,000 upfront if later-year monthly payment is not accepted. With landlord approval, pay NGN 1,200,000 upfront and then eight payments of NGN 150,000 towards Year 2, starting four months after handover.',
 'Manual or automatic collection': 'For eligible later-year payments, manual payment and optional automatic debit follow the same agreed amounts and dates. Automatic debit requires separate customer consent and a verified active provider authorization, with pause/cancel and failed-payment controls. It does not turn a one-year stay into monthly rent or guarantee collection.',
 'Viewing and handover': 'Request a viewing arranges an in-person visit. Watch walkthrough opens recorded media. Property verification is a separate operational review. Payment alone is not handover. Confirm required payment, agreed arrival and authorized handover before activating occupancy. Long Let agreements record the term, condition/inventory, charges/deposit, utilities, maintenance, renewal, notice and exit responsibilities.',
 'Fees and receipts': 'Show the charged currency, price, discounts and compulsory charges before payment. Hotels have no WeHouse reservation fee charged to the guest. Property reservation fees apply only to the property flows that specify them. Creator controls published commission policies, including Experiences; use the applicable accepted rate rather than inventing a default. For requested services, any enabled customer service charge is separate from the agreed service price and the commission deducted from the provider share. Save the accepted policy and amounts; later changes apply to new agreements.',
 'Payment protection and release': 'Payment is established by verified provider/server confirmation, not a redirect or message. Keep auditable records for charges, protected funds, release, refunds, reversals and withdrawals, with duplicate protection. Blocking, disputes, connection loss and uncertain receipts do not automatically award money. Hotel and Short Let have a disclosed arrival-issue window after authorized check-in: a two-hour default/minimum, optionally extended to four hours by the offered property/rate. Check-in and checkout alone do not instruct payout.',
 'Cancellation policy': 'The standard refundable Hotel, Short Let, Service and Experience booking gives a full refund when cancelled at least 24 hours before the scheduled start. Show the exact deadline and booking/property timezone before payment. Host/provider cancellation gives a full refund. Partners select approved WeHouse policy options rather than writing arbitrary cancellation rules. Existing bookings keep their accepted policy. Late or non-refundable cases follow the accepted terms and WeHouse review. Long Let exit follows its separate tenancy agreement.',
 'Refunds and Short Let caution': 'Show the exact refund and reasons for deductions before cancellation confirmation. A pending refund becomes completed only on provider confirmation; failed or uncertain refunds remain recoverable through Help. Refunds never exceed what was paid. Short Let caution is refundable, not a cancellation penalty. A Partner has 24 hours after effective checkout for an itemized evidence-backed claim; the notified guest has 48 hours to accept, counter or dispute. Silence never awards the Partner the money; refund the undisputed remainder.',
 'Shared booking costs and withdrawals': 'Long Let can be shared with an eligible Roommate or accepted Friend. Short Let and Hotel can be shared with accepted Friends. Each invited payer accepts; payer count cannot exceed guest capacity or three total. Track each confirmed share separately. Sharing a booking cost is not a future-rent instalment product. Withdrawals require eligible recipient checks, configured cooldown/count/amount limits and fresh sign-in; the agreed default freshness is 10 minutes, controlled by Creator. A confirmed charge and a settled Partner payout are different facts.',
 'Services and Experiences': 'Experiences are provider-led dated activities such as tours, walks, cooking/creative classes and suitable campus activities. They are independent of accommodation and use the existing provider workspace, identity, wallet, Inbox and Help. Existing Service Workers can apply; a new host does not need to offer an unrelated service first. Shows, parties and nightlife are excluded. A private Friend plan is not a paid Experience.',
 'Service and activity terms': 'Requested services use an explicitly accepted scope, deliverables/exclusions, time, location and quote. A public starting price is not an accepted quote. Each Experience states duration, meeting point, dates/timezone, capacity, total price/currency, inclusions/exclusions, participation restrictions and relevant accessibility/safety information. Review applicable expertise, venue permission, credentials, permits or insurance by category and market. Identity approval alone does not prove professional competence. Pro business packages do not automatically become public checkout offers.',
 'Completion and reviews': 'A real booking connects confirmed capacity, payment, fulfillment, cancellation/refund and Help. Reviews come from eligible genuine transactions, including Long Let tenancies and completed Experiences. A prepared session or scheduled date does not prove attendance. Public work samples need appropriate permission and provenance; a WeHouse-job claim requires customer confirmation. Pro cannot buy verification, trust, a rating or a review badge.',
 'Friend and Roommate relationships': 'The same two people may be Friends and Roommates, with independent permissions and conversations. The limit is five accepted Friends plus outgoing unanswered requests combined; incoming requests do not use a slot. Requests expire after 24 hours, with at most 10 sent daily. Either Friend can block; only the blocker can undo their block. Blocking stops contact without resolving protected money. Unblock does not revive a cancelled booking. Roommate cancellation sends a neutral notice, preserves readable history and disables sending; restoration follows a 30-day wait.',
 'Plans, sharing and notifications': 'Suggest a plan / Plan together coordinates privately inside the existing one-to-one Friend chat. It creates no booking, tenancy or payment obligation. Friend groups are deferred. Sharing a property, Hotel, Service profile or eligible Experience is a recommendation, not booking authority; the recipient uses the normal booking/request flow. Activity reflects real domain events and opens the relevant task. Reading it does not complete that task. Messages keep their own unread state. Followed searches use saved matching criteria and controlled alerts.',
 'Reports, support and moderation': 'Reports about content/safety receive a durable reference, authorized review and recorded outcome/status. Active stay, service and money issues use linked Help cases. Cases are routed by responsibility, assignment and geography rather than being visible to everyone with a dashboard. Internal notes remain private to authorized operators. The Creator can access the necessary global operational queues. Portfolios remain relevant work, not a social feed; false, unsafe, privacy-violating or rights-infringing content is subject to reasoned moderation and a review route.',
 'Core features and Pro': 'Normal marketplace access, onboarding/review, trust, safety, Help, payment records and essential fulfillment stay core features. Pro sells optional recurring business tools. It does not buy staff authority, verification or guaranteed ranking. Show the actual plan benefits, price/currency, billing period, renewal and cancellation terms before purchase. Entitlement requires verified billing, with purchase, expiry, cancellation, refund/revocation and restore handled consistently under the accepted terms.',
 'Optional discounts': 'Discounts are optional and preserve base price, funding source, expiry and final charged amount. Property host discounts are 5-50%; combined host/WeHouse discounts are capped at 50%. WeHouse funds its part from commission while preserving the Partner agreed share. Long Let discounts apply to Year 1 only. Hotel discounts can target the whole hotel, a room type or a package; the narrowest active Hotel discount applies without Hotel-discount stacking. Experiences may offer optional discounts. Confirmed bookings keep their accepted price; refunds follow what was paid.',
 'Sponsored placement': 'Sponsored campaigns attach to a specific eligible property, Service or Experience. Match the customer location, dates, budget and service needs first; exclude unavailable, suspended or unapproved offers. Rotate eligible campaigns fairly within the matching pool and limit repeated exposure. Label placement Sponsored. Ordinary search stays useful without payment. A campaign for one listing does not automatically promote every unit in a building.',
 'Promotion purchase and reporting': 'Sell a disclosed promotion period, showing the actual price, dates and target offering before purchase. Report real views, opens and bookings separately. Paid placement does not guarantee a booking or imply verification/safety. Similar units must not crowd a Sponsored section with duplicate cards.',
 'Markets and money': 'Nigeria is the starting market. Country, currency, timezone and appropriate location divisions belong to the market and booking. Display money in the currency actually charged; a viewer setting must not convert the recorded obligation silently. Enable a new payment market only when its currency, processor, settlement/refund handling and applicable local requirements are supported.'
})
story = []
groups = [
 ('Accounts and privacy', ['Account and staff access', 'Identity verification', 'Sign-in and recovery', 'Privacy and data choices']),
 ('Properties and responsibility', ['Property structure', 'Listing information', 'Property authority and documents', 'Review and management responsibility']),
 ('Stays and rent', ['Short Let and Hotel stays', 'Long Let payment rule', 'Later-year monthly rent', 'Rent example', 'Manual or automatic collection', 'Viewing and handover']),
 ('Payments and cancellation', ['Fees and receipts', 'Payment protection and release', 'Cancellation policy', 'Refunds and Short Let caution', 'Shared booking costs and withdrawals']),
 ('Services and Experiences', ['Services and Experiences', 'Service and activity terms', 'Completion and reviews']),
 ('Friends, safety and support', ['Friend and Roommate relationships', 'Plans, sharing and notifications', 'Reports, support and moderation']),
 ('Pro, discounts and Sponsored', ['Core features and Pro', 'Optional discounts', 'Sponsored placement', 'Promotion purchase and reporting', 'Markets and money']),
]
for index, (title, keys) in enumerate(groups):
    if index: story.append(PageBreak())
    p(f'WEHOUSE / AGREED POLICIES / {index+1:02d}', 'SmallNote')
    p(title, 'CoverTitle')
    if index == 0:
        p('25 October 2026', 'Heading2')
        p('Record of the product policies agreed with the owner. Prepared for legal review before publication.', 'SmallNote')
    for key in keys:
        rule(key, rules[key])

def footer(canvas, doc):
    canvas.saveState();canvas.setStrokeColor(colors.HexColor('#dedbe6'));canvas.line(45,43,550,43)
    canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#656071'))
    canvas.drawString(45,29,'WEHOUSE | AGREED PRODUCT POLICIES | 25 OCTOBER 2026')
    canvas.drawRightString(550,29,str(doc.page));canvas.restoreState()
target=OUT/'WeHouse_Policy_Decisions_For_Legal_Review.pdf'
doc=SimpleDocTemplate(str(target),pagesize=(595.28,841.89),rightMargin=45,leftMargin=45,topMargin=43,bottomMargin=58,title='WeHouse Policy Decisions for Legal Review',author='WeHouse product decision record')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
pdf=pdfium.PdfDocument(str(target))
if len(pdf) != len(groups): raise RuntimeError('Policy section overflow created an extra page')
manifest=[]
for n,page in enumerate(pdf):
    text=page.get_textpage().get_text_range()
    if not text.strip(): raise RuntimeError(f'Empty page {n+1}')
    page.render(scale=1.15).to_pil().save(PREVIEW/f'page-{n+1:02d}.png')
    manifest.append({'page':n+1,'characters':len(text)})
(PREVIEW/'manifest.json').write_text(json.dumps(manifest,indent=2))
sheet = Image.new('RGB', (750, ((len(pdf)+2)//3)*370), '#e8e7eb')
draw = ImageDraw.Draw(sheet)
for n in range(len(pdf)):
    thumb = Image.open(PREVIEW/f'page-{n+1:02d}.png').convert('RGB')
    thumb.thumbnail((235,335))
    x,y=(n%3)*250+7,(n//3)*370+22
    sheet.paste(thumb,(x,y));draw.text((x,y-16),f'Page {n+1}',fill='#242038')
sheet.save(PREVIEW/'contact-sheet.png')
all_text = '\n'.join(page.get_textpage().get_text_range() for page in pdf)
for unwanted in ['SHA-256','C-001','PR #118','migration','supabase','Decisions before publication','needs final approval','questions for the lawyer']:
    if unwanted in all_text: raise RuntimeError('Technical appendix material found: '+unwanted)
if '\ufffd' in all_text or '\u25a0' in all_text: raise RuntimeError('Unrenderable glyph in PDF text')
print(json.dumps({'pdf':str(target),'pages':len(pdf),'bytes':target.stat().st_size,'previews':str(PREVIEW)}))
