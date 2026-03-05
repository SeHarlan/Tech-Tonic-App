import { useAtomValue } from 'jotai';
import { refreshOwnedAtom } from '../store/atoms';
import type { NftItem } from '../utils/das-api';

export function useRefreshOwned(): () => Promise<NftItem[]> {
  const fn = useAtomValue(refreshOwnedAtom);
  return fn ?? (async () => []);
}
