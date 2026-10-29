// Vercel serverless backend for Free GST Billing Software.
//
// This replaces the local disk-based Express server (../server.js) for online
// deployment. It speaks the EXACT same /api/* contract that src/store.js
// expects, so the entire React frontend runs unchanged — the only difference
// is that data lives in Neon Postgres (see ./db.js) instead of data/*.json.
//
// Routes that only make sense on a user's own PC (open-data-folder, launch an
// update script, on-disk auto-backups, the Saved-Invoices PDF archive) are
// stubbed to degrade gracefully: the UI keeps working, those buttons just
// no-op. Your real online backup is the built-in Export / Import (full JSON),
// which is implemented for real below.
//
// Auth: a single shared password (Basic Auth) gates every route when
// APP_PASSWORD is set. The local app had no login because it only answered
// 127.0.0.1; on a public URL a gate is mandatory. See requireAuth below.

import express from 'express';
import crypto from 'crypto';
import {
  nextCounterValue, startFor, numberSeriesFor, counterKeyFor, formatDocNumber,
  businessKeyOf, getFinancialYearLabel, INVOICE_TYPES, templateTotals, clientYearToDate,
} from '../src/utils.js';
import {
  readAll, readOne, exists, writeOne, deleteOne, moveOne,
  readProfile, writeProfile, readMeta, writeMeta, readPrefs, writePrefs, incrementMeta,
} from './db.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// ---------------------------------------------------------------------------
// Shared-password gate. Set APP_PASSWORD (and optionally APP_USER, default
// "admin") in Vercel env vars. Health check stays open for uptime monitors.
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return next(); // not configured → open (dev only; you set this in prod)
  if (req.path === '/api/health') return next();
  const user = process.env.APP_USER || 'admin';
  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
    // timing-safe compare
    const ok = u === user && p.length === pass.length &&
      crypto.timingSafeEqual(Buffer.from(p), Buffer.from(pass));
    if (ok) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Free GST Billing"');
  return res.status(401).send('Authentication required');
}
app.use(requireAuth);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const DEFAULT_PROFILE = {
  businessName: '', address: '', state: '', gstin: '', pan: '',
  email: '', phone: '', bankName: '', accountNumber: '', ifsc: '',
  logo: '', signature: '', upiId: '', googleClientId: '', googleDriveFolder: 'GST Billing Invoices',
};
const LOCK_KEY = 'appLock';
const withoutLock = (meta) => { const { [LOCK_KEY]: _l, ...rest } = meta || {}; return rest; };
const withLock = (meta, lock) => (lock ? { ...withoutLock(meta), [LOCK_KEY]: lock } : withoutLock(meta));

// Wrap an async route so a thrown error becomes a clean 500 instead of a
// hung request / unhandled rejection.
const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[api error]', req.method, req.path, err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error', code: 'server-error' });
});

// Date helpers (ported from server.js, used by recurring generate).
const isoDay = (d) => d.toISOString().split('T')[0];
const parseIsoDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const localToday = () => isoDay(new Date());
const addDays = (s, days) => { const d = parseIsoDay(s); if (!d) return ''; d.setUTCDate(d.getUTCDate() + days); return isoDay(d); };
function advanceDate(s, frequency, interval, anchorDay) {
  const d = parseIsoDay(s); if (!d) return s;
  const n = Math.max(1, parseInt(interval, 10) || 1);
  if (frequency === 'weekly') { d.setUTCDate(d.getUTCDate() + 7 * n); return isoDay(d); }
  const months = frequency === 'quarterly' ? 3 * n : frequency === 'yearly' ? 12 * n : n;
  const day = Math.min(31, Math.max(1, parseInt(anchorDay, 10) || d.getUTCDate()));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoDay(target);
}

// ===========================================================================
// BILLS
// ===========================================================================
app.get('/api/bills', h(async (req, res) => {
  const bills = await readAll('bills');
  bills.sort((a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate));
  res.json(bills);
}));

