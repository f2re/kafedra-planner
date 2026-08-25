import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import { createManualPlan } from '../packages/plans/src/manual.mjs';
import { createOrganizationUnit, createPersonAppointment, organizationSnapshot } from '../packages/organization/src/service.mjs';
import {
  getScienceLifecycleItem,
  listScienceLifecycleItems,
  transitionScienceLifecycle,
  unlinkScienceFromPlan,
  updateScienceEditorial
} from '../packages/science-lifecycle/src/service.mjs';
import { linkSciencePlan } from '../packages/science-lifecycle/src/plan-link.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-science-lifecycle-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, database, workspace };
}

async function closeFixture({ root, database }) {
  database.close();
  await rm(root, { recursive: true, force: true });
}

test('ручная коррекция не перезаписывает извлечённую научную карточку', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Редактор Науки' });
    const science = createScientificItem(database, workspace.id, {
      title: 'Исходное название статьи', kind: 'article', authors: ['Иванов Иван Иванович'],
      publicationYear: 2024, doi: '10.1000/source'
    });
    assert.throws(() => updateScienceEditorial(database, workspace.id, science.id, {
      title: 'Исправленное название'
    }, actor.id), /science_editor_reason_required/u);

    const updated = updateScienceEditorial(database, workspace.id, science.id, {
      title: 'Исправленное название статьи', doi: '10.1000/corrected', publicationYear: 2025,
      authors: ['Иванов Иван Иванович', 'Петров Пётр Петрович'],
      classifications: ['ВАК', 'РИНЦ'], nextAction: 'Подать корректуру', nextActionDue: '2026-09-15',
      reason: 'Уточнено по опубликованной версии'
    }, actor.id);

    assert.equal(updated.title, 'Исправленное название статьи');
    assert.equal(updated.manual_override.reason, 'Уточнено по опубликованной версии');
    assert.deepEqual(updated.classifications, ['ВАК', 'РИНЦ']);
    assert.equal(database.get('SELECT title FROM scientific_items WHERE id = ?', science.id).title, 'Исходное название статьи');
    assert.equal(database.get('SELECT doi FROM scientific_items WHERE id = ?', science.id).doi, '10.1000/source');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM scientific_item_revisions WHERE scientific_item_id = ?', science.id).n, 1);
    assert.ok(database.get(`SELECT id FROM search_fragments WHERE source_kind = 'scientific_item' AND source_id = ?`, science.id));
  } finally {
    await closeFixture(env);
  }
});

test('этапы научной работы переходят только по допустимому маршруту и сохраняют историю', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Руководитель Науки' });
    const science = createScientificItem(database, workspace.id, {
      title: 'Рукопись для журнала', kind: 'article', authors: ['Автор А.А.']
    });
    database.run("UPDATE scientific_items SET lifecycle_status = 'idea' WHERE id = ?", science.id);

    assert.throws(() => transitionScienceLifecycle(database, workspace.id, science.id, {
      status: 'published', eventDate: '2026-08-20'
    }, actor.id), /science_lifecycle_transition_invalid/u);

    transitionScienceLifecycle(database, workspace.id, science.id, {
      status: 'drafting', eventDate: '2026-08-20', note: 'Начата подготовка рукописи',
      nextAction: 'Завершить рукопись', nextActionDue: '2026-09-10'
    }, actor.id);
    transitionScienceLifecycle(database, workspace.id, science.id, {
      status: 'submitted', eventDate: '2026-09-11', note: 'Подано в редакцию', targetVenue: 'Журнал Метеорология',
      nextAction: 'Ожидать решение', nextActionDue: '2026-10-15'
    }, actor.id);
    const accepted = transitionScienceLifecycle(database, workspace.id, science.id, {
      status: 'accepted', eventDate: '2026-10-01', note: 'Получено письмо о принятии'
    }, actor.id);
    assert.equal(accepted.lifecycle_status, 'accepted');
    assert.equal(accepted.submitted_at, '2026-09-11');
    assert.equal(accepted.accepted_at, '2026-10-01');
    assert.equal(accepted.lifecycle_events.length, 3);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM audit_log WHERE subject_id = ?', science.id).n >= 3, true);
  } finally {
    await closeFixture(env);
  }
});

