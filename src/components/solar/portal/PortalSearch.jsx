import { useEffect, useMemo, useRef, useState } from 'react';

import { buildPortalSearchIndex, searchPortalIndex } from '../../../lib/solar/portal-search.mjs';

const TYPE_LABEL = { project: 'Proyecto', quote: 'Cotización', cfe: 'CFE', asset: 'Equipo instalado', serial: 'Serie de inventario', lead: 'Lead', receipt: 'Recibo' };

export default function PortalSearch({ data, navigation, open, setOpen, onNavigate }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const allowedViews = useMemo(() => new Set(navigation.map(([id]) => id)), [navigation]);
  const index = useMemo(() => buildPortalSearchIndex(data).filter((item) => allowedViews.has(item.view)), [data, allowedViews]);
  const results = useMemo(() => searchPortalIndex(index, query), [index, query]);

  useEffect(() => {
    function handleShortcut(event) {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k')) {
        event.preventDefault(); setOpen(true);
      }
      if (event.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  function choose(result) {
    onNavigate(result);
    setQuery('');
    setOpen(false);
  }

  if (!open) return null;
  return <div className="sp-search-layer" role="dialog" aria-modal="true" aria-label="Buscar en CDSE Solar" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
    <section className="sp-command-search">
      <header><div><p className="sp-section-number">BÚSQUEDA TRANSVERSAL</p><h2>Encuentra cualquier expediente.</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar búsqueda">Cerrar</button></header>
      <label className="sp-command-input"><span aria-hidden="true">⌕</span><input ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, teléfono, folio, servicio o serie…" aria-describedby="portal-search-help" autoComplete="off" /><kbd>Esc</kbd></label>
      <p id="portal-search-help">Busca en la información que tu función tiene autorizada. Escribe al menos dos caracteres.</p>
      <div className="sp-command-results" aria-live="polite">
        {results.map((result) => <button type="button" key={`${result.type}-${result.id}`} onClick={() => choose(result)}>
          <span>{TYPE_LABEL[result.type] ?? result.type}</span>
          <div><strong>{result.title}</strong><small>{result.subtitle}</small></div>
          <b aria-hidden="true">→</b>
        </button>)}
        {query.trim().length >= 2 && !results.length && <div className="sp-command-empty"><strong>Sin coincidencias</strong><p>Revisa el folio o intenta con el nombre, teléfono, servicio CFE o número de serie.</p></div>}
        {query.trim().length < 2 && <div className="sp-command-guide"><span>Busca por</span><p>CDSE-P-000021 · CFE-AHO-8891 · 538910105451 · GRW-9X77</p></div>}
      </div>
    </section>
  </div>;
}
