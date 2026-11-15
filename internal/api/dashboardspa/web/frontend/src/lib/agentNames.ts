import { t } from '../i18n';

// A person-readable name for an agent: its role when the name or template
// says one, else the last path segment without the session suffix. Session
// names like `superpowers__implementer-gcg-session-d1b5…` are machine ids.

const SESSION_SUFFIX = /-gcg-session-.*$/;

// Order matters: `run-operator` before anything shorter it contains.
const ROLES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|[^a-z])mayor([^a-z]|$)/, label: 'Mayor' },
  { pattern: /run[-_.]?operator/, label: 'Run operator' },
  { pattern: /implementer/, label: 'Implementer' },
  { pattern: /reviewer/, label: 'Reviewer' },
  { pattern: /dispatcher/, label: 'Dispatcher' },
];

function lastSegment(name: string): string {
  const parts = name.split('/').filter((part) => part.length > 0);
  return (parts[parts.length - 1] ?? name).replace(SESSION_SUFFIX, '');
}

function roleOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const segment = lastSegment(value.trim().toLowerCase());
  for (const role of ROLES) {
    if (role.pattern.test(segment)) return role.label;
  }
  return null;
}

export function agentDisplayName(name: string, template?: string): string {
  const role = roleOf(name) ?? roleOf(template);
  if (role !== null) return t(role);
  return lastSegment(name.trim());
}
