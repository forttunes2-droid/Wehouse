// ═══════════════════════════════════════════════════════════════
// WeHouse Central Configuration — SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════

/** System account used for all support chat — NOT a real person */
export const WH_SUPPORT_USER_ID = 'wehouse_support';

/** Support email displayed throughout the app */
export const WH_SUPPORT_EMAIL = 'support@wehouse.com.ng';

/** Display name for the support account in chats */
export const WH_SUPPORT_DISPLAY_NAME = 'WeHouse Support';

/** Roles that should NEVER appear in field officer assignment dropdowns */
export const UNASSIGNABLE_ROLES = ['creator', 'admin', 'user', 'worker', 'property_partner'];

/** Roles that CAN be assigned as field officers */
export const FIELD_OFFICER_ELIGIBLE_ROLES = ['staff'];