app.post('/api/bills', h(async (req, res) => {
  const bill = req.body;
  if (!bill || !bill.id) return res.status(400).json({ error: 'Bill must have an id' });
  const overwrite = req.query.overwrite === '1' || req.query.overwrite === 'true';
  if (!overwrite && await exists('bills', bill.id)) {
    return res.status(409).json({ error: 'A bill with this invoice number already exists', invoiceNumber: bill.id });
  }
  await writeOne('bills', bill.id, bill);
  res.json({ success: true });
}));

// A bill used as a client-credit source for another live bill can't be
// silently deleted (would dangle a "paid via credit" target). Mirrors server.js.
async function findCreditDependents(billId) {
  const dependents = [];
  for (const other of await readAll('bills')) {
    if (!other || other.id === billId) continue;
    const payments = other.payments || other.data?.payments || [];
    for (const p of payments) {
      if (p?.mode !== 'credit-applied') continue;
      if ((p?.creditSourceBillIds || []).includes(billId)) {
        dependents.push({ id: other.id, invoiceNumber: other.invoiceNumber, amount: p.amount });
        break;
      }
    }
  }
  return dependents;
}

app.delete('/api/bills/:id', h(async (req, res) => {
  const id = req.params.id;
  if (!await exists('bills', id)) return res.json({ success: true });
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!force) {
    const dependents = await findCreditDependents(id);
    if (dependents.length > 0) {
      return res.status(409).json({
        error: 'client-credit-dependency',
        message: 'This bill was used as a client-credit source on another invoice. Deleting it would leave that invoice paid via credit that no longer has a real source.',
        dependents,
      });
    }
  }
  if (req.query.permanent === '1') {
    await deleteOne('bills', id);
    return res.json({ success: true, permanent: true });
  }
  await moveOne('bills', 'trash', id); // soft delete → restorable from Trash
  res.json({ success: true, trashed: true });
}));

// ===========================================================================
// PROFILE (singleton)
// ===========================================================================
app.get('/api/profile', h(async (req, res) => res.json(await readProfile(DEFAULT_PROFILE))));
app.post('/api/profile', h(async (req, res) => { await writeProfile(req.body); res.json({ success: true }); }));

// ===========================================================================
// Generic collection factory for the simple CRUD collections
// ===========================================================================
function crud(route, collection, idPrefix, sortFn) {
  app.get(`/api/${route}`, h(async (req, res) => {
    const items = await readAll(collection);
    if (sortFn) items.sort(sortFn);
    res.json(items);
  }));
  app.post(`/api/${route}`, h(async (req, res) => {
    const item = req.body || {};
    if (!item.id) item.id = `${idPrefix}_${Date.now()}`;
    await writeOne(collection, item.id, item);
    res.json({ success: true, id: item.id });
  }));
  app.delete(`/api/${route}/:id`, h(async (req, res) => {
    await deleteOne(collection, req.params.id);
    res.json({ success: true });
  }));
}
const byName    = (a, b) => (a.name || '').localeCompare(b.name || '');
const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date);

crud('clients',  'clients',  'cli',  byName);
crud('products', 'products', 'prod', byName);
crud('expenses', 'expenses', 'exp',  byDateDesc);
crud('recurring','recurring','rec',  (a, b) => (a.clientName || '').localeCompare(b.clientName || ''));
crud('receipts', 'receipts', 'rcp',  byDateDesc);
crud('purchases','purchases','pur',  byDateDesc);
crud('profiles', 'profiles', 'biz',  (a, b) => (a.businessName || '').localeCompare(b.businessName || ''));

// ===========================================================================
// TERMS TEMPLATES (special: seeds a default when empty)
// ===========================================================================
app.get('/api/templates', h(async (req, res) => {
  let templates = await readAll('templates');
  if (templates.length === 0) {
    const defaultTpl = {
      id: 'default', name: 'Standard Terms',
      content: '1. Payment is due within 15 days of invoice date unless otherwise agreed in writing.\n2. Interest @ 18% p.a. will be charged on overdue payments beyond the due date.\n3. The scope of work is limited to what is explicitly mentioned in the project proposal/agreement. Any additional requirements will be quoted and billed separately.\n4. All intellectual property and source code will be transferred to the client only upon receipt of full payment.\n5. We shall not be liable for any delays caused by incomplete or late submission of content, credentials, or approvals from the client\'s end.\n6. Any change requests after project approval may attract additional charges and revised timelines.\n7. This invoice is subject to the jurisdiction of courts at the service provider\'s registered location.\n8. E. & O.E.',
    };
    await writeOne('templates', 'default', defaultTpl);
    templates = [defaultTpl];
  }
  templates.sort(byName);
  res.json(templates);
}));
app.post('/api/templates', h(async (req, res) => {
  const tpl = req.body || {};
  if (!tpl.id) tpl.id = `tpl_${Date.now()}`;
  await writeOne('templates', tpl.id, tpl);
  res.json({ success: true, id: tpl.id });
}));
app.delete('/api/templates/:id', h(async (req, res) => { await deleteOne('templates', req.params.id); res.json({ success: true }); }));

