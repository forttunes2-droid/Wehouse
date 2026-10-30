// Anonymous catalog reads only. These gates cannot establish mixed-journey capacity.
export const CATALOG_CAPACITY_LIMITS = Object.freeze({
  p95_ms: 2000,
  retry_rate_pct: 1,
  dispatch_deviation_pct: 5,
});

export function catalogWarmupComplete(successfulPaths, expectedPaths) {
  return Array.isArray(successfulPaths) && expectedPaths.length > 0 &&
    successfulPaths.length === expectedPaths.length &&
    new Set(successfulPaths).size === expectedPaths.length &&
    expectedPaths.every(name => successfulPaths.includes(name));
}

export function assessCatalogStage(stage, expectedPaths) {
  const failures = [];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  if (!finite(stage.target_rps) || stage.target_rps <= 0 || !finite(stage.seconds) || stage.seconds <= 0 ||
      stage.offered !== stage.target_rps * stage.seconds) failures.push('Invalid offered workload');
  if (stage.completed !== stage.offered || stage.errors !== 0 || stage.dropped !== 0)
    failures.push('Incomplete or failed requests');
  if (!finite(stage.retry_rate_pct) || stage.retry_rate_pct < 0 || stage.retry_rate_pct > CATALOG_CAPACITY_LIMITS.retry_rate_pct)
    failures.push('Retry rate exceeds the catalog gate or is missing');
  if (!finite(stage.p95_ms) || stage.p95_ms < 0 || stage.p95_ms > CATALOG_CAPACITY_LIMITS.p95_ms)
    failures.push('Overall p95 exceeds 2000 ms or is missing');
  const offeredWindow = stage.dispatch_seconds;
  const dispatchRate = stage.offered / offeredWindow;
  if (!finite(offeredWindow) || offeredWindow <= 0 || !finite(dispatchRate) ||
      Math.abs(dispatchRate - stage.target_rps) / stage.target_rps * 100 > CATALOG_CAPACITY_LIMITS.dispatch_deviation_pct)
    failures.push('Generator dispatch rate differs from target by more than 5% or is missing');
  if (!expectedPaths.length) failures.push('No expected paths supplied');
  for (const name of expectedPaths) {
    const path = stage.by_path?.[name];
    if (!path || !Number.isInteger(path.requests) || path.requests <= 0 || path.errors !== 0 ||
        !finite(path.p95_ms) || path.p95_ms < 0 || path.p95_ms > CATALOG_CAPACITY_LIMITS.p95_ms)
      failures.push(`${name}: missing samples, errors or p95 above 2000 ms`);
  }
  if (expectedPaths.reduce((total, name) => total + (stage.by_path?.[name]?.requests || 0), 0) !== stage.completed)
    failures.push('Per-path samples do not account for all completed requests');
  return { passed: failures.length === 0, failures };
}
