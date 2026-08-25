import { CLAUDE_SUBSCRIPTION_IDENTITY } from "./claude-identities.js";
import {
  CODEX_DEFAULT_IDENTITY,
  CODEX_ISOLATED_IDENTITY
} from "./codex-identities.js";

export const providerIdentityIds = [
  CODEX_DEFAULT_IDENTITY,
  CODEX_ISOLATED_IDENTITY,
  CLAUDE_SUBSCRIPTION_IDENTITY
] as const;

export type ProviderIdentityId = (typeof providerIdentityIds)[number];

export function isProviderIdentityId(value: string): value is ProviderIdentityId {
  return providerIdentityIds.includes(value as ProviderIdentityId);
}
