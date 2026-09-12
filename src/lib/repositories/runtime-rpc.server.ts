import type { AdminDb } from "../admin-db";

type RpcError = { message: string };
export type RuntimeRpcResult<T> = { data: T | null; error: RpcError | null };

type RuntimeRpcCaller = <T>(
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<RuntimeRpcResult<T>>;

/**
 * Temporary bridge for RPCs that exist in Lovable Cloud but are newer than the
 * generated schema snapshot. Keeping the cast in one server-only repository
 * avoids spreading `any`/unchecked RPC access through application code.
 */
export async function callRuntimeRpc<T>(
  db: AdminDb,
  fn: string,
  args?: Record<string, unknown>,
): Promise<RuntimeRpcResult<T>> {
  const caller = db.rpc.bind(db) as unknown as RuntimeRpcCaller;
  return await caller<T>(fn, args);
}
