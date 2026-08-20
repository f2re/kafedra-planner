import { explainObjectAccess, setObjectAccess } from '../../access-control/src/service.mjs';

export function copyScienceImportAccess(database, workspaceId, sourceDocumentId, scientificItemIds, actorPersonId = null, now = new Date().toISOString()) {
  const source = explainObjectAccess(database, workspaceId, 'document', sourceDocumentId);
  const grants = source.grants.map((grant) => ({ personId: grant.person_id, role: grant.access_role }));
  if (actorPersonId && source.policy?.owner_person_id !== actorPersonId && !grants.some((grant) => grant.personId === actorPersonId)) {
    grants.push({ personId: actorPersonId, role: 'editor' });
  }
  for (const scientificItemId of [...new Set(scientificItemIds.filter(Boolean))]) {
    setObjectAccess(database, workspaceId, 'scientific_item', scientificItemId, {
      accessScope: source.policy?.access_scope || 'restricted',
      ownerPersonId: source.policy?.owner_person_id || actorPersonId || null,
      grants
    }, actorPersonId, now);
  }
}
