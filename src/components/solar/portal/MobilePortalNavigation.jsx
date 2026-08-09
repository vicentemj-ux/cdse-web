import { useMemo, useState } from 'react';

const GROUPS = [
  ['home', 'Inicio', ['overview']],
  ['sales', 'Ventas', ['new', 'quotes', 'leads', 'catalog']],
  ['projects', 'Proyectos', ['projects', 'agenda']],
  ['operations', 'Operación', ['installations', 'inventory', 'cfe', 'post-sales']],
  ['more', 'Más', ['finance', 'team']],
];

export default function MobilePortalNavigation({ navigation, activeView, onNavigate, onSearch, onLogout }) {
  const [openGroup, setOpenGroup] = useState('');
  const labelMap = useMemo(() => new Map(navigation), [navigation]);
  const groups = GROUPS.map(([id, label, ids]) => [id, label, ids.filter((item) => labelMap.has(item))])
    .filter(([id, , ids]) => ids.length || id === 'more');
  const selected = groups.find(([id]) => id === openGroup);

  function selectGroup(id, ids) {
    if (ids.length === 1 && id !== 'more') { onNavigate(ids[0]); setOpenGroup(''); return; }
    setOpenGroup((current) => current === id ? '' : id);
  }

  return <>
    {selected && <div className="sp-mobile-nav-sheet" role="navigation" aria-label={`${selected[1]}: módulos`}>
      <div><span>{selected[1]}</span><button type="button" onClick={() => setOpenGroup('')} aria-label="Cerrar menú">×</button></div>
      {selected[2].map((id) => <button type="button" className={activeView === id ? 'is-active' : ''} onClick={() => { onNavigate(id); setOpenGroup(''); }} key={id}><span>{labelMap.get(id)}</span><b aria-hidden="true">→</b></button>)}
      {selected[0] === 'more' && <><button type="button" onClick={() => { onSearch(); setOpenGroup(''); }}><span>Buscar en todo el portal</span><b aria-hidden="true">⌕</b></button><button type="button" onClick={onLogout}><span>Cerrar sesión</span><b aria-hidden="true">↗</b></button></>}
    </div>}
    <nav className="sp-mobile-nav" aria-label="Áreas del portal">
      {groups.map(([id, label, ids], index) => <button type="button" className={ids.includes(activeView) || openGroup === id ? 'is-active' : ''} aria-expanded={openGroup === id} onClick={() => selectGroup(id, ids)} key={id}><span>{String(index + 1).padStart(2, '0')}</span>{label}</button>)}
    </nav>
  </>;
}

