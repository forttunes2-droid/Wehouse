/** Uses the same authorised peer projection as Inbox, not unrestricted profiles. */
export type RoommateConversationRef = {
  id: string;
  participant_a: string;
  participant_b: string;
  conversation_type?: string | null;
  status?: string | null;
};
export type RoommatePeerIdentity = {
  user_id: string;
  name: string;
  avatar: string | null;
  username?: string;
  isBlocked: boolean;
};
export type RoommateRecipient = {
  conversationId: string;
  userId: string;
  name: string;
  username: string;
  avatar: string | null;
};

export function selectRoommateRecipients(
  viewerId: string,
  conversations: readonly RoommateConversationRef[],
  people: Readonly<Record<string, RoommatePeerIdentity>>,
): { recipients: RoommateRecipient[]; missingIdentityCount: number } {
  const recipients: RoommateRecipient[] = [];
  const included = new Set<string>();
  const missing = new Set<string>();
  if (!viewerId) return { recipients, missingIdentityCount: 0 };
  for (const conversation of conversations) {
    if (conversation.conversation_type !== 'roommate'
      || !['active', 'accepted'].includes(String(conversation.status))
      || !conversation.id) continue;
    const other = conversation.participant_a === viewerId
      ? conversation.participant_b
      : conversation.participant_b === viewerId ? conversation.participant_a : null;
    if (!other || other === viewerId || included.has(other)) continue;
    // Own-property lookup avoids accidental inherited values on plain objects.
    const peer = Object.prototype.hasOwnProperty.call(people, other) ? people[other] : null;
    if (peer?.isBlocked) continue;
    const username = String(peer?.username || '').trim().replace(/^@/, '');
    const name = String(peer?.name || '').trim();
    if (!peer || peer.user_id !== other || (!name && !username)
      || (name === 'Roommate' && !username)) {
      missing.add(other);
      continue;
    }
    included.add(other);
    missing.delete(other);
    recipients.push({
      conversationId: conversation.id,
      userId: other,
      name: name && name !== 'Roommate' ? name : username,
      username,
      avatar: peer.avatar || null,
    });
  }
  recipients.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  return { recipients, missingIdentityCount: missing.size };
}
