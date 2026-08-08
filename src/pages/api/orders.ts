import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createOrder, OrderValidationError } from '../../server/orders.ts';

export const prerender = false;

const PayloadSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        offerId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  customer: z.strictObject({
    fullName: z.string().min(1).max(200),
    email: z.string().email().max(320),
    phone: z.string().max(50).optional(),
    addressLine1: z.string().min(1).max(200),
    addressLine2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    region: z.string().max(100).optional(),
    postalCode: z.string().min(1).max(20),
    country: z.string().length(2),
  }),
  customerNotes: z.string().max(2000).optional(),
  paymentMethod: z.enum(['card', 'usdc']).optional(),
});

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'request body must be JSON' });
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, {
      error: 'invalid order payload',
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    });
  }

  try {
    const created = createOrder(parsed.data);
    return json(201, {
      orderId: created.orderId,
      accessToken: created.accessToken,
      confirmationUrl: `/orders/${created.orderId}/confirmation?token=${created.accessToken}`,
      paymentMethod: parsed.data.paymentMethod ?? 'card',
    });
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return json(422, { error: error.message });
    }
    // Never echo unexpected errors to the client (and never log PII).
    console.error('order intake failed:', error);
    return json(500, { error: 'order could not be created' });
  }
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}