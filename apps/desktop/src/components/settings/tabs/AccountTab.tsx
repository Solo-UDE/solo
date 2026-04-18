import { useEffect, useMemo, useState } from 'react';
import { ExitIcon, GitHubLogoIcon } from '@radix-ui/react-icons';
import { Mail, ShieldCheck, UserRound } from 'lucide-react';
import type { User } from '../../../lib/auth';
import { getIdToken } from '../../../lib/auth';
import { useAuthStore } from '../../../stores/authStore';
import { useGitHubAccountsStore } from '../../../stores/githubAccountsStore';

type DecodedTokenClaims = Record<string, unknown>;

interface CognitoIdentityClaim {
  providerName?: string;
  userId?: string;
}

interface SoloIdentitySummary {
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  providerLabel: string;
  providerAccount: string | null;
  subject: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function decodeJwtClaims(token: string): DecodedTokenClaims | null {
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const utf8 = decodeURIComponent(
      Array.from(binary)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(utf8) as DecodedTokenClaims;
  } catch (error) {
    console.error('Failed to decode ID token claims:', error);
    return null;
  }
}

function parseIdentities(raw: unknown): CognitoIdentityClaim[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is CognitoIdentityClaim => typeof entry === 'object' && entry !== null);
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (entry): entry is CognitoIdentityClaim => typeof entry === 'object' && entry !== null,
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

function providerLabel(raw: string | null): string {
  switch ((raw ?? '').toLowerCase()) {
    case 'github':
      return 'GitHub';
    case 'google':
      return 'Google';
    case 'loginwithamazon':
      return 'Amazon';
    case 'cognito':
    case '':
      return 'Email';
    default:
      return raw ?? 'Unknown';
  }
}

function providerFromUsername(username: string | null): string | null {
  if (!username) return null;
  const prefix = username.split('_', 1)[0];
  return prefix && prefix !== username ? prefix : null;
}

function deriveSoloIdentity(
  user: User | null,
  claims: DecodedTokenClaims | null,
): SoloIdentitySummary | null {
  if (!user) return null;

  const identities = parseIdentities(claims?.identities);
  const firstIdentity = identities[0];
  const cognitoUsername = asString(claims?.['cognito:username']);
  const rawProvider =
    asString(firstIdentity?.providerName) ?? providerFromUsername(cognitoUsername) ?? 'cognito';

  const metadata = user.user_metadata;
  const displayName =
    asString(metadata.name) ??
    asString(claims?.name) ??
    asString(metadata.preferred_username) ??
    asString(claims?.preferred_username) ??
    user.email ??
    'Signed-in user';

  return {
    displayName,
    email: user.email ?? asString(claims?.email),
    avatarUrl: asString(metadata.avatar_url) ?? asString(claims?.picture),
    providerLabel: providerLabel(rawProvider),
    providerAccount:
      asString(metadata.preferred_username) ??
      asString(claims?.preferred_username) ??
      asString(firstIdentity?.userId) ??
      cognitoUsername,
    subject: user.id ?? asString(claims?.sub),
  };
}

function AccountAvatar({
  name,
  avatarUrl,
  fallbackClassName,
}: {
  name: string;
  avatarUrl: string | null;
  fallbackClassName?: string;
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="h-14 w-14 rounded-full object-cover" />;
  }

  return (
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-muted/40 ${fallbackClassName ?? ''}`}
    >
      <span className="text-lg font-semibold text-foreground">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/50 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="max-w-[65%] text-right text-sm text-foreground">
        {value ?? <span className="text-muted-foreground">Unavailable</span>}
      </div>
    </div>
  );
}

export function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const githubUser = useGitHubAccountsStore((s) => s.user);
  const githubToken = useGitHubAccountsStore((s) => s.token);
  const isGitHubLoading = useGitHubAccountsStore((s) => s.isLoading);
  const isGitHubConnecting = useGitHubAccountsStore((s) => s.isConnecting);
  const loadGitHubToken = useGitHubAccountsStore((s) => s.loadToken);
  const disconnectGitHub = useGitHubAccountsStore((s) => s.disconnectGitHub);

  const [claims, setClaims] = useState<DecodedTokenClaims | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadClaims = async () => {
      if (!isAuthenticated) {
        setClaims(null);
        return;
      }

      try {
        const token = await getIdToken();
        if (!cancelled) {
          setClaims(token ? decodeJwtClaims(token) : null);
        }
      } catch (error) {
        console.error('Failed to read ID token for account settings:', error);
        if (!cancelled) {
          setClaims(null);
        }
      }
    };

    void loadClaims();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    void loadGitHubToken();
  }, [loadGitHubToken]);

  const soloIdentity = useMemo(() => deriveSoloIdentity(user, claims), [user, claims]);

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Solo Sign-In</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          This is the account currently signed in to Solo. It controls access to sync,
          stats, and the desktop app session.
        </p>

        <div className="rounded-[14px] border border-border/70 bg-background/55 p-5">
          {soloIdentity ? (
            <>
              <div className="mb-5 flex items-center gap-4">
                <AccountAvatar name={soloIdentity.displayName} avatarUrl={soloIdentity.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-foreground">{soloIdentity.displayName}</h4>
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      Signed in with {soloIdentity.providerLabel}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{soloIdentity.email ?? 'No email claim returned'}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-0">
                <MetaRow label="Auth provider" value={soloIdentity.providerLabel} />
                <MetaRow label="Provider account" value={soloIdentity.providerAccount} />
                <MetaRow label="Solo user ID" value={soloIdentity.subject} />
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              <span>No Solo account is currently signed in.</span>
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">GitHub Connection</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          This token is used for Git operations like clone, push, pull, and repo setup. It
          can be a different GitHub account from the one used to sign in to Solo.
        </p>

        <div className="rounded-[14px] border border-border/70 bg-background/55 p-5">
          {githubUser && githubToken ? (
            <>
              <div className="mb-5 flex items-center gap-4">
                <AccountAvatar
                  name={githubUser.login}
                  avatarUrl={githubUser.avatar_url}
                  fallbackClassName="bg-background/70"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-foreground">{githubUser.login}</h4>
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      Connected for Git
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <GitHubLogoIcon className="h-4 w-4" />
                    <span>{githubUser.type}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnectGitHub()}
                  className="inline-flex items-center gap-2 rounded-[9px] border border-border/70 bg-background/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <ExitIcon className="h-4 w-4" />
                  Disconnect
                </button>
              </div>

              <div className="space-y-0">
                <MetaRow label="GitHub login" value={githubUser.login} />
                <MetaRow label="GitHub account type" value={githubUser.type} />
                <MetaRow label="GitHub user ID" value={String(githubUser.id)} />
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />
              <span>
                {isGitHubConnecting || isGitHubLoading
                  ? 'Checking the saved GitHub connection...'
                  : 'No GitHub account is connected for Git operations.'}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
