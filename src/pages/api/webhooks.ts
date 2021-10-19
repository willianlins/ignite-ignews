import { NextApiRequest, NextApiResponse } from "next";
import { Readable } from 'stream';
import Stripe from "stripe";
import { stripe } from '../../services/stripe';
import { safeSubscription } from "./_lib/manageSubscription";

async function buffer(readable: Readable) {
  const chuncks = [];

  for await (const chunck of readable) {
    chuncks.push(
      typeof chunck === 'string' ? Buffer.from(chunck) : chunck
    );
  }

  return Buffer.concat(chuncks);
}

export const config = {
  api: {
    bodyParser: false
  }
}

const relevantEvents = new Set([
  'checkout.session.completed',
  'customer.sbuscription.updated',
  'customer.sbuscription.deleted',
])

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'POST') {
    const buf = await buffer(req);
    const secret = req.headers['stripe-signature'];

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(buf, secret, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`)
    }

    const type = event.type;

    if (relevantEvents.has(type)) {
      try {
        switch (type) {
          case 'customer.sbuscription.updated':
          case 'customer.sbuscription.deleted':

            const subscription = event.data.object as Stripe.Subscription;

            await safeSubscription(subscription.id, subscription.customer.toString(),false);

            break;
          case 'checkout.session.completed':

            const checkoutSession = event.data.object as Stripe.Checkout.Session

            await safeSubscription(checkoutSession.subscription.toString(), checkoutSession.customer.toString(), true)

            break;
          default:
            throw new Error('Unhandled event.')
        }
      } catch (err) {
        return res.json({ error: 'Webhook handler failed.' })
      }
    }

    res.json({ received: true })
  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method not allowed');
  }
}