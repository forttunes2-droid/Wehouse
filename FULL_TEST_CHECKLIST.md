# WEHOUSE NIGERIA — COMPLETE PRE-LAUNCH TEST CHECKLIST
# Test EVERY item. Check the box only when verified on live site.
# Last Updated: July 5, 2026

═══════════════════════════════════════════════════════════════════════
SECTION 1: AUTHENTICATION & SIGNUP
═══════════════════════════════════════════════════════════════════════

[ ] 1.1  Sign up as a regular user (email + password)
[ ] 1.2  Sign up as a worker (email + password, selects worker role)
[ ] 1.3  Sign up as property partner (email + password, selects property_partner role)
[ ] 1.4  Login with email + password
[ ] 1.5  Login persists after browser refresh (session storage)
[ ] 1.6  Logout clears session and redirects to login
[ ] 1.7  PWA install prompt appears on mobile
[ ] 1.8  PWA works offline (shows offline page)
[ ] 1.9  Email verification flow (if enabled)
[ ] 1.10 Phone number input works with Nigerian format (+234)

═══════════════════════════════════════════════════════════════════════
SECTION 2: USER ROLES & NAVIGATION
═══════════════════════════════════════════════════════════════════════

[ ] 2.1  Regular user sees: Home, Search, Hotels, Roommates, Workers, Profile tabs
[ ] 2.2  Worker sees: Home, Search, Hotels, Roommates, Profile tab (NOT Workers tab)
[ ] 2.3  Property Partner sees: Home, Search, Hotels, Roommates, Workers, Partner tab
[ ] 2.4  Staff sees: Staff Dashboard with their permission tabs only
[ ] 2.5  Creator sees: Creator Dashboard
[ ] 2.6  Admin sees: Admin Dashboard
[ ] 2.7  Worker CANNOT access worker_discovery page (gets redirected to home)
[ ] 2.8  Worker CANNOT access worker_categories page
[ ] 2.9  Property Partner CANNOT access worker_categories page
[ ] 2.10 All roles see correct bottom navigation on mobile

═══════════════════════════════════════════════════════════════════════
SECTION 3: HOUSING / LISTINGS (CORE FEATURE)
═══════════════════════════════════════════════════════════════════════

[ ] 3.1  Home page loads with featured listings
[ ] 3.2  Home page shows cities carousel
[ ] 3.3  Home page shows recommended listings
[ ] 3.4  Search page loads with filters
[ ] 3.5  Search by state works
[ ] 3.6  Search by city/LGA works
[ ] 3.7  Search by price range works
[ ] 3.8  Search by bedrooms/bathrooms works
[ ] 3.9  Search by property type works
[ ] 3.10 Search by amenities works
[ ] 3.11 Listing detail page loads with all photos
[ ] 3.12 Listing detail shows price, location, description
[ ] 3.13 Listing detail shows amenities list
[ ] 3.14 Listing detail shows agent/host info
[ ] 3.15 Save/bookmark listing works
[ ] 3.16 Saved listings page shows saved items
[ ] 3.17 Unsave listing works
[ ] 3.18 Share listing works
[ ] 3.19 Contact agent button works
[ ] 3.20 Request inspection from listing works
[ ] 3.21 View on map works
[ ] 3.22 Similar listings shown at bottom of detail

═══════════════════════════════════════════════════════════════════════
SECTION 4: HOTELS
═══════════════════════════════════════════════════════════════════════

[ ] 4.1  Hotels home page loads
[ ] 4.2  Hotel search by city works
[ ] 4.3  Hotel search by date range works
[ ] 4.4  Hotel detail page loads with photos
[ ] 4.5  Hotel room types displayed
[ ] 4.6  Hotel booking form works
[ ] 4.7  Hotel booking creates reservation
[ ] 4.8  Hotel booking payment (Paystack) works
[ ] 4.9  Hotel booking confirmation shows

═══════════════════════════════════════════════════════════════════════
SECTION 5: ROOMMATE MATCHING
═══════════════════════════════════════════════════════════════════════

[ ] 5.1  Roommate page loads
[ ] 5.2  Create roommate profile form works
[ ] 5.3  Lifestyle preferences section expands/collapses
[ ] 5.4  Submit button is visible and clickable (not pushed off screen)
[ ] 5.5  Roommate profile saves successfully
[ ] 5.6  Find roommate matches returns results
[ ] 5.7  Match cards display correctly
[ ] 5.8  Contact roommate match works
[ ] 5.9  Roommate filter by location works
[ ] 5.10 Roommate filter by budget works

