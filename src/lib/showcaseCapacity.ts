export type ShowcaseCapacity={posts:number;videos:number;post_limit:number;video_limit:number;photo_bytes:number;video_bytes:number};
export function parseShowcaseCapacity(value:unknown):ShowcaseCapacity {
  const row=value as ShowcaseCapacity|null;
  if(!row||![row.posts,row.videos,row.post_limit,row.video_limit,row.photo_bytes,row.video_bytes].every(Number.isSafeInteger)
    ||row.posts<0||row.videos<0||row.post_limit<1||row.video_limit<0||row.video_limit>row.post_limit||row.photo_bytes<1||row.video_bytes<1)
    throw new Error('Showcase limits could not be confirmed. Refresh before uploading.');
  return row;
}
export function showcaseCapacityError(capacity:ShowcaseCapacity,isVideo:boolean) {
  if(capacity.posts>=capacity.post_limit)return `Your showcase has ${capacity.post_limit} work samples. Remove an old sample before adding another.`;
  if(isVideo&&capacity.videos>=capacity.video_limit)return `Your showcase already has ${capacity.video_limit} videos. Remove one before adding another.`;
  return null;
}
