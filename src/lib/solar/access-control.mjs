export const STAFF_ROLES = {
  admin: { label: 'Administrador', projectRole: null, description: 'Control total, usuarios, catálogo, autorizaciones y auditoría.' },
  seller: { label: 'Ventas', projectRole: 'seller', description: 'Leads, cotizaciones, seguimiento comercial y comisión propia.' },
  operations: { label: 'Operaciones', projectRole: 'operations', description: 'Agenda, documentos, instalación, CFE, inventario y postventa.' },
  engineering: { label: 'Ingeniería', projectRole: 'engineering', description: 'Levantamientos, diseño, cálculos y expediente técnico.' },
  installer: { label: 'Instalación', projectRole: 'installer', description: 'Órdenes de campo, seguridad, evidencia y materiales asignados.' },
  finance: { label: 'Finanzas', projectRole: 'finance', description: 'Cobranza, conciliación, margen y comisiones autorizadas.' },
  viewer: { label: 'Consulta', projectRole: 'viewer', description: 'Lectura de expedientes expresamente asignados, sin cambios.' },
};

const MODULES = {
  admin: ['overview','analytics','new','quotes','projects','agenda','installations','inventory','cfe','post-sales','finance','leads','catalog','team'],
  seller: ['overview','analytics','new','quotes','projects','agenda','post-sales','finance'],
  operations: ['overview','projects','agenda','installations','inventory','cfe','post-sales'],
  engineering: ['overview','projects','agenda','inventory','cfe'],
  installer: ['overview','projects','agenda','installations','inventory'],
  finance: ['overview','projects','agenda','finance'],
  viewer: ['overview','projects','agenda'],
};

const ACTIONS = {
  admin: ['*'],
  seller: ['sales.manage','project.tasks','project.documents','post-sales.manage'],
  operations: ['project.tasks','project.documents','survey.manage','installation.execute','cfe.manage','inventory.read','post-sales.manage'],
  engineering: ['project.tasks','project.documents','survey.manage','engineering.manage','inventory.read'],
  installer: ['project.tasks','project.documents','installation.execute','inventory.read'],
  finance: ['project.tasks','finance.capture'],
  viewer: [],
};

export function canOpenModule(role, module) {
  return (MODULES[role] ?? []).includes(module);
}

export function canPerform(role, action) {
  const allowed = ACTIONS[role] ?? [];
  return allowed.includes('*') || allowed.includes(action);
}

export function navigationForRole(role, navigation) {
  return navigation.filter(([id]) => canOpenModule(role, id));
}

export function roleLabel(role) {
  return STAFF_ROLES[role]?.label ?? 'Sin función';
}
