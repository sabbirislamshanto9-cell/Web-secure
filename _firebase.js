const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin;
}

async function requireUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('Missing Firebase ID token');
    err.statusCode = 401;
    throw err;
  }
  const token = header.slice(7);
  const adminSdk = getAdmin();
  return adminSdk.auth().verifyIdToken(token);
}

module.exports = { getAdmin, requireUser };
