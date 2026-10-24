type Facts = {
  propertyType: string; bedrooms: string; bathrooms: string;
  hotelRooms: Array<{ maxGuests: string; inventory: string }>;
};

export function propertySubmissionFactsError(draft: Facts): string | null {
  const whole = (value: string, minimum: number) => value.trim() !== '' && /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= 2147483647;
  if (draft.propertyType === 'apartment') {
    if (!whole(draft.bedrooms, 0)) return 'Enter the bedroom count. Use 0 for a studio.';
    if (!whole(draft.bathrooms, 0)) return 'Enter a whole-number bathroom count.';
  }
  if (draft.propertyType === 'hotel') {
    for (const [index, room] of draft.hotelRooms.entries()) {
      if (!whole(room.maxGuests, 1)) return `Room type ${index + 1}: enter a guest capacity of at least 1.`;
      if (!whole(room.inventory, 1)) return `Room type ${index + 1}: enter a room inventory of at least 1.`;
    }
  }
  return null;
}
