const { getAdmin, requireUser } = require('./_firebase');

const VERIFY_URL = 'https://pay.prlxw.com/api/verify';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireUser(req);
    const transactionId = String(req.body?.transactionId || '').trim();
    if (!transactionId) return res.status(400).json({ error: 'transactionId is required' });

    const gatewayResponse = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-KEY': process.env.SECUREPAY_BRAND_KEY
      },
      body: JSON.stringify({ transaction_id: transactionId })
    });
    const result = await gatewayResponse.json().catch(() => ({}));

    if (!gatewayResponse.ok) {
      return res.status(502).json({ error: result.message || 'SecurePay verification failed' });
    }

    if (result.status !== 'COMPLETED') {
      return res.status(200).json({ ok: false, status: result.status || 'PENDING', message: 'Payment is not completed yet.' });
    }

    const metadata = result.metadata || {};
    if (metadata.user_id !== user.uid) {
      return res.status(403).json({ error: 'Transaction does not belong to this user' });
    }

    const amount = Number(result.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid verified amount' });
    }

    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    const orderId = metadata.order_id;
    if (!orderId) return res.status(400).json({ error: 'Missing order metadata' });

    const orderRef = db.collection('moneyRequests').doc(orderId);
    const userRef = db.collection('users').doc(user.uid);

    let credited = false;
    await db.runTransaction(async tx => {
      const orderSnap = await tx.get(orderRef);
      const userSnap = await tx.get(userRef);
      if (!orderSnap.exists || !userSnap.exists) throw new Error('Order or user not found');

      const order = orderSnap.data();
      if (order.userId !== user.uid) throw new Error('Unauthorized order');
      if (Number(order.amount).toFixed(2) !== amount.toFixed(2)) throw new Error('Amount mismatch');

      if (order.status === 'Paid') {
        credited = false;
        return;
      }

      const oldBalance = Number(userSnap.data().walletBalance || 0);
      tx.update(userRef, {
        walletBalance: oldBalance + amount
      });
      tx.update(orderRef, {
        status: 'Paid',
        transactionId,
        verifiedAmount: amount,
        verifiedStatus: 'COMPLETED',
        paidAt: adminSdk.firestore.FieldValue.serverTimestamp()
      });
      credited = true;
    });

    return res.status(200).json({ ok: true, status: 'COMPLETED', credited, amount, transactionId });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
};
