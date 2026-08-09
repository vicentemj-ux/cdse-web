import test from 'node:test';
import assert from 'node:assert/strict';

import { canOpenModule, canPerform, navigationForRole, roleLabel } from '../src/lib/solar/access-control.mjs';

test('cada función abre sólo sus áreas de trabajo', () => {
  assert.equal(canOpenModule('seller', 'new'), true);
  assert.equal(canOpenModule('seller', 'catalog'), false);
  assert.equal(canOpenModule('installer', 'installations'), true);
  assert.equal(canOpenModule('installer', 'finance'), false);
  assert.equal(canOpenModule('finance', 'finance'), true);
});

test('consulta nunca adquiere escritura y administrador conserva control', () => {
  assert.equal(canPerform('viewer', 'project.documents'), false);
  assert.equal(canPerform('viewer', 'finance.capture'), false);
  assert.equal(canPerform('admin', 'engineering.manage'), true);
  assert.equal(canPerform('engineering', 'engineering.manage'), true);
  assert.equal(canPerform('engineering', 'finance.capture'), false);
});

test('la navegación mantiene orden y etiquetas conocidas', () => {
  const navigation = [['overview','Resumen'],['new','Nueva'],['projects','Proyectos'],['finance','Finanzas']];
  assert.deepEqual(navigationForRole('viewer', navigation), [['overview','Resumen'],['projects','Proyectos']]);
  assert.equal(roleLabel('operations'), 'Operaciones');
});
