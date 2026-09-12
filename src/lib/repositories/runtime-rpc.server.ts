import { adminDb, type AdminDb } from "../admin-db";

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

/**
 * Server-only facade for trusted background endpoints. Routes call this
 * repository contract instead of importing the privileged Lovable Cloud client.
 */
export async function callAdminRuntimeRpc<T>(
  fn: string,
  args?: Record<string, unknown>,
): Promise<RuntimeRpcResult<T>> {
  const db = await adminDb();
  return callRuntimeRpc<T>(db, fn, args);
}
