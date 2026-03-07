import { RPC_ENDPOINT } from '../config.ts';

/**
 * Make a JSON-RPC 2.0 call to the configured RPC endpoint.
 * Throws on RPC-level errors.
 */
export async function rpcCall<T>(
  method: string,
  params: unknown,
): Promise<T> {
  const res = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
  });
  const json = (await res.json()) as {
    error?: { message: string };
    result: T;
  };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}
