import { useState, useEffect } from 'react';
import { BedDouble, Plus, LogIn, LogOut, Trash2, X, Pencil, CalendarDays, ReceiptText } from 'lucide-react';
import { toast } from './Toast';
import HelpButton from './HelpButton';
import { getAllRooms, saveRoom, deleteRoom, getAllBookings, saveBooking, deleteBooking, getAllClients, saveClient } from '../store';
import { localToday, formatCurrency, planEventIdBackfill, eventKey } from '../utils';

// ---- date helpers (local, YYYY-MM-DD) ----
const isoAddDays = (iso, n) => {
  const d = iso ? new Date(iso + 'T00:00:00') : new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const nightsBetween = (a, b) => {
  if (!a || !b) return 0;
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
  const n = Math.round((d2 - d1) / 86400000);
  return n > 0 ? n : 0;
};
const fmtDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '');
// A booking "covers" a day when checkIn <= day < checkOut (checkout day is free).
// Stays: checkout day is free (checkIn <= day < checkOut). Event blocks are
// inclusive of both ends, so a single-day event (from == to) still blocks it.
const coversDay = (b, day) => {
  if (!b.checkIn || !b.checkOut) return false;
  if (b.kind === 'block') return b.checkIn <= day && day <= b.checkOut;
  return b.checkIn <= day && day < b.checkOut;
};
const isActive = (b) => b && b.status !== 'cancelled' && b.status !== 'checked-out';
// eventKey (shared with the receipt picker + backfill) groups blocks by eventId
// when present, else by name — see utils.js.

