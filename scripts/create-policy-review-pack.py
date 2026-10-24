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
styles.add(ParagraphStyle(name='Rule', fontSize=9, leading=13, spaceAfter=8))
styles.add(ParagraphStyle(name='SmallNote', fontSize=8, leading=11, textColor=colors.HexColor('#656071'), spaceAfter=8))
styles['Heading1'].textColor = colors.HexColor('#49349c')
styles['Heading1'].spaceBefore = 16
styles['Heading1'].spaceAfter = 12
styles['Heading1'].keepWithNext = True
styles['Heading2'].fontSize = 12
styles['Heading2'].leading = 16
styles['Heading2'].keepWithNext = True
story = []
def clean(text):
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = text.replace('**','').replace('`','').replace('—',' - ').replace('–','-').replace('→',' > ').replace('₦','[naira currency symbol]')
    return text
def p(text, style='Rule'):
    story.append(Paragraph(html.escape(clean(text)).replace('\n','<br/>'), styles[style]))
def h(text): p(text, 'Heading1')
def rule(title, text):
    story.append(KeepTogether([Paragraph(html.escape(title), styles['Heading2']), Paragraph(html.escape(text), styles['Rule'])]))

p('WEHOUSE', 'Deck')
p('Policies for legal review', 'CoverTitle')
p('Agreed product rules and questions for the lawyer', 'Deck')
p('Prepared 23 October 2026 | Nigeria-first marketplace with planned country expansion', 'Rule')
p('REVIEW COPY - NOT PUBLISHED TERMS', 'Heading2')
p('Policy instructions for legal drafting, not published terms or a legal opinion. This document does not claim every feature is available. No new commission percentage, penalty or retention period is invented.', 'SmallNote')
h('1. Agreed product and policy boundaries')
rule('Accounts, roles and access', 'One person keeps one account and may hold independently granted provider or Team workspaces. Accounts are for adults aged 18 or older. Staff membership is assigned, never obtained by self-selection. Creator has global authority; Admin and staff permissions follow explicit scope and assignment. Privileged and financial overrides require recorded authority and reasons.')
rule('Identity and private evidence', 'NIN is not required for Personal signup or ordinary customer payment. Nigerian Property Partners and Service Workers may use NIN as an identity method with approved alternatives. Identity belongs to the person; property authority, activity expertise, licences, venue permissions and payout KYC are distinct checks. Raw identity and supporting documents remain private. No identity-check fee was approved.')
rule('Property structure', 'A compound or apartment building may contain independent bookable units, including mixed Short Let and Long Let offers. Building identity, physical space, layout and rental term are separate facts. Entire-unit and private-bedroom offers disclose shared areas; overlapping whole-unit and room sales must be prevented. Studio / self-contained is one familiar option with zero separate bedrooms. Penthouse is a home style, not a separate product.')
rule('Stay and tenancy terms', 'Short Let uses nightly, date-based stays, including stays up to the owner-approved 90-day limit. It does not automatically become Long Let at 30 days. Long Let uses a separate tenancy agreement. Monthly rent is optional only where accepted by the Partner; paying an accepted term in full must remain possible. The requested multi-year monthly model is Year 1 paid before moving in, followed by eight monthly payments in months 5-12 of the preceding year for each later year, paid to the Partner as received. Where monthly payment is not accepted, the full agreed term is due before booking. The requested schedule needs legal review of tenancy, arrears, exit and allocation before being offered; it is not in-app credit.')
rule('Experiences and requested services', 'Experiences are provider-led dated activities, such as tours and cooking or creative classes, independent of accommodation. They remain inside the same provider workspace and share account identity, wallet, Inbox and support. An Experience host need not first offer an unrelated requested service. Each activity is assessed for relevant expertise, safety, venue and locally applicable evidence. Shows, parties and nightlife are excluded.')
rule('Friends, Roommates and private plans', 'Friend and Roommate are independent relationships, even between the same two people. Friend plans coordinate privately inside the existing one-to-one chat and create no booking, rent agreement or payment obligation. Friend groups are deferred. The account limit is five accepted Friends plus outgoing unanswered requests; incoming requests do not use a slot. Requests expire after 24 hours, with up to ten sent per day. Either person may block; only the blocker may undo that block. Blocking stops contact without settling protected money. Roommate cancellation sends a neutral notice, preserves readable history and disables sending; restoration has a 30-day wait.')
h('2. Money, cancellation and commercial policy')
rule('Standard cancellation deadline - latest owner confirmation', 'Full refund until 24 hours before the scheduled start applies to the agreed standard refundable Experiences, Services, Short Let and Hotel bookings. Host/provider cancellation gives a full refund. Show the exact deadline and booking timezone before payment. Existing bookings retain their accepted agreement. This decision does not set every late-cancellation deduction, no-show charge, statutory exception or dispute outcome.')
rule('Payment protection and payouts', 'A redirect, toast or open checkout is not payment proof. Payment confirmation comes from verified, idempotent server/provider records. Protection, release, refunds, reversals and withdrawals retain their own auditable records. Blocking or losing a connection does not decide who receives protected funds. Hotel and Short Let funds remain protected through a disclosed arrival-issue window after authorised check-in: default/minimum two hours, optionally extended to four hours by the offered property/rate package. Check-in and checkout alone do not instruct a payout. The Short Let caution fee is refundable, not a cancellation penalty. A Partner has 24 hours after effective checkout for an itemised evidence-backed claim; the notified guest has 48 hours to accept, counter or dispute it. Silence does not award the Partner the money; the undisputed remainder is refunded. Withdrawals use configured cooldown/count/amount limits and fresh authentication; the agreed default freshness is ten minutes, configurable by Creator.')
rule('Fees and commissions', 'Creator controls published commission policies; the owner did not approve a numeric Experience commission. A requested-service customer charge, if enabled, is separate from the agreed service price and the Worker commission. All charges, currency, policy versions and net amounts must be disclosed and snapshotted. Hotels have no WeHouse reservation fee charged to the guest. Merchant account compliance or bank-name resolution does not verify every payout recipient.')
rule('Shared booking costs', 'Long Let may be shared with an eligible Roommate or accepted Friend. Short Let and Hotel may be shared with accepted Friends. Every invited payer accepts; the payer count may not exceed guest capacity or three total. Customer wording is Share the booking cost / Pay your share. Sharing is not a future-rent instalment product.')
rule('Discounts', 'Discounts are optional. Quotes and bookings preserve base price, funding source, caps, expiry, currency and final paid amount; confirmed bookings are not repriced later. Refunds never exceed the amount actually paid. Property host discounts are 5-50%, combined host/WeHouse discounts are capped at 50%, and WeHouse funds its portion from its commission while protecting the Partner share. Long Let discounts apply to Year 1 only. Hotel discounts may target a whole hotel, room type or package; the narrowest active hotel discount applies without hotel-discount stacking. Resolve the conflicting WeHouse-funded Hotel cap before publishing it. Experience discounts were accepted in principle; exact eligibility, stacking and funding rules need a complete approved configuration.')
rule('Sponsored placement', 'Promotions attach to a specific eligible property, service or Experience. Match the customer search, exclude unavailable/suspended/unapproved offers, rotate eligible campaigns fairly, limit repeated exposure and label paid placement Sponsored. Ordinary search remains useful without payment. The accepted starting direction is a fixed promotion period with actual views, opens and bookings reported separately. No numerical price, guaranteed exposure probability or booking guarantee was agreed.')
rule('Pro and core features', 'Normal marketplace access, onboarding/review, trust, safety, support, payment records and essential fulfillment remain core features. Pro sells optional recurring business tools and never buys verification or trust. Sales require concrete value and verified billing/refund behavior. App-store purchase requirements need review for the actual digital features offered.')
h('3. Operations, privacy and publication')
rule('Property and provider evidence', 'Collect accepted evidence appropriate to the offering and jurisdiction rather than every possible document. Verify property authority, address and applicable operating/tenancy permissions. Hotels and Short Lets need the relevant guest/stay, safety, capacity and operating information. Long Let needs authority for the offered term and clear rent, deposit, charges, utilities, repairs, handover and exit terms. Exact local document alternatives require counsel and operations acceptance.')
rule('Independent review and material changes', 'The owner cannot approve their own asset or evidence. Review records identify the reviewer, decision, reason, date and any expiry. Changed offering details or requirements invalidate the old evidence context. Rejected or expired required evidence blocks the appropriate new activity without silently erasing existing bookings or financial history.')
rule('Reports, support and Team access', 'A report needs a receipt, a scoped review queue and a recorded outcome. A live booking or service problem follows the linked Support case. Access depends on role, assignment and geography, with internal notes kept private to authorized operators. Opening an Activity item does not complete its underlying task. Creator-only launch operation must still expose the necessary queues and recovery controls.')
rule('Reviews and public media', 'Reviews must come from eligible genuine transactions, including Long Let tenants and completed Experiences. Scheduled sessions alone are not proof of attendance. Private evidence is not public listing media. Public portfolios and claims need provenance, permission and a moderation/review route. Pro does not buy a rating or a review badge.')
rule('Privacy and account security', 'Provider sign-in, account confirmation, device approval and password recovery are distinct purposes. Email users must have a working fallback without Google or Apple. Pending-device/recovery codes are purpose-bound, expire after ten minutes and allow at most five guesses. Private messaging is described as end-to-end encrypted only for the contexts where that is implemented and verified. Legal bases, retention, deletion exceptions, international transfers and biometric review need explicit legal documentation.')
story.append(PageBreak())
h('4. Decisions needed before publication')
for title,text in [
 ('Cancellation precedence','The 23 October 24-hour/full-provider-cancellation decision supersedes conflicting earlier proposed defaults. It does not approve an automatic late penalty. Review non-refundable offerings, cooling-off/statutory rights, no-shows, interrupted work, disputes and refund timing.'),
 ('Email changes and recovery','A new email must be verified before replacing the active address, with appropriate proof of account control. Confirm provider-linked addresses, recovery, device approval and notification choices without forcing email users to use Google or Apple.'),
 ('Tenancy and monthly payment','Confirm tenancy formation, term/renewal, monthly eligibility, due dates, arrears/grace, early exit, eviction/possession process, deposit return, agency/service fees and multi-year calculation. Review the requested eight-payment schedule described above for each launch jurisdiction; no in-app credit scheme is approved.'),
 ('Payment legal model','Review the approved processor arrangement, fund protection/settlement responsibilities, payout-recipient KYC, chargebacks after payout, complaints, refunds, taxes and whether the actual model creates licensing obligations. The phrase payment protection does not itself establish a regulated escrow service.'),
 ('Fees, promotions and subscriptions','No Experience commission value is invented. Resolve exact fee formulas, sponsored prices/exposure disclosures, discount caps/funding conflicts, subscription renewal/cancellation/refunds, tax invoices and native-store digital purchase treatment.'),
 ('Documents, safety and liability','Approve the evidence matrix per enabled market and category, accepted alternatives, insurance/permits, expiry, appeals, host responsibilities and WeHouse managed-property responsibilities. A manual evidence review is not a guarantee of legal compliance or physical safety.'),
 ('Company and privacy publication details','Confirm the legal entity, registration/address, contacts, governing law, dispute forum, privacy roles and lawful bases, biometric safeguards/DPIA, processor contracts, transfer safeguards, retention schedule, data-rights process, child exclusion and incident notices. These details are not approved merely because a template exists.'),
]: rule(title,text)
p('Please return proposed legal wording and a clear list of changes or unanswered questions for owner approval. Confirm when WeHouse is intermediary, operator or contracting party, including WeHouse-managed buildings. Agreed changes must be reflected in the product before publication.', 'SmallNote')

def footer(canvas, doc):
    canvas.saveState();canvas.setStrokeColor(colors.HexColor('#dedbe6'));canvas.line(45,43,550,43)
    canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#656071'))
    canvas.drawString(45,29,'WEHOUSE | LEGAL REVIEW COPY | 23 OCTOBER 2026')
    canvas.drawRightString(550,29,str(doc.page));canvas.restoreState()
target=OUT/'WeHouse_Policy_Decisions_For_Legal_Review.pdf'
doc=SimpleDocTemplate(str(target),pagesize=(595.28,841.89),rightMargin=45,leftMargin=45,topMargin=43,bottomMargin=58,title='WeHouse Policy Decisions for Legal Review',author='WeHouse product decision record')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
pdf=pdfium.PdfDocument(str(target))
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
for unwanted in ['SHA-256','C-001','PR #118','migration','supabase']:
    if unwanted in all_text: raise RuntimeError('Technical appendix material found: '+unwanted)
if '\ufffd' in all_text or '\u25a0' in all_text: raise RuntimeError('Unrenderable glyph in PDF text')
print(json.dumps({'pdf':str(target),'pages':len(pdf),'bytes':target.stat().st_size,'previews':str(PREVIEW)}))