// ===========================================================================
// META (counters & settings). The PIN lock hides behind /api/lock only.
// ===========================================================================
app.get('/api/meta/:key', h(async (req, res) => {
  if (req.params.key === LOCK_KEY) return res.status(403).json({ error: 'Refused', code: 'forbidden' });
  const meta = await readMeta({});
  res.json({ value: meta[req.params.key] ?? null });
}));
app.post('/api/meta/:key', h(async (req, res) => {
  if (req.params.key === LOCK_KEY) return res.status(403).json({ error: 'Refused', code: 'forbidden' });
  if (!req.body || !('value' in req.body)) return res.status(400).json({ error: 'Invalid request', code: 'bad-request' });
  const meta = await readMeta({});
  meta[req.params.key] = req.body.value;
  await writeMeta(meta);
  res.json({ success: true });
}));
// Atomic — single SQL UPSERT in db.incrementMeta, race-free across instances.
app.post('/api/meta/:key/increment', h(async (req, res) => {
  if (req.params.key === LOCK_KEY) return res.status(403).json({ error: 'Refused', code: 'forbidden' });
  // Clamp start the same way utils.nextCounterValue does (1..MAX_START_NUMBER).
  const probe = nextCounterValue(0, req.body?.start); // == clamp(start,1,MAX) since last=0 → max(1,from)
  const value = await incrementMeta(req.params.key, probe);
  res.json({ value });
}));

// ===========================================================================
// LOCAL PREFS (singleton, merge semantics)
// ===========================================================================
app.get('/api/local-prefs', h(async (req, res) => res.json({ value: await readPrefs({}) })));
app.post('/api/local-prefs', h(async (req, res) => {
  const { set = {}, remove = [] } = req.body || {};
  if (!set || typeof set !== 'object' || Array.isArray(set) || !Array.isArray(remove)) {
    return res.status(400).json({ error: 'Invalid request', code: 'bad-request' });
  }
  const prefs = await readPrefs({});
  for (const [k, v] of Object.entries(set)) if (typeof v === 'string') prefs[k] = v;
  for (const k of remove) delete prefs[String(k)];
  await writePrefs(prefs);
  res.json({ success: true });
}));

