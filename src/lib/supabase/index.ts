// ─── SUPABASE MODULE EXPORTS ───────────────────────
// Modularized from the original 2160-line monolith.

// Client
export { supabase } from './client';
export type { DiagnosticsResult } from './client';
export { runDiagnostics } from './client';

// Utils
export { compressImageFile } from './utils';

// Auth
export {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resetPassword,
  getSession,
  isUsernameTaken,
  updateUsername,
  changePassword,
  logPasswordChange,
} from './auth';

// Profile
export {
  getProfile,
  getProfileByAuthId,
  getPublicAgentInfo,
  getPublicAgentByUserId,
  getProfileByEmail,
  linkProfileToAuth,
  createProfile,
  uploadAvatar,
  validateUsername,
  checkUsernameAvailable,
  removeAvatar,
  updateProfile,
  updatePrivacySettings,
} from './profile';

// Session
export {
  parseDeviceInfo,
  trackSession,
  endSession,
  getSessionHistory,
  createUserSession,
  deactivateUserSession,
  isSessionActive,
  getStoredSessionId,
  updateSessionLastSeen,
} from './session';

// Listings
export {
  getAllListings,
  getListing,
  getCreatorListings,
  getAvailableChatAgents,
  detectDuplicateImage,
  checkDuplicateListing,
  uploadListingImage,
  uploadListingVideo,
  deleteListing,
  saveListing,
  unsaveListing,
  getSavedListings,
  createListing,
  getRequiredApproverRank,
  getApproverLabel,
  canApproveListing,
  getListingsPendingApproval,
  approveListing,
  rejectListing,
  getMyPendingListings,
  updateListingStatus,
  createEnquiry,
  getEnquiriesForListing,
  getEnquiriesForUser,
  replyToEnquiry,
} from './listings';

// Reservations
export {
  createReservation,
  getReservationForListing,
  getReservationsForUser,
  cancelReservation,
  markSupportContacted,
  updateReservationPlan,
  createInspectionRequest,
  getInspectionRequestForReservation,
  getInspectionRequestsForUser,
  getPendingInspectionRequests,
  getInspectionRequestsForFieldOfficer,
  assignFieldOfficer,
  startInspection,
  completeInspection,
  cancelInspectionRequest,
} from './reservations';

// Roommate
export {
  saveRoommatePreferences,
  getRoommatePreferences,
  findMatches,
  startRoommateSearch,
  stopRoommateSearch,
  refreshRoommateSearch,
  getSavedMatchResults,
  updateMatchStatus,
  clearMatchResults,
  checkSearchExpiry,
} from './roommate';

// Workers (v2 — Categories, Verification, Wallet, Payouts)
export {
  getWorkers,
  parseWorkerStatus,
  getAllWorkers,
  getPendingWorkers,
  updateWorkerStatus,
  // Service Categories
  getServiceCategories,
  getServiceSubcategories,
  getCategoryWithSubcategories,
  createServiceCategory,
  updateServiceCategory,
  deleteServiceCategory,
  createServiceSubcategory,
  updateServiceSubcategory,
  deleteServiceSubcategory,
  seedSubcategoriesForCategory,
  // Worker Verification
  submitWorkerVerification,
  uploadWorkerVerificationVideo,
  getWorkerVerification,
  getVerificationsByStatus,
  reviewWorkerVerification,
  // Blue Badge
  getBlueBadgeSubscription,
  createBlueBadgeSubscription,
  cancelBlueBadgeSubscription,
  // Wallet
  getOrCreateWallet,
  getWallet,
  getWalletTransactions,
  creditWallet,
  updateWalletBankDetails,
  // Escrow
  createEscrowTransaction,
  getEscrowForBooking,
  releaseEscrow,
  refundEscrow,
  // Withdrawals
  requestWithdrawal,
  getWithdrawals,
  // Audit
  logFinancialEvent,
  getFinancialAuditLogs,
  // Dashboard
  getWorkerDashboardData,
  getWorkerSystemStats,
} from './workers';

// Chat
export {
  getConversations,
  getStaffConversations,
  getPartnerSupportInbox,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  deleteConversation,
  markMessagesSeen,
  createConversation,
  acceptEnquiry,
  closeConversation,
  getOrCreateConversation,
} from './chat';

// Partner Support
export {
  createPartnerSupportConversation,
  getPartnerConversations,
  getPartnerSupportMessages,
} from './partner-support';

// Announcements
export {
  checkAnnouncementTables,
  sendAnnouncement,
  getAnnouncementsForUser,
  markAnnouncementRead,
  deleteAnnouncement,
  getAnnouncementsSentBy,
  getAllAnnouncements,
  getUnreadAnnouncementCount,
  getAnnouncementStats,
  getOfficialMessagesForUser,
  markOfficialMessageRead,
  deleteOfficialMessage,
  getOfficialMessagesSentBy,
  getAllOfficialMessages,
  getUnreadOfficialCount,
  checkOfficialMessageTables,
  getMessageRecipientCount,
  getFilteredRecipientCount,
} from './announcements';

// Activity
export {
  getUserActivity,
  getUserMatches,
  getUserRoomInterests,
  getSavedListingsWithData,
  getReviews,
  createReview,
  getRoomInterests,
  createRoomInterest,
} from './activity';

// Admin
export {
  getAllUsers,
  getUserCount,
  getCreatorDashboardStats,
  type CreatorDashboardStats,
  canChangeRole,
  updateUserRole,
  getRoleChangeHistory,
  deleteUser,
  deleteOwnAccount,
  restoreUser,
  toggleMaintenanceExempt,
  getAllListingsAdmin,
  getReports,
  createReport,
  resolveReport,
  dismissReport,
  suspendUser,
  reactivateUser,
  freezeUser,
  banUser,
  getAuditLogs,
  logAuditAction,
  getSystemSettings,
  updateSystemSetting,
  submitStaffReview,
  getStaffReviews,
  getStaffRatingSummary,
} from './admin';

// Notifications
export {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
} from './notifications';

// Permissions (CTO Master Architecture)
export {
  getStaffPermissions,
  grantPermission,
  revokePermission,
  hasPermission,
  hasAnyPermission,
  getAllStaffWithPermissions,
  getStaffByPermission,
} from './permissions';

// Hotels
export {
  getHotels,
  getHotelById,
  getHotelRooms,
  getRoomById,
  getHotelReviews,
  addHotelReview,
  createHotelBooking,
  getHotelBookingsForUser,
  getHotelBookingsForHotel,
  updateBookingStatus,
  getHotelsByOwner,
  createHotel,
  updateHotel,
  deleteHotel,
  createHotelRoom,
  updateHotelRoom,
  deleteHotelRoom,
  uploadHotelImage,
  uploadRoomImage,
} from './hotels';

// Platform Settings
export {
  getPlatformSettings,
  getPlatformSetting,
  updatePlatformSetting,
  getTypedSetting,
} from './platform-settings';
