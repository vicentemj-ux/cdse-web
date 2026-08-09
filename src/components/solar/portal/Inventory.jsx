import { useEffect, useMemo, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import {
  eligibleInventorySerials,
  inventoryAvailability,
  inventoryPortfolioMetrics,
  materialAllocationState,
  movementLabel,
  parseInventorySerials,
  serialPortfolioMetrics,
} from '../../../lib/solar/inventory-control.mjs';

const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const CATEGORY = { module: 'Panel solar', inverter: 'Inversor', mounting: 'Estructura', electrical: 'Material eléctrico', protection: 'Protecciones', monitoring: 'Monitoreo', consumable: 'Consumible', other: 'Otro' };
const UNIT = { piece: 'pza', meter: 'm', kit: 'kit', roll: 'rollo', box: 'caja', liter: 'L', kg: 'kg' };
const STATE = { pending: 'Sin apartar', partial: 'Parcial', ready: 'Listo para entregar', issued: 'Entregado', closed: 'Cerrado', cancelled: 'Cancelado' };
const ACTION = { reserve: 'Apartar', release: 'Liberar', issue: 'Entregar', return: 'Devolver' };
const SERIAL_STATUS = { in_stock: 'En almacén', reserved: 'Apartado', issued: 'En obra', installed: 'Instalado', quarantined: 'En revisión', retired: 'Retirado' };
const ERROR = {
  ADMIN_REQUIRED: 'Esta acción requiere permisos administrativos.', QUANTITY_MUST_BE_POSITIVE: 'La cantidad debe ser mayor que cero.',
  STOCK_BELOW_RESERVED: 'El ajuste dejaría menos existencia que la ya apartada. Libera apartados antes de disminuir.',
  INSUFFICIENT_AVAILABLE_STOCK: 'No hay existencia disponible suficiente para completar ese apartado.',
  RESERVATION_EXCEEDS_PLAN: 'El apartado supera la cantidad todavía pendiente del plan.', RELEASE_EXCEEDS_RESERVATION: 'No puedes liberar más de lo actualmente apartado.',
  ISSUE_REQUIRES_RESERVATION: 'Primero aparta el material; sólo se puede entregar inventario reservado.',
  RETURN_EXCEEDS_NET_ISSUED: 'La devolución supera lo entregado y aún no devuelto.', ALLOCATION_CLOSED: 'Esta partida ya está cerrada o cancelada.',
  WORK_ORDER_PROJECT_MISMATCH: 'La orden de trabajo no pertenece al proyecto seleccionado.', ITEM_IDENTITY_REQUIRED: 'Captura SKU y nombre del material.',
  SERIALS_REQUIRED: 'Captura o selecciona al menos un número de serie.', INVALID_SERIAL_FORMAT: 'Una serie contiene caracteres no permitidos o es demasiado corta.',
  SERIAL_ALREADY_EXISTS: 'Una de esas series ya existe. Búscala antes de volver a registrarla.', SERIALS_EXCEED_PHYSICAL_STOCK: 'Las series exceden la existencia física pendiente de identificar.',
  SERIALIZED_STOCK_REQUIRES_SERIES: 'Este equipo requiere números de serie; usa la recepción serializada.', SERIAL_SELECTION_REQUIRED: 'Selecciona las unidades por número de serie.',
  SERIAL_STATE_MISMATCH: 'Una serie cambió de estado o no permite esta acción. Actualiza y vuelve a seleccionarla.', SERIAL_LOCATION_MISMATCH: 'Una serie pertenece a otra ubicación.',
  SERIAL_ALLOCATION_MISMATCH: 'Una serie está ligada a otra partida.', SERIAL_NOT_ISSUED_TO_PROJECT: 'Sólo pueden instalarse series entregadas a ese proyecto.',
  INSTALLATION_DATE_IN_FUTURE: 'La fecha real de instalación no puede estar en el futuro.', RECEIPT_REFERENCE_REQUIRED: 'Captura la factura o remisión de la recepción.',
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

export default function Inventory({ data, isAdmin, profile, refresh, onOpenProject, openSerialId }) {
  const allocations = data.inventoryAllocations ?? [];
  const items = data.inventoryItems ?? [];
  const locations = data.inventoryLocations ?? [];
  const movements = data.inventoryMovements ?? [];
  const serials = data.inventorySerials ?? [];
  const canConfirmInstallation = isAdmin || ['operations','installer'].includes(profile?.role);
  const activeProjects = useMemo(() => data.projects.filter((item) => item.status !== 'cancelled'), [data.projects]);
  const initialProject = allocations[0]?.project_id ?? activeProjects[0]?.id ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(initialProject);
  const [tab, setTab] = useState('projects');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState({ itemId: '', locationId: locations[0]?.id ?? '', quantity: '', workOrderId: '', notes: '' });
  const [action, setAction] = useState({ allocationId: '', type: 'reserve', quantity: '', serialIds: [], workOrderId: '', reference: '', notes: '' });
  const [stock, setStock] = useState({ itemId: '', locationId: locations[0]?.id ?? '', type: 'receipt', serialMode: 'receive', quantity: '', serialText: '', unitCost: '', reference: '', notes: '' });
  const [itemForm, setItemForm] = useState({ sku: '', name: '', category: 'electrical', unit: 'piece', unitCost: '', reorderPoint: '0', serialTracking: false, notes: '' });
  const [serialFilter, setSerialFilter] = useState('all');
  const [installIds, setInstallIds] = useState([]);
  const [installForm, setInstallForm] = useState({ installedAt: new Date().toISOString().slice(0,10), workOrderId: '', notes: '' });

  const selectedProject = activeProjects.find((item) => item.id === selectedProjectId) ?? activeProjects[0] ?? null;
  const projectAllocations = allocations.filter((item) => item.project_id === selectedProject?.id);
  const projectOrders = data.workOrders.filter((item) => item.project_id === selectedProject?.id && item.status !== 'cancelled');
  const metrics = inventoryPortfolioMetrics(items, allocations);
  const serialMetrics = serialPortfolioMetrics(serials);
  const query = search.trim().toLocaleLowerCase('es-MX');
  const visibleProjects = activeProjects.filter((item) => !query || `${item.folio} ${item.customer_name} ${item.service_number ?? ''}`.toLocaleLowerCase('es-MX').includes(query));
  const visibleItems = items.filter((item) => !query || `${item.sku} ${item.name} ${CATEGORY[item.category] ?? ''}`.toLocaleLowerCase('es-MX').includes(query));
  const visibleSerials = serials.filter((item) => (serialFilter === 'all' || item.status === serialFilter) && (!query || `${item.serial_number} ${item.solar_inventory_items?.sku ?? ''} ${item.solar_inventory_items?.name ?? ''} ${item.solar_projects?.folio ?? ''} ${item.solar_projects?.customer_name ?? ''}`.toLocaleLowerCase('es-MX').includes(query)));
  const actionAllocation = allocations.find((item) => item.id === action.allocationId);
  const actionCandidates = actionAllocation ? eligibleInventorySerials(serials, actionAllocation, action.type) : [];
  const selectedInstallProjectId = serials.find((item) => installIds.includes(item.id))?.project_id ?? '';
  const installCandidates = serials.filter((item) => item.status === 'issued' && (!selectedInstallProjectId || item.project_id === selectedInstallProjectId));
  const installOrders = data.workOrders.filter((item) => item.project_id === selectedInstallProjectId && item.status !== 'cancelled');

  useEffect(() => {
    if (!openSerialId) return;
    const serial = serials.find((item) => item.id === openSerialId);
    if (!serial) return;
    setTab('serials'); setSearch(serial.serial_number); setSerialFilter('all');
  }, [openSerialId, serials]);

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
    await run('item', () => getSupabaseClient().rpc('create_solar_inventory_item', { p_data: itemForm }), 'Material agregado. Registra su primera recepción para hacerlo disponible.', () => setItemForm({ sku: '', name: '', category: 'electrical', unit: 'piece', unitCost: '', reorderPoint: '0', serialTracking: false, notes: '' }));
  }

  async function recordStock(event) {
    event.preventDefault();
    const item = items.find((row) => row.id === stock.itemId);
    if (item?.serial_tracking) {
      const parsed = parseInventorySerials(stock.serialText);
      if (parsed.invalid.length) return setError(`Revisa estas series: ${parsed.invalid.join(', ')}.`);
      if (parsed.duplicates.length) return setError(`Elimina series repetidas de la captura: ${parsed.duplicates.join(', ')}.`);
      if (!parsed.serials.length) return setError('Captura al menos una serie, separada por línea, coma o punto y coma.');
      const rpc = stock.serialMode === 'identify' ? 'identify_solar_inventory_serials' : 'receive_solar_serialized_stock';
      const args = stock.serialMode === 'identify'
        ? { p_item_id: stock.itemId, p_location_id: stock.locationId, p_serial_numbers: parsed.serials, p_reference: stock.reference || null, p_notes: stock.notes || null }
        : { p_item_id: stock.itemId, p_location_id: stock.locationId, p_serial_numbers: parsed.serials, p_unit_cost_before_vat_mxn: stock.unitCost ? Number(stock.unitCost) : null, p_reference: stock.reference, p_notes: stock.notes || null };
      return run('stock', () => getSupabaseClient().rpc(rpc, args), stock.serialMode === 'identify' ? `${parsed.serials.length} series conciliadas con existencia previa.` : `${parsed.serials.length} equipos recibidos con cadena de custodia iniciada.`, () => setStock((current) => ({ ...current, serialText: '', reference: '', notes: '' })));
    }
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
    const item = items.find((row) => row.id === actionAllocation?.item_id);
    const serialized = item?.serial_tracking;
    if (serialized && !action.serialIds.length) return setError('Selecciona al menos una serie para continuar.');
    const rpc = serialized ? 'move_solar_project_serials' : 'move_solar_project_material';
    const args = serialized
      ? { p_allocation_id: action.allocationId, p_action: action.type, p_serial_ids: action.serialIds, p_work_order_id: action.workOrderId || null, p_reference: action.reference || null, p_notes: action.notes || null }
      : { p_allocation_id: action.allocationId, p_action: action.type, p_quantity: Number(action.quantity), p_work_order_id: action.workOrderId || null, p_reference: action.reference || null, p_notes: action.notes || null };
    await run('action', () => getSupabaseClient().rpc(rpc, args), `${ACTION[action.type]} registrado. El saldo y la trazabilidad unitaria ya fueron actualizados.`, () => setAction({ allocationId: '', type: 'reserve', quantity: '', serialIds: [], workOrderId: '', reference: '', notes: '' }));
  }

  function beginAction(allocation, type) {
    const state = materialAllocationState(allocation);
    const maximum = type === 'reserve' ? state.uncovered : type === 'return' ? state.netIssued : state.reserved;
    const item = items.find((row) => row.id === allocation.item_id);
    const candidates = eligibleInventorySerials(serials, allocation, type);
    setAction({ allocationId: allocation.id, type, quantity: maximum > 0 ? String(maximum) : '', serialIds: item?.serial_tracking ? candidates.slice(0, Math.max(0, Math.floor(maximum))).map((serial) => serial.id) : [], workOrderId: allocation.work_order_id ?? '', reference: '', notes: '' });
    setError(''); setMessage('');
  }

  async function installSerials(event) {
    event.preventDefault();
    if (!installIds.length || !selectedInstallProjectId) return setError('Selecciona equipos entregados de un mismo proyecto.');
    await run('install', () => getSupabaseClient().rpc('install_solar_project_serials', {
      p_project_id: selectedInstallProjectId, p_serial_ids: installIds, p_work_order_id: installForm.workOrderId || null,
      p_installed_at: installForm.installedAt, p_notes: installForm.notes || null,
    }), `${installIds.length} equipos enlazados al activo instalado y a Postventa.`, () => { setInstallIds([]); setInstallForm((current) => ({ ...current, workOrderId: '', notes: '' })); });
  }

  return <section className="sp-view sp-inventory">
    <header className="sp-view-header"><div><p className="sp-section-number">ALMACÉN / TRAZABILIDAD</p><h1>Cada pieza tiene destino.</h1></div><p className="sp-header-note">Existencia física, material apartado y entrega a obra permanecen separados para evitar prometer lo que no está disponible.</p></header>
    <div className="sp-ledger sp-inventory-ledger"><div><span>Valor físico</span><strong>{isAdmin ? money.format(metrics.stockValue) : items.length}</strong><small>{isAdmin ? 'antes de IVA · costo catálogo' : 'SKUs visibles'}</small></div><div><span>Puntos de reorden</span><strong>{metrics.lowStockCount}</strong><small>sin margen disponible</small></div><div><span>Proyectos con faltante</span><strong>{metrics.shortageProjectCount}</strong><small>{metrics.shortageAllocationCount} partidas abiertas</small></div><div><span>Proyectos listos</span><strong>{metrics.readyProjectCount}</strong><small>todas sus partidas apartadas</small></div></div>
    <div className="sp-install-tabs" role="tablist" aria-label="Áreas de inventario">{[['projects','Material por proyecto'],['stock','Existencias'],['serials','Números de serie'],['movements','Libro mayor']].map(([id,label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)} key={id}>{label}</button>)}</div>
    {message && <p className="sp-inline-notice" role="status" aria-live="polite">{message}</p>}{error && <p className="sp-form-error" role="alert">{error}</p>}

    {tab === 'projects' && <div className="sp-inventory-shell">
      <aside className="sp-inventory-index"><label className="sp-field"><span>Buscar proyecto</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, folio o servicio" /></label><div>{visibleProjects.map((project) => { const rows = allocations.filter((item) => item.project_id === project.id); const shortage = rows.filter((item) => materialAllocationState(item).uncovered > 0).length; return <button type="button" className={selectedProject?.id === project.id ? 'is-active' : ''} onClick={() => setSelectedProjectId(project.id)} key={project.id}><span>{project.folio}</span><strong>{project.customer_name}</strong><small>{rows.length ? shortage ? `${shortage} partida${shortage === 1 ? '' : 's'} por cubrir` : 'Material completamente cubierto' : 'Sin lista de materiales'}</small></button>; })}{!visibleProjects.length && <p>No hay proyectos que coincidan.</p>}</div></aside>
      {selectedProject ? <main className="sp-inventory-project"><header><div><p className="sp-section-number">{selectedProject.folio}</p><h2>{selectedProject.customer_name}</h2><p>{projectAllocations.length} partida{projectAllocations.length === 1 ? '' : 's'} · {projectOrders.length} orden{projectOrders.length === 1 ? '' : 'es'} de trabajo</p></div><button type="button" className="sp-text-button" onClick={() => onOpenProject(selectedProject.id)}>Abrir expediente →</button></header>
        <div className="sp-material-list">{projectAllocations.map((allocation) => { const state = materialAllocationState(allocation); const item = items.find((row) => row.id === allocation.item_id) ?? allocation.solar_inventory_items; const tracked = serials.filter((serial) => serial.allocation_id === allocation.id && ['reserved','issued','installed'].includes(serial.status)).length; return <article key={allocation.id} className={`is-${state.state}`}><div className="sp-material-name"><span>{CATEGORY[item?.category] ?? 'Material'} · {item?.sku}</span><strong>{item?.name ?? 'Material sin catálogo'}</strong><small>{allocation.solar_inventory_locations?.name ?? locations.find((row) => row.id === allocation.location_id)?.name} · origen {allocation.source.replaceAll('_',' ')}{item?.serial_tracking ? ` · ${tracked} series ligadas` : ''}</small></div><div className="sp-material-numbers"><div><span>Planeado</span><b>{number.format(state.planned)}</b></div><div><span>Apartado</span><b>{number.format(state.reserved)}</b></div><div><span>Entregado neto</span><b>{number.format(state.netIssued)}</b></div><div className={state.uncovered ? 'is-short' : 'is-covered'}><span>Por cubrir</span><b>{number.format(state.uncovered)}</b></div></div><div className="sp-material-progress"><i><b style={{ width: `${state.progress * 100}%` }} /></i><span>{STATE[allocation.status] ?? STATE[state.state]}</span></div>{isAdmin && <div className="sp-material-actions">{state.uncovered > 0 && <button type="button" onClick={() => beginAction(allocation,'reserve')}>Apartar</button>}{state.reserved > 0 && <><button type="button" className="is-primary" onClick={() => beginAction(allocation,'issue')}>Entregar</button><button type="button" onClick={() => beginAction(allocation,'release')}>Liberar</button></>}{state.netIssued > 0 && <button type="button" onClick={() => beginAction(allocation,'return')}>Devolver</button>}</div>}</article>; })}{!projectAllocations.length && <div className="sp-inventory-empty"><strong>El proyecto aún no tiene materiales.</strong><p>Los paneles e inversores se agregan desde el alcance aceptado. Puedes completar estructura, protecciones, cableado y consumibles desde el plan.</p></div>}</div>
        {isAdmin && action.allocationId && <form className="sp-inventory-action" onSubmit={moveMaterial}><div><p className="sp-section-number">{ACTION[action.type].toUpperCase()}</p><strong>{items.find((row) => row.id === actionAllocation?.item_id)?.name ?? actionAllocation?.solar_inventory_items?.name}</strong></div>{items.find((row) => row.id === actionAllocation?.item_id)?.serial_tracking ? <fieldset className="sp-serial-picker"><legend>Unidades por serie · {action.serialIds.length} seleccionadas</legend>{actionCandidates.map((serial) => <label key={serial.id}><input type="checkbox" checked={action.serialIds.includes(serial.id)} onChange={() => setAction((current) => ({ ...current, serialIds: current.serialIds.includes(serial.id) ? current.serialIds.filter((id) => id !== serial.id) : [...current.serialIds, serial.id] }))} /><span><b>{serial.serial_number}</b><small>{SERIAL_STATUS[serial.status]}</small></span></label>)}{!actionCandidates.length && <p>No hay series compatibles. Revisa recepción, ubicación y estado.</p>}</fieldset> : <label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={action.quantity} onChange={(event) => setAction({ ...action, quantity: event.target.value })} /></label>}<label className="sp-field"><span>Orden de trabajo</span><select value={action.workOrderId} onChange={(event) => setAction({ ...action, workOrderId: event.target.value })}><option value="">Sin orden específica</option>{projectOrders.map((order) => <option value={order.id} key={order.id}>{order.folio} · {order.status}</option>)}</select></label><label className="sp-field"><span>Referencia</span><input maxLength="160" placeholder="Factura, vale o remisión" value={action.reference} onChange={(event) => setAction({ ...action, reference: event.target.value })} /></label><label className="sp-field sp-field--wide"><span>Nota</span><input maxLength="500" value={action.notes} onChange={(event) => setAction({ ...action, notes: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'action'}>{busy === 'action' ? 'Actualizando saldo…' : `Confirmar ${ACTION[action.type].toLocaleLowerCase('es-MX')}`}</button><button type="button" className="sp-text-button" onClick={() => setAction({ allocationId: '', type: 'reserve', quantity: '', serialIds: [], workOrderId: '', reference: '', notes: '' })}>Cancelar</button></form>}
        {isAdmin && <form className="sp-inventory-plan" onSubmit={planMaterial}><div><p className="sp-section-number">AMPLIAR LISTA</p><h3>Agregar material planeado.</h3><p>No aparta existencias hasta que lo confirmes en la partida.</p></div><label className="sp-field"><span>Material</span><select required value={plan.itemId} onChange={(event) => setPlan({ ...plan, itemId: event.target.value })}><option value="">Selecciona</option>{items.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.sku} · {item.name}</option>)}</select></label><label className="sp-field"><span>Ubicación</span><select required value={plan.locationId} onChange={(event) => setPlan({ ...plan, locationId: event.target.value })}>{locations.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={plan.quantity} onChange={(event) => setPlan({ ...plan, quantity: event.target.value })} /></label><label className="sp-field"><span>Orden opcional</span><select value={plan.workOrderId} onChange={(event) => setPlan({ ...plan, workOrderId: event.target.value })}><option value="">Sin asignar</option>{projectOrders.map((order) => <option value={order.id} key={order.id}>{order.folio}</option>)}</select></label><label className="sp-field sp-field--wide"><span>Nota técnica</span><input maxLength="500" value={plan.notes} onChange={(event) => setPlan({ ...plan, notes: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'plan'}>Agregar al plan</button></form>}
      </main> : <div className="sp-inventory-empty"><strong>Sin proyectos disponibles.</strong><p>La lista de materiales nace cuando una cotización aceptada se convierte en proyecto.</p></div>}
    </div>}

    {tab === 'stock' && <section className="sp-inventory-stock"><header className="sp-subhead"><div><p className="sp-section-number">EXISTENCIAS</p><h2>Físico, apartado, disponible.</h2></div><label className="sp-field"><span>Buscar material</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, nombre o categoría" /></label></header><div className="sp-stock-list">{visibleItems.map((item) => { const total = totalBalance(item); const low = total.available <= Number(item.reorder_point); return <article className={low ? 'is-low' : ''} key={item.id}><div><span>{CATEGORY[item.category]} · {item.sku}</span><strong>{item.name}</strong><small>Reorden en {number.format(item.reorder_point)} {UNIT[item.unit]}</small></div><dl><div><dt>Físico</dt><dd>{number.format(total.onHand)}</dd></div><div><dt>Apartado</dt><dd>{number.format(total.reserved)}</dd></div><div><dt>Disponible</dt><dd>{number.format(total.available)}</dd></div></dl><b>{low ? 'REORDENAR' : 'DISPONIBLE'}</b></article>; })}{!visibleItems.length && <div className="sp-inventory-empty"><strong>Sin materiales que coincidan.</strong><p>Prueba con otro SKU, nombre o categoría.</p></div>}</div>
      {isAdmin && <div className="sp-stock-admin">
        <form onSubmit={recordStock}><p className="sp-section-number">MOVIMIENTO FÍSICO</p><h3>Recibir o ajustar.</h3>
          <label className="sp-field"><span>Material</span><select required value={stock.itemId} onChange={(event) => { const item = items.find((row) => row.id === event.target.value); setStock({ ...stock, itemId: event.target.value, unitCost: item?.default_unit_cost_before_vat_mxn ?? '', type: 'receipt', serialMode: 'receive', serialText: '' }); }}><option value="">Selecciona</option>{items.map((item) => <option value={item.id} key={item.id}>{item.sku} · {item.name}{item.serial_tracking ? ' · series' : ''}</option>)}</select></label>
          <label className="sp-field"><span>Ubicación</span><select required value={stock.locationId} onChange={(event) => setStock({ ...stock, locationId: event.target.value })}>{locations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          {items.find((item) => item.id === stock.itemId)?.serial_tracking ? <>
            <label className="sp-field"><span>Operación serializada</span><select value={stock.serialMode} onChange={(event) => setStock({ ...stock, serialMode: event.target.value })}><option value="receive">Recibir compra nueva</option><option value="identify">Identificar existencia anterior</option></select></label>
            <label className="sp-field"><span>Números de serie</span><textarea required rows="7" value={stock.serialText} onChange={(event) => setStock({ ...stock, serialText: event.target.value })} placeholder={'Una serie por línea\nGRW-MIN6000-0001\nMOD-550-0002'} /><small>{parseInventorySerials(stock.serialText).serials.length} unidades únicas reconocidas</small></label>
            <label className="sp-field"><span>Costo unitario sin IVA</span><input type="number" min="0" step="0.01" disabled={stock.serialMode === 'identify'} value={stock.unitCost} onChange={(event) => setStock({ ...stock, unitCost: event.target.value })} /></label>
          </> : <><label className="sp-field"><span>Tipo</span><select value={stock.type} onChange={(event) => setStock({ ...stock, type: event.target.value })}><option value="receipt">Recepción de compra</option><option value="adjustment_in">Ajuste de entrada</option><option value="adjustment_out">Ajuste de salida</option></select></label><div className="sp-field-pair"><label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={stock.quantity} onChange={(event) => setStock({ ...stock, quantity: event.target.value })} /></label><label className="sp-field"><span>Costo unitario sin IVA</span><input type="number" min="0" step="0.01" value={stock.unitCost} onChange={(event) => setStock({ ...stock, unitCost: event.target.value })} /></label></div></>}
          <label className="sp-field"><span>Referencia</span><input required={stock.type === 'receipt' && stock.serialMode !== 'identify'} maxLength="160" placeholder="Factura o remisión" value={stock.reference} onChange={(event) => setStock({ ...stock, reference: event.target.value })} /></label><label className="sp-field"><span>Motivo / nota</span><textarea required={!items.find((item) => item.id === stock.itemId)?.serial_tracking && stock.type !== 'receipt'} maxLength="500" value={stock.notes} onChange={(event) => setStock({ ...stock, notes: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'stock'}>{busy === 'stock' ? 'Registrando…' : 'Registrar movimiento'}</button>
        </form>
        <form onSubmit={createItem}><p className="sp-section-number">NUEVO SKU</p><h3>Catalogar material.</h3><div className="sp-field-pair"><label className="sp-field"><span>SKU</span><input required maxLength="80" autoCapitalize="characters" value={itemForm.sku} onChange={(event) => setItemForm({ ...itemForm, sku: event.target.value })} /></label><label className="sp-field"><span>Unidad</span><select value={itemForm.unit} onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })}>{Object.entries(UNIT).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label className="sp-field"><span>Nombre</span><input required maxLength="180" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} /></label><label className="sp-field"><span>Categoría</span><select value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value, serialTracking: ['module','inverter'].includes(event.target.value) ? true : itemForm.serialTracking })}>{Object.entries(CATEGORY).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="sp-field-pair"><label className="sp-field"><span>Costo sin IVA</span><input type="number" min="0" step="0.01" value={itemForm.unitCost} onChange={(event) => setItemForm({ ...itemForm, unitCost: event.target.value })} /></label><label className="sp-field"><span>Punto de reorden</span><input type="number" min="0" step="0.001" value={itemForm.reorderPoint} onChange={(event) => setItemForm({ ...itemForm, reorderPoint: event.target.value })} /></label></div><label className="sp-check-row"><input type="checkbox" checked={itemForm.serialTracking || ['module','inverter'].includes(itemForm.category)} disabled={['module','inverter'].includes(itemForm.category)} onChange={(event) => setItemForm({ ...itemForm, serialTracking: event.target.checked })} /><span><strong>Control unitario por serie</strong><small>Obligatorio para paneles e inversores; opcional para monitoreo y protecciones.</small></span></label><label className="sp-field"><span>Notas</span><textarea maxLength="500" value={itemForm.notes} onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'item'}>Crear SKU</button></form>
      </div>}
    </section>}

    {tab === 'serials' && <section className="sp-serials-view">
      <header className="sp-subhead"><div><p className="sp-section-number">CADENA DE CUSTODIA</p><h2>Una identidad, todo el recorrido.</h2><p>La serie conecta factura, almacén, proyecto, orden de trabajo y activo de Postventa.</p></div><label className="sp-field"><span>Buscar serie o proyecto</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Serie, SKU, folio o cliente" /></label></header>
      <div className="sp-serial-ledger"><div><span>Identificadas</span><strong>{serialMetrics.total}</strong></div><div><span>En almacén</span><strong>{serialMetrics.inStock}</strong></div><div><span>Apartadas</span><strong>{serialMetrics.reserved}</strong></div><div><span>En obra</span><strong>{serialMetrics.issued}</strong></div><div><span>Instaladas</span><strong>{serialMetrics.installed}</strong></div><div className={serialMetrics.exceptions ? 'is-alert' : ''}><span>Excepciones</span><strong>{serialMetrics.exceptions}</strong></div></div>
      <div className="sp-serial-filter" role="group" aria-label="Filtrar números de serie">{[['all','Todas'],...Object.entries(SERIAL_STATUS)].map(([value,label]) => <button type="button" className={serialFilter === value ? 'is-active' : ''} onClick={() => setSerialFilter(value)} key={value}>{label}</button>)}</div>
      {canConfirmInstallation && installCandidates.length > 0 && <form className="sp-serial-install" onSubmit={installSerials}><div><p className="sp-section-number">CIERRE DE INSTALACIÓN</p><h3>Convertir salida en activo instalado.</h3><p>Selecciona sólo equipos colocados físicamente. Al confirmar aparecerán en Postventa.</p></div><div className="sp-serial-picker sp-serial-picker--install">{installCandidates.map((serial) => <label key={serial.id}><input type="checkbox" checked={installIds.includes(serial.id)} disabled={Boolean(selectedInstallProjectId && serial.project_id !== selectedInstallProjectId)} onChange={() => setInstallIds((current) => current.includes(serial.id) ? current.filter((id) => id !== serial.id) : [...current, serial.id])} /><span><b>{serial.serial_number}</b><small>{serial.solar_projects?.folio} · {serial.solar_inventory_items?.sku}</small></span></label>)}</div><label className="sp-field"><span>Fecha real</span><input type="date" max={new Date().toISOString().slice(0,10)} required value={installForm.installedAt} onChange={(event) => setInstallForm({ ...installForm, installedAt: event.target.value })} /></label><label className="sp-field"><span>Orden de trabajo</span><select value={installForm.workOrderId} onChange={(event) => setInstallForm({ ...installForm, workOrderId: event.target.value })}><option value="">Sin orden específica</option>{installOrders.map((order) => <option value={order.id} key={order.id}>{order.folio}</option>)}</select></label><label className="sp-field sp-field--wide"><span>Nota de instalación</span><input maxLength="500" value={installForm.notes} onChange={(event) => setInstallForm({ ...installForm, notes: event.target.value })} placeholder="Ubicación, string, observación o evidencia relacionada" /></label><button className="sp-button sp-button--primary" disabled={busy === 'install' || !installIds.length}>{busy === 'install' ? 'Enlazando activos…' : `Registrar ${installIds.length || ''} instalada${installIds.length === 1 ? '' : 's'}`}</button></form>}
      <div className="sp-serial-list">{visibleSerials.map((serial) => <article className={`is-${serial.status}`} key={serial.id}><div className="sp-serial-code"><span>{SERIAL_STATUS[serial.status]}</span><strong>{serial.serial_number}</strong><small>{serial.solar_inventory_items?.sku} · {serial.solar_inventory_items?.name}</small></div><div className="sp-serial-route"><span>{serial.solar_inventory_locations?.name ?? 'Origen documentado'}</span><b aria-hidden="true">→</b><span>{serial.solar_projects ? `${serial.solar_projects.folio} · ${serial.solar_projects.customer_name}` : serial.status === 'in_stock' ? 'Disponible para proyecto' : 'Sin proyecto'}</span><b aria-hidden="true">→</b><span>{serial.status === 'installed' ? `${serial.solar_assets?.manufacturer ?? ''} ${serial.solar_assets?.model ?? 'Activo instalado'}`.trim() : serial.status === 'issued' ? 'Pendiente de confirmar instalación' : 'Postventa pendiente'}</span></div><footer><span>{serial.received_reference || 'Existencia conciliada'} · {dateTime.format(new Date(serial.received_at))}</span>{serial.solar_work_orders?.folio && <b>{serial.solar_work_orders.folio}</b>}</footer></article>)}{!visibleSerials.length && <div className="sp-inventory-empty"><strong>No hay series en esta vista.</strong><p>Recibe paneles o inversores con sus identificadores, o cambia el filtro para consultar otro estado.</p></div>}</div>
    </section>}

    {tab === 'movements' && <section className="sp-inventory-movements"><header className="sp-subhead"><div><p className="sp-section-number">LIBRO MAYOR</p><h2>Lo ocurrido no se reescribe.</h2></div><p>Cada renglón conserva saldos antes y después. Los ajustes corrigen mediante un movimiento nuevo.</p></header><div>{movements.map((movement) => <article key={movement.id}><time>{dateTime.format(new Date(movement.created_at))}</time><div><span>{movementLabel(movement.movement_type)} · {movement.solar_inventory_items?.sku}</span><strong>{movement.solar_inventory_items?.name}</strong><small>{movement.solar_projects ? `${movement.solar_projects.folio} · ${movement.solar_projects.customer_name}` : movement.reference || 'Movimiento de almacén'}{movement.notes ? ` · ${movement.notes}` : ''}</small></div><b>{number.format(movement.quantity)} {UNIT[movement.solar_inventory_items?.unit]}</b><dl><div><dt>Físico</dt><dd>{number.format(movement.on_hand_before)} → {number.format(movement.on_hand_after)}</dd></div><div><dt>Apartado</dt><dd>{number.format(movement.reserved_before)} → {number.format(movement.reserved_after)}</dd></div></dl></article>)}{!movements.length && <div className="sp-inventory-empty"><strong>Aún no hay movimientos.</strong><p>La primera recepción iniciará la trazabilidad del almacén.</p></div>}</div></section>}
  </section>;
}
