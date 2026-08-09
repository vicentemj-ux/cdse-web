import { useMemo, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import { inventoryAvailability, inventoryPortfolioMetrics, materialAllocationState, movementLabel } from '../../../lib/solar/inventory-control.mjs';

const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const CATEGORY = { module: 'Panel solar', inverter: 'Inversor', mounting: 'Estructura', electrical: 'Material eléctrico', protection: 'Protecciones', monitoring: 'Monitoreo', consumable: 'Consumible', other: 'Otro' };
const UNIT = { piece: 'pza', meter: 'm', kit: 'kit', roll: 'rollo', box: 'caja', liter: 'L', kg: 'kg' };
const STATE = { pending: 'Sin apartar', partial: 'Parcial', ready: 'Listo para entregar', issued: 'Entregado', closed: 'Cerrado', cancelled: 'Cancelado' };
const ACTION = { reserve: 'Apartar', release: 'Liberar', issue: 'Entregar', return: 'Devolver' };
const ERROR = {
  ADMIN_REQUIRED: 'Esta acción requiere permisos administrativos.', QUANTITY_MUST_BE_POSITIVE: 'La cantidad debe ser mayor que cero.',
  STOCK_BELOW_RESERVED: 'El ajuste dejaría menos existencia que la ya apartada. Libera apartados antes de disminuir.',
  INSUFFICIENT_AVAILABLE_STOCK: 'No hay existencia disponible suficiente para completar ese apartado.',
  RESERVATION_EXCEEDS_PLAN: 'El apartado supera la cantidad todavía pendiente del plan.', RELEASE_EXCEEDS_RESERVATION: 'No puedes liberar más de lo actualmente apartado.',
  ISSUE_REQUIRES_RESERVATION: 'Primero aparta el material; sólo se puede entregar inventario reservado.',
  RETURN_EXCEEDS_NET_ISSUED: 'La devolución supera lo entregado y aún no devuelto.', ALLOCATION_CLOSED: 'Esta partida ya está cerrada o cancelada.',
  WORK_ORDER_PROJECT_MISMATCH: 'La orden de trabajo no pertenece al proyecto seleccionado.', ITEM_IDENTITY_REQUIRED: 'Captura SKU y nombre del material.',
};

function friendlyError(error) {
  const raw = error?.message?.replace(/^.*?:\s*/, '') || '';
  if (raw.includes('solar_inventory_items_sku_key')) return 'Ese SKU ya existe en el inventario.';
  return ERROR[raw] ?? raw ?? 'No se pudo completar el movimiento. Los datos permanecen en pantalla para corregirlos.';
}

function totalBalance(item) {
  return (item.solar_inventory_balances ?? []).reduce((result, balance) => {
    const current = inventoryAvailability(balance);
    return { onHand: result.onHand + current.onHand, reserved: result.reserved + current.reserved, available: result.available + current.available };
  }, { onHand: 0, reserved: 0, available: 0 });
}

export default function Inventory({ data, isAdmin, refresh, onOpenProject }) {
  const allocations = data.inventoryAllocations ?? [];
  const items = data.inventoryItems ?? [];
  const locations = data.inventoryLocations ?? [];
  const movements = data.inventoryMovements ?? [];
  const activeProjects = useMemo(() => data.projects.filter((item) => item.status !== 'cancelled'), [data.projects]);
  const initialProject = allocations[0]?.project_id ?? activeProjects[0]?.id ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(initialProject);
  const [tab, setTab] = useState('projects');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState({ itemId: '', locationId: locations[0]?.id ?? '', quantity: '', workOrderId: '', notes: '' });
  const [action, setAction] = useState({ allocationId: '', type: 'reserve', quantity: '', workOrderId: '', reference: '', notes: '' });
  const [stock, setStock] = useState({ itemId: '', locationId: locations[0]?.id ?? '', type: 'receipt', quantity: '', unitCost: '', reference: '', notes: '' });
  const [itemForm, setItemForm] = useState({ sku: '', name: '', category: 'electrical', unit: 'piece', unitCost: '', reorderPoint: '0', notes: '' });

  const selectedProject = activeProjects.find((item) => item.id === selectedProjectId) ?? activeProjects[0] ?? null;
  const projectAllocations = allocations.filter((item) => item.project_id === selectedProject?.id);
  const projectOrders = data.workOrders.filter((item) => item.project_id === selectedProject?.id && item.status !== 'cancelled');
  const metrics = inventoryPortfolioMetrics(items, allocations);
  const query = search.trim().toLocaleLowerCase('es-MX');
  const visibleProjects = activeProjects.filter((item) => !query || `${item.folio} ${item.customer_name} ${item.service_number ?? ''}`.toLocaleLowerCase('es-MX').includes(query));
  const visibleItems = items.filter((item) => !query || `${item.sku} ${item.name} ${CATEGORY[item.category] ?? ''}`.toLocaleLowerCase('es-MX').includes(query));

  async function run(key, request, success, reset) {
    if (busy) return;
    setBusy(key); setMessage(''); setError('');
    const result = await request();
    setBusy('');
    if (result.error) return setError(friendlyError(result.error));
    setMessage(success); reset?.(); await refresh();
  }

  async function createItem(event) {
    event.preventDefault();
    await run('item', () => getSupabaseClient().rpc('create_solar_inventory_item', { p_data: itemForm }), 'Material agregado. Registra su primera recepción para hacerlo disponible.', () => setItemForm({ sku: '', name: '', category: 'electrical', unit: 'piece', unitCost: '', reorderPoint: '0', notes: '' }));
  }

  async function recordStock(event) {
    event.preventDefault();
    await run('stock', () => getSupabaseClient().rpc('record_solar_inventory_stock', {
      p_item_id: stock.itemId, p_location_id: stock.locationId, p_movement_type: stock.type, p_quantity: Number(stock.quantity),
      p_unit_cost_before_vat_mxn: stock.unitCost ? Number(stock.unitCost) : null, p_reference: stock.reference || null, p_notes: stock.notes || null,
    }), stock.type === 'receipt' ? 'Recepción registrada en el libro mayor.' : 'Ajuste registrado con saldo anterior y posterior.', () => setStock((current) => ({ ...current, quantity: '', reference: '', notes: '' })));
  }

  async function planMaterial(event) {
    event.preventDefault();
    await run('plan', () => getSupabaseClient().rpc('plan_solar_project_material', {
      p_project_id: selectedProject.id, p_item_id: plan.itemId, p_location_id: plan.locationId, p_planned_quantity: Number(plan.quantity),
      p_work_order_id: plan.workOrderId || null, p_notes: plan.notes || null,
    }), 'Partida agregada al plan. Aún no afecta existencia hasta que la apartes.', () => setPlan((current) => ({ ...current, itemId: '', quantity: '', workOrderId: '', notes: '' })));
  }

  async function moveMaterial(event) {
    event.preventDefault();
    await run('action', () => getSupabaseClient().rpc('move_solar_project_material', {
      p_allocation_id: action.allocationId, p_action: action.type, p_quantity: Number(action.quantity), p_work_order_id: action.workOrderId || null,
      p_reference: action.reference || null, p_notes: action.notes || null,
    }), `${ACTION[action.type]} registrado. El saldo y la trazabilidad del proyecto ya fueron actualizados.`, () => setAction({ allocationId: '', type: 'reserve', quantity: '', workOrderId: '', reference: '', notes: '' }));
  }

  function beginAction(allocation, type) {
    const state = materialAllocationState(allocation);
    const maximum = type === 'reserve' ? state.uncovered : type === 'return' ? state.netIssued : state.reserved;
    setAction({ allocationId: allocation.id, type, quantity: maximum > 0 ? String(maximum) : '', workOrderId: allocation.work_order_id ?? '', reference: '', notes: '' });
    setError(''); setMessage('');
  }

  return <section className="sp-view sp-inventory">
    <header className="sp-view-header"><div><p className="sp-section-number">ALMACÉN / TRAZABILIDAD</p><h1>Cada pieza tiene destino.</h1></div><p className="sp-header-note">Existencia física, material apartado y entrega a obra permanecen separados para evitar prometer lo que no está disponible.</p></header>
    <div className="sp-ledger sp-inventory-ledger"><div><span>Valor físico</span><strong>{isAdmin ? money.format(metrics.stockValue) : items.length}</strong><small>{isAdmin ? 'antes de IVA · costo catálogo' : 'SKUs visibles'}</small></div><div><span>Puntos de reorden</span><strong>{metrics.lowStockCount}</strong><small>sin margen disponible</small></div><div><span>Proyectos con faltante</span><strong>{metrics.shortageProjectCount}</strong><small>{metrics.shortageAllocationCount} partidas abiertas</small></div><div><span>Proyectos listos</span><strong>{metrics.readyProjectCount}</strong><small>todas sus partidas apartadas</small></div></div>
    <div className="sp-install-tabs" role="tablist" aria-label="Áreas de inventario">{[['projects','Material por proyecto'],['stock','Existencias'],['movements','Libro mayor']].map(([id,label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)} key={id}>{label}</button>)}</div>
    {message && <p className="sp-inline-notice" role="status" aria-live="polite">{message}</p>}{error && <p className="sp-form-error" role="alert">{error}</p>}

    {tab === 'projects' && <div className="sp-inventory-shell">
      <aside className="sp-inventory-index"><label className="sp-field"><span>Buscar proyecto</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, folio o servicio" /></label><div>{visibleProjects.map((project) => { const rows = allocations.filter((item) => item.project_id === project.id); const shortage = rows.filter((item) => materialAllocationState(item).uncovered > 0).length; return <button type="button" className={selectedProject?.id === project.id ? 'is-active' : ''} onClick={() => setSelectedProjectId(project.id)} key={project.id}><span>{project.folio}</span><strong>{project.customer_name}</strong><small>{rows.length ? shortage ? `${shortage} partida${shortage === 1 ? '' : 's'} por cubrir` : 'Material completamente cubierto' : 'Sin lista de materiales'}</small></button>; })}{!visibleProjects.length && <p>No hay proyectos que coincidan.</p>}</div></aside>
      {selectedProject ? <main className="sp-inventory-project"><header><div><p className="sp-section-number">{selectedProject.folio}</p><h2>{selectedProject.customer_name}</h2><p>{projectAllocations.length} partida{projectAllocations.length === 1 ? '' : 's'} · {projectOrders.length} orden{projectOrders.length === 1 ? '' : 'es'} de trabajo</p></div><button type="button" className="sp-text-button" onClick={() => onOpenProject(selectedProject.id)}>Abrir expediente →</button></header>
        <div className="sp-material-list">{projectAllocations.map((allocation) => { const state = materialAllocationState(allocation); const item = allocation.solar_inventory_items ?? items.find((row) => row.id === allocation.item_id); return <article key={allocation.id} className={`is-${state.state}`}><div className="sp-material-name"><span>{CATEGORY[item?.category] ?? 'Material'} · {item?.sku}</span><strong>{item?.name ?? 'Material sin catálogo'}</strong><small>{allocation.solar_inventory_locations?.name ?? locations.find((row) => row.id === allocation.location_id)?.name} · origen {allocation.source.replaceAll('_',' ')}</small></div><div className="sp-material-numbers"><div><span>Planeado</span><b>{number.format(state.planned)}</b></div><div><span>Apartado</span><b>{number.format(state.reserved)}</b></div><div><span>Entregado neto</span><b>{number.format(state.netIssued)}</b></div><div className={state.uncovered ? 'is-short' : 'is-covered'}><span>Por cubrir</span><b>{number.format(state.uncovered)}</b></div></div><div className="sp-material-progress"><i><b style={{ width: `${state.progress * 100}%` }} /></i><span>{STATE[allocation.status] ?? STATE[state.state]}</span></div>{isAdmin && <div className="sp-material-actions">{state.uncovered > 0 && <button type="button" onClick={() => beginAction(allocation,'reserve')}>Apartar</button>}{state.reserved > 0 && <><button type="button" className="is-primary" onClick={() => beginAction(allocation,'issue')}>Entregar</button><button type="button" onClick={() => beginAction(allocation,'release')}>Liberar</button></>}{state.netIssued > 0 && <button type="button" onClick={() => beginAction(allocation,'return')}>Devolver</button>}</div>}</article>; })}{!projectAllocations.length && <div className="sp-inventory-empty"><strong>El proyecto aún no tiene materiales.</strong><p>Los paneles e inversores se agregan desde el alcance aceptado. Puedes completar estructura, protecciones, cableado y consumibles desde el plan.</p></div>}</div>
        {isAdmin && action.allocationId && <form className="sp-inventory-action" onSubmit={moveMaterial}><div><p className="sp-section-number">{ACTION[action.type].toUpperCase()}</p><strong>{projectAllocations.find((row) => row.id === action.allocationId)?.solar_inventory_items?.name}</strong></div><label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={action.quantity} onChange={(event) => setAction({ ...action, quantity: event.target.value })} /></label><label className="sp-field"><span>Orden de trabajo</span><select value={action.workOrderId} onChange={(event) => setAction({ ...action, workOrderId: event.target.value })}><option value="">Sin orden específica</option>{projectOrders.map((order) => <option value={order.id} key={order.id}>{order.folio} · {order.status}</option>)}</select></label><label className="sp-field"><span>Referencia</span><input maxLength="160" placeholder="Factura, vale o remisión" value={action.reference} onChange={(event) => setAction({ ...action, reference: event.target.value })} /></label><label className="sp-field sp-field--wide"><span>Nota</span><input maxLength="500" value={action.notes} onChange={(event) => setAction({ ...action, notes: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'action'}>{busy === 'action' ? 'Actualizando saldo…' : `Confirmar ${ACTION[action.type].toLocaleLowerCase('es-MX')}`}</button><button type="button" className="sp-text-button" onClick={() => setAction({ allocationId: '', type: 'reserve', quantity: '', workOrderId: '', reference: '', notes: '' })}>Cancelar</button></form>}
        {isAdmin && <form className="sp-inventory-plan" onSubmit={planMaterial}><div><p className="sp-section-number">AMPLIAR LISTA</p><h3>Agregar material planeado.</h3><p>No aparta existencias hasta que lo confirmes en la partida.</p></div><label className="sp-field"><span>Material</span><select required value={plan.itemId} onChange={(event) => setPlan({ ...plan, itemId: event.target.value })}><option value="">Selecciona</option>{items.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.sku} · {item.name}</option>)}</select></label><label className="sp-field"><span>Ubicación</span><select required value={plan.locationId} onChange={(event) => setPlan({ ...plan, locationId: event.target.value })}>{locations.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={plan.quantity} onChange={(event) => setPlan({ ...plan, quantity: event.target.value })} /></label><label className="sp-field"><span>Orden opcional</span><select value={plan.workOrderId} onChange={(event) => setPlan({ ...plan, workOrderId: event.target.value })}><option value="">Sin asignar</option>{projectOrders.map((order) => <option value={order.id} key={order.id}>{order.folio}</option>)}</select></label><label className="sp-field sp-field--wide"><span>Nota técnica</span><input maxLength="500" value={plan.notes} onChange={(event) => setPlan({ ...plan, notes: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'plan'}>Agregar al plan</button></form>}
      </main> : <div className="sp-inventory-empty"><strong>Sin proyectos disponibles.</strong><p>La lista de materiales nace cuando una cotización aceptada se convierte en proyecto.</p></div>}
    </div>}

    {tab === 'stock' && <section className="sp-inventory-stock"><header className="sp-subhead"><div><p className="sp-section-number">EXISTENCIAS</p><h2>Físico, apartado, disponible.</h2></div><label className="sp-field"><span>Buscar material</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, nombre o categoría" /></label></header><div className="sp-stock-list">{visibleItems.map((item) => { const total = totalBalance(item); const low = total.available <= Number(item.reorder_point); return <article className={low ? 'is-low' : ''} key={item.id}><div><span>{CATEGORY[item.category]} · {item.sku}</span><strong>{item.name}</strong><small>Reorden en {number.format(item.reorder_point)} {UNIT[item.unit]}</small></div><dl><div><dt>Físico</dt><dd>{number.format(total.onHand)}</dd></div><div><dt>Apartado</dt><dd>{number.format(total.reserved)}</dd></div><div><dt>Disponible</dt><dd>{number.format(total.available)}</dd></div></dl><b>{low ? 'REORDENAR' : 'DISPONIBLE'}</b></article>; })}{!visibleItems.length && <div className="sp-inventory-empty"><strong>Sin materiales que coincidan.</strong><p>Prueba con otro SKU, nombre o categoría.</p></div>}</div>
      {isAdmin && <div className="sp-stock-admin"><form onSubmit={recordStock}><p className="sp-section-number">MOVIMIENTO FÍSICO</p><h3>Recibir o ajustar.</h3><label className="sp-field"><span>Material</span><select required value={stock.itemId} onChange={(event) => { const item = items.find((row) => row.id === event.target.value); setStock({ ...stock, itemId: event.target.value, unitCost: item?.default_unit_cost_before_vat_mxn ?? '' }); }}><option value="">Selecciona</option>{items.map((item) => <option value={item.id} key={item.id}>{item.sku} · {item.name}</option>)}</select></label><label className="sp-field"><span>Ubicación</span><select required value={stock.locationId} onChange={(event) => setStock({ ...stock, locationId: event.target.value })}>{locations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="sp-field"><span>Tipo</span><select value={stock.type} onChange={(event) => setStock({ ...stock, type: event.target.value })}><option value="receipt">Recepción de compra</option><option value="adjustment_in">Ajuste de entrada</option><option value="adjustment_out">Ajuste de salida</option></select></label><div className="sp-field-pair"><label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={stock.quantity} onChange={(event) => setStock({ ...stock, quantity: event.target.value })} /></label><label className="sp-field"><span>Costo unitario sin IVA</span><input type="number" min="0" step="0.01" value={stock.unitCost} onChange={(event) => setStock({ ...stock, unitCost: event.target.value })} /></label></div><label className="sp-field"><span>Referencia</span><input required={stock.type === 'receipt'} maxLength="160" placeholder="Factura o remisión" value={stock.reference} onChange={(event) => setStock({ ...stock, reference: event.target.value })} /></label><label className="sp-field"><span>Motivo / nota</span><textarea required={stock.type !== 'receipt'} maxLength="500" value={stock.notes} onChange={(event) => setStock({ ...stock, notes: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'stock'}>Registrar movimiento</button></form><form onSubmit={createItem}><p className="sp-section-number">NUEVO SKU</p><h3>Catalogar material.</h3><div className="sp-field-pair"><label className="sp-field"><span>SKU</span><input required maxLength="80" autoCapitalize="characters" value={itemForm.sku} onChange={(event) => setItemForm({ ...itemForm, sku: event.target.value })} /></label><label className="sp-field"><span>Unidad</span><select value={itemForm.unit} onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })}>{Object.entries(UNIT).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label className="sp-field"><span>Nombre</span><input required maxLength="180" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} /></label><label className="sp-field"><span>Categoría</span><select value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })}>{Object.entries(CATEGORY).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="sp-field-pair"><label className="sp-field"><span>Costo sin IVA</span><input type="number" min="0" step="0.01" value={itemForm.unitCost} onChange={(event) => setItemForm({ ...itemForm, unitCost: event.target.value })} /></label><label className="sp-field"><span>Punto de reorden</span><input type="number" min="0" step="0.001" value={itemForm.reorderPoint} onChange={(event) => setItemForm({ ...itemForm, reorderPoint: event.target.value })} /></label></div><label className="sp-field"><span>Notas</span><textarea maxLength="500" value={itemForm.notes} onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'item'}>Crear SKU</button></form></div>}
    </section>}

    {tab === 'movements' && <section className="sp-inventory-movements"><header className="sp-subhead"><div><p className="sp-section-number">LIBRO MAYOR</p><h2>Lo ocurrido no se reescribe.</h2></div><p>Cada renglón conserva saldos antes y después. Los ajustes corrigen mediante un movimiento nuevo.</p></header><div>{movements.map((movement) => <article key={movement.id}><time>{dateTime.format(new Date(movement.created_at))}</time><div><span>{movementLabel(movement.movement_type)} · {movement.solar_inventory_items?.sku}</span><strong>{movement.solar_inventory_items?.name}</strong><small>{movement.solar_projects ? `${movement.solar_projects.folio} · ${movement.solar_projects.customer_name}` : movement.reference || 'Movimiento de almacén'}{movement.notes ? ` · ${movement.notes}` : ''}</small></div><b>{number.format(movement.quantity)} {UNIT[movement.solar_inventory_items?.unit]}</b><dl><div><dt>Físico</dt><dd>{number.format(movement.on_hand_before)} → {number.format(movement.on_hand_after)}</dd></div><div><dt>Apartado</dt><dd>{number.format(movement.reserved_before)} → {number.format(movement.reserved_after)}</dd></div></dl></article>)}{!movements.length && <div className="sp-inventory-empty"><strong>Aún no hay movimientos.</strong><p>La primera recepción iniciará la trazabilidad del almacén.</p></div>}</div></section>}
  </section>;
}
