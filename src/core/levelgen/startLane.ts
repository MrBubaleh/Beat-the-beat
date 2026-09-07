export function startLane(config: {
  lanes: number;
  riskZone: { riskLanes: number[] };
}): number {
  const mid = Math.floor(config.lanes / 2);
  for (let offset = 0; offset <= mid; offset++) {
    const down = mid - offset;
    if (down >= 0 && !config.riskZone.riskLanes.includes(down)) return down;
    const up = mid + offset;
    if (up < config.lanes && !config.riskZone.riskLanes.includes(up)) return up;
  }
  return mid;
}