═══════════════════════════════════════════════════════════════════════
SECTION 6: WORKER DISCOVERY & BOOKING
═══════════════════════════════════════════════════════════════════════

[ ] 6.1  Worker categories page loads
[ ] 6.2  Worker categories show all service types
[ ] 6.3  Click category filters workers correctly
[ ] 6.4  Worker discovery page shows worker cards
[ ] 6.5  Worker cards show photo, name, occupation, price, rating
[ ] 6.6  Worker search by name works
[ ] 6.7  Worker filter by city works
[ ] 6.8  Worker filter by state works
[ ] 6.9  Worker bio expands/collapses correctly
[ ] 6.10 Click "Book Worker" opens booking form
[ ] 6.11 Booking form has: description, address, date, message
[ ] 6.12 Submit booking request succeeds (NO error)
[ ] 6.13 Booking request creates negotiation chat
[ ] 6.14 Negotiation chat shows booking status badge
[ ] 6.15 Negotiation chat shows progress bar
[ ] 6.16 Customer and worker can exchange messages
[ ] 6.17 Worker clicks "Accept Booking" and enters price
[ ] 6.18 Customer sees "Pay" button with negotiated amount
[ ] 6.19 Customer pays via Paystack
[ ] 6.20 Worker clicks "Start Job"
[ ] 6.21 Worker clicks "Mark Complete"
[ ] 6.22 Customer clicks "Confirm Completion"
[ ] 6.23 Customer can raise dispute
[ ] 6.24 Booking status shows "Completed" after confirmation
[ ] 6.25 Worker wallet gets credited (minus 12.5% commission)
[ ] 6.26 Either party can cancel before payment
[ ] 6.27 Worker receives notification of new booking

═══════════════════════════════════════════════════════════════════════
SECTION 7: WORKER DASHBOARD
═══════════════════════════════════════════════════════════════════════

[ ] 7.1  Worker dashboard loads with all tabs
[ ] 7.2  Home tab shows: views, jobs count, completed count, balance
[ ] 7.3  Wallet card shows available/pending/withdrawn
[ ] 7.4  Verification tab shows status
[ ] 7.5  Verification form submits (ID, experience, category, video)
[ ] 7.6  Verification status shows pending/approved/rejected
[ ] 7.7  Bookings/Jobs tab shows all conversations
[ ] 7.8  Jobs tab filter: All, New, Negotiate, Pending Pay, Confirmed, Active, Done, Paid
[ ] 7.9  Clicking job opens negotiation chat
[ ] 7.10 Messages tab shows conversations
[ ] 7.11 Wallet tab shows balance and transactions
[ ] 7.12 Withdrawal form works (amount + bank details)
[ ] 7.13 Bank details save correctly
[ ] 7.14 Services tab shows current service category
[ ] 7.15 Earnings tab shows total earned and this month
[ ] 7.16 Reviews tab shows customer reviews
[ ] 7.17 Profile tab shows worker profile
[ ] 7.18 Settings tab allows editing profile
[ ] 7.19 Blue badge subscription works
[ ] 7.20 Worker logout works

═══════════════════════════════════════════════════════════════════════
SECTION 8: PROPERTY PARTNER SYSTEM
═══════════════════════════════════════════════════════════════════════

[ ] 8.1  Property Partner dashboard loads with all tabs
[ ] 8.2  Overview shows: Properties, Bookings, Occupancy, Earnings stats
[ ] 8.3  My Properties tab shows approved listings (view only)
[ ] 8.4  Property cards show image, price, location, type
[ ] 8.5  Bookings tab shows customer bookings for partner's properties
[ ] 8.6  Occupancy tab shows occupied/vacant per property
[ ] 8.7  Earnings tab shows revenue breakdown
[ ] 8.8  Earnings shows 10% commission calculation
[ ] 8.9  Inspections tab shows "Request Property Inspection" button
[ ] 8.10 Inspection request form works (address, city, state, notes)
[ ] 8.11 Submitting inspection creates support conversation
[ ] 8.12 Inspection history shows submitted requests
[ ] 8.13 Support tab shows support conversations
[ ] 8.14 Support conversation shows timeline with status
[ ] 8.15 Can message WeHouse support in conversation
[ ] 8.16 Settings tab works
[ ] 8.17 Partner logout works

═══════════════════════════════════════════════════════════════════════
SECTION 9: STAFF DASHBOARD
═══════════════════════════════════════════════════════════════════════

