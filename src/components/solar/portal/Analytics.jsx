import { useMemo, useState } from 'react';

import { buildExecutiveAnalytics } from '../../../lib/solar/executive-analytics.mjs';

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

function currentPeriod() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { from: `${today.getFullYear()}-01-01`, to: local };
}

function daysLabel(value) {
  if (value === null) return 'Sin muestra';
  if (value < 1) return '< 1 día';
  return `${number.format(value)} ${Math.round(value * 10) === 10 ? 'día' : 'días'}`;
}

export default function Analytics({ data, isAdmin, profile, onOpenProject }) {
  const initial = currentPeriod();
  const [filters, setFilters] = useState({ ...initial, seller: isAdmin ? 'all' : profile.user_id });
  const report = useMemo(() => buildExecutiveAnalytics(data, filters), [data, filters]);
  const activeSellers = data.profiles.filter((item) => item.active !== false && ['admin', 'seller'].includes(item.role));
  const maxFunnel = Math.max(report.funnel[0]?.count ?? 0, 1);

  return (
    <section className="sp-view sp-analytics">
      <header className="sp-view-header sp-analytics-header">
        <div>
          <p className="sp-section-number">DIRECCIÓN / DESEMPEÑO</p>
          <h1>Del lead al kilowatt.</h1>
          <p className="sp-analytics-intro">Conversión, velocidad operativa y utilidad real con trazabilidad hasta el expediente de origen.</p>
        </div>
        <div className="sp-analytics-scope" aria-label="Periodo del reporte">
          <label><span>Desde</span><input type="date" value={filters.from} max={filters.to} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
          <label><span>Hasta</span><input type="date" value={filters.to} min={filters.from} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
          {isAdmin && <label><span>Vendedor</span><select value={filters.seller} onChange={(event) => setFilters((current) => ({ ...current, seller: event.target.value }))}><option value="all">Todo el equipo</option>{activeSellers.map((item) => <option value={item.user_id} key={item.user_id}>{item.full_name}</option>)}</select></label>}
        </div>
      </header>

      <div className="sp-analytics-ledger" aria-label="Resultado financiero del periodo">
        <div><span>Venta antes de IVA</span><strong>{money.format(report.financial.revenueBeforeVat)}</strong><small>{report.financial.projectCount} proyectos aceptados</small></div>
        <div><span>Costo real pagado</span><strong>{money.format(report.financial.actualCost)}</strong><small>sin IVA · comprobado</small></div>
        <div><span>Margen real</span><strong>{money.format(report.financial.actualMargin)}</strong><small>{number.format(report.financial.marginPercent)}% de la venta antes de IVA</small></div>
        <div><span>Comisión comprometida</span><strong>{money.format(report.financial.commissionNet)}</strong><small>{money.format(report.financial.commissionPaid)} ya pagados</small></div>
      </div>

      <div className="sp-analytics-grid">
        <section className="sp-analytics-panel sp-analytics-funnel">
          <header><div><p className="sp-section-number">01 / CONVERSIÓN</p><h2>Cohorte comercial</h2></div><p>El periodo selecciona la fecha de entrada del lead. Cada escalón conserva a esa misma cohorte.</p></header>
          <div className="sp-funnel-plot">
            {report.funnel.map((item, index) => (
              <div className="sp-funnel-step" key={item.id}>
                <div className="sp-funnel-label"><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong><b>{item.count}</b><small>{number.format(item.rate)}%</small></div>
                <div className="sp-funnel-track" aria-label={`${item.label}: ${item.count}, ${number.format(item.rate)} por ciento`}><i style={{ width: `${Math.max(item.count / maxFunnel * 100, item.count ? 4 : 0)}%` }} /></div>
              </div>
            ))}
          </div>
          {!report.meta.cohortSize && <p className="sp-analytics-empty">No hay leads en este periodo. Amplía las fechas para reconstruir una cohorte.</p>}
        </section>

        <section className="sp-analytics-panel sp-cycle-panel">
          <header><div><p className="sp-section-number">02 / VELOCIDAD</p><h2>Tiempo entre hitos</h2></div><p>Mediana en días; la muestra sólo cuenta expedientes que tienen ambos hitos documentados.</p></header>
          <ol className="sp-cycle-line">
            {report.cycles.map((item, index) => <li key={item.label}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.label}</strong><small>{item.sample ? `${item.sample} ${item.sample === 1 ? 'expediente' : 'expedientes'} con evidencia` : 'Aún no hay dos fechas comparables'}</small></div><b>{daysLabel(item.days)}</b></li>)}
          </ol>
        </section>
      </div>

      <section className="sp-analytics-panel sp-exception-panel">
        <header><div><p className="sp-section-number">03 / CONTROL DE EXCEPCIONES</p><h2>Lo que necesita intervención hoy</h2></div><p>Esta lista no cambia con el periodo: refleja atrasos activos del vendedor seleccionado.</p></header>
        <div className="sp-exception-summary"><strong>{report.exceptions.length}</strong><span>{report.exceptions.length === 1 ? 'señal operativa abierta' : 'señales operativas abiertas'}</span></div>
        <div className="sp-exception-list">
          {report.exceptions.slice(0, 10).map((item) => <button type="button" onClick={() => onOpenProject(item.projectId)} key={item.id}><span className={`sp-exception-mark is-${item.severity}`} /><div><small>{item.type} · {item.folio ?? 'Proyecto'}</small><strong>{item.title}</strong></div><b>{item.ageDays === null ? 'Revisar' : `${Math.max(Math.floor(item.ageDays), 0)} d`}</b><i aria-hidden="true">→</i></button>)}
          {!report.exceptions.length && <div className="sp-analytics-empty sp-analytics-empty--good"><strong>Operación sin alertas activas.</strong><span>No hay tareas vencidas, proyectos comprometidos, instalaciones fuera de ventana ni esperas CFE abiertas.</span></div>}
        </div>
      </section>

      <section className="sp-analytics-panel sp-seller-panel">
        <header><div><p className="sp-section-number">04 / DESEMPEÑO COMERCIAL</p><h2>{isAdmin ? 'Lectura por vendedor' : 'Mi desempeño'}</h2></div><p>Conversión de cotizaciones creadas en el periodo a ventas de esa misma muestra. Importes antes de IVA.</p></header>
        <div className="sp-table-wrap"><table><thead><tr><th>Vendedor</th><th>Cotizaciones</th><th>Ventas de cohorte</th><th>Conversión</th><th>Venta aceptada</th><th>Margen real</th><th>Comisión</th></tr></thead><tbody>{report.sellers.map((seller) => <tr key={seller.id}><td><strong>{seller.name}</strong></td><td>{seller.quotes}</td><td>{seller.cohortSales}</td><td>{number.format(seller.conversion)}%</td><td>{money.format(seller.revenue)}</td><td>{money.format(seller.margin)}</td><td>{money.format(seller.commission)}</td></tr>)}{!report.sellers.length && <tr><td colSpan="7">No hay vendedores o movimientos para mostrar en el periodo.</td></tr>}</tbody></table></div>
      </section>

      <footer className="sp-analytics-note"><strong>Cómo leer este tablero</strong><p>“Margen real” descuenta costos marcados como pagados y comisión efectivamente pagada; puede verse alto mientras falten costos por conciliar. “Comisión comprometida” muestra la obligación neta registrada. Los porcentajes no son metas: describen únicamente los expedientes disponibles.</p></footer>
    </section>
  );
}
