/** Bounded work; preserves source order. No unbounded request per saved place. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  shouldContinue: () => boolean = () => true,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  const result: R[] = new Array(items.length);
  let cursor = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && shouldContinue()) {
      const index = cursor++;
      if (index >= items.length) return;
      try { result[index] = await task(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return result;
}