test('научное мероприятие создаётся в ручном плане атомарно и повтор не создаёт дубль', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Заведующий Кафедрой' });
    const executor = createPerson(database, workspace.id, { displayName: 'Исполнитель Науки' });
    const plan = createManualPlan(database, workspace.id, {
      title: 'План научной работы', planKind: 'department', periodKind: 'calendar', yearStart: 2026
    }, actor.id);
    const science = createScientificItem(database, workspace.id, {
      title: 'Статья о наукастинге', kind: 'article', authors: ['Исполнитель Науки']
    });
    updateScienceEditorial(database, workspace.id, science.id, {
      nextAction: 'Подготовить статью о наукастинге', nextActionDue: '2026-11-01',
      reason: 'Планирование научной работы'
    }, actor.id);

    const linked = linkSciencePlan(database, workspace.id, science.id, {
      planId: plan.id, executionMode: 'assigned', executorPersonIds: [executor.id],
      controllerPersonId: actor.id
    }, actor.id);
    assert.equal(linked.plan_link.plan_id, plan.id);
    assert.ok(linked.plan_link.assignment_id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plan_items WHERE plan_id = ?', plan.id).n, 1);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM assignments WHERE id = ?', linked.plan_link.assignment_id).n, 1);

    const repeated = linkSciencePlan(database, workspace.id, science.id, {
      planItemId: linked.plan_link.plan_item_id
    }, actor.id);
    assert.equal(repeated.plan_link.plan_item_id, linked.plan_link.plan_item_id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plan_items WHERE plan_id = ?', plan.id).n, 1);

    const unlinked = unlinkScienceFromPlan(database, workspace.id, science.id, {
      reason: 'Мероприятие перенесено в другой цикл'
    }, actor.id);
    assert.equal(unlinked.plan_link, null);
    assert.ok(database.get('SELECT id FROM plan_items WHERE id = ?', linked.plan_link.plan_item_id));
    assert.ok(database.get('SELECT id FROM assignments WHERE id = ?', linked.plan_link.assignment_id));
  } finally {
    await closeFixture(env);
  }
});

test('научная выборка использует историческую аффилиацию на дату публикации', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const author = createPerson(database, workspace.id, { displayName: 'Автор Исторический' });
    const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
    const oldUnit = createOrganizationUnit(database, workspace.id, {
      name: 'Старая лаборатория', unitKind: 'laboratory', parentUnitId: rootUnit.id,
      validFrom: '2018-01-01', validTo: '2022-12-31'
    }, actor.id);
    const currentUnit = createOrganizationUnit(database, workspace.id, {
      name: 'Новая лаборатория', unitKind: 'laboratory', parentUnitId: rootUnit.id,
      validFrom: '2023-01-01'
    }, actor.id);
    createPersonAppointment(database, workspace.id, author.id, {
      unitId: oldUnit.id, validFrom: '2018-01-01', validTo: '2022-12-31'
    }, actor.id);
    createPersonAppointment(database, workspace.id, author.id, {
      unitId: currentUnit.id, validFrom: '2023-01-01'
    }, actor.id);
    const science = createScientificItem(database, workspace.id, {
      title: 'Историческая публикация', kind: 'article', authors: ['Автор Исторический'], publicationYear: 2021
    });
    const item = getScienceLifecycleItem(database, workspace.id, science.id);
    assert.equal(item.affiliations[0].unit_name_snapshot, 'Старая лаборатория');
    assert.equal(listScienceLifecycleItems(database, workspace.id, { unitId: oldUnit.id }).length, 1);
    assert.equal(listScienceLifecycleItems(database, workspace.id, { unitId: currentUnit.id }).length, 0);
  } finally {
    await closeFixture(env);
  }
});
