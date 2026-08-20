export {
  listOrganizationUnits, organizationTree, listOrganizationPositions,
  createOrganizationUnit, updateOrganizationUnit,
  createOrganizationPosition, updateOrganizationPosition
} from './units.mjs';
export {
  listPersonAppointments, resolvePersonAppointment, listOrganizationPeople,
  createPersonAppointment, updatePersonAppointment, refreshDerivedAffiliations
} from './appointments.mjs';
export {
  listScientificAuthorAffiliations, setScientificAuthorAffiliation
} from './affiliations.mjs';

import { organizationTree, listOrganizationPositions } from './units.mjs';
import { listOrganizationPeople } from './appointments.mjs';
import { isoDate, today } from './shared.mjs';

export function organizationSnapshot(database, workspaceId, { asOf = today(), includeInactive = false } = {}) {
  const date = isoDate(asOf, 'asOf');
  return {
    asOf: date,
    tree: organizationTree(database, workspaceId, { asOf: date, includeInactive }),
    positions: listOrganizationPositions(database, workspaceId, { includeInactive }),
    people: listOrganizationPeople(database, workspaceId, { asOf: date })
  };
}
