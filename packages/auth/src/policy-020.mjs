import { authorizeApiRequest } from './policy.mjs';

const V020_PREFIXES = [
  '/api/organization',
  '/api/appointments/',
  '/api/science-lifecycle',
  '/api/science-imports',
  '/api/science-reports'
];

function isScienceExtension(path) {
  return /^\/api\/science\/[^/]+\/(?:lifecycle|editor|lifecycle-events|plan-link|unlink-plan)$/u.test(path);
}

function isPersonOrganization(path) {
  return /^\/api\/people\/[^/]+\/(?:appointments|organization)$/u.test(path);
}

function isScienceAffiliation(path) {
  return /^\/api\/science\/[^/]+\/authors\/[^/]+\/affiliation$/u.test(path);
}

export function authorizeApiRequest020(database, context, method, path, searchParams) {
  const delegated = V020_PREFIXES.some((prefix) => path.startsWith(prefix))
    || isScienceExtension(path)
    || isPersonOrganization(path)
    || isScienceAffiliation(path);
  if (delegated) return;
  return authorizeApiRequest(database, context, method, path, searchParams);
}
