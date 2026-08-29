const { getAdmin, requireUser } = require('./_firebase');

const SITE_URL = process.env.SITE_URL || 'https://sabbirislamshanto9-cell.github.io/AS-FF-STORE/';
const GATEWAY_URL = 'https://pay.prlxw.com/api';

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
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    const orderRef = db.collection('moneyRequests').doc();
    const orderId = orderRef.id;

    const profile = await db.collection('users').doc(user.uid).get();
    const profileData = profile.exists ? profile.data() : {};

    const payload = {
      amount: Number(amount.toFixed(2)),
      cus_name: profileData.name || user.name || 'AS FF STORE User',
      cus_email: user.email || profileData.email || 'customer@example.com',
      cus_phone: profileData.phone || '',
      success_url: SITE_URL,
      cancel_url: SITE_URL,
      metadata: {
        order_id: orderId,
        user_id: user.uid,
        type: 'wallet_topup'
      }
    };

    const gatewayResponse = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-KEY': process.env.SECUREPAY_BRAND_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await gatewayResponse.json().catch(() => ({}));
    if (!gatewayResponse.ok || !data.payment_url) {
      console.error('SecurePay create error:', gatewayResponse.status, data);
      return res.status(502).json({ error: data.message || 'SecurePay payment creation failed' });
    }

    await orderRef.set({
      userId: user.uid,
      amount: Number(amount.toFixed(2)),
      paymentMethod: 'SecurePay BD',
      status: 'Pending',
      transactionId: null,
      securePayPaymentUrl: data.payment_url,
      gateway: 'securepay',
      date: adminSdk.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ payment_url: data.payment_url, order_id: orderId });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
};
