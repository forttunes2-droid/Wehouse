                    onClick={() => void handleCustomerPay()}
                    disabled={paying}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-50"
                  >
                    {paying
                      ? "Processing…"
                      : `Pay ₦${Number(booking.negotiated_amount || 0).toLocaleString()}`}
                  </button>
                )}
              {!isWorker && booking.status === "completed_pending_approval" && (
                <button
                  onClick={() => void handleCustomerConfirm()}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold"
                >
                  Confirm completion
                </button>
              )}
              {!isWorker &&
                [
                  "confirmed",
                  "in_progress",
                  "completed_pending_approval",
                ].includes(booking.status) && (
                  <button
                    onClick={() => setShowDisputeForm((v) => !v)}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[9px] font-semibold text-red-300"
                  >
                    Raise dispute
                  </button>
                )}
              {!paymentReview &&
                [
                  "booking_requested",
                  "negotiating",
                  "waiting_payment",
                ].includes(booking.status) && (
                  <button
                    onClick={() => setShowCancelForm((v) => !v)}
                    className="rounded-lg bg-[var(--wh-interactive)] px-3 py-1.5 text-[9px] text-[var(--wh-text-secondary)]"
                  >
                    Cancel
                  </button>
                )}
            </div>
            {showAcceptForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[.035] p-2">
                <label className="block text-[9px] font-semibold text-[var(--wh-text-secondary)]">
                  Your price (₦)
                  <input
                    inputMode="numeric"
                    value={acceptAmount}
                    onChange={(e) =>
                      setAcceptAmount(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="Enter the final price"
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none"
                  />
                </label>
                <BookingDateField label="Job date" value={acceptDate} onChange={setAcceptDate} context="Service schedule" />
                <button
                  disabled={!Number(acceptAmount) || !acceptDate}
                  onClick={() => void handleWorkerAccept()}
                  className="h-9 w-full rounded-lg bg-violet-500 text-[10px] font-semibold disabled:cursor-not-allowed disabled:bg-[var(--wh-interactive)] disabled:text-[var(--wh-text-muted)]"
                >
                  Confirm price &amp; accept booking
                </button>
              </div>
            )}
            {showDisputeForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-red-500/15 bg-red-500/[.035] p-2">
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  rows={2}
                  placeholder="What went wrong?"
                  className="w-full resize-none rounded-lg border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-2 text-xs outline-none"
                />
                <button
                  onClick={() => void handleCustomerDispute()}
                  className="h-9 w-full rounded-lg bg-red-500 text-[10px] font-semibold"
                >
                  Submit dispute
                </button>
              </div>
            )}
            {showCancelForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-2">
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={2}
                  placeholder="Reason for cancellation"
                  className="w-full resize-none rounded-lg border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-2 text-xs outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowCancelForm(false)}
                    className="h-9 rounded-lg bg-[var(--wh-interactive)] text-[10px]"
                  >
                    Keep booking
                  </button>
                  <button
                    onClick={() => void handleCancel()}
                    className="h-9 rounded-lg bg-red-500/10 text-[10px] font-semibold text-red-300"
                  >
                    Cancel booking
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>
      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.045),transparent_32%)] px-3 py-4 sm:px-4">
        <div className="mx-auto max-w-4xl space-y-3">
          {messages.some((message) => message.decryption_failed) ? (
            <section className="flex items-center justify-between gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[.06] p-3">
              <div>
                <p className="text-[10px] font-semibold text-violet-100">
                  Some messages are still locked
                </p>
                <p className="mt-1 text-[9px] leading-4 text-[var(--wh-text-secondary)]">
                  Re-enter your Inbox PIN to unlock this conversation on this device.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void retryLockedMessages()}
                className="min-h-10 shrink-0 rounded-xl border border-violet-400/25 px-3 text-[9px] font-semibold text-violet-200"
              >
                Enter PIN
              </button>
            </section>
          ) : null}
          {messageError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/[.06] p-4 text-center">
              <p className="text-xs font-semibold text-red-200">
                Messages could not be loaded
              </p>
              <button
                onClick={() => void loadAll()}
                className="mt-2 text-[10px] font-semibold text-violet-300"
              >
                Try again
              </button>
            </div>
          ) : null}
          {!messageError && messages.length === 0 ? (
            <div className="grid min-h-44 place-items-center text-center">
              <div>
                <p className="text-sm font-semibold">No messages yet</p>
                <p className="mt-2 text-[10px] text-[var(--wh-text-muted)]">
                  Start with the work details, schedule and price.
                </p>
              </div>
            </div>
          ) : null}
          <PrivateCallHistory
            contextType="worker_booking"
            contextId={conversationId}
          />
          {messages.map((msg, index) => {
            const mine = msg.sender_id === profile.user_id,
              reactions = Object.values(msg.reactions || {}).reduce<
                Record<string, number>
              >(
                (all, emoji) => ({ ...all, [emoji]: (all[emoji] || 0) + 1 }),
                {},
              ),
              prev = messages[index - 1],
              showDay =
                !prev ||
                new Date(prev.created_at).toDateString() !==
                  new Date(msg.created_at).toDateString();
            return (
              <div key={msg.id}>
                {showDay && <DaySeparator value={msg.created_at} />}
                <MessagePress
                  onOpen={(anchor) => {
                    setMessageMenuAnchor(anchor);
                    setMessageMenuMode("actions");
                    setMessageMenu(msg);
                  }}
                  onTap={(anchor) => {
                    setMessageMenuAnchor(anchor);
                    setMessageMenuMode("reactions");
                    setMessageMenu(msg);
                  }}
                  onReply={() => setReplyingTo(msg)}
                  className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] overflow-hidden rounded-[20px] px-3.5 py-2.5 sm:max-w-[72%] ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]"}`}
                  >
                    {!mine && (
                      <p className="mb-1 text-[9px] font-semibold text-violet-300">
                        {msg.sender_name || "Job participant"}
                      </p>
                    )}
                    {msg.reply_to_id &&
                      (() => {
                        const quoted = messageById.get(msg.reply_to_id);
                        return quoted ? (
                          <div
                            className={`mb-2 border-l-2 px-2.5 py-1.5 ${mine ? "border-violet-100/70 bg-black/10" : "border-violet-400 bg-[var(--wh-interactive)]"}`}
                          >
                            <p className="truncate text-[8px] font-semibold text-violet-200">
                              {quoted.sender_id === profile.user_id
                                ? "You"
                                : quoted.sender_name || peerName}
                            </p>
                            <p className="mt-0.5 truncate text-[9px] opacity-70">
                              {quoted.content ||
                                (quoted.attachments?.length
                                  ? "Attachment"
                                  : "Message")}
                            </p>
                          </div>
                        ) : null;
                      })()}
                    <MessageMedia items={(msg.attachments || []).map((url, i) => ({url, type: msg.attachment_types?.[i], name: msg.attachment_names?.[i]}))} />
                    {msg.attachment_failed && <AttachmentState error />}
                    {msg.content && <MessageContent content={msg.content} />}
                    <p
                      className={`mt-1 text-[8px] ${mine ? "text-violet-100/70" : "text-[var(--wh-text-muted)]"}`}
                    >
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {mine && (
                        <span
                          className={
                            msg.is_read
                              ? "ml-1 font-bold text-cyan-200"
                              : "ml-1 text-violet-100/50"
                          }
                        >
                          {msg.delivery_state === "sending"
                            ? " · Sending…"
                            : msg.delivery_state === "failed"
                              ? " · Not sent"
                              : msg.is_read
                                ? " ✓✓"
                                : " ✓"}
                        </span>
                      )}
                    </p>
                    {Object.keys(reactions).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {Object.entries(reactions).map(([emoji, count]) => (
                          <span
                            key={emoji}
                            className="rounded-full bg-black/20 px-1.5 py-0.5 text-[9px]"
                          >
                            {emoji}
                            {count > 1 ? ` ${count}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </MessagePress>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </main>
      <footer className="chat-input-container shrink-0 border-t border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
        {openConversation && !contactBlocked ? (
          <div className="mx-auto max-w-4xl">
            {!secureChat ? (
              <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--wh-border-subtle)] px-4 py-3 text-[10px] text-[var(--wh-text-secondary)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                Opening conversation…
              </div>
            ) : secureChat.state !== "ready" ? (
              <SecureChatOnboarding
                status={secureChat}
                personName={peerName}
                onReady={() => void finishSecureUnlock()}
              />
            ) : (
              <>
                <PendingMessageMedia files={files} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))} />
                <VoiceRecorderPanel
                  recording={voice.recording}
                  seconds={voice.seconds}
                  level={voice.level}
                  draft={voice.draft}
                  onCancel={voice.cancel}
                  onFinish={voice.finish}
                  onDiscard={voice.discard}
                  onUse={(file) => {
                    setFiles((current) =>
                      [...current, file].slice(0, MAX_FILES),
                    );
                    voice.discard();
                  }}
                />
                {replyingTo && (
                  <div className="mb-2 flex items-center gap-3 border-l-2 border-violet-400 bg-[var(--wh-interactive)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[8px] font-semibold text-violet-300">
                        Replying to{" "}
                        {replyingTo.sender_id === profile.user_id
                          ? "yourself"
                          : replyingTo.sender_name || peerName}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--wh-text-secondary)]">
                        {replyingTo.content ||
                          (replyingTo.attachments?.length
                            ? "Attachment"
                            : "Message")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      className="grid h-8 w-8 place-items-center text-[var(--wh-text-secondary)]"
                      aria-label="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <ChatAttachmentPicker
                    onFiles={chooseFiles}
                  />
                  <button
                    onClick={() => void toggleVoice()}
                    aria-label={
                      voice.recording
                        ? "Finish voice recording"
                        : "Record voice message"
                    }
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${voice.recording ? "bg-red-500 text-white" : "border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"}`}
                  >
                    <Mic />
                  </button>
                  <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 py-1.5 focus-within:border-violet-500/40">
                    <textarea
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder="Write in this conversation…"
                      className="max-h-24 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleSend()}
                    disabled={sending || (!input.trim() && !files.length)}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-[var(--wh-interactive)] disabled:text-[var(--wh-text-muted)]"
                  >
                    {sending ? "…" : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : contactBlocked ? (
          <div className="mx-auto max-w-4xl py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold text-amber-200">
                  Messages and private calls are stopped
                </p>
                <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                  {peerBlocked
                    ? "You blocked this person. Unblock them from their profile to restore contact."
                    : "This person blocked contact. The conversation history remains available."}
                </p>
              </div>
              {jobSupportOpen && (
                <button
                  onClick={openSupport}
                  className="shrink-0 text-[9px] font-semibold text-violet-300"
                >
                  {paymentReview ? "Open review" : "Message WeHouse"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-[var(--wh-text-muted)]">
                This job conversation is closed.
              </p>
              {jobSupportOpen && (
                <button
                  onClick={openSupport}
                  className="text-[10px] font-semibold text-violet-300"
                >
                  Message WeHouse
                </button>
              )}
            </div>
            {!isWorker && booking?.status === "approved_released" && (
              <section className="mt-3 border-t border-[var(--wh-border-subtle)] pt-3">
                {review && !reviewOpen ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-amber-300">
                        {"★".repeat(Number(review.rating))}
                      </p>
                      <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                        Your verified review ·{" "}
                        {review.comment
                          ? "Written review included"
                          : "No written comment"}
                      </p>
                    </div>
                    <button
                      onClick={() => setReviewOpen(true)}
                      className="text-[9px] font-semibold text-violet-300"
                    >
                      Edit review
                    </button>
                  </div>
                ) : reviewOpen ? (
                  <div>
                    <p className="text-xs font-semibold">
                      Rate this completed job
                    </p>
                    <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                      Your rating and review appear on this professional’s
                      public profile.
                    </p>
                    <div className="mt-3 flex gap-2" aria-label="Choose rating">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`${value} star${value === 1 ? "" : "s"}`}
                          onClick={() => setReviewRating(value)}
                          className={`text-2xl ${value <= reviewRating ? "text-amber-300" : "text-[var(--wh-text-muted)]"}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewComment}
                      onChange={(event) =>
                        setReviewComment(event.target.value.slice(0, 1200))
                      }
                      placeholder="Describe the work, communication and reliability (optional)"
                      className="mt-3 min-h-20 w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-xs outline-none focus:border-violet-500/40"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={reviewSaving}
                        onClick={() => void saveReview()}
                        className="h-10 flex-1 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40"
                      >
                        {reviewSaving ? "Saving…" : "Publish verified review"}
                      </button>
                      {review && (
                        <button
                          onClick={() => setReviewOpen(false)}
                          className="h-10 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-[10px]"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setReviewOpen(true)}
                    className="h-11 w-full rounded-xl bg-amber-500/10 text-[10px] font-semibold text-amber-300"
                  >
                    Rate and review this job
                  </button>
                )}
              </section>
            )}
          </div>
        )}
      </footer>
      {(!openConversation || contactBlocked) &&
      secureChat &&
      (secureChat.state === "setup_required" ||
        secureChat.state === "unlock_required") ? (
        <SecureChatOnboarding
          status={secureChat}
          personName={peerName}
          onReady={() => void finishSecureUnlock()}
        />
      ) : null}
      {profileOpen ? (
        <ConversationIdentitySheet
          profile={peerProfile}
          booking={booking}
          isWorker={isWorker}
          name={peerName}
          avatar={peerAvatar}
          presence={presenceText || ""}
          onClose={() => setProfileOpen(false)}
          onAudioCall={() => {
            setProfileOpen(false);
            void startCall("audio");
          }}
          onVideoCall={() => {
            setProfileOpen(false);
            void startCall("video");
          }}
          blocked={peerBlocked}
          blockedByPeer={blockedByPeer}
          blockBusy={blockBusy}
          onToggleBlock={() => {
            if (peerBlocked) void togglePeerBlock();
            else setBlockPrompt(true);
          }}
          onReport={openReport}
        />
      ) : null}
      {detailsOpen && booking ? (
        <JobRequestDetailsSheet
          booking={booking}
          bookingId={bookingId}
          isWorker={isWorker}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null}
      {messageMenu && (
        <MessageActionSheet
          anchor={messageMenuAnchor}
          mode={messageMenuMode}
          currentReaction={messageMenu.reactions?.[profile.user_id] || null}
          onClose={() => setMessageMenu(null)}
          onReact={async (emoji) => {
            const current = messageMenu.reactions?.[profile.user_id];
            const result = await reactToBookingMessage(
              conversationId,
              messageMenu.id,
              current === emoji ? null : emoji,
            );
            if (result.error) return toast.error(result.error.message);
            setMessages((rows) =>
              rows.map((row) =>
                row.id === messageMenu.id
                  ? { ...row, reactions: result.reactions }
                  : row,
              ),
            );
            setMessageMenu(null);
          }}
          onReply={() => {
            setReplyingTo(messageMenu);
            setMessageMenu(null);
          }}
          onRemove={() => {
            setMessageToRemove(messageMenu);
            setMessageMenu(null);
          }}
          onCopy={messageMenu.content ? () => {
            void navigator.clipboard.writeText(messageMenu.content || "");
            toast.success("Message copied");
            setMessageMenu(null);
          } : undefined}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(messageToRemove)}
        title="Remove this message?"
        description="This removes the message only from your chat. The other person keeps their copy."
        confirmLabel="Remove for me"
        onCancel={() => setMessageToRemove(null)}
        onConfirm={() => void deleteMessageForMe()}
      />
      <ConfirmDialog
        isOpen={blockPrompt}
        title={`Stop contact with ${peerProfile?.full_name || peerName}?`}
        description="Messages and private calls will stop. Your booking, payment review and chat history will stay intact unless WeHouse flags a real safety issue."
        confirmLabel="Stop contact"
        variant="danger"
        onCancel={() => setBlockPrompt(false)}
        onConfirm={() => void togglePeerBlock()}
      />
      {showPaymentReview && !isWorker && booking?.status === "waiting_payment" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review service booking and payment"
          className="fixed inset-0 z-[100040] flex items-end justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:p-5"
        >
          <div className="my-auto w-full max-w-xl">
            <BookingPaymentReview
              eyebrow="Service booking"
              title="Review the agreed work"
              subtitle="Confirm the service, provider, schedule, location and agreed price before opening Paystack."
              rows={[
                { label: "Service", value: booking.service_type || "Service" },
                { label: "Provider", value: booking.worker_name || "Assigned provider" },
                { label: "Scheduled date", value: formatWorkerBookingDate(booking.scheduled_date) },
                { label: "Service location", value: booking.address || "Agreed in your conversation" },
                ...(booking.description ? [{ label: "Agreed work", value: booking.description }] : []),
                ...(booking.booking_code ? [{ label: "Booking reference", value: booking.booking_code }] : []),
              ]}
              amountLabel="Agreed total due now"
              amount={"₦" + Number(booking.negotiated_amount || booking.agreed_amount || 0).toLocaleString("en-NG")}
              termsTitle="Payment protection"
              terms="WeHouse keeps the payment protected while the work is active. When the provider marks the job complete, confirm the work to release payment. If it is incomplete, raise a dispute from this booking for WeHouse to review."
              note="This is the amount agreed in the booking. Go back to chat if the work, date or price needs to change. The booking is updated only after Paystack confirms payment."
              editLabel="Back to chat"
              confirmLabel="Continue to Paystack"
              busy={paying}
              confirmDisabled={Number(booking.negotiated_amount || booking.agreed_amount || 0) <= 0 || booking.payment_review_required === true}
              busyLabel="Opening Paystack…"
              onEdit={() => setShowPaymentReview(false)}
              onConfirm={() => void handleCustomerPay()}
            />
          </div>
        </div>
      ) : null}
      {confirmDelete && (
        <DeleteSheet
          onCancel={() => setConfirmDelete(false)}
          onDelete={() => void deleteFromMessages()}
        />
      )}
    </div>,
    document.body,
  );
}
function formatWorkerBookingDate(value?: string | null) {
  if (!value) return "To be confirmed";
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dayOnly ? value + "T12:00:00" : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-NG", dayOnly
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" });
}

function ChatAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-violet-300">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        (name || "W")[0].toUpperCase()
      )}
    </div>
  );
}
function ConversationIdentitySheet({
  profile,
  booking,
  isWorker,
  name,
  avatar,
  presence,
  onClose,
  onAudioCall,
  onVideoCall,
  blocked,
  blockedByPeer,
  blockBusy,
  onToggleBlock,
  onReport,
}: {
  profile: ConversationProfile | null;
  booking: Booking | null;
  isWorker: boolean;
  name: string;
  avatar?: string | null;
  presence: string;
  onClose: () => void;
  onAudioCall: () => void;
  onVideoCall: () => void;
  blocked: boolean;
  blockedByPeer: boolean;
  blockBusy: boolean;
  onToggleBlock: () => void;
  onReport: () => void;
}) {
  const [fullProfile, setFullProfile] = useState(false);
  const viewingWorker = !isWorker;
  const displayName = profile?.full_name || name;
  const avatarUrl = profile?.avatar_url || avatar || null;
  const location = [profile?.lga || profile?.local_government || profile?.city, profile?.state]
    .filter(Boolean)
    .join(", ");
  const reviewed = ["approved", "verified", "live"].includes(
    String((profile as any)?.verification_status || (profile as any)?.worker_status || "").toLowerCase(),
  );
  if (fullProfile && viewingWorker && profile?.user_id) {
    return (
      <WorkerPublicProfile
        worker={{ ...profile, local_government: profile.lga || profile.local_government } as Profile}
        onBack={() => setFullProfile(false)}
        onBook={() => undefined}
        showBookingAction={false}
          communicationActions={!blocked && !blockedByPeer ? (
          <>
            <PublicProfileAction label="Audio" onClick={onAudioCall}><Phone /></PublicProfileAction>
            <PublicProfileAction label="Video" onClick={onVideoCall}><VideoCall /></PublicProfileAction>
          </>
        ) : undefined}
        safetyAction={
          <div className="mt-5 space-y-2">
            <button type="button" className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200" onClick={onReport}>Report profile</button>
            <ProfileBlockAction blocked={blocked} busy={blockBusy} onClick={onToggleBlock} />
          </div>
        }
      />
    );
  }
  return (
    <RoommatePublicProfile
      context="conversation"
      onViewProfile={viewingWorker && profile?.user_id ? () => setFullProfile(true) : undefined}
      person={{
        name: displayName,
        username: profile?.username,
        avatar: avatarUrl,
        location,
        bio: viewingWorker
          ? profile?.worker_bio || profile?.bio
          : profile?.bio || "Customer for this service booking.",
        occupation: viewingWorker
          ? reviewed
            ? "WeHouse reviewed service worker"
            : "WeHouse service worker"
          : "WeHouse customer",
      }}
      presence={presence}
      onClose={onClose}
      actions={!blocked && !blockedByPeer ? (
        <div className="flex gap-5">
          <PublicProfileAction label="Audio" onClick={onAudioCall}><Phone /></PublicProfileAction>
          <PublicProfileAction label="Video" onClick={onVideoCall}><VideoCall /></PublicProfileAction>
        </div>
      ) : undefined}
      footer={
        <>
        {isWorker && booking ? (
          <div className="mt-5 border-t border-[var(--wh-border-subtle)] pt-4">
            <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--wh-text-muted)]">
              This booking
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <CaseFact label="Service" value={booking.service_type || "Service request"} />
              <CaseFact label="Status" value={booking.status.replaceAll("_", " ")} />
              <CaseFact
                label="Scheduled"
                value={booking.scheduled_date ? new Date(`${booking.scheduled_date}T12:00:00`).toLocaleDateString() : "Not agreed"}
              />
              <CaseFact
                label="Agreed price"
                value={Number(booking.agreed_amount || booking.negotiated_amount || 0) > 0 ? `₦${Number(booking.agreed_amount || booking.negotiated_amount).toLocaleString("en-NG")}` : "Not agreed"}
              />
            </div>
            {booking.address ? (
              <div className="mt-2 rounded-xl bg-[var(--wh-interactive)] p-3">
                <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--wh-text-muted)]">Job location</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--wh-text-secondary)]">{booking.address}</p>
              </div>
            ) : null}
            {booking.customer_message || booking.description ? (
              <div className="mt-2 rounded-xl bg-[var(--wh-interactive)] p-3">
                <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--wh-text-muted)]">Original request</p>
                <p className="mt-1 whitespace-pre-line text-[10px] leading-4 text-[var(--wh-text-secondary)]">{booking.customer_message || booking.description}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 space-y-2">
          <button type="button" className="h-12 w-full rounded-2xl border border-[var(--wh-border-subtle)] text-[11px] font-semibold text-[var(--wh-text)]" onClick={onReport}>Report profile</button>
          <ProfileBlockAction blocked={blocked} busy={blockBusy} onClick={onToggleBlock} />
        </div>
        </>
      }
    />
  );
}
function CaseFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-[var(--wh-interactive)] p-3"><p className="text-[8px] uppercase tracking-wide text-[var(--wh-text-muted)]">{label}</p><p className="mt-1 capitalize text-[10px] font-semibold text-[#CFD2DA]">{value}</p></div>;
}
function DaySeparator({ value }: { value: string }) {
  const date = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const label =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString([], {
            day: "numeric",
            month: "short",
            year:
              date.getFullYear() === today.getFullYear()
                ? undefined
                : "numeric",
          });
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="h-px flex-1 bg-[var(--wh-interactive)]" />
      <span className="text-[8px] font-semibold text-[var(--wh-text-muted)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--wh-interactive)]" />
    </div>
  );
}
function DeleteSheet({
  onCancel,
  onDelete,
}: {
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center"
      onClick={onCancel}
    >
      <section
        className="w-full rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-5 sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-red-500/10 text-red-300">
          <TrashIcon />
        </div>
        <h2 className="text-base font-bold">Remove this conversation?</h2>
        <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-muted)]">
          The job and its audit history stay intact, and the other participant
          keeps their copy. A new reply can make this conversation appear again.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="h-11 rounded-xl border border-[var(--wh-border-subtle)] text-[11px] font-semibold text-[var(--wh-text-secondary)]"
          >
            Keep
          </button>
          <button
            onClick={onDelete}
            className="h-11 rounded-xl border border-red-500/20 bg-red-500/10 text-[11px] font-semibold text-red-200"
          >
            Remove from Inbox
          </button>
        </div>
      </section>
    </div>
  );
}
function MessageContent({ content }: { content: string }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  if (isImage(content))
    return (
      <>
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="mb-1 block max-w-full overflow-hidden rounded-xl bg-black"
        >
          <img
            src={content}
            alt="Shared"
            loading="lazy"
            decoding="async"
            className="max-h-72 max-w-full object-contain"
          />
        </button>
        {viewerOpen ? (
          <MediaViewer
            src={content}
            kind="image"
            title="Shared image"
            onClose={() => setViewerOpen(false)}
          />
        ) : null}
      </>
    );
  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed">{content}</p>
  );
}
function BookingAttachment({ url }: { url: string }) {
  return <MessageMedia items={[{ url }]} />;
}
function isImage(v: string) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(v);
}
function Mic() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
function Phone() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function VideoCall() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}
function ProfileBlockAction({ blocked, busy, onClick }: { blocked: boolean; busy: boolean; onClick: () => void }) {
  return <button type="button" disabled={busy} onClick={onClick} className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200 disabled:opacity-45">{busy ? "Updating…" : blocked ? "Resume contact" : "Stop contact"}</button>;
}
function TrashIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="m9 7 .6-2h4.8l.6 2" />
      <path d="m6.5 7 .8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}
function JobRequestDetails({ booking }: { booking: Booking }) {
  const facts = [
    [
      "Requested date",
      booking.scheduled_date
        ? new Date(`${booking.scheduled_date}T12:00:00`).toLocaleDateString()
        : "To be agreed",
    ],
    ["Service location", booking.address || "Not supplied"],
  ];
  return (
    <div className="space-y-3 rounded-xl border border-violet-500/12 bg-violet-500/[.035] p-3">
      <div className="border-b border-[var(--wh-border-subtle)] pb-3">
        <div>
          <p className="text-[8px] font-bold uppercase tracking-[.14em] text-violet-300">Original service request</p>
          <p className="mt-1 text-[10px] font-semibold text-[#E2E4EA]">#{booking.booking_code || "—"} · {booking.service_type || "Service request"}</p>
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--wh-text-muted)]">
              {label}
            </p>
            <p className="mt-1 break-words text-[10px] leading-4 text-[#D4D7E0]">
              {value}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--wh-border-subtle)] pt-3">
        <p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--wh-text-muted)]">
          What the customer requested
        </p>
        <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-[var(--wh-text-secondary)]">
          {booking.description ||
            booking.customer_message ||
            "No written description was supplied with this request."}
        </p>
      </div>
      {booking.request_attachments?.length ? (
        <div className="grid gap-2 border-t border-[var(--wh-border-subtle)] pt-3 sm:grid-cols-2">
          {booking.request_attachments.map((url, index) => (
            <div key={`${url}-${index}`}>
              <p className="mb-1 text-[8px] text-[var(--wh-text-muted)]">
                Request attachment {index + 1}
              </p>
              <BookingAttachment url={url} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function JobRequestDetailsSheet({
  booking,
  bookingId,
  isWorker,
  onClose,
}: {
  booking: Booking;
  bookingId: string;
  isWorker: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100120] flex h-[100dvh] flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]"
      role="dialog"
      aria-modal="true"
      aria-label="Service request details"
    >
      <header className="flex min-h-14 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-3 pt-[env(safe-area-inset-top)]">
        <BackButton onClick={onClose} className="!ml-0 !w-10" ariaLabel="Back to chat" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {booking.service_type || "Service request"}
          </p>
          <p className="mt-0.5 text-[9px] text-[var(--wh-text-muted)]">
            #{booking.booking_code || "—"}
          </p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-xl space-y-4">
          <JobRequestDetails booking={booking} />
          <WorkerBookingDocuments bookingId={bookingId} isWorker={isWorker} />
        </div>
      </main>
    </div>
  );
}
function workerNextStep(status: string, isWorker: boolean) {
  const copy: Record<string, [string, string]> = {
    booking_requested: ["Review the request, set the full price and confirm the work date.", "The professional is reviewing your request and will set the full price and work date."],
    negotiating: ["Agree the work details, full price and date with the customer.", "Agree the work details, full price and date with the professional."],
    waiting_payment: ["Wait for the customer to approve the agreement and pay through WeHouse.", "Review the final price and date, then pay through WeHouse to confirm the job."],
    confirmed: ["Payment is secured. Start the job only when you arrive and begin the agreed work.", "Payment is secured. The professional can start the job when the agreed work begins."],
    in_progress: ["Complete the agreed work, then mark it ready for the customer to review.", "The work is in progress. Do not confirm completion until you have checked the result."],
    completed_pending_approval: ["Wait for the customer to confirm the work or open a problem report.", "Check the finished work. Confirm it only if the agreed work is complete, or report a problem."],
    approved_released: ["The customer confirmed the work and your earnings are available under the payout rules.", "The work is complete and payment has been released under the booking rules."],
    disputed: ["Do not make a new payment or private settlement while WeHouse reviews the problem.", "Do not confirm or pay again while WeHouse reviews the problem."],
    cancelled: ["This job is cancelled. No work should begin.", "This job is cancelled. No further booking action is needed."],
    refunded: ["This job is closed and the customer refund has been recorded.", "The refund has been recorded. Open WeHouse support if the record is incorrect."],
  };
  const item = copy[status] || ["Open the request to see the next available action.", "Open the request to see the next available action."];
  return item[isWorker ? 0 : 1];
}
                    onClick={() => setShowPaymentReview(true)}
                    disabled={paying}
                    className="min-h-10 rounded-xl bg-violet-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500"
                  >
                    {paying
                      ? "Processing…"
                      : "Review payment · ₦" + Number(booking.negotiated_amount || booking.agreed_amount || 0).toLocaleString("en-NG")}
                  </button>
                )}
              {!isWorker && booking.status === "completed_pending_approval" && (
                <button
                  onClick={() => void handleCustomerConfirm()}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold"
                >
                  Confirm completion
                </button>
              )}
              {!isWorker &&
                [
                  "confirmed",
                  "in_progress",
                  "completed_pending_approval",
                ].includes(booking.status) && (
                  <button
                    onClick={() => setShowDisputeForm((v) => !v)}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[9px] font-semibold text-red-300"
                  >
                    Raise dispute
                  </button>
                )}
              {!paymentReview &&
                [
                  "booking_requested",
                  "negotiating",
                  "waiting_payment",
                ].includes(booking.status) && (
                  <button
                    onClick={() => setShowCancelForm((v) => !v)}
                    className="rounded-lg bg-[var(--wh-interactive)] px-3 py-1.5 text-[9px] text-[var(--wh-text-secondary)]"
                  >
                    Cancel
                  </button>
                )}
            </div>
            {showAcceptForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[.035] p-2">
                <label className="block text-[9px] font-semibold text-[var(--wh-text-secondary)]">
                  Your price (₦)
                  <input
                    inputMode="numeric"
                    value={acceptAmount}
                    onChange={(e) =>
                      setAcceptAmount(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="Enter the final price"
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none"
                  />
                </label>
                <BookingDateField label="Job date" value={acceptDate} onChange={setAcceptDate} context="Service schedule" />
                <button
                  disabled={!Number(acceptAmount) || !acceptDate}
                  onClick={() => void handleWorkerAccept()}
                  className="h-9 w-full rounded-lg bg-violet-500 text-[10px] font-semibold disabled:cursor-not-allowed disabled:bg-[var(--wh-interactive)] disabled:text-[var(--wh-text-muted)]"
                >
                  Confirm price &amp; accept booking
                </button>
              </div>
            )}
            {showDisputeForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-red-500/15 bg-red-500/[.035] p-2">
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  rows={2}
                  placeholder="What went wrong?"
                  className="w-full resize-none rounded-lg border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-2 text-xs outline-none"
                />
                <button
                  onClick={() => void handleCustomerDispute()}
                  className="h-9 w-full rounded-lg bg-red-500 text-[10px] font-semibold"
                >
                  Submit dispute
                </button>
              </div>
            )}
            {showCancelForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-2">
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={2}
                  placeholder="Reason for cancellation"
                  className="w-full resize-none rounded-lg border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-2 text-xs outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowCancelForm(false)}
                    className="h-9 rounded-lg bg-[var(--wh-interactive)] text-[10px]"
                  >
                    Keep booking
                  </button>
                  <button
                    onClick={() => void handleCancel()}
                    className="h-9 rounded-lg bg-red-500/10 text-[10px] font-semibold text-red-300"
                  >
                    Cancel booking
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>
      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.045),transparent_32%)] px-3 py-4 sm:px-4">
        <div className="mx-auto max-w-4xl space-y-3">
          {messages.some((message) => message.decryption_failed) ? (
            <section className="flex items-center justify-between gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[.06] p-3">
              <div>
                <p className="text-[10px] font-semibold text-violet-100">
                  Some messages are still locked
                </p>
                <p className="mt-1 text-[9px] leading-4 text-[var(--wh-text-secondary)]">
                  Re-enter your Inbox PIN to unlock this conversation on this device.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void retryLockedMessages()}
                className="min-h-10 shrink-0 rounded-xl border border-violet-400/25 px-3 text-[9px] font-semibold text-violet-200"
              >
                Enter PIN
              </button>
            </section>
          ) : null}
          {messageError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/[.06] p-4 text-center">
              <p className="text-xs font-semibold text-red-200">
                Messages could not be loaded
              </p>
              <button
                onClick={() => void loadAll()}
                className="mt-2 text-[10px] font-semibold text-violet-300"
              >
                Try again
              </button>
            </div>
          ) : null}
          {!messageError && messages.length === 0 ? (
            <div className="grid min-h-44 place-items-center text-center">
              <div>
                <p className="text-sm font-semibold">No messages yet</p>
                <p className="mt-2 text-[10px] text-[var(--wh-text-muted)]">
                  Start with the work details, schedule and price.
                </p>
              </div>
            </div>
          ) : null}
          <PrivateCallHistory
            contextType="worker_booking"
            contextId={conversationId}
          />
          {messages.map((msg, index) => {
            const mine = msg.sender_id === profile.user_id,
              reactions = Object.values(msg.reactions || {}).reduce<
                Record<string, number>
              >(
                (all, emoji) => ({ ...all, [emoji]: (all[emoji] || 0) + 1 }),
                {},
              ),
              prev = messages[index - 1],
              showDay =
                !prev ||
                new Date(prev.created_at).toDateString() !==
                  new Date(msg.created_at).toDateString();
            return (
              <div key={msg.id}>
                {showDay && <DaySeparator value={msg.created_at} />}
                <MessagePress
                  onOpen={(anchor) => {
                    setMessageMenuAnchor(anchor);
                    setMessageMenuMode("actions");
                    setMessageMenu(msg);
                  }}
                  onTap={(anchor) => {
                    setMessageMenuAnchor(anchor);
                    setMessageMenuMode("reactions");
                    setMessageMenu(msg);
                  }}
                  onReply={() => setReplyingTo(msg)}
                  className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] overflow-hidden rounded-[20px] px-3.5 py-2.5 sm:max-w-[72%] ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]"}`}
                  >
                    {!mine && (
                      <p className="mb-1 text-[9px] font-semibold text-violet-300">
                        {msg.sender_name || "Job participant"}
                      </p>
                    )}
                    {msg.reply_to_id &&
                      (() => {
                        const quoted = messageById.get(msg.reply_to_id);
                        return quoted ? (
                          <div
                            className={`mb-2 border-l-2 px-2.5 py-1.5 ${mine ? "border-violet-100/70 bg-black/10" : "border-violet-400 bg-[var(--wh-interactive)]"}`}
                          >
                            <p className="truncate text-[8px] font-semibold text-violet-200">
                              {quoted.sender_id === profile.user_id
                                ? "You"
                                : quoted.sender_name || peerName}
                            </p>
                            <p className="mt-0.5 truncate text-[9px] opacity-70">
                              {quoted.content ||
                                (quoted.attachments?.length
                                  ? "Attachment"
                                  : "Message")}
                            </p>
                          </div>
                        ) : null;
                      })()}
                    <MessageMedia items={(msg.attachments || []).map((url, i) => ({url, type: msg.attachment_types?.[i], name: msg.attachment_names?.[i]}))} />
                    {msg.attachment_failed && <AttachmentState error />}
                    {msg.content && <MessageContent content={msg.content} />}
                    <p
                      className={`mt-1 text-[8px] ${mine ? "text-violet-100/70" : "text-[var(--wh-text-muted)]"}`}
                    >
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {mine && (
                        <span
                          className={
                            msg.is_read
                              ? "ml-1 font-bold text-cyan-200"
                              : "ml-1 text-violet-100/50"
                          }
                        >
                          {msg.delivery_state === "sending"
                            ? " · Sending…"
                            : msg.delivery_state === "failed"
                              ? " · Not sent"
                              : msg.is_read
                                ? " ✓✓"
                                : " ✓"}
                        </span>
                      )}
                    </p>
                    {Object.keys(reactions).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {Object.entries(reactions).map(([emoji, count]) => (
                          <span
                            key={emoji}
                            className="rounded-full bg-black/20 px-1.5 py-0.5 text-[9px]"
                          >
                            {emoji}
                            {count > 1 ? ` ${count}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </MessagePress>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </main>
      <footer className="chat-input-container shrink-0 border-t border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
        {openConversation && !contactBlocked ? (
          <div className="mx-auto max-w-4xl">
            {!secureChat ? (
              <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--wh-border-subtle)] px-4 py-3 text-[10px] text-[var(--wh-text-secondary)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                Opening conversation…
              </div>
            ) : secureChat.state !== "ready" ? (
              <SecureChatOnboarding
                status={secureChat}
                personName={peerName}
                onReady={() => void finishSecureUnlock()}
              />
            ) : (
              <>
                <PendingMessageMedia files={files} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))} />
                <VoiceRecorderPanel
                  recording={voice.recording}
                  seconds={voice.seconds}
                  level={voice.level}
                  draft={voice.draft}
                  onCancel={voice.cancel}
                  onFinish={voice.finish}
                  onDiscard={voice.discard}
                  onUse={(file) => {
                    setFiles((current) =>
                      [...current, file].slice(0, MAX_FILES),
                    );
                    voice.discard();
                  }}
                />
                {replyingTo && (
                  <div className="mb-2 flex items-center gap-3 border-l-2 border-violet-400 bg-[var(--wh-interactive)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[8px] font-semibold text-violet-300">
                        Replying to{" "}
                        {replyingTo.sender_id === profile.user_id
                          ? "yourself"
                          : replyingTo.sender_name || peerName}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--wh-text-secondary)]">
                        {replyingTo.content ||
                          (replyingTo.attachments?.length
                            ? "Attachment"
                            : "Message")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      className="grid h-8 w-8 place-items-center text-[var(--wh-text-secondary)]"
                      aria-label="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <ChatAttachmentPicker
                    onFiles={chooseFiles}
                  />
                  <button
                    onClick={() => void toggleVoice()}
                    aria-label={
                      voice.recording
                        ? "Finish voice recording"
                        : "Record voice message"
                    }
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${voice.recording ? "bg-red-500 text-white" : "border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"}`}
                  >
                    <Mic />
                  </button>
                  <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 py-1.5 focus-within:border-violet-500/40">
                    <textarea
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder="Write in this conversation…"
                      className="max-h-24 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleSend()}
                    disabled={sending || (!input.trim() && !files.length)}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-[var(--wh-interactive)] disabled:text-[var(--wh-text-muted)]"
                  >
                    {sending ? "…" : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : contactBlocked ? (
          <div className="mx-auto max-w-4xl py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold text-amber-200">
                  Messages and private calls are stopped
                </p>
                <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                  {peerBlocked
                    ? "You blocked this person. Unblock them from their profile to restore contact."
                    : "This person blocked contact. The conversation history remains available."}
                </p>
              </div>
              {jobSupportOpen && (
                <button
                  onClick={openSupport}
                  className="shrink-0 text-[9px] font-semibold text-violet-300"
                >
                  {paymentReview ? "Open review" : "Message WeHouse"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-[var(--wh-text-muted)]">
                This job conversation is closed.
              </p>
              {jobSupportOpen && (
                <button
                  onClick={openSupport}
                  className="text-[10px] font-semibold text-violet-300"
                >
                  Message WeHouse
                </button>
              )}
            </div>
            {!isWorker && booking?.status === "approved_released" && (
              <section className="mt-3 border-t border-[var(--wh-border-subtle)] pt-3">
                {review && !reviewOpen ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-amber-300">
                        {"★".repeat(Number(review.rating))}
                      </p>
                      <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                        Your verified review ·{" "}
                        {review.comment
                          ? "Written review included"
                          : "No written comment"}
                      </p>
                    </div>
                    <button
                      onClick={() => setReviewOpen(true)}
                      className="text-[9px] font-semibold text-violet-300"
                    >
                      Edit review
                    </button>
                  </div>
                ) : reviewOpen ? (
                  <div>
                    <p className="text-xs font-semibold">
                      Rate this completed job
                    </p>
                    <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                      Your rating and review appear on this professional’s
                      public profile.
                    </p>
                    <div className="mt-3 flex gap-2" aria-label="Choose rating">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`${value} star${value === 1 ? "" : "s"}`}
                          onClick={() => setReviewRating(value)}
                          className={`text-2xl ${value <= reviewRating ? "text-amber-300" : "text-[var(--wh-text-muted)]"}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewComment}
                      onChange={(event) =>
                        setReviewComment(event.target.value.slice(0, 1200))
                      }
                      placeholder="Describe the work, communication and reliability (optional)"
                      className="mt-3 min-h-20 w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-xs outline-none focus:border-violet-500/40"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={reviewSaving}
                        onClick={() => void saveReview()}
                        className="h-10 flex-1 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40"
                      >
                        {reviewSaving ? "Saving…" : "Publish verified review"}
                      </button>
                      {review && (
                        <button
                          onClick={() => setReviewOpen(false)}
                          className="h-10 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-[10px]"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setReviewOpen(true)}
                    className="h-11 w-full rounded-xl bg-amber-500/10 text-[10px] font-semibold text-amber-300"
                  >
                    Rate and review this job
                  </button>
                )}
              </section>
            )}
          </div>
        )}
      </footer>
      {(!openConversation || contactBlocked) &&
      secureChat &&
      (secureChat.state === "setup_required" ||
        secureChat.state === "unlock_required") ? (
        <SecureChatOnboarding
          status={secureChat}
          personName={peerName}
          onReady={() => void finishSecureUnlock()}
        />
      ) : null}
      {profileOpen ? (
        <ConversationIdentitySheet
          profile={peerProfile}
          booking={booking}
          isWorker={isWorker}
          name={peerName}
          avatar={peerAvatar}
          presence={presenceText || ""}
          onClose={() => setProfileOpen(false)}
          onAudioCall={() => {
            setProfileOpen(false);
            void startCall("audio");
          }}
          onVideoCall={() => {
            setProfileOpen(false);
            void startCall("video");
          }}
          blocked={peerBlocked}
          blockedByPeer={blockedByPeer}
          blockBusy={blockBusy}
          onToggleBlock={() => {
            if (peerBlocked) void togglePeerBlock();
            else setBlockPrompt(true);
          }}
          onReport={openReport}
        />
      ) : null}
      {detailsOpen && booking ? (
        <JobRequestDetailsSheet
          booking={booking}
          bookingId={bookingId}
          isWorker={isWorker}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null}
      {messageMenu && (
        <MessageActionSheet
          anchor={messageMenuAnchor}
          mode={messageMenuMode}
          currentReaction={messageMenu.reactions?.[profile.user_id] || null}
          onClose={() => setMessageMenu(null)}
          onReact={async (emoji) => {
            const current = messageMenu.reactions?.[profile.user_id];
            const result = await reactToBookingMessage(
              conversationId,
              messageMenu.id,
              current === emoji ? null : emoji,
            );
            if (result.error) return toast.error(result.error.message);
            setMessages((rows) =>
              rows.map((row) =>
                row.id === messageMenu.id
                  ? { ...row, reactions: result.reactions }
                  : row,
              ),
            );
            setMessageMenu(null);
          }}
          onReply={() => {
            setReplyingTo(messageMenu);
            setMessageMenu(null);
          }}
          onRemove={() => {
            setMessageToRemove(messageMenu);
            setMessageMenu(null);
          }}
          onCopy={messageMenu.content ? () => {
            void navigator.clipboard.writeText(messageMenu.content || "");
            toast.success("Message copied");
            setMessageMenu(null);
          } : undefined}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(messageToRemove)}
        title="Remove this message?"
        description="This removes the message only from your chat. The other person keeps their copy."
        confirmLabel="Remove for me"
        onCancel={() => setMessageToRemove(null)}
        onConfirm={() => void deleteMessageForMe()}
      />
      <ConfirmDialog
        isOpen={blockPrompt}
        title={`Stop contact with ${peerProfile?.full_name || peerName}?`}
        description="Messages and private calls will stop. Your booking, payment review and chat history will stay intact unless WeHouse flags a real safety issue."
        confirmLabel="Stop contact"
        variant="danger"
        onCancel={() => setBlockPrompt(false)}
        onConfirm={() => void togglePeerBlock()}
      />
      {confirmDelete && (
        <DeleteSheet
          onCancel={() => setConfirmDelete(false)}
          onDelete={() => void deleteFromMessages()}
        />
      )}
    </div>,
    document.body,
  );
}
function ChatAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-violet-300">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        (name || "W")[0].toUpperCase()
      )}
    </div>
  );
}
function ConversationIdentitySheet({
  profile,
  booking,
  isWorker,
  name,
  avatar,
  presence,
  onClose,
  onAudioCall,
  onVideoCall,
  blocked,
  blockedByPeer,
  blockBusy,
  onToggleBlock,
  onReport,
}: {
  profile: ConversationProfile | null;
  booking: Booking | null;
  isWorker: boolean;
  name: string;
  avatar?: string | null;
  presence: string;
  onClose: () => void;
  onAudioCall: () => void;
  onVideoCall: () => void;
  blocked: boolean;
  blockedByPeer: boolean;
  blockBusy: boolean;
  onToggleBlock: () => void;
  onReport: () => void;
}) {
  const [fullProfile, setFullProfile] = useState(false);
  const viewingWorker = !isWorker;
  const displayName = profile?.full_name || name;
  const avatarUrl = profile?.avatar_url || avatar || null;
  const location = [profile?.lga || profile?.local_government || profile?.city, profile?.state]
    .filter(Boolean)
    .join(", ");
  const reviewed = ["approved", "verified", "live"].includes(
    String((profile as any)?.verification_status || (profile as any)?.worker_status || "").toLowerCase(),
  );
  if (fullProfile && viewingWorker && profile?.user_id) {
    return (
      <WorkerPublicProfile
        worker={{ ...profile, local_government: profile.lga || profile.local_government } as Profile}
        onBack={() => setFullProfile(false)}
        onBook={() => undefined}
        showBookingAction={false}
          communicationActions={!blocked && !blockedByPeer ? (
          <>
            <PublicProfileAction label="Audio" onClick={onAudioCall}><Phone /></PublicProfileAction>
            <PublicProfileAction label="Video" onClick={onVideoCall}><VideoCall /></PublicProfileAction>
          </>
        ) : undefined}
        safetyAction={
          <div className="mt-5 space-y-2">
            <button type="button" className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200" onClick={onReport}>Report profile</button>
            <ProfileBlockAction blocked={blocked} busy={blockBusy} onClick={onToggleBlock} />
          </div>
        }
      />
    );
  }
  return (
    <RoommatePublicProfile
      context="conversation"
      onViewProfile={viewingWorker && profile?.user_id ? () => setFullProfile(true) : undefined}
      person={{
        name: displayName,
        username: profile?.username,
        avatar: avatarUrl,
        location,
        bio: viewingWorker
          ? profile?.worker_bio || profile?.bio
          : profile?.bio || "Customer for this service booking.",
        occupation: viewingWorker
          ? reviewed
            ? "WeHouse reviewed service worker"
            : "WeHouse service worker"
          : "WeHouse customer",
      }}
      presence={presence}
      onClose={onClose}
      actions={!blocked && !blockedByPeer ? (
        <div className="flex gap-5">
          <PublicProfileAction label="Audio" onClick={onAudioCall}><Phone /></PublicProfileAction>
          <PublicProfileAction label="Video" onClick={onVideoCall}><VideoCall /></PublicProfileAction>
        </div>
      ) : undefined}
      footer={
        <>
        {isWorker && booking ? (
          <div className="mt-5 border-t border-[var(--wh-border-subtle)] pt-4">
            <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--wh-text-muted)]">
              This booking
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <CaseFact label="Service" value={booking.service_type || "Service request"} />
              <CaseFact label="Status" value={booking.status.replaceAll("_", " ")} />
              <CaseFact
                label="Scheduled"
                value={booking.scheduled_date ? new Date(`${booking.scheduled_date}T12:00:00`).toLocaleDateString() : "Not agreed"}
              />
              <CaseFact
                label="Agreed price"
                value={Number(booking.agreed_amount || booking.negotiated_amount || 0) > 0 ? `₦${Number(booking.agreed_amount || booking.negotiated_amount).toLocaleString("en-NG")}` : "Not agreed"}
              />
            </div>
            {booking.address ? (
              <div className="mt-2 rounded-xl bg-[var(--wh-interactive)] p-3">
                <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--wh-text-muted)]">Job location</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--wh-text-secondary)]">{booking.address}</p>
              </div>
            ) : null}
            {booking.customer_message || booking.description ? (
              <div className="mt-2 rounded-xl bg-[var(--wh-interactive)] p-3">
                <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--wh-text-muted)]">Original request</p>
                <p className="mt-1 whitespace-pre-line text-[10px] leading-4 text-[var(--wh-text-secondary)]">{booking.customer_message || booking.description}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 space-y-2">
          <button type="button" className="h-12 w-full rounded-2xl border border-[var(--wh-border-subtle)] text-[11px] font-semibold text-[var(--wh-text)]" onClick={onReport}>Report profile</button>
          <ProfileBlockAction blocked={blocked} busy={blockBusy} onClick={onToggleBlock} />
        </div>
        </>
      }
    />
  );
}
function CaseFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-[var(--wh-interactive)] p-3"><p className="text-[8px] uppercase tracking-wide text-[var(--wh-text-muted)]">{label}</p><p className="mt-1 capitalize text-[10px] font-semibold text-[#CFD2DA]">{value}</p></div>;
}
function DaySeparator({ value }: { value: string }) {
  const date = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const label =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString([], {
            day: "numeric",
            month: "short",
            year:
              date.getFullYear() === today.getFullYear()
                ? undefined
                : "numeric",
          });
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="h-px flex-1 bg-[var(--wh-interactive)]" />
      <span className="text-[8px] font-semibold text-[var(--wh-text-muted)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--wh-interactive)]" />
    </div>
  );
}
function DeleteSheet({
  onCancel,
  onDelete,
}: {
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center"
      onClick={onCancel}
    >
      <section
        className="w-full rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-5 sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-red-500/10 text-red-300">
          <TrashIcon />
        </div>
        <h2 className="text-base font-bold">Remove this conversation?</h2>
        <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-muted)]">
          The job and its audit history stay intact, and the other participant
          keeps their copy. A new reply can make this conversation appear again.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="h-11 rounded-xl border border-[var(--wh-border-subtle)] text-[11px] font-semibold text-[var(--wh-text-secondary)]"
          >
            Keep
          </button>
          <button
            onClick={onDelete}
            className="h-11 rounded-xl border border-red-500/20 bg-red-500/10 text-[11px] font-semibold text-red-200"
          >
            Remove from Inbox
          </button>
        </div>
      </section>
    </div>
  );
}
function MessageContent({ content }: { content: string }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  if (isImage(content))
    return (
      <>
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="mb-1 block max-w-full overflow-hidden rounded-xl bg-black"
        >
          <img
            src={content}
            alt="Shared"
            loading="lazy"
            decoding="async"
            className="max-h-72 max-w-full object-contain"
          />
        </button>
        {viewerOpen ? (
          <MediaViewer
            src={content}
            kind="image"
            title="Shared image"
            onClose={() => setViewerOpen(false)}
          />
        ) : null}
      </>
    );
  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed">{content}</p>
  );
}
function BookingAttachment({ url }: { url: string }) {
  return <MessageMedia items={[{ url }]} />;
}
function isImage(v: string) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(v);
}
function Mic() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
function Phone() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function VideoCall() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}
function ProfileBlockAction({ blocked, busy, onClick }: { blocked: boolean; busy: boolean; onClick: () => void }) {
  return <button type="button" disabled={busy} onClick={onClick} className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200 disabled:opacity-45">{busy ? "Updating…" : blocked ? "Resume contact" : "Stop contact"}</button>;
}
function TrashIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="m9 7 .6-2h4.8l.6 2" />
      <path d="m6.5 7 .8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}
function JobRequestDetails({ booking }: { booking: Booking }) {
  const facts = [
    [
      "Requested date",
      booking.scheduled_date
        ? new Date(`${booking.scheduled_date}T12:00:00`).toLocaleDateString()
        : "To be agreed",
    ],
    ["Service location", booking.address || "Not supplied"],
  ];
  return (
    <div className="space-y-3 rounded-xl border border-violet-500/12 bg-violet-500/[.035] p-3">
      <div className="border-b border-[var(--wh-border-subtle)] pb-3">
        <div>
          <p className="text-[8px] font-bold uppercase tracking-[.14em] text-violet-300">Original service request</p>
          <p className="mt-1 text-[10px] font-semibold text-[#E2E4EA]">#{booking.booking_code || "—"} · {booking.service_type || "Service request"}</p>
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--wh-text-muted)]">
              {label}
            </p>
            <p className="mt-1 break-words text-[10px] leading-4 text-[#D4D7E0]">
              {value}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--wh-border-subtle)] pt-3">
        <p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--wh-text-muted)]">
          What the customer requested
        </p>
        <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-[var(--wh-text-secondary)]">
          {booking.description ||
            booking.customer_message ||
            "No written description was supplied with this request."}
        </p>
      </div>
      {booking.request_attachments?.length ? (
        <div className="grid gap-2 border-t border-[var(--wh-border-subtle)] pt-3 sm:grid-cols-2">
          {booking.request_attachments.map((url, index) => (
            <div key={`${url}-${index}`}>
              <p className="mb-1 text-[8px] text-[var(--wh-text-muted)]">
                Request attachment {index + 1}
              </p>
              <BookingAttachment url={url} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function JobRequestDetailsSheet({
  booking,
  bookingId,
  isWorker,
  onClose,
}: {
  booking: Booking;
  bookingId: string;
  isWorker: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100120] flex h-[100dvh] flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]"
      role="dialog"
      aria-modal="true"
      aria-label="Service request details"
    >
      <header className="flex min-h-14 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-3 pt-[env(safe-area-inset-top)]">
        <BackButton onClick={onClose} className="!ml-0 !w-10" ariaLabel="Back to chat" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {booking.service_type || "Service request"}
          </p>
          <p className="mt-0.5 text-[9px] text-[var(--wh-text-muted)]">
            #{booking.booking_code || "—"}
          </p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-xl space-y-4">
          <JobRequestDetails booking={booking} />
          <WorkerBookingDocuments bookingId={bookingId} isWorker={isWorker} />
        </div>
      </main>
    </div>
  );
}
function workerNextStep(status: string, isWorker: boolean) {
  const copy: Record<string, [string, string]> = {
    booking_requested: ["Review the request, set the full price and confirm the work date.", "The professional is reviewing your request and will set the full price and work date."],
    negotiating: ["Agree the work details, full price and date with the customer.", "Agree the work details, full price and date with the professional."],
    waiting_payment: ["Wait for the customer to approve the agreement and pay through WeHouse.", "Review the final price and date, then pay through WeHouse to confirm the job."],
    confirmed: ["Payment is secured. Start the job only when you arrive and begin the agreed work.", "Payment is secured. The professional can start the job when the agreed work begins."],
    in_progress: ["Complete the agreed work, then mark it ready for the customer to review.", "The work is in progress. Do not confirm completion until you have checked the result."],
    completed_pending_approval: ["Wait for the customer to confirm the work or open a problem report.", "Check the finished work. Confirm it only if the agreed work is complete, or report a problem."],
    approved_released: ["The customer confirmed the work and your earnings are available under the payout rules.", "The work is complete and payment has been released under the booking rules."],
    disputed: ["Do not make a new payment or private settlement while WeHouse reviews the problem.", "Do not confirm or pay again while WeHouse reviews the problem."],
    cancelled: ["This job is cancelled. No work should begin.", "This job is cancelled. No further booking action is needed."],
    refunded: ["This job is closed and the customer refund has been recorded.", "The refund has been recorded. Open WeHouse support if the record is incorrect."],
  };
  const item = copy[status] || ["Open the request to see the next available action.", "Open the request to see the next available action."];
  return item[isWorker ? 0 : 1];
}
