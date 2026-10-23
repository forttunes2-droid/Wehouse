/** Retain confirmed upload paths across retries, including a lost registration response. */
export function createInspectionEvidenceBatch() {
  const uploads = new Map<File, Promise<string>>();
  return async (files: File[], upload: (file: File) => Promise<string>) => {
    const photoUrls: string[] = [], videoUrls: string[] = [];
    for (const file of files) {
      let pending = uploads.get(file);
      if (!pending) {
        pending = upload(file).catch(error => { uploads.delete(file); throw error; });
        uploads.set(file, pending);
      }
      const path = await pending;
      (file.type.startsWith('video/') ? videoUrls : photoUrls).push(path);
    }
    return { photoUrls, videoUrls };
  };
}
