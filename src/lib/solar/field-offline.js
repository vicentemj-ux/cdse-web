const QUEUE_KEY = 'cdse-solar-field-queue-v1';
const SNAPSHOT_KEY = 'cdse-solar-field-snapshot-v1';

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be disabled or full. The caller still retains its live form.
  }
}

export function cacheFieldSnapshot(workOrders) {
  writeJson(SNAPSHOT_KEY, { savedAt: new Date().toISOString(), workOrders });
}

export function getFieldSnapshot() {
  return readJson(SNAPSHOT_KEY, { savedAt: null, workOrders: [] });
}

export function getQueuedFieldActions() {
  return readJson(QUEUE_KEY, []);
}

export function enqueueFieldAction(action) {
  const queued = getQueuedFieldActions();
  const entry = { id: crypto.randomUUID(), queuedAt: new Date().toISOString(), attempts: 0, ...action };
  writeJson(QUEUE_KEY, [...queued, entry]);
  return entry;
}

export async function flushFieldActions(client) {
  const queue = getQueuedFieldActions();
  const remaining = [];
  let synced = 0;
  for (const action of queue) {
    let result;
    if (action.type === 'checklist') {
      result = await client.rpc('set_solar_work_order_checklist_item', action.payload);
    } else if (action.type === 'incident') {
      result = await client.rpc('report_solar_work_order_incident', action.payload);
    } else {
      continue;
    }
    if (result.error) remaining.push({ ...action, attempts: Number(action.attempts ?? 0) + 1, lastError: result.error.message });
    else synced += 1;
  }
  writeJson(QUEUE_KEY, remaining);
  return { synced, remaining: remaining.length };
}
