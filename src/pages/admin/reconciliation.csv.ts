import type { APIRoute } from 'astro';
import { listFeeReconciliation } from '../../server/admin-orders.ts';

export const prerender = false;

// PII-free reconciliation export (the report a dao-finance role receives).
export const GET: APIRoute = ({ locals }) => {
  const user = locals.adminUser!;
  const rows = listFeeReconciliation(user);

  const header = [
    'order_id',
    'created_at',
    'manufacturer_id',
    'payment_status',
    'currency',
    'subtotal_minor',
    'dao_fee_minor',
    'dao_fee_status',
    'dao_fee_reference',
    'commitment_hash',
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.created_at,
      row.manufacturer_id,
      row.payment_status,
      row.currency ?? '',
      row.subtotal_minor ?? '',
      row.dao_fee_minor ?? '',
      row.dao_fee_status,
      csvEscape(row.dao_fee_reference ?? ''),
      row.commitment_hash ?? '',
    ].join(','),
  );

  return new Response([header.join(','), ...lines].join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="dao-fee-reconciliation.csv"',
    },
  });
};

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
