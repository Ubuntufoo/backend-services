import type { OrderInsert, OrderRow, OrderUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  requireOptionalResult,
  requireSingleResult,
  type SingleResult,
} from './shared.js';

export async function createOrder(
  client: SupabaseDataClient,
  input: OrderInsert
): Promise<OrderRow> {
  const result = (await client
    .from('orders')
    .insert(input)
    .select()
    .single()) as SingleResult<OrderRow>;

  return requireSingleResult(result, `Order "${input.order_id}" was not created.`);
}

export async function getOrderByOrderId(
  client: SupabaseDataClient,
  orderId: string
): Promise<OrderRow | null> {
  const result = (await client
    .from('orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle()) as SingleResult<OrderRow>;

  return requireOptionalResult(result);
}

export async function updateOrder(
  client: SupabaseDataClient,
  orderId: string,
  changes: OrderUpdate
): Promise<OrderRow> {
  const result = await client
    .from('orders')
    .update(changes)
    .eq('order_id', orderId)
    .select()
    .single() as SingleResult<OrderRow>;

  return requireSingleResult(result, `Order "${orderId}" was not updated.`);
}
