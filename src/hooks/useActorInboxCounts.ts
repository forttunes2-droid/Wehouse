import { useCallback, useState } from 'react';

type Counts = { chatUnread: number; activityUnread: number };

/** Counts belong to one actor; incomplete reads retain that actor's last receipt. */
export function useActorInboxCounts(userId: string) {
  const [snapshot, setSnapshot] = useState<Counts & { userId: string }>({
    userId, chatUnread: 0, activityUnread: 0,
  });
  const updateCounts = useCallback((update: Partial<Counts>) => {
    if (Object.values(update).some(value => !Number.isSafeInteger(value) || value < 0)) return;
    setSnapshot(previous => ({
      ...(previous.userId === userId ? previous : { userId, chatUnread: 0, activityUnread: 0 }),
      ...update,
    }));
  }, [userId]);
  const chatUnread = snapshot.userId === userId ? snapshot.chatUnread : 0;
  const activityUnread = snapshot.userId === userId ? snapshot.activityUnread : 0;
  return { chatUnread, activityUnread, totalUnread: chatUnread + activityUnread, updateCounts };
}