// ===========================================================================
// PIN LOCK (optional screen lock; salted scrypt hash in meta.appLock)
// ===========================================================================
const PIN_RE = /^(\d{6}|\d{8})$/;
const pinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const pinMatches = (lock, pin) => {
  if (!lock?.salt || !lock?.hash || !PIN_RE.test(String(pin ?? ''))) return false;
  const a = Buffer.from(pinHash(pin, lock.salt), 'hex');
  const b = Buffer.from(lock.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const pinTries = { wrong: 0, until: 0 };
const checkPin = (res, lock, pin) => {
  const wait = Math.ceil((pinTries.until - Date.now()) / 1000);
  if (wait > 0) { res.status(429).json({ ok: false, wait }); return false; }
  if (pinMatches(lock, pin)) { pinTries.wrong = 0; return true; }
  pinTries.wrong += 1;
  if (pinTries.wrong >= 5) { pinTries.wrong = 0; pinTries.until = Date.now() + 30000; }
  res.status(401).json({ ok: false, error: 'wrong-pin' });
  return false;
};
app.get('/api/lock', h(async (req, res) => {
  const lock = (await readMeta({}))[LOCK_KEY] || null;
  res.json({ enabled: !!lock, length: lock?.length || 0 });
}));
app.post('/api/lock/verify', h(async (req, res) => {
  const lock = (await readMeta({}))[LOCK_KEY] || null;
  if (!lock) return res.json({ ok: true });
  if (checkPin(res, lock, req.body?.pin)) res.json({ ok: true });
}));
app.post('/api/lock/set', h(async (req, res) => {
  const { pin, currentPin } = req.body || {};
  if (pin !== null && !PIN_RE.test(String(pin ?? ''))) return res.status(400).json({ error: 'Invalid request', code: 'bad-request' });
  const meta = await readMeta({});
  const lock = meta[LOCK_KEY] || null;
  if (lock && !checkPin(res, lock, currentPin)) return undefined;
  if (pin === null) delete meta[LOCK_KEY];
  else {
    const salt = crypto.randomBytes(16).toString('hex');
    meta[LOCK_KEY] = { salt, hash: pinHash(pin, salt), length: String(pin).length };
  }
  await writeMeta(meta);
  return res.json({ ok: true, enabled: pin !== null });
}));

// ===========================================================================
// EXPORT / IMPORT (the real online backup path)
// ===========================================================================
app.get('/api/export', h(async (req, res) => {
  const [bills, profile, clients, templates, products, expenses, recurring, receipts, profiles, purchases, meta] = await Promise.all([
    readAll('bills'), readProfile(DEFAULT_PROFILE), readAll('clients'), readAll('templates'),
    readAll('products'), readAll('expenses'), readAll('recurring'), readAll('receipts'),
    readAll('profiles'), readAll('purchases'), readMeta({}),
  ]);
  res.json({
    bills, profile, clients, termsTemplates: templates, products, expenses,
    recurring, receipts, profiles, purchases,
    meta: withoutLock(meta),
    exportedAt: new Date().toISOString(),
  });
}));

app.post('/api/import', h(async (req, res) => {
  const data = req.body || {};
  const overwrite = req.query.overwrite === '1' || req.query.overwrite === 'true';
  const counts = {
    billCount: 0, billSkipped: 0, clientCount: 0, clientSkipped: 0,
    templateCount: 0, templateSkipped: 0, productCount: 0, productSkipped: 0,
    expenseCount: 0, expenseSkipped: 0, recurringCount: 0, recurringSkipped: 0,
    receiptCount: 0, receiptSkipped: 0, profileCount: 0, profileSkipped: 0,
    purchaseCount: 0, purchaseSkipped: 0,
  };
  const upsertList = async (collection, list, countKey, skipKey) => {
    for (const entity of list || []) {
      if (!entity?.id) continue;
      if (!overwrite && await exists(collection, entity.id)) { counts[skipKey]++; continue; }
      await writeOne(collection, entity.id, entity);
      counts[countKey]++;
    }
  };
  if (data.profile && (overwrite || !(await readOne('singleton', 'profile')))) await writeProfile(data.profile);
  await upsertList('bills',     data.bills,          'billCount',      'billSkipped');
  await upsertList('clients',   data.clients,        'clientCount',    'clientSkipped');
  await upsertList('templates', data.termsTemplates, 'templateCount',  'templateSkipped');
  await upsertList('products',  data.products,       'productCount',   'productSkipped');
  await upsertList('expenses',  data.expenses,       'expenseCount',   'expenseSkipped');
  await upsertList('recurring', data.recurring,      'recurringCount', 'recurringSkipped');
  await upsertList('receipts',  data.receipts,       'receiptCount',   'receiptSkipped');
  await upsertList('profiles',  data.profiles,       'profileCount',   'profileSkipped');
  await upsertList('purchases', data.purchases,      'purchaseCount',  'purchaseSkipped');

  // meta merge — same gating as server.js
  if (data.meta) {
    const existing = await readMeta({});
    if (overwrite || Object.keys(existing).length === 0) {
      await writeMeta(withLock(withoutLock(data.meta), existing[LOCK_KEY]));
    } else {
      const series = { ...(data.meta.invoiceNumberSeries || {}), ...(existing.invoiceNumberSeries || {}) };
      if (Object.keys(series).length) existing.invoiceNumberSeries = series;
      for (const [k, v] of Object.entries(data.meta)) {
        if (k.startsWith('counter_') && Number(v) > (Number(existing[k]) || 0)) existing[k] = Number(v);
      }
      await writeMeta(existing);
    }
  }

  // Reconcile counters with imported bill numbers so the next reservation
  // doesn't collide (mirrors server.js Data-F12.2).
  try {
    const meta = await readMeta({});
    const maxByPrefix = {}, maxByKey = {};
    for (const bill of await readAll('bills')) {
      const num = String(bill?.invoiceNumber || bill?.id || '');
      const m = num.match(/^([A-Z]+)[\W_].*?(\d+)\s*$/i);
      if (!m) continue;
      const prefix = m[1].toUpperCase();
      const suffix = parseInt(m[2], 10);
      if (!Number.isFinite(suffix)) continue;
      if (!maxByPrefix[prefix] || suffix > maxByPrefix[prefix]) maxByPrefix[prefix] = suffix;
      const typePrefix = INVOICE_TYPES[bill.invoiceType || bill.data?.invoiceType || 'tax-invoice']?.prefix;
      if (typePrefix) {
        const biz = businessKeyOf(bill.data?.profile || { gstin: bill.ownerGstin, businessName: bill.ownerName });
        const ser = numberSeriesFor(meta.invoiceNumberSettings, meta.invoiceNumberSeries, biz);
        const head = formatDocNumber({ settings: { ...ser, format: 'sequential', showFinYear: false }, typePrefix, next: 0 }).replace(/0+$/, '');
        if (num.toUpperCase().startsWith(head.toUpperCase())) {
          const key = counterKeyFor(typePrefix, ser, biz);
          if (!maxByKey[key] || suffix > maxByKey[key]) maxByKey[key] = suffix;
        }
      }
    }
    let changed = false;
    const wanted = { ...Object.fromEntries(Object.entries(maxByPrefix).map(([p, n]) => [`counter_${p}`, n])), ...maxByKey };
    for (const [key, maxNum] of Object.entries(wanted)) {
      if (maxNum > (Number(meta[key]) || 0)) { meta[key] = maxNum; changed = true; }
    }
    if (changed) await writeMeta(meta);
  } catch (err) { console.error('Post-import counter reconciliation failed:', err); }

  res.json({ ...counts, hasProfile: !!data.profile });
}));

// ===========================================================================
// NUMBER SERIES follow a renamed business
// ===========================================================================
app.post('/api/number-series/rename', h(async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to || typeof from !== 'string' || typeof to !== 'string' || from === to) {
    return res.status(400).json({ error: 'Invalid request', code: 'bad-request' });
  }
  const meta = await readMeta({});
  const series = meta.invoiceNumberSeries || {};
  if (!series[from] || series[to]) return res.json({ moved: false });
  series[to] = series[from];
  delete series[from];
  meta.invoiceNumberSeries = series;
  for (const key of Object.keys(meta)) {
    if (key.startsWith('counter_') && key.endsWith(`@${from}`)) {
      const target = key.slice(0, -from.length) + to;
      meta[target] = Math.max(Number(meta[target]) || 0, Number(meta[key]) || 0);
      delete meta[key];
    }
  }
  await writeMeta(meta);
  res.json({ moved: true });
}));

