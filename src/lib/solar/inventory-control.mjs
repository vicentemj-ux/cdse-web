const value = (input) => Number.isFinite(Number(input)) ? Number(input) : 0;

export function inventoryAvailability(balance = {}) {
  const onHand = Math.max(value(balance.on_hand), 0);
  const reserved = Math.min(Math.max(value(balance.reserved), 0), onHand);
  return { onHand, reserved, available: Math.max(onHand - reserved, 0) };
}

export function materialAllocationState(allocation = {}) {
  const planned = Math.max(value(allocation.planned_quantity), 0);
  const reserved = Math.max(value(allocation.reserved_quantity), 0);
  const issued = Math.max(value(allocation.issued_quantity), 0);
  const returned = Math.min(Math.max(value(allocation.returned_quantity), 0), issued);
  const netIssued = issued - returned;
  const uncovered = Math.max(planned - reserved - netIssued, 0);
  const progress = planned > 0 ? Math.min(netIssued / planned, 1) : 0;
  const state = netIssued >= planned && reserved === 0
    ? 'issued'
    : uncovered === 0 && planned > netIssued
      ? 'ready'
      : reserved > 0 || netIssued > 0
        ? 'partial'
        : 'pending';
  return { planned, reserved, issued, returned, netIssued, uncovered, progress, state };
}

export function inventoryPortfolioMetrics(items = [], allocations = []) {
  const stock = items.flatMap((item) => (item.solar_inventory_balances ?? []).map((balance) => ({ item, balance })));
  const stockValue = stock.reduce((sum, row) => sum + inventoryAvailability(row.balance).onHand * value(row.item.default_unit_cost_before_vat_mxn), 0);
  const lowStockItems = items.filter((item) => {
    const available = (item.solar_inventory_balances ?? []).reduce((sum, balance) => sum + inventoryAvailability(balance).available, 0);
    return item.active !== false && available <= value(item.reorder_point);
  });
  const openAllocations = allocations.filter((item) => !['cancelled', 'closed'].includes(item.status));
  const shortageAllocations = openAllocations.filter((item) => materialAllocationState(item).uncovered > 0);
  const readyProjects = new Set(openAllocations.filter((item) => materialAllocationState(item).state === 'ready').map((item) => item.project_id));
  const shortageProjects = new Set(shortageAllocations.map((item) => item.project_id));
  return {
    stockValue,
    lowStockCount: lowStockItems.length,
    shortageAllocationCount: shortageAllocations.length,
    shortageProjectCount: shortageProjects.size,
    readyProjectCount: [...readyProjects].filter((id) => !shortageProjects.has(id)).length,
  };
}

export function movementLabel(type) {
  return ({
    receipt: 'Recepción', adjustment_in: 'Ajuste de entrada', adjustment_out: 'Ajuste de salida',
    reserve: 'Apartado', release: 'Liberación', issue: 'Entrega a proyecto', return: 'Devolución',
  })[type] ?? 'Movimiento';
}

export function normalizeInventorySerial(input) {
  return String(input ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLocaleUpperCase('es-MX');
}

export function parseInventorySerials(input) {
  const values = String(input ?? '').split(/[\n,;\t]+/).map(normalizeInventorySerial).filter(Boolean);
  const seen = new Set();
  const serials = [];
  const duplicates = [];
  const invalid = [];
  for (const serial of values) {
    if (!/^[A-Z0-9][A-Z0-9._\/-]{2,179}$/.test(serial)) {
      invalid.push(serial);
    } else if (seen.has(serial)) {
      duplicates.push(serial);
    } else {
      seen.add(serial);
      serials.push(serial);
    }
  }
  return { serials, duplicates: [...new Set(duplicates)], invalid: [...new Set(invalid)] };
}

export function serialPortfolioMetrics(serials = []) {
  const count = (status) => serials.filter((item) => item.status === status).length;
  return {
    total: serials.length,
    inStock: count('in_stock'),
    reserved: count('reserved'),
    issued: count('issued'),
    installed: count('installed'),
    exceptions: serials.filter((item) => ['quarantined', 'retired'].includes(item.status)).length,
  };
}

export function eligibleInventorySerials(serials = [], allocation = {}, action = '') {
  return serials.filter((serial) => {
    if (serial.item_id !== allocation.item_id) return false;
    if (action === 'reserve') return serial.status === 'in_stock' && serial.location_id === allocation.location_id;
    if (action === 'release') return serial.status === 'reserved' && serial.allocation_id === allocation.id;
    if (action === 'issue') return serial.status === 'reserved' && serial.allocation_id === allocation.id;
    if (action === 'return') return serial.status === 'issued' && serial.allocation_id === allocation.id;
    return false;
  });
}
