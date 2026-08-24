import { authorizeApiRequest } from './policy.mjs';

// Compatibility adapter for the 0.2.0 modules. Authorization remains centralized
// in the current policy so PIN and account modes have exactly the same protection.
export function authorizeApiRequest020(_database, context, _method, path, _searchParams) {
  return authorizeApiRequest(context, path);
}