// ===========================================================================
// RECURRING — "Generate Now" (ported from server.js generateFromTemplate)
// ===========================================================================
const templateHasEnded = (tpl, today) =>
  (tpl.endMode === 'onDate' && tpl.endDate && today > tpl.endDate) ||
  (tpl.endMode === 'afterN' && tpl.maxOccurrences && (tpl.occurrencesCreated || 0) >= tpl.maxOccurrences);

// Async invoice-number reservation (read meta, bump counter, format). Not
// atomic across instances, but Generate-Now is a manual one-off action.
async function nextInvoiceNumber(prefix, invoiceType, businessKey) {
  const meta = await readMeta({});
  const series = numberSeriesFor(meta.invoiceNumberSettings, meta.invoiceNumberSeries, businessKey);
  const key = counterKeyFor(prefix, series, businessKey);
  const next = nextCounterValue(meta[key], startFor(invoiceType, series));
  meta[key] = next;
  await writeMeta(meta);
  return formatDocNumber({ settings: series, typePrefix: prefix, next, fyLabel: getFinancialYearLabel() });
}

async function generateFromTemplate(tpl, today) {
  const profiles = await readAll('profiles');
  const profile = profiles.find((p) => p.gstin && tpl.ownerGstin && p.gstin === tpl.ownerGstin)
    || profiles.find((p) => p.id && tpl.profileId && p.id === tpl.profileId)
    || profiles.find((p) => p.businessName && p.businessName === (tpl.profileBusinessName || tpl.ownerName))
    || await readProfile({});
  const prefix = tpl.invoiceType === 'proforma' ? 'EST'
    : tpl.invoiceType === 'quotation' ? 'QUO'
    : tpl.invoiceType === 'credit-note' ? 'CN'
    : tpl.invoiceType === 'bill-of-supply' ? 'BOS'
    : tpl.invoiceType === 'composition' ? 'COMP'
    : tpl.invoiceType === 'delivery-challan' ? 'DC'
    : 'INV';
  const bizKey = businessKeyOf(profile);
  let invoiceNumber = await nextInvoiceNumber(prefix, tpl.invoiceType, bizKey);
  for (let i = 0; i < 50 && await exists('bills', invoiceNumber); i++) {
    invoiceNumber = await nextInvoiceNumber(prefix, tpl.invoiceType, bizKey);
  }
  const invoiceDate = today;
  const ytd = clientYearToDate(await readAll('bills'), tpl.clientName, today);
  const totals = templateTotals(tpl, profile, { tcsCumulativeThisYear: ytd, tdsCumulativeThisYear: ytd });
  const dueDays = Number(tpl.dueDays);
  const dueDate = Number.isFinite(dueDays) && dueDays >= 0 && tpl.dueDays !== '' && tpl.dueDays !== null
    ? addDays(invoiceDate, dueDays) : '';
  const bill = {
    id: invoiceNumber, clientName: tpl.clientName, invoiceNumber, invoiceDate,
    invoiceType: tpl.invoiceType || 'tax-invoice',
    currency: (tpl.invoiceOptions && tpl.invoiceOptions.currency) || 'INR',
    totalAmount: totals.total, totalTaxAmount: totals.totalTaxAmount,
    status: 'unpaid', paidAmount: 0, payments: [],
    generatedFrom: tpl.id, autoGenerated: true, autoGeneratedAt: new Date().toISOString(),
    data: {
      profile,
      client: {
        name: tpl.clientName, state: tpl.clientState, gstin: tpl.clientGstin,
        address: tpl.clientAddress, country: tpl.clientCountry, city: tpl.clientCity,
        pin: tpl.clientPin, email: tpl.clientEmail, phone: tpl.clientPhone, isSEZ: tpl.isSEZ,
      },
      details: { invoiceNumber, invoiceDate, dueDate, placeOfSupply: tpl.placeOfSupply || '' },
      items: (tpl.items || []).map((i) => ({ ...i, name: i.name || i.description || '' })),
      totals, invoiceType: tpl.invoiceType || 'tax-invoice',
      customTerms: tpl.customTerms || '', customNotes: tpl.customNotes || '',
      extraSections: tpl.extraSections || [], invoiceOptions: tpl.invoiceOptions || {},
      taxInclusive: !!tpl.taxInclusive,
    },
  };
  await writeOne('bills', invoiceNumber, bill);
  const from = tpl.nextDate || today;
  if (!tpl.anchorDay && tpl.frequency !== 'weekly') tpl.anchorDay = Number(from.slice(8, 10)) || undefined;
  tpl.nextDate = advanceDate(from, tpl.frequency, tpl.interval, tpl.anchorDay);
  tpl.lastGenerated = today;
  tpl.occurrencesCreated = (tpl.occurrencesCreated || 0) + 1;
  await writeOne('recurring', tpl.id, tpl);
  return invoiceNumber;
}