const STATUS = {
  vacant:   { label: 'Vacant',   color: '#059669', bg: 'rgba(5,150,105,0.10)' },
  occupied: { label: 'Occupied', color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
  reserved: { label: 'Reserved', color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
  blocked:  { label: 'Blocked',  color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },
};

// Save a booking; if the server rejects it as a conflict (409), offer the
// operator a deliberate override (e.g. an event ended early and the room is
// genuinely free for a late walk-in). Returns true if saved.
async function saveWithOverride(booking) {
  try {
    await saveBooking(booking);
    return true;
  } catch (e) {
    if (e && e.status === 409) {
      const c = (e.body && e.body.conflicts && e.body.conflicts[0]) || null;
      const who = c ? (c.kind === 'block' ? `event "${c.eventName || ''}"` : `guest ${c.guestName || ''}`) : 'another booking';
      const when = c ? ` (${fmtDate(c.checkIn)}–${fmtDate(c.checkOut)})` : '';
      if (window.confirm(`A room here is already booked/blocked by ${who}${when}.\n\nThis is usually a double-booking. Override and save anyway? (e.g. the event ended early or the room was freed)`)) {
        await saveBooking(booking, { force: true });
        return true;
      }
      return false;
    }
    throw e;
  }
}

export default function FrontDesk({ profile, onCreateInvoiceFromStay }) {
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [tab, setTab] = useState('board');
  const [loading, setLoading] = useState(true);
  const [roomModal, setRoomModal] = useState(null);     // room object (new = {})
  const [bookingModal, setBookingModal] = useState(null); // { mode, roomId?, booking? }
  const [blockModal, setBlockModal] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [blockFilter, setBlockFilter] = useState('all'); // all | upcoming | past
  const [eventDetail, setEventDetail] = useState(null);   // selected event name

  const currency = profile?.currency || 'INR';
  const today = localToday();

  const load = async () => {
    setLoading(true);
    try {
      const [r, b] = await Promise.all([getAllRooms(), getAllBookings()]);
      setRooms(r);
      // One-time migration: give legacy event blocks (created before eventId
      // existed) a stable id, grouped by name. Acts only on the first load that
      // finds un-keyed blocks; afterwards the plan is empty, so this is a no-op.
      const toFix = planEventIdBackfill(b);
      if (toFix.length) {
        for (const blk of toFix) { try { await saveBooking(blk, { force: true }); } catch { /* retried next load */ } }
        setBookings(await getAllBookings());
        toast(`Updated grouping for ${toFix.length} older event block${toFix.length > 1 ? 's' : ''}`, 'success');
      } else {
        setBookings(b);
      }
    } catch { toast('Could not load front desk data', 'error'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const roomById = (id) => rooms.find((r) => r.id === id);
  // Split a list of space ids into guest rooms vs. venues (halls/outdoor).
  const splitSpaces = (ids) => {
    const roomsOut = [], venues = [];
    for (const id of ids || []) { const r = roomById(id); if (!r) continue; (r.isHall ? venues : roomsOut).push(r.number); }
    return { rooms: roomsOut, venues };
  };
  const roomBooking = (roomId) => bookings.find((b) => isActive(b) && (b.roomIds || []).includes(roomId) && coversDay(b, today));
  const roomStatus = (room) => {
    const b = roomBooking(room.id);
    if (!b) return { key: 'vacant', booking: null };
    if (b.kind === 'block') return { key: 'blocked', booking: b };
    if (b.status === 'checked-in') return { key: 'occupied', booking: b };
    return { key: 'reserved', booking: b };
  };

  // ---- actions ----
  // Status transitions (check-in / check-out / cancel) on an existing booking
  // must never be blocked by conflict validation — they don't create new
  // overlaps — so they always force.
  const persistBooking = async (b) => { try { await saveBooking(b, { force: true }); await load(); return true; } catch { toast('Save failed', 'error'); return false; } };

  const doCheckIn = async (b) => { if (await persistBooking({ ...b, status: 'checked-in', checkedInAt: new Date().toISOString() })) toast(`${b.guestName || 'Guest'} checked in`, 'success'); };

  // Build the pre-filled GST invoice for a stay (used by checkout-and-bill and
  // by the "Bill" action in History for an already-checked-out stay).
  const billFromBooking = (b) => {
    const nights = nightsBetween(b.checkIn, b.checkOut) || 1;
    const roomNos = (b.roomIds || []).map((id) => roomById(id)?.number).filter(Boolean).join(', ');
    const items = (b.roomIds || []).map((id, i) => {
      const room = roomById(id);
      return {
        id: `${Date.now()}_${i}`,
        name: [room?.type, room?.number ? `(Room ${room.number})` : ''].filter(Boolean).join(' ') || 'Room charges',
        hsn: '996311', quantity: nights, unit: 'Day',
        rate: Number(b.ratePerNight || room?.baseRate || 0),
        discount: 0, taxPercent: 5, cessPercent: 0,
      };
    });
    if (!items.length) items.push({ id: `${Date.now()}`, name: 'Room charges', hsn: '996311', quantity: nights, unit: 'Day', rate: Number(b.ratePerNight || 0), discount: 0, taxPercent: 5, cessPercent: 0 });
    onCreateInvoiceFromStay({
      clientName: b.guestName || '',
      invoiceType: 'tax-invoice',
      data: {
        client: { name: b.guestName || '', companyName: b.companyName || '', phone: b.guestPhone || '', gstin: b.guestGstin || '', address: b.address || '', city: '', pin: '', state: '', country: 'India', email: '', isSEZ: false },
        items,
        details: { checkIn: b.checkIn, checkOut: b.checkOut, roomNo: roomNos, guests: b.guests || '', invoiceDate: today },
        invoiceType: 'tax-invoice',
        customTerms: 'Subject to Garoth (M.P.) jurisdiction only.',
      },
    });
  };

  const doCheckOutAndBill = async (b) => {
    if (!(await persistBooking({ ...b, status: 'checked-out', checkedOutAt: new Date().toISOString() }))) return;
    billFromBooking(b);
  };

  const doCheckOutOnly = async (b) => { if (await persistBooking({ ...b, status: 'checked-out', checkedOutAt: new Date().toISOString() })) toast('Checked out', 'success'); };

  const removeBooking = async (b, label = 'Booking') => {
    if (!window.confirm(`Remove this ${label.toLowerCase()}?`)) return;
    try { await deleteBooking(b.id); await load(); toast(`${label} removed`, 'info'); } catch { toast('Delete failed', 'error'); }
  };

  // Cancel (undo) a check-in or reservation — frees the room, no bill; it is
  // kept in History marked as cancelled rather than deleted.
  const cancelBooking = async (b, label = 'booking') => {
    if (!window.confirm(`Cancel this ${label}? The room is freed and no bill is made (it stays in History as cancelled).`)) return;
    if (await persistBooking({ ...b, status: 'cancelled', cancelledAt: new Date().toISOString() })) toast('Cancelled', 'info');
  };

  const removeRoom = async (room) => {
    const active = bookings.filter((b) => isActive(b) && (b.roomIds || []).includes(room.id));
    if (active.length) { toast(`Can't delete ${room.number} — it has ${active.length} active booking/block. Check out or cancel them first.`, 'error'); return; }
    if (!window.confirm(`Delete room ${room.number}?`)) return;
    try { await deleteRoom(room.id); await load(); toast('Room deleted', 'info'); } catch { toast('Delete failed', 'error'); }
  };

  // Today strip
  const arrivals = bookings.filter((b) => isActive(b) && b.kind !== 'block' && b.status === 'reserved' && b.checkIn === today);
  const departures = bookings.filter((b) => b.kind !== 'block' && b.status === 'checked-in' && b.checkOut === today);
  const reservations = bookings.filter((b) => isActive(b) && b.kind !== 'block' && b.status !== 'checked-in').sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
  const blocks = bookings.filter((b) => isActive(b) && b.kind === 'block').sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
  // Group blocks into events (same name), with span + distinct room count.
  const eventGroups = Object.values(blocks.reduce((acc, b) => {
    const key = eventKey(b);
    (acc[key] = acc[key] || { key, name: (b.eventName || 'Event').trim(), eventId: b.eventId, items: [] }).items.push(b);
    return acc;
  }, {})).map((g) => {
    const items = [...g.items].sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
    const split = splitSpaces([...new Set(items.flatMap((b) => b.roomIds || []))]);
    return { ...g, items, from: items[0].checkIn, to: items[items.length - 1].checkOut, roomCount: split.rooms.length, venueCount: split.venues.length, notes: items[0].notes };
  }).sort((a, c) => (a.from || '').localeCompare(c.from || ''));
  const filteredEvents = eventGroups
    .filter((g) => !blockSearch.trim() || g.name.toLowerCase().includes(blockSearch.trim().toLowerCase()))
    .filter((g) => blockFilter === 'all' || (blockFilter === 'upcoming' ? g.to >= today : g.to < today));
  const history = bookings.filter((b) => b.kind !== 'block' && (b.status === 'checked-out' || b.status === 'cancelled'))
    .sort((a, b) => (b.checkedOutAt || b.checkOut || '').localeCompare(a.checkedOutAt || a.checkOut || ''));

  const guestRooms = rooms.filter((r) => !r.isHall);
  const occupiedCount = guestRooms.filter((r) => roomStatus(r).key === 'occupied').length;

  // Board is grouped by floor in this order, then any others.
  const FLOOR_ORDER = ['Ground', 'First', 'Second', 'Outdoor'];
  const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
  const floorsPresent = [...new Set(rooms.map((r) => r.floor || 'Other'))];
  const orderedFloors = [...FLOOR_ORDER.filter((f) => floorsPresent.includes(f)), ...floorsPresent.filter((f) => !FLOOR_ORDER.includes(f))];

  const renderCard = (room) => {
    const { key, booking } = roomStatus(room);
    const s = STATUS[key];
    const hall = !!room.isHall;
    return (
      <div key={room.id} className="glass-panel" style={{ padding: '0.85rem', borderLeft: `4px solid ${s.color}`, background: s.bg, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
          <strong style={{ fontSize: hall ? '0.9rem' : '1.05rem' }}>{room.number}</strong>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</span>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{hall ? '🏛 ' : ''}{room.type || 'Room'}{!hall && room.baseRate ? ` · ${formatCurrency(room.baseRate, currency)}/night` : ''}</div>
        {booking && (
          <div style={{ fontSize: '0.8rem' }}>
            <div style={{ fontWeight: 600 }}>{booking.kind === 'block' ? `🎉 ${booking.eventName || 'Event'}` : (booking.guestName || 'Guest')}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{fmtDate(booking.checkIn)} → {fmtDate(booking.checkOut)}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
          {hall ? (
            key === 'blocked'
              ? <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => removeBooking(booking, 'Event block')}><X size={13} /> Release</button>
              : <button className="btn btn-primary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => setBlockModal({ preselect: [room.id] })}><CalendarDays size={13} /> Block</button>
          ) : (<>
            {key === 'vacant' && <button className="btn btn-primary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => setBookingModal({ mode: 'checkin', roomId: room.id })}><LogIn size={13} /> Check in</button>}
            {key === 'reserved' && <>
              <button className="btn btn-primary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => doCheckIn(booking)}><LogIn size={13} /> Check in</button>
              <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.5rem' }} onClick={() => cancelBooking(booking, 'reservation')} title="Cancel reservation"><Trash2 size={13} /></button>
            </>}
            {key === 'occupied' && <>
              <button className="btn btn-primary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => doCheckOutAndBill(booking)} title="Check out and create the GST invoice"><ReceiptText size={13} /> Checkout &amp; bill</button>
              <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.5rem' }} onClick={() => doCheckOutOnly(booking)} title="Check out without billing"><LogOut size={13} /></button>
              <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.5rem' }} onClick={() => cancelBooking(booking, 'check-in')} title="Cancel this check-in (mistake) — frees the room, no bill"><Trash2 size={13} /></button>
            </>}
            {key === 'blocked' && <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => removeBooking(booking, 'Event block')}><X size={13} /> Release</button>}
          </>)}
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <h1 className="page-title">Front Desk</h1>
            <p className="page-subtitle">
              {guestRooms.length} rooms · {occupiedCount} occupied · {guestRooms.length - occupiedCount} available today
            </p>
          </div>
          <HelpButton title="Front Desk — how to use" doc="products">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Rooms</strong> tab: add your rooms once (number, type, tariff).</li>
              <li><strong>Board</strong>: each room shows Vacant / Occupied / Reserved / Blocked for today. Check in and out from here.</li>
              <li><strong>Check out</strong> frees the room and opens a pre-filled GST invoice (nights × tariff).</li>
              <li><strong>Reservations</strong>: future bookings; mark them checked-in on arrival.</li>
              <li><strong>Block for event</strong>: hold several rooms for a date range (wedding, conference).</li>
            </ul>
          </HelpButton>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setBlockModal(true)}><CalendarDays size={16} /> Block for event</button>
          <button className="btn btn-secondary" onClick={() => setBookingModal({ mode: 'reserve' })}><Plus size={16} /> New reservation</button>
          <button className="btn btn-primary" onClick={() => setBookingModal({ mode: 'checkin' })}><LogIn size={16} /> Check in</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[['board', 'Board'], ['reservations', `Reservations${reservations.length ? ` (${reservations.length})` : ''}`], ['blocks', `Events${eventGroups.length ? ` (${eventGroups.length})` : ''}`], ['history', `History${history.length ? ` (${history.length})` : ''}`], ['rooms', 'Rooms']].map(([k, label]) => (
          <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : tab === 'board' ? (
        <>
          {(arrivals.length > 0 || departures.length > 0) && (
            <div className="glass-panel" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
              <span><strong style={{ color: STATUS.reserved.color }}>Arrivals today:</strong> {arrivals.length ? arrivals.map((a) => a.guestName).join(', ') : '—'}</span>
              <span><strong style={{ color: STATUS.occupied.color }}>Departures today:</strong> {departures.length ? departures.map((d) => d.guestName).join(', ') : '—'}</span>
            </div>
          )}
          {rooms.length === 0 ? (
            <div className="glass-panel empty-state"><BedDouble size={48} /><p>No rooms yet. Add your rooms to start.</p><button className="btn btn-primary" onClick={() => { setTab('rooms'); setRoomModal({}); }}><Plus size={18} /> Add Room</button></div>
          ) : (
            <>
              {orderedFloors.map((floor) => {
                const fr = rooms.filter((r) => (r.floor || 'Other') === floor).sort(byNumber);
                if (!fr.length) return null;
                return (
                  <div key={floor} style={{ marginBottom: '1.25rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {floor === 'Other' ? 'Other' : `${floor} Floor`} · {fr.length}
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
                      {fr.map((room) => renderCard(room))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      ) : tab === 'reservations' ? (
        <div className="glass-panel" style={{ padding: 0 }}>
          {reservations.length === 0 ? (
            <div className="empty-state"><CalendarDays size={48} /><p>No upcoming reservations.</p><button className="btn btn-primary" onClick={() => setBookingModal({ mode: 'reserve' })}><Plus size={18} /> New reservation</button></div>
          ) : (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Status</th><th className="col-center">Actions</th></tr></thead>
              <tbody>{reservations.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">{b.guestName}{b.guestPhone ? <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{b.guestPhone}</div> : null}</td>
                  <td>{(b.roomIds || []).map((id) => roomById(id)?.number || '?').join(', ')}</td>
                  <td>{fmtDate(b.checkIn)}</td>
                  <td>{fmtDate(b.checkOut)}</td>
                  <td>{nightsBetween(b.checkIn, b.checkOut)}</td>
                  <td><span style={{ color: STATUS.reserved.color, fontWeight: 600, fontSize: '0.8rem' }}>Reserved</span></td>
                  <td><div className="table-actions" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-primary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => doCheckIn(b)}><LogIn size={13} /> Check in</button>
                    <button className="icon-btn" title="Edit" onClick={() => setBookingModal({ mode: 'reserve', booking: b })}><Pencil size={14} /></button>
                    <button className="icon-btn icon-btn-red" title="Cancel" onClick={() => removeBooking(b, 'Reservation')}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}</tbody></table></div>
          )}
        </div>
      ) : tab === 'blocks' ? (
        <div>
          {blocks.length === 0 ? (
            <div className="glass-panel empty-state"><CalendarDays size={48} /><p>No event blocks. Hold rooms for a wedding, conference, etc.</p><button className="btn btn-primary" onClick={() => setBlockModal(true)}><Plus size={18} /> Block for event</button></div>
          ) : (<>
            <div className="glass-panel" style={{ padding: '0.6rem 0.85rem', marginBottom: '0.75rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="text" className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder="Search events by name…" value={blockSearch} onChange={(e) => setBlockSearch(e.target.value)} />
              <select className="form-input" style={{ width: 'auto' }} value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
              </select>
            </div>
            {filteredEvents.length === 0 ? (
              <div className="glass-panel empty-state"><CalendarDays size={40} /><p>No events match.</p></div>
            ) : filteredEvents.map((g) => (
              <button key={g.key} type="button" className="glass-panel" onClick={() => setEventDetail(g.key)}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '0.85rem 1rem', marginBottom: '0.6rem', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: '0.95rem' }}>🎉 {g.name}</strong>
                  {g.to < today && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 6 }}>(past)</span>}
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {fmtDate(g.from)}{g.to !== g.from ? ` – ${fmtDate(g.to)}` : ''} · {g.items.length} day{g.items.length > 1 ? 's' : ''} · {g.roomCount} room{g.roomCount !== 1 ? 's' : ''}{g.venueCount > 0 ? ` · ${g.venueCount} venue${g.venueCount !== 1 ? 's' : ''}` : ''}
                  </div>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>View ›</span>
              </button>
            ))}
          </>)}
        </div>
      ) : tab === 'history' ? (
        <div className="glass-panel" style={{ padding: 0 }}>
          {history.length === 0 ? (
            <div className="empty-state"><CalendarDays size={48} /><p>No past stays yet. Checked-out guests will appear here.</p></div>
          ) : (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Status</th><th className="col-center">Bill</th></tr></thead>
              <tbody>{history.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">{b.guestName || '—'}{b.guestPhone ? <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{b.guestPhone}</div> : null}</td>
                  <td>{(b.roomIds || []).map((id) => roomById(id)?.number || '?').join(', ')}</td>
                  <td>{fmtDate(b.checkIn)}</td>
                  <td>{fmtDate(b.checkOut)}</td>
                  <td>{nightsBetween(b.checkIn, b.checkOut)}</td>
                  <td><span style={{ fontWeight: 600, fontSize: '0.8rem', color: b.status === 'cancelled' ? 'var(--text-muted)' : STATUS.occupied.color }}>{b.status === 'cancelled' ? 'Cancelled' : 'Checked out'}</span></td>
                  <td style={{ textAlign: 'center' }}>{b.status === 'checked-out' && (
                    <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }} onClick={() => billFromBooking(b)} title="Generate the GST invoice for this stay"><ReceiptText size={13} /> Bill</button>
                  )}</td>
                </tr>
              ))}</tbody></table></div>
          )}
        </div>
      ) : (
        /* Rooms setup */
        <div className="glass-panel" style={{ padding: 0 }}>
          <div className="table-header"><h3>Rooms</h3><button className="btn btn-primary" onClick={() => setRoomModal({})}><Plus size={16} /> Add Room</button></div>
          {rooms.length === 0 ? (
            <div className="empty-state"><BedDouble size={48} /><p>No rooms yet. Add your first room.</p></div>
          ) : (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Room No.</th><th>Type</th><th>Floor</th><th>Tariff / night</th><th className="col-center">Actions</th></tr></thead>
              <tbody>{rooms.map((room) => (
                <tr key={room.id}>
                  <td className="font-medium">{room.number}</td>
                  <td>{room.type || '-'}</td>
                  <td>{room.floor || '-'}</td>
                  <td>{room.baseRate ? formatCurrency(room.baseRate, currency) : '-'}</td>
                  <td><div className="table-actions" style={{ justifyContent: 'center' }}>
                    <button className="icon-btn icon-btn-blue" title="Edit" onClick={() => setRoomModal(room)}><Pencil size={14} /></button>
                    <button className="icon-btn icon-btn-red" title="Delete" onClick={() => removeRoom(room)}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}</tbody></table></div>
          )}
        </div>
      )}

      {roomModal && <RoomModal room={roomModal} onClose={() => setRoomModal(null)} onSaved={async () => { setRoomModal(null); await load(); }} />}
      {bookingModal && <BookingModal rooms={rooms} bookings={bookings} ctx={bookingModal} onClose={() => setBookingModal(null)} onSaved={async () => { setBookingModal(null); await load(); }} />}
      {blockModal && <BlockModal rooms={rooms} bookings={bookings} initialSelected={(blockModal && blockModal.preselect) || []} editBlock={(blockModal && blockModal.editBlock) || null} addEvent={(blockModal && blockModal.addEvent) || null} onClose={() => setBlockModal(false)} onSaved={async () => { setBlockModal(false); await load(); }} />}
      {eventDetail && (() => {
        const days = blocks.filter((b) => eventKey(b) === eventDetail).sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
        const evName = days[0]?.eventName || 'Event';
        return (
          <div className="modal-overlay" onClick={() => setEventDetail(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="section-title" style={{ margin: 0 }}>🎉 {evName}</h3>
                <button className="icon-btn" onClick={() => setEventDetail(null)}><X size={18} /></button>
              </div>
              {days.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No days left for this event.</p>
              ) : (<>
                {days[0].notes && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>{days[0].notes}</p>}
                {days.map((b) => (
                  <div key={b.id} style={{ padding: '0.6rem 0', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: '0.88rem' }}>{fmtDate(b.checkIn)}{b.checkOut !== b.checkIn ? ` – ${fmtDate(b.checkOut)}` : ''}</strong>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }} onClick={() => { setBlockModal({ editBlock: b }); setEventDetail(null); }}><Pencil size={13} /> Edit</button>
                        <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }} onClick={() => removeBooking(b, 'Event block')}><Trash2 size={13} /> Remove day</button>
                      </div>
                    </div>
                    {(() => {
                      const s = splitSpaces(b.roomIds);
                      return (
                        <div style={{ fontSize: '0.82rem', marginTop: 4 }}>
                          <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Rooms ({s.rooms.length}):</span> {s.rooms.join(', ') || '—'}</div>
                          {s.venues.length > 0 && <div style={{ marginTop: 2 }}><span style={{ color: '#7c3aed', fontWeight: 600 }}>Venues ({s.venues.length}):</span> {s.venues.join(', ')}</div>}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </>)}
              <div className="flex gap-2 justify-end mt-4">
                {days.length > 0 && (
                  <button className="btn btn-secondary" onClick={() => { setBlockModal({ addEvent: { eventId: days[0].eventId, eventName: evName } }); setEventDetail(null); }}><Plus size={14} /> Add day</button>
                )}
                <button className="btn btn-primary" onClick={() => setEventDetail(null)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------- Room modal ----------------
function RoomModal({ room, onClose, onSaved }) {
  const [form, setForm] = useState({ number: room.number || '', type: room.type || '', floor: room.floor || '', baseRate: room.baseRate ?? '', notes: room.notes || '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!String(form.number).trim()) { toast('Room number is required', 'warning'); return; }
    setSaving(true);
    try {
      await saveRoom({ ...room, number: String(form.number).trim(), type: form.type.trim(), floor: String(form.floor).trim(), baseRate: form.baseRate === '' ? 0 : parseFloat(form.baseRate), notes: form.notes.trim() });
      toast(room.id ? 'Room updated' : 'Room added', 'success'); onSaved();
    } catch { toast('Save failed', 'error'); setSaving(false); }
  };
  return (
    <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: 460 }}>
      <div className="flex justify-between items-center mb-4"><h3 className="section-title" style={{ margin: 0 }}>{room.id ? 'Edit Room' : 'Add Room'}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group"><label className="form-label">Room No. *</label><input className="form-input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="e.g. 101" /></div>
        <div className="form-group"><label className="form-label">Type</label><input className="form-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="e.g. Deluxe, Suite" /></div>
        <div className="form-group"><label className="form-label">Floor</label><input className="form-input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="e.g. 1" /></div>
        <div className="form-group"><label className="form-label">Tariff / night (₹)</label><input type="number" className="form-input" value={form.baseRate} onChange={(e) => setForm({ ...form, baseRate: e.target.value })} placeholder="0.00" min="0" step="any" /></div>
        <div className="form-group full-width"><label className="form-label">Notes</label><input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. sea-facing, non-smoking" /></div>
      </div>
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{room.id ? 'Update' : 'Save'}</button></div>
    </div></div>
  );
}

// ---------------- Booking modal (reserve / check-in) ----------------
function BookingModal({ rooms, bookings, ctx, onClose, onSaved }) {
  const b = ctx.booking || {};
  const today = localToday();
  const [form, setForm] = useState({
    guestName: b.guestName || '', guestPhone: b.guestPhone || '', companyName: b.companyName || '', guestGstin: b.guestGstin || '', address: b.address || '',
    roomId: ctx.roomId || (b.roomIds && b.roomIds[0]) || '',
    checkIn: b.checkIn || today, checkOut: b.checkOut || isoAddDays(today, 1),
    ratePerNight: b.ratePerNight ?? '', guests: b.guests || '', advance: b.advance ?? '', notes: b.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const reserve = ctx.mode === 'reserve';

  // Guest autocomplete from the saved guests (same list as the invoice form).
  const [clients, setClients] = useState([]);
  const [showGuestSuggest, setShowGuestSuggest] = useState(false);
  useEffect(() => { getAllClients().then(setClients).catch(() => {}); }, []);
  const guestMatches = form.guestName.trim()
    ? clients.filter((c) => (c.name || '').toLowerCase().includes(form.guestName.trim().toLowerCase())).slice(0, 6)
    : [];
  const pickGuest = (c) => {
    setForm((f) => ({
      ...f,
      guestName: c.name || '',
      guestPhone: c.phone || f.guestPhone,
      companyName: c.companyName || f.companyName,
      guestGstin: c.gstin || f.guestGstin,
      address: c.address || f.address,
    }));
    setShowGuestSuggest(false);
  };

  // default rate from the chosen room
  useEffect(() => {
    if (form.roomId && (form.ratePerNight === '' || form.ratePerNight == null)) {
      const r = rooms.find((x) => x.id === form.roomId);
      if (r?.baseRate) setForm((f) => ({ ...f, ratePerNight: r.baseRate }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.roomId]);

  const nights = nightsBetween(form.checkIn, form.checkOut);
  const save = async () => {
    if (!form.guestName.trim()) { toast('Guest name is required', 'warning'); return; }
    if (!form.roomId) { toast('Pick a room', 'warning'); return; }
    if (nights <= 0) { toast('Check-out must be after check-in', 'warning'); return; }
    const bookingObj = {
      ...b, kind: 'stay', status: reserve ? 'reserved' : 'checked-in',
      roomIds: [form.roomId], guestName: form.guestName.trim(), guestPhone: form.guestPhone.trim(),
      companyName: form.companyName.trim(), guestGstin: form.guestGstin.trim().toUpperCase(), address: form.address.trim(),
      checkIn: form.checkIn, checkOut: form.checkOut,
      ratePerNight: form.ratePerNight === '' ? 0 : parseFloat(form.ratePerNight),
      guests: form.guests.trim(), advance: form.advance === '' ? 0 : parseFloat(form.advance), notes: form.notes.trim(),
      ...(reserve ? {} : { checkedInAt: b.checkedInAt || new Date().toISOString() }),
    };
    setSaving(true);
    try {
      const ok = await saveWithOverride(bookingObj);
      if (!ok) { setSaving(false); return; }
      // Grow the guest directory so repeat guests autocomplete next time.
      const known = clients.some((c) => (c.name || '').trim().toLowerCase() === form.guestName.trim().toLowerCase());
      if (!known) {
        try { await saveClient({ name: form.guestName.trim(), phone: form.guestPhone.trim(), companyName: form.companyName.trim(), gstin: form.guestGstin.trim().toUpperCase(), address: form.address.trim(), country: 'India' }); } catch { /* non-blocking */ }
      }
      toast(reserve ? 'Reservation saved' : `${form.guestName.trim()} checked in`, 'success'); onSaved();
    } catch { toast('Save failed', 'error'); setSaving(false); }
  };

  return (
    <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: 520 }}>
      <div className="flex justify-between items-center mb-4"><h3 className="section-title" style={{ margin: 0 }}>{reserve ? (b.id ? 'Edit reservation' : 'New reservation') : 'Check in guest'}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group" style={{ position: 'relative' }}>
          <label className="form-label">Guest name *</label>
          <input className="form-input" value={form.guestName} autoComplete="off"
            onChange={(e) => { setForm({ ...form, guestName: e.target.value }); setShowGuestSuggest(true); }}
            onFocus={() => setShowGuestSuggest(true)}
            onBlur={() => setTimeout(() => setShowGuestSuggest(false), 150)}
            placeholder="Type to search saved guests or add new" />
          {showGuestSuggest && guestMatches.length > 0 && (
            <div className="client-suggestions">
              {guestMatches.map((c) => (
                <button type="button" key={c.id} className="client-suggestion-item" onMouseDown={() => pickGuest(c)}>
                  <div className="client-suggestion-main">
                    <strong>{c.name}</strong>
                    {(c.companyName || c.phone) && <small className="client-suggestion-addr">{c.companyName || c.phone}</small>}
                  </div>
                  <span>{c.phone || ''}{c.gstin ? ` · ${c.gstin}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.guestPhone} onChange={(e) => setForm({ ...form, guestPhone: e.target.value })} placeholder="+91 …" /></div>
        <div className="form-group"><label className="form-label">Company (optional)</label><input className="form-input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="For corporate bookings" /></div>
        <div className="form-group"><label className="form-label">GSTIN (optional)</label><input className="form-input" value={form.guestGstin} onChange={(e) => setForm({ ...form, guestGstin: e.target.value.toUpperCase() })} maxLength={15} /></div>
        <div className="form-group full-width"><label className="form-label">Address</label><input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Guest address / city (prints on the bill)" /></div>
        <div className="form-group"><label className="form-label">Room *</label>
          <select className="form-input" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value, ratePerNight: '' })}>
            <option value="">Select room</option>
            {rooms.filter((r) => !r.isHall).map((r) => <option key={r.id} value={r.id}>{r.number}{r.type ? ` — ${r.type}` : ''}</option>)}
          </select>
        </div>
        <div className="form-group"><label className="form-label">Guests (pax)</label><input className="form-input" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} placeholder="e.g. 2 adults" /></div>
        <div className="form-group"><label className="form-label">Check-in *</label><input type="date" className="form-input" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">Check-out *</label><input type="date" className="form-input" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">Tariff / night (₹)</label><input type="number" className="form-input" value={form.ratePerNight} onChange={(e) => setForm({ ...form, ratePerNight: e.target.value })} placeholder="0.00" min="0" step="any" /></div>
        <div className="form-group"><label className="form-label">Advance paid (₹)</label><input type="number" className="form-input" value={form.advance} onChange={(e) => setForm({ ...form, advance: e.target.value })} placeholder="0.00" min="0" step="any" /></div>
        <div className="form-group full-width"><label className="form-label">Notes</label><input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Special requests, ID, etc." /></div>
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{nights > 0 ? `${nights} night${nights > 1 ? 's' : ''}` : 'Set valid dates'}</div>
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{reserve ? 'Save reservation' : 'Check in'}</button></div>
    </div></div>
  );
}

// ---------------- Event-block modal (bulk) ----------------
function BlockModal({ rooms, bookings = [], initialSelected = [], editBlock = null, addEvent = null, onClose, onSaved }) {
  const today = localToday();
  const [form, setForm] = useState({
    eventName: editBlock?.eventName || addEvent?.eventName || '',
    checkIn: editBlock?.checkIn || today,
    checkOut: editBlock?.checkOut || isoAddDays(today, 1),
    notes: editBlock?.notes || '',
  });
  const [selected, setSelected] = useState(() => new Set(editBlock?.roomIds || initialSelected));
  const [saving, setSaving] = useState(false);
  const allSelected = selected.size === rooms.length && rooms.length > 0;
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rooms.map((r) => r.id)));
  const nights = nightsBetween(form.checkIn, form.checkOut);

  const save = async () => {
    if (!form.eventName.trim()) { toast('Event name is required', 'warning'); return; }
    if (selected.size === 0) { toast('Select at least one room', 'warning'); return; }
    if (!form.checkIn || !form.checkOut || form.checkOut < form.checkIn) { toast('Pick a valid date range', 'warning'); return; }
    setSaving(true);
    try {
      const eventId = editBlock ? editBlock.eventId : (addEvent ? addEvent.eventId : 'evt_' + Date.now());
      const ok = await saveWithOverride({ ...(editBlock || {}), kind: 'block', status: 'reserved', eventId, eventName: form.eventName.trim(), roomIds: [...selected], checkIn: form.checkIn, checkOut: form.checkOut, notes: form.notes.trim() });
      if (!ok) { setSaving(false); return; }
      toast(editBlock ? `Updated "${form.eventName.trim()}"` : `Blocked ${selected.size} room${selected.size > 1 ? 's' : ''} for ${form.eventName.trim()}`, 'success'); onSaved();
    } catch { toast('Save failed', 'error'); setSaving(false); }
  };

  return (
    <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: 560 }}>
      <div className="flex justify-between items-center mb-4"><h3 className="section-title" style={{ margin: 0 }}>{editBlock ? 'Edit event block' : addEvent ? `Add a day to ${addEvent.eventName}` : 'Block rooms for an event'}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group full-width"><label className="form-label">Event name *</label><input className="form-input" value={form.eventName} readOnly={!!addEvent} style={addEvent ? { opacity: 0.7, cursor: 'not-allowed' } : undefined} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. Sharma Wedding, Corporate Conference" /></div>
        <div className="form-group"><label className="form-label">From *</label><input type="date" className="form-input" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">To *</label><input type="date" className="form-input" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></div>
        <div className="form-group full-width"><label className="form-label">Notes</label><input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Contact, catering, etc." /></div>
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label className="form-label" style={{ margin: 0 }}>Rooms to block ({selected.size} selected)</label>
          <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }} onClick={toggleAll}>{allSelected ? 'Clear all' : 'Select all'}</button>
        </div>
        {rooms.length === 0 ? <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Add rooms first.</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {rooms.map((r) => (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '0.3rem 0.4rem', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: selected.has(r.id) ? 'var(--primary-light)' : 'transparent' }}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} style={{ accentColor: 'var(--primary)' }} />
                {r.number}
              </label>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{(form.checkIn && form.checkOut && form.checkOut >= form.checkIn) ? `${nights + 1} day${nights + 1 > 1 ? 's' : ''} blocked` : 'Pick a valid date range'}</div>
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{editBlock ? 'Save changes' : addEvent ? 'Add day' : 'Block rooms'}</button></div>
    </div></div>
  );
}