[ ] 9.1  Staff login redirects to StaffDashboard (not old standalone pages)
[ ] 9.2  Staff sees tabs based on their permission only
[ ] 9.3  Overview tab loads with quick action cards
[ ] 9.4  Stats bar shows correct counts per permission
[ ] 9.5  Operations tab: can approve/reject pending listings
[ ] 9.6  Operations tab: reject shows inline form (not browser prompt)
[ ] 9.7  Finance tab: payouts sub-tab works
[ ] 9.8  Finance tab: commission rules sub-tab works
[ ] 9.9  Support tab: tickets show with status
[ ] 9.10 Support tab: can assign ticket to self
[ ] 9.11 Support tab: resolve shows inline form (not browser prompt)
[ ] 9.12 Verification tab: shows workers pending approval
[ ] 9.13 Verification tab: can approve worker
[ ] 9.14 Verification tab: can reject worker
[ ] 9.15 Verification tab: can suspend verified worker
[ ] 9.16 Verification tab: filter tabs work (pending/verified/suspended/all)
[ ] 9.17 Field Officer tab: loads assigned inspections
[ ] 9.18 Field Officer tab: NO error about missing function
[ ] 9.19 Field Officer tab: can start inspection
[ ] 9.20 Field Officer tab: can complete inspection with report
[ ] 9.21 Field Officer tab: complete shows inline form (not browser prompt)
[ ] 9.22 Field Officer tab: can post property from completed inspection
[ ] 9.23 Post property form: title, price, description, images
[ ] 9.24 Post property auto-links partner_id from inspection
[ ] 9.25 Staff logout works
[ ] 9.26 Staff chat back button goes to staff_dashboard (not home)

═══════════════════════════════════════════════════════════════════════
SECTION 10: CREATOR DASHBOARD
═══════════════════════════════════════════════════════════════════════

[ ] 10.1 Creator dashboard loads
[ ] 10.2 User count matches admin count (both should be same)
[ ] 10.3 User management tab shows all users
[ ] 10.4 Can change user roles
[ ] 10.5 Worker verification tab shows pending workers
[ ] 10.6 Worker verification: can approve/reject/suspend
[ ] 10.7 Worker profile modal shows bio, ID card, video
[ ] 10.8 Inspection management tab works
[ ] 10.9 Can assign field officer to inspection
[ ] 10.10 Analytics/stats load correctly
[ ] 10.11 Announcements can be sent to selected groups
[ ] 10.12 Service categories CRUD works
[ ] 10.13 Can create new service category
[ ] 10.14 Can edit service category
[ ] 10.15 Can delete service category
[ ] 10.16 Can create subcategory
[ ] 10.17 Can delete subcategory
[ ] 10.18 Reports/tickets tab works
[ ] 10.19 Settings tab works
[ ] 10.20 Creator logout works

═══════════════════════════════════════════════════════════════════════
SECTION 11: ADMIN DASHBOARD
═══════════════════════════════════════════════════════════════════════

[ ] 11.1 Admin dashboard loads with correct user count
[ ] 11.2 Users tab shows all users
[ ] 11.3 Can view user details
[ ] 11.4 Can change user roles
[ ] 11.5 Listings tab shows all listings
[ ] 11.6 Approval tab shows pending listings
[ ] 11.7 Can approve/reject listings
[ ] 11.8 Announcements tab works
[ ] 11.9 Admin logout works

═══════════════════════════════════════════════════════════════════════
SECTION 12: CHAT & MESSAGING
═══════════════════════════════════════════════════════════════════════

[ ] 12.1 Chat page loads conversations list
[ ] 12.2 Conversations show other person's name + last message
[ ] 12.3 Unread badge shows on conversation
[ ] 12.4 Open conversation shows message history
[ ] 12.5 Send text message works
[ ] 12.6 Send image attachment works
[ ] 12.7 Messages appear in real-time
[ ] 12.8 Mark as read when opening conversation
[ ] 12.9 Delete conversation shows custom modal (not browser confirm)
[ ] 12.10 Back button routes by role (staff→dashboard, worker→dashboard, user→home)
[ ] 12.11 Support chat (WeHouse Support) works for all roles
[ ] 12.12 Chat with property partner works
[ ] 12.13 Chat with worker works

═══════════════════════════════════════════════════════════════════════
SECTION 13: PAYMENTS (PAYSTACK)
═══════════════════════════════════════════════════════════════════════