app.post('/api/recurring/:id/generate', h(async (req, res) => {
  const tpl = (await readAll('recurring')).find((t) => t && t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Recurring template not found' });
  const today = localToday();
  if (templateHasEnded(tpl, today)) return res.status(409).json({ error: 'This template has reached its end date or number of invoices' });
  const invoiceNumber = await generateFromTemplate(tpl, today);
  res.json({ success: true, invoiceNumber });
}));

// Optional Vercel Cron target for the daily auto-fire (serverless has no
// setInterval). Wire it in vercel.json "crons" → "/api/cron/recurring".
app.get('/api/cron/recurring', h(async (req, res) => {
  const today = localToday();
  let made = 0;
  for (const tpl of await readAll('recurring')) {
    if (tpl.active === false || templateHasEnded(tpl, today)) continue;
    const due = (tpl.nextDate || tpl.startDate || today) <= today;
    if (due) { await generateFromTemplate(tpl, today); made++; }
  }
  res.json({ ok: true, generated: made });
}));

// ===========================================================================
// VERSION (frontend reads this once; no bundled package.json needed)
// ===========================================================================
app.get('/api/version', h(async (req, res) => {
  res.json({ current: process.env.APP_VERSION || 'online', latest: null, updateAvailable: false });
}));
app.get('/api/changelog', h(async (req, res) => res.json({ changelog: '' })));
app.get('/api/check-update', h(async (req, res) => res.json({ updateAvailable: false, current: process.env.APP_VERSION || 'online' })));

// ===========================================================================
// TRASH (bills soft-deleted above)
// ===========================================================================
app.get('/api/trash', h(async (req, res) => {
  const items = await readAll('trash');
  items.sort((a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate));
  res.json(items);
}));
app.post('/api/trash/:id/restore', h(async (req, res) => {
  const moved = await moveOne('trash', 'bills', req.params.id);
  res.json({ success: moved });
}));
app.delete('/api/trash/:id', h(async (req, res) => { await deleteOne('trash', req.params.id); res.json({ success: true }); }));

// ===========================================================================
// LOCAL-ONLY features — stubbed so the UI degrades gracefully online.
// (On a user's PC these touched the disk: PDF archive, on-disk backups,
// open-folder, update scripts. None are possible / needed on serverless —
// your backup online is Export/Import, PDFs download client-side.)
// ===========================================================================
app.post('/api/save-pdf', express.raw({ type: 'application/pdf', limit: '20mb' }), (req, res) => res.json({ saved: false, unsupported: true }));
app.post('/api/trash-pdf', (req, res) => res.json({ ok: true, unsupported: true }));
app.post('/api/saved-pdf/cancel-mark', (req, res) => res.json({ ok: true, unsupported: true }));
app.get('/api/backups', (req, res) => res.json([]));
app.post('/api/backups/now', (req, res) => res.json({ success: false, unsupported: true }));
app.delete('/api/backups/:date', (req, res) => res.json({ success: false, unsupported: true }));
app.post('/api/backups/:date/restore', (req, res) => res.json({ success: false, unsupported: true }));
app.get('/api/backup-folder', (req, res) => res.json({ path: '' }));
app.post('/api/backup-folder', (req, res) => res.json({ success: false, unsupported: true }));
app.get('/api/control-panel/status', (req, res) => res.json({ online: true, local: false }));
app.post('/api/control-panel/backup', (req, res) => res.json({ ok: false, unsupported: true }));
app.post('/api/control-panel/open-data-folder', (req, res) => res.json({ ok: false, unsupported: true }));
app.post('/api/control-panel/open-backups-folder', (req, res) => res.json({ ok: false, unsupported: true }));
app.post('/api/control-panel/launch-script', (req, res) => res.json({ ok: false, unsupported: true, error: 'Updates are handled by redeploying on Vercel.' }));

// ===========================================================================
// HEALTH
// ===========================================================================
app.get('/api/health', h(async (req, res) => {
  let dbOk = true;
  try { await readMeta({}); } catch { dbOk = false; }
  res.json({ ok: dbOk, mode: 'online', version: process.env.APP_VERSION || 'online' });
}));

// Unknown /api/* → JSON 404 (don't fall through to the SPA).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'not-found' }));

export default app;