[ ] 13.1 Paystack initialization works
[ ] 13.2 Hotel booking payment succeeds
[ ] 13.3 Worker booking payment succeeds
[ ] 13.4 Payment callback updates booking status
[ ] 13.5 Failed payment shows error message
[ ] 13.6 Wallet balance updates after payment
[ ] 13.7 Commission deduction (12.5%) calculated correctly
[ ] 13.8 Worker receives correct amount after commission
[ ] 13.9 Escrow holds payment until job completion
[ ] 13.10 Refund process works for disputed bookings

═══════════════════════════════════════════════════════════════════════
SECTION 14: NOTIFICATIONS
═══════════════════════════════════════════════════════════════════════

[ ] 14.1 Push notification permission requested
[ ] 14.2 New booking notification sent to worker
[ ] 14.3 Booking accepted notification sent to customer
[ ] 14.4 Payment received notification sent to worker
[ ] 14.5 Job completed notification sent to customer
[ ] 14.6 New inspection assignment notification to field officer
[ ] 14.7 New message notification
[ ] 14.8 Announcement notification to selected groups
[ ] 14.9 Notification badge count shows on app icon

═══════════════════════════════════════════════════════════════════════
SECTION 15: SETTINGS & PROFILE
═══════════════════════════════════════════════════════════════════════

[ ] 15.1 Profile page loads with user info
[ ] 15.2 Edit profile: change full name
[ ] 15.3 Edit profile: change phone number
[ ] 15.4 Edit profile: change city/state
[ ] 15.5 Edit profile: upload avatar photo
[ ] 15.6 Account center page loads
[ ] 15.7 Privacy settings page loads
[ ] 15.8 Security settings page loads
[ ] 15.9 Settings tab: all options work
[ ] 15.10 Dark mode toggle works
[ ] 15.11 Notification preferences save

═══════════════════════════════════════════════════════════════════════
SECTION 16: PWA & TECHNICAL
═══════════════════════════════════════════════════════════════════════

[ ] 16.1 Site loads on mobile browser
[ ] 16.2 Site loads on desktop browser
[ ] 16.3 Add to Home Screen works on Android
[ ] 16.4 Add to Home Screen works on iOS
[ ] 16.5 App icon shows correctly
[ ] 16.6 Splash screen shows correctly
[ ] 16.7 Service worker registers
[ ] 16.8 Offline page shows when no internet
[ ] 16.9 Auto-update on new deployment works
[ ] 16.10 Images load correctly (no broken images)
[ ] 16.11 No console errors on page load
[ ] 16.12 Page transitions are smooth
[ ] 16.13 Loading spinners show during data fetch
[ ] 16.14 Empty states show when no data
[ ] 16.15 Scroll to top works
[ ] 16.16 URL routing works correctly

═══════════════════════════════════════════════════════════════════════
SECTION 17: SECURITY
═══════════════════════════════════════════════════════════════════════

[ ] 17.1 RLS policies block unauthorized data access
[ ] 17.2 Staff can only see their permission tabs
[ ] 17.3 Creator can do everything except override other creators
[ ] 17.4 Worker cannot access admin/creator pages
[ ] 17.5 Regular user cannot access staff pages
[ ] 17.6 SQL injection attempts blocked
[ ] 17.7 XSS attempts in chat messages are sanitized
[ ] 17.8 File uploads restricted to images/videos only
[ ] 17.9 Sensitive data not exposed in frontend code
[ ] 17.10 wehouse_support account cannot be assigned staff permissions

═══════════════════════════════════════════════════════════════════════
HOW TO USE THIS CHECKLIST
═══════════════════════════════════════════════════════════════════════

1. Test each item on the LIVE site (wehouse.com.ng)
2. Mark [ ] as [x] ONLY when verified working
3. If an item fails, note the exact error message
4. Test on BOTH mobile and desktop where applicable
5. Test with REAL data, not just empty states
6. Have at least 2 different people test independently

═══════════════════════════════════════════════════════════════════════
KNOWN ISSUES TO VERIFY ARE FIXED
═══════════════════════════════════════════════════════════════════════

[ ] FIXED: Creator sees 10 users, Admin sees 11 (should both show 11)
[ ] FIXED: Booking worker shows "function not found" error
[ ] FIXED: Field officer sees "get_my_inspections not found" error
[ ] FIXED: Worker sees "Find Worker" option (should be hidden)
[ ] FIXED: Worker status shows wrong value (bio emoji vs DB column)
[ ] FIXED: Staff chat back button dumps to home page
[ ] FIXED: Browser prompt() on reject/resolve/complete (should be inline form)
[ ] FIXED: Delete conversation shows ugly browser confirm
[ ] FIXED: Roommate search button pushed off screen
[ ] FIXED: Worker profile update blocked by RLS
