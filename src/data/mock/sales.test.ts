import { afterEach, describe, expect, it } from 'vitest';
import { kofiNoonIso, migrateState, MockDataSource } from './MockDataSource';
import { buildSeed, type MockState } from './seed';
import { ForbiddenError, NotFoundError, ValidationError, type ProgrammeInput } from '../DataSource';
import type { CallTerms, OpenCall, Viewer } from '@/domain/types';
import { kofiDay } from '@/domain/reports';

const visitor: Viewer = { role: 'public', displayName: 'Visitor' };
const admin: Viewer = { role: 'admin', userId: 'user_quincy', displayName: 'Quincy' };
const mara: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
const deshawn: Viewer = { role: 'artist', userId: 'user_deshawn', artistId: 'art_deshawn', displayName: 'DeShawn Ferris' };
const priya: Viewer = { role: 'artist', userId: 'user_priya', artistId: 'art_priya', displayName: 'Priya Venkataraman' };
const lena: Viewer = { role: 'curator', userId: 'user_lena', curatorId: 'cur_lena', curatorVerified: true, displayName: 'Lena Marchetti' };
/** Owen is pending; the client's claim to be verified is ignored. */
const owen: Viewer = { role: 'curator', userId: 'user_owen', curatorId: 'cur_owen', curatorVerified: true, displayName: 'Owen Blackwood' };
const spoofLena: Viewer = { role: 'curator', userId: 'user_owen', curatorId: 'cur_lena', curatorVerified: true, displayName: 'Not Lena' };

const T = Date.parse('2026-10-20T16:00:00Z');
const CMA_TERMS: CallTerms = { artistSharePct: 70, kofiSharePct: 20, partnerSharePct: 10, buyerPremiumPct: 10, resaleRoyaltyPct: 5, currency: 'USD', paymentNote: 'Artists are paid within 30 days of the auction.' };

function make() {
  let n = 0;
  const ds = new MockDataSource({ persist: false, now: () => new Date(T), idFactory: (p) => `${p}_t${++n}` });
  return { ds };
}

const draft = (over: Partial<ProgrammeInput<OpenCall>> = {}): ProgrammeInput<OpenCall> => ({
  sample: true,
  published: true,
  kind: 'auction',
  title: 'Spring Benefit',
  summary: 'A benefit auction.',
  body: 'Body.',
  eligibility: 'Approved artists',
  mediums: [],
  opensOn: '2026-11-01',
  deadline: '2026-12-01',
  maxWorks: 2,
  fee: 'No entry fee',
  terms: CMA_TERMS,
  ...over,
});

async function err(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}
async function expectValidation(p: Promise<unknown>, field: string, message?: string | RegExp) {
  const e = await err(p);
  expect(e, field).toBeInstanceOf(ValidationError);
  expect((e as ValidationError).field).toBe(field);
  if (message) expect((e as ValidationError).message).toMatch(message);
}

describe('seed', () => {
  it('every call has a kind; the CMA auction has its terms, three applications, three lots and two payouts', async () => {
    const { ds } = make();
    const kinds = Object.fromEntries((await ds.listOpenCalls(admin)).map((c) => [c.id, c.kind]));
    expect(kinds).toEqual({ call_night_weather: 'award', call_soft_ground: 'exhibition', call_cma_auction: 'auction', call_summer_open: 'exhibition', call_advocacy: 'exhibition' });
    const cma = (await ds.getOpenCall(visitor, 'call_cma_auction'))!;
    expect(cma).toMatchObject({ organizerInstitutionId: 'inst_cma', partner: 'Carnegie Museum of Art', terms: CMA_TERMS, published: true, sample: true, exhibitionId: 'ex_night_weather' });
    expect((await ds.getOpenCall(admin, 'call_advocacy'))!.organizerInstitutionId).toBeUndefined();
    const apps = await ds.listApplications(admin, 'call_cma_auction');
    expect(apps.map((a) => [a.id, a.status]).sort()).toEqual([['app_deshawn_cma', 'accepted'], ['app_mara_cma', 'accepted'], ['app_priya_cma', 'declined']]);
    const lots = await ds.listLots(admin);
    expect(lots.map((l) => [l.id, l.lotNumber, l.artworkId, l.status, l.reserve, l.sale?.hammerPrice ?? null, l.payout?.id ?? null, l.payout?.status ?? null])).toEqual([
      ['lot_cma_1', 1, 'aw_mara_1', 'sold', 600000, 820000, 'payout_cma_1', 'due'],
      ['lot_cma_2', 2, 'aw_mara_2', 'live', 100000, null, null, null],
      ['lot_cma_3', 3, 'aw_deshawn_1', 'sold', 150000, 160000, 'payout_cma_3', 'paid'],
    ]);
    expect(lots[0]!.sale).toMatchObject({ artistAmount: 574000, kofiAmount: 164000, partnerAmount: 82000, buyerPremium: 82000, soldAt: '2026-10-18T16:00:00.000Z', buyerRef: 'Paddle 14' });
    expect(kofiDay(lots[0]!.sale!.soldAt)).toBe('2026-10-18');
    expect(lots[2]!.payout).toMatchObject({ amount: 112000, method: 'Bank transfer', reference: 'KC-2026-0031', paidAt: '2026-10-19T16:00:00.000Z' });
    expect(lots[0]).toMatchObject({ callTitle: 'Night Weather Benefit Auction', callKind: 'auction', artworkTitle: 'Doubling (Liberty Avenue, 7:40pm)', artistWorkingName: 'Mara Oyelaran' });
    expect(lots[0]!.work?.id).toBe('aw_mara_1');
  });
});

describe('partners: calls', () => {
  it('listMyCalls: Lena sees her institution’s calls, admin every organised call; pending curators and others are refused', async () => {
    const { ds } = make();
    expect((await ds.listMyCalls(lena)).map((c) => c.id)).toEqual(['call_cma_auction']);
    expect((await ds.listMyCalls(admin)).map((c) => c.id)).toEqual(['call_cma_auction']);
    for (const v of [owen, spoofLena, mara, visitor]) await expect(ds.listMyCalls(v)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('Lena drafts a call: organiser forced to her institution, never published, never sample; she sees the draft, others do not', async () => {
    const { ds } = make();
    const saved = await ds.saveOpenCall(lena, draft({ organizerInstitutionId: 'inst_pit', published: true, sample: true }));
    expect(saved).toMatchObject({ organizerInstitutionId: 'inst_cma', published: false, sample: false, kind: 'auction', terms: CMA_TERMS });
    expect((await ds.listMyCalls(lena)).map((c) => c.id)).toContain(saved.id);
    expect((await ds.listOpenCalls(lena)).map((c) => c.id)).toContain(saved.id);
    expect(await ds.getOpenCall(lena, saved.id)).toBeDefined();
    for (const v of [visitor, owen, mara]) {
      expect(await ds.getOpenCall(v, saved.id)).toBeUndefined();
      expect((await ds.listOpenCalls(v)).map((c) => c.id)).not.toContain(saved.id);
    }
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'programme.save', entityType: 'open_call', entityId: saved.id, actorRole: 'curator', meta: { created: true, published: false } });

    // Editing the draft keeps it a draft, whatever she sends.
    const edited = await ds.saveOpenCall(lena, { ...draft({ title: 'Spring Benefit 2027', published: true, organizerInstitutionId: undefined }), id: saved.id });
    expect(edited).toMatchObject({ title: 'Spring Benefit 2027', published: false, organizerInstitutionId: 'inst_cma' });

    // Once Kofi publishes, the partner can no longer edit it.
    await ds.saveOpenCall(admin, { ...edited, published: true });
    await expect(ds.saveOpenCall(lena, { ...draft(), id: saved.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('Lena cannot edit Kofi’s calls or publish anything; Owen (pending) cannot draft at all', async () => {
    const { ds } = make();
    const nw = (await ds.getOpenCall(admin, 'call_night_weather'))!;
    await expect(ds.saveOpenCall(lena, nw)).rejects.toBeInstanceOf(ForbiddenError);
    // Her own published call is Kofi's to change now.
    const cma = (await ds.getOpenCall(admin, 'call_cma_auction'))!;
    await expect(ds.saveOpenCall(lena, { ...cma, title: 'Renamed' })).rejects.toBeInstanceOf(ForbiddenError);
    for (const v of [owen, spoofLena, mara, visitor]) await expect(ds.saveOpenCall(v, draft())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.deleteOpenCall(lena, 'call_cma_auction')).rejects.toBeInstanceOf(ForbiddenError);
    expect(ds._raw().openCalls.find((c) => c.id === 'call_night_weather')!.title).toBe('Night Weather Studio Award');
  });

  it('kind and terms are validated for admins and partners alike', async () => {
    const { ds } = make();
    for (const v of [admin, lena]) {
      await expectValidation(ds.saveOpenCall(v, draft({ terms: undefined })), 'terms', 'An auction call must publish its compensation terms.');
      await expectValidation(ds.saveOpenCall(v, draft({ terms: { ...CMA_TERMS, kofiSharePct: 25 } })), 'artistSharePct', /add up to 100/);
      await expectValidation(ds.saveOpenCall(v, draft({ terms: { ...CMA_TERMS, currency: 'dollars' } })), 'currency');
      await expectValidation(ds.saveOpenCall(v, draft({ kind: 'raffle' as never })), 'kind');
    }
    await expectValidation(ds.saveOpenCall(admin, draft({ organizerInstitutionId: 'inst_missing' })), 'organizerInstitutionId');
    // An exhibition call needs no terms; an older client that sends no kind keeps the stored one.
    await expect(ds.saveOpenCall(admin, draft({ kind: 'exhibition', terms: undefined }))).resolves.toMatchObject({ kind: 'exhibition' });
    const nw = (await ds.getOpenCall(admin, 'call_night_weather'))!;
    const { kind: _k, ...noKind } = nw;
    expect((await ds.saveOpenCall(admin, noKind as unknown as ProgrammeInput<OpenCall>)).kind).toBe('award');
  });

  it('terms are locked once a lot has sold; a call with lots stays an auction', async () => {
    const { ds } = make();
    const cma = (await ds.getOpenCall(admin, 'call_cma_auction'))!;
    await expectValidation(ds.saveOpenCall(admin, { ...cma, terms: { ...CMA_TERMS, artistSharePct: 75, kofiSharePct: 15 } }), 'terms', 'Terms are locked once a lot has sold.');
    await expectValidation(ds.saveOpenCall(admin, { ...cma, terms: undefined }), 'terms');
    await expectValidation(ds.saveOpenCall(admin, { ...cma, kind: 'exhibition' }), 'kind');
    // The same terms (any key order) and other edits are fine.
    const reordered = Object.fromEntries(Object.entries(CMA_TERMS).reverse()) as unknown as CallTerms;
    await expect(ds.saveOpenCall(admin, { ...cma, title: 'Night Weather Benefit Auction 2026', terms: reordered })).resolves.toMatchObject({ title: 'Night Weather Benefit Auction 2026' });
    // A fresh auction with no sale can change its terms.
    const fresh = await ds.saveOpenCall(admin, draft());
    await expect(ds.saveOpenCall(admin, { ...fresh, terms: { ...CMA_TERMS, artistSharePct: 80, kofiSharePct: 10 } })).resolves.toMatchObject({ terms: { artistSharePct: 80 } });
  });
});

describe('partners: applications', () => {
  it('Lena reviews her call’s applications only, with the reviewers’ note and the attached works (no contact)', async () => {
    const { ds } = make();
    const rows = await ds.listApplications(lena);
    expect(rows.map((r) => r.id).sort()).toEqual(['app_deshawn_cma', 'app_mara_cma', 'app_priya_cma']);
    expect((await ds.listApplications(lena, 'call_cma_auction')).length).toBe(3);
    const maraRow = rows.find((r) => r.id === 'app_mara_cma')!;
    expect(maraRow.staffNote).toBe('Reserves agreed by phone: $6,000 and $1,000.');
    // Prices follow their own visibility: aw_mara_1 is shown to verified institutions.
    expect(maraRow.works.map((w) => [w.id, w.price?.amount ?? null, w.priceWithheld])).toEqual([['aw_mara_1', 9800, false], ['aw_mara_2', 1400, false]]);
    // Applying is consent: Priya (still in review) has her attached work shown to the reviewers.
    expect(rows.find((r) => r.id === 'app_priya_cma')!.works.map((w) => w.id)).toEqual(['aw_priya_1']);
    expect(await ds.getArtwork(lena, 'aw_priya_1')).toBeUndefined();
    const json = JSON.stringify(rows);
    for (const secret of ['mara@example.com', 'priya@example.com', '412 555', 'Omolara']) expect(json).not.toContain(secret);
    for (const w of rows.flatMap((r) => r.works)) expect(w.canEdit).toBe(false);
  });

  it('Lena cannot touch call_night_weather’s applications; Owen and artists cannot review', async () => {
    const { ds } = make();
    await expect(ds.listApplications(lena, 'call_night_weather')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.setApplicationStatus(lena, 'app_deshawn_night', 'shortlisted')).rejects.toBeInstanceOf(ForbiddenError);
    expect(ds._raw().applications.find((a) => a.id === 'app_deshawn_night')!.status).toBe('submitted');
    for (const v of [owen, spoofLena, mara, visitor]) {
      await expect(ds.listApplications(v, 'call_cma_auction')).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.setApplicationStatus(v, 'app_priya_cma', 'shortlisted')).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('Lena decides on her own call, audited as a curator; the artist never sees the reviewers’ note', async () => {
    const { ds } = make();
    const row = await ds.setApplicationStatus(lena, 'app_priya_cma', 'shortlisted', { staffNote: 'Revisit once approved.', decisionNote: 'We are holding your application.' });
    expect(row).toMatchObject({ status: 'shortlisted', staffNote: 'Revisit once approved.' });
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'application.status', entityId: 'app_priya_cma', actorRole: 'curator', actorId: 'user_lena', meta: { status: 'shortlisted', callId: 'call_cma_auction' } });
    const mine = (await ds.listMyApplications(priya)).find((a) => a.id === 'app_priya_cma')!;
    expect(mine.decisionNote).toBe('We are holding your application.');
    expect('staffNote' in mine).toBe(false);
  });

  it('a selection with lots cannot be undone until its lots are withdrawn', async () => {
    const { ds } = make();
    await expectValidation(ds.setApplicationStatus(admin, 'app_mara_cma', 'declined'), 'status', /lots/);
  });
});

describe('lots', () => {
  it('admin sees every lot with payouts; Lena sees her call’s lots with buyer refs and no payouts; artists and others use listMyLots or are refused', async () => {
    const { ds } = make();
    const forLena = await ds.listLots(lena);
    expect(forLena.map((l) => l.id)).toEqual(['lot_cma_1', 'lot_cma_2', 'lot_cma_3']);
    expect(forLena[0]!.sale?.buyerRef).toBe('Paddle 14');
    expect(forLena.every((l) => l.payout === undefined && !('payout' in l))).toBe(true);
    expect((await ds.listLots(lena, 'call_cma_auction')).length).toBe(3);
    await expect(ds.listLots(lena, 'call_night_weather')).rejects.toBeInstanceOf(ForbiddenError);
    for (const v of [mara, owen, spoofLena, visitor]) await expect(ds.listLots(v)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listPayouts(lena)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listBuyerInquiries(lena)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('an artist sees only their own lots, never the buyer reference, with their payout', async () => {
    const { ds } = make();
    const mine = await ds.listMyLots(mara);
    expect(mine.map((l) => l.id)).toEqual(['lot_cma_1', 'lot_cma_2']);
    expect(mine[0]!.sale).toMatchObject({ hammerPrice: 820000, artistAmount: 574000 });
    expect('buyerRef' in mine[0]!.sale!).toBe(false);
    expect(mine[0]!.payout).toMatchObject({ id: 'payout_cma_1', status: 'due', amount: 574000 });
    expect(JSON.stringify(mine)).not.toContain('Paddle');
    const his = await ds.listMyLots(deshawn);
    expect(his.map((l) => [l.id, l.payout?.status])).toEqual([['lot_cma_3', 'paid']]);
    expect(JSON.stringify(his)).not.toMatch(/Paddle|art_mara/);
    expect(await ds.listMyLots(priya)).toEqual([]);
    expect((await ds.listPayouts(mara)).map((p) => p.id)).toEqual(['payout_cma_1']);
    expect((await ds.listPayouts(deshawn)).map((p) => p.id)).toEqual(['payout_cma_3']);
    for (const v of [lena, owen, visitor, admin]) await expect(ds.listMyLots(v)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listPayouts(owen)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ds.listPayouts(visitor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a lot comes only from a selected work, once per work and lot number per call', async () => {
    const { ds } = make();
    const base = { callId: 'call_cma_auction', applicationId: 'app_mara_cma', artworkId: 'aw_mara_1', lotNumber: 9 };
    await expectValidation(ds.saveLot(admin, base), 'artworkId', 'This work is already a lot in this auction.');
    await expectValidation(ds.saveLot(admin, { ...base, applicationId: 'app_priya_cma', artworkId: 'aw_priya_1' }), 'applicationId', /accepted/);
    await expectValidation(ds.saveLot(admin, { ...base, applicationId: 'app_deshawn_cma' }), 'artworkId', 'That work is not on the application.');
    await expectValidation(ds.saveLot(admin, { ...base, applicationId: 'app_missing' }), 'applicationId');
    await expectValidation(ds.saveLot(admin, { ...base, callId: 'call_summer_open', applicationId: 'app_mara_summer' }), 'callId', 'Only auction calls have lots.');
    await expect(ds.saveLot(admin, { ...base, callId: 'call_missing' })).rejects.toBeInstanceOf(NotFoundError);
    // Withdraw lot 2: its work and number are free again, and the withdrawn lot cannot come back as a duplicate.
    await ds.setLotStatus(admin, 'lot_cma_2', 'withdrawn');
    const again = await ds.saveLot(admin, { ...base, artworkId: 'aw_mara_2', lotNumber: 2, reserve: 120000, startingBid: 80000 });
    expect(again).toMatchObject({ status: 'planned', artistId: 'art_mara', reserve: 120000, startingBid: 80000 });
    await expectValidation(ds.setLotStatus(admin, 'lot_cma_2', 'planned'), 'artworkId', 'This work is already a lot in this auction.');
    await expectValidation(ds.saveLot(admin, { ...base, id: again.id, artworkId: 'aw_mara_2', lotNumber: 3 }), 'lotNumber', 'Lot 3 is already used in this auction.');
    // Editing clears an emptied reserve.
    const edited = await ds.saveLot(admin, { ...base, id: again.id, artworkId: 'aw_mara_2', lotNumber: 4 });
    expect(edited.reserve).toBeUndefined();
    expect(edited.lotNumber).toBe(4);
    await expectValidation(ds.saveLot(admin, { ...base, id: 'lot_cma_1', artworkId: 'aw_mara_1', lotNumber: 1 }), 'status', /sold/);
  });

  it('Lena manages lots on her own call like Kofi; audit rows name her as a curator', async () => {
    const { ds } = make();
    await ds.setLotStatus(lena, 'lot_cma_2', 'withdrawn');
    await ds.deleteLot(lena, 'lot_cma_2');
    expect(ds._raw().lots.map((l) => l.id)).toEqual(['lot_cma_1', 'lot_cma_3']);
    const lot = await ds.saveLot(lena, { callId: 'call_cma_auction', applicationId: 'app_mara_cma', artworkId: 'aw_mara_2', lotNumber: 2, reserve: 100000 });
    expect(lot).toMatchObject({ status: 'planned', lotNumber: 2 });
    expect(lot.payout).toBeUndefined();
    const live = await ds.setLotStatus(lena, lot.id, 'live');
    expect(live.status).toBe('live');
    const sold = await ds.recordSale(lena, lot.id, { hammerPrice: 125000, soldOn: '2026-10-20', buyerRef: 'Paddle 30' });
    expect(sold.sale).toMatchObject({ hammerPrice: 125000, artistAmount: 87500, buyerRef: 'Paddle 30' });
    expect(sold.payout).toBeUndefined();
    const audit = (await ds.listAudit(admin, 6)).map((e) => [e.action, e.actorRole, e.entityType]);
    expect(audit).toEqual([
      ['lot.sale', 'curator', 'lot'],
      ['lot.save', 'curator', 'lot'],
      ['lot.save', 'curator', 'lot'],
      ['lot.delete', 'curator', 'lot'],
      ['lot.save', 'curator', 'lot'],
      // the seed's last audit row
      ['inquiry.status', 'admin', 'inquiry'],
    ]);
    // Owen, artists and visitors cannot manage lots; Lena cannot manage another call's lots.
    for (const v of [owen, spoofLena, mara, visitor]) {
      await expect(ds.saveLot(v, { callId: 'call_cma_auction', applicationId: 'app_mara_cma', artworkId: 'aw_mara_2', lotNumber: 7 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.setLotStatus(v, 'lot_cma_1', 'unsold')).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.recordSale(v, lot.id, { hammerPrice: 1, soldOn: '2026-10-20' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ds.deleteLot(v, lot.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const other = await ds.saveOpenCall(admin, draft());
    await expect(ds.saveLot(lena, { callId: other.id, applicationId: 'app_mara_cma', artworkId: 'aw_mara_2', lotNumber: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('recordSale: validates, freezes the split at noon Kofi time, creates a due payout, audits without the buyer', async () => {
    const { ds } = make();
    await expectValidation(ds.recordSale(admin, 'lot_cma_2', { hammerPrice: 99999, soldOn: '2026-10-19' }), 'hammerPrice', /reserve/);
    await expectValidation(ds.recordSale(admin, 'lot_cma_2', { hammerPrice: 120000, soldOn: '2026-10-21' }), 'soldOn', /future/);
    await expectValidation(ds.recordSale(admin, 'lot_cma_2', { hammerPrice: 120000, soldOn: '2026-02-30' }), 'soldOn');
    await expectValidation(ds.recordSale(admin, 'lot_cma_1', { hammerPrice: 900000, soldOn: '2026-10-19' }), 'status', /already sold/);
    await expect(ds.recordSale(admin, 'lot_missing', { hammerPrice: 1, soldOn: '2026-10-19' })).rejects.toBeInstanceOf(NotFoundError);
    const row = await ds.recordSale(admin, 'lot_cma_2', { hammerPrice: 120000, soldOn: '2026-10-19', buyerRef: '  Paddle 22 ' });
    expect(row.status).toBe('sold');
    expect(row.sale).toEqual({ hammerPrice: 120000, currency: 'USD', buyerPremium: 12000, artistAmount: 84000, kofiAmount: 24000, partnerAmount: 12000, terms: CMA_TERMS, soldAt: '2026-10-19T16:00:00.000Z', buyerRef: 'Paddle 22' });
    expect(row.payout).toMatchObject({ lotId: 'lot_cma_2', artistId: 'art_mara', amount: 84000, currency: 'USD', status: 'due' });
    const ev = (await ds.listAudit(admin))[0]!;
    expect(ev).toMatchObject({ action: 'lot.sale', entityId: 'lot_cma_2', meta: { hammer: 120000, currency: 'USD', lotNumber: 2 } });
    expect(JSON.stringify(ev)).not.toContain('Paddle');
    // The terms on the sale are a copy: the stored call is not aliased.
    ds._raw().lots.find((l) => l.id === 'lot_cma_2')!.sale!.terms.artistSharePct = 1;
    expect(ds._raw().openCalls.find((c) => c.id === 'call_cma_auction')!.terms!.artistSharePct).toBe(70);
  });

  it('void a sale (sold → unsold): sale cleared, payout kept as void; a paid payout blocks it; a re-sale makes a new payout', async () => {
    const { ds } = make();
    await expectValidation(ds.setLotStatus(admin, 'lot_cma_3', 'unsold'), 'status', 'Payout already paid.');
    expect(ds._raw().lots.find((l) => l.id === 'lot_cma_3')!.sale).toBeDefined();
    await expectValidation(ds.setLotStatus(admin, 'lot_cma_1', 'withdrawn'), 'status');
    await expectValidation(ds.setLotStatus(admin, 'lot_cma_2', 'sold'), 'status', /Record the sale/);
    await expectValidation(ds.setLotStatus(admin, 'lot_cma_2', 'gone' as never), 'status');
    const voided = await ds.setLotStatus(admin, 'lot_cma_1', 'unsold');
    expect(voided.status).toBe('unsold');
    expect(voided.sale).toBeUndefined();
    expect(voided.payout).toMatchObject({ id: 'payout_cma_1', status: 'void' });
    const top = (await ds.listAudit(admin, 2)).map((e) => [e.action, e.entityId, e.meta?.voided ?? e.meta?.status]);
    expect(top).toEqual([
      ['lot.sale', 'lot_cma_1', true],
      ['payout.status', 'payout_cma_1', 'void'],
    ]);
    // A voided lot keeps its record: it cannot be deleted.
    await expectValidation(ds.deleteLot(admin, 'lot_cma_1'), 'status', /sale on record/);
    // Re-sale: a fresh due payout; the old one stays void and cannot be revived.
    const resold = await ds.recordSale(admin, 'lot_cma_1', { hammerPrice: 700000, soldOn: '2026-10-20' });
    expect(resold.payout).toMatchObject({ status: 'due', amount: 490000 });
    expect(resold.payout!.id).not.toBe('payout_cma_1');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'due'), 'status', /voided/);
    expect((await ds.listMyLots(mara))[0]!.payout?.amount).toBe(490000);
    const report = await ds.kofiReport(admin, { from: '2026-10-01', to: '2026-10-31' });
    expect(report.totals.lotsSold).toBe(2);
    expect(report.totals.artistDue).toEqual({ USD: 490000 });
  });

  it('delete: a never-sold lot only', async () => {
    const { ds } = make();
    await expectValidation(ds.deleteLot(admin, 'lot_cma_1'), 'status');
    await expectValidation(ds.deleteLot(lena, 'lot_cma_3'), 'status');
    await ds.deleteLot(admin, 'lot_cma_2');
    expect(ds._raw().lots.map((l) => l.id)).toEqual(['lot_cma_1', 'lot_cma_3']);
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'lot.delete', entityId: 'lot_cma_2', meta: { callId: 'call_cma_auction', lotNumber: 2 } });
    await expect(ds.deleteLot(admin, 'lot_cma_2')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('payouts', () => {
  it('admin only; paid needs a method, a short reference and a date no later than today', async () => {
    const { ds } = make();
    for (const v of [lena, mara, owen, visitor]) await expect(ds.setPayoutStatus(v, 'payout_cma_1', 'paid', { method: 'Bank transfer' })).rejects.toBeInstanceOf(ForbiddenError);
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'paid'), 'method');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: '  ' }), 'method');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'x'.repeat(81) }), 'method');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'Check', reference: 'x'.repeat(121) }), 'reference');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'Check', paidOn: '2026-10-21' }), 'paidOn', /future/);
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'Check', paidOn: 'soon' }), 'paidOn');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_3', 'void'), 'status');
    await expectValidation(ds.setPayoutStatus(admin, 'payout_cma_1', 'due'), 'status');
    await expect(ds.setPayoutStatus(admin, 'payout_missing', 'paid', { method: 'Check' })).rejects.toBeInstanceOf(NotFoundError);
    expect(ds._raw().payouts.find((p) => p.id === 'payout_cma_1')!.status).toBe('due');

    const paid = await ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: ' Check #1042 ', reference: 'KC-2026-0032', note: 'Posted to the studio.' });
    expect(paid).toMatchObject({ status: 'paid', method: 'Check #1042', reference: 'KC-2026-0032', note: 'Posted to the studio.', paidAt: '2026-10-20T16:00:00.000Z', artistWorkingName: 'Mara Oyelaran', artworkTitle: 'Doubling (Liberty Avenue, 7:40pm)', callTitle: 'Night Weather Benefit Auction', lotNumber: 1 });
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'payout.status', entityType: 'payout', entityId: 'payout_cma_1', actorRole: 'admin', meta: { status: 'paid', lotId: 'lot_cma_1', method: 'Check #1042' } });
    // Mara sees it in her studio.
    expect((await ds.listMyLots(mara))[0]!.payout).toMatchObject({ status: 'paid', paidAt: '2026-10-20T16:00:00.000Z' });
    // A correction (paid → due) clears the payment details.
    const reopened = await ds.setPayoutStatus(admin, 'payout_cma_1', 'due');
    expect([reopened.method, reopened.reference, reopened.paidAt]).toEqual([undefined, undefined, undefined]);
    const back = await ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'Bank transfer', paidOn: '2026-10-19' });
    expect(back.paidAt).toBe('2026-10-19T16:00:00.000Z');
  });

  it('due → void → due is allowed while the lot is still sold', async () => {
    const { ds } = make();
    await ds.setPayoutStatus(admin, 'payout_cma_1', 'void');
    await expect(ds.setPayoutStatus(admin, 'payout_cma_1', 'due')).resolves.toMatchObject({ status: 'due' });
    expect((await ds.listPayouts(admin)).map((p) => p.id).sort()).toEqual(['payout_cma_1', 'payout_cma_3']);
  });
});

describe('Kofi report', () => {
  it('admin only; the range is validated; the export is audited with its range', async () => {
    const { ds } = make();
    for (const v of [lena, mara, owen, visitor]) await expect(ds.kofiReport(v, { from: '2026-01-01', to: '2026-12-31' })).rejects.toBeInstanceOf(ForbiddenError);
    await expectValidation(ds.kofiReport(admin, { from: '2026-12-01', to: '2026-01-01' }), 'range', 'The start date must be before the end date.');
    await expectValidation(ds.kofiReport(admin, { from: '2026-10-21', to: '2026-12-31' }), 'range', 'The start date is in the future.');
    await expectValidation(ds.kofiReport(admin, { from: '', to: '' }), 'range');
    const r = await ds.kofiReport(admin, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.generatedAt).toBe(new Date(T).toISOString());
    expect(r.totals).toMatchObject({ lotsSold: 2, hammerTotal: { USD: 980000 }, artistPaid: { USD: 112000 }, artistDue: { USD: 574000 } });
    expect(r.payments.find((p) => p.payoutId === 'payout_cma_1')).toBeDefined();
    expect((await ds.listAudit(admin))[0]).toMatchObject({ action: 'report.export', entityType: 'report', actorRole: 'admin', meta: { from: '2026-10-01', to: '2026-10-31' } });
  });
});

describe('kofiNoonIso', () => {
  it('is noon in Pittsburgh every day of 2026, across both DST changes', () => {
    expect(kofiNoonIso('2026-10-18')).toBe('2026-10-18T16:00:00.000Z');
    expect(kofiNoonIso('2026-11-01')).toBe('2026-11-01T17:00:00.000Z');
    expect(kofiNoonIso('2026-03-08')).toBe('2026-03-08T16:00:00.000Z');
    expect(kofiNoonIso('2026-01-15')).toBe('2026-01-15T17:00:00.000Z');
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      expect(kofiDay(kofiNoonIso(day)), day).toBe(day);
    }
  });
});

describe('persisted state from v3', () => {
  afterEach(() => localStorage.clear());

  function v3State(): Record<string, unknown> {
    const s = buildSeed() as unknown as Record<string, unknown> & MockState;
    delete (s as Partial<MockState>).lots;
    delete (s as Partial<MockState>).payouts;
    s.openCalls = s.openCalls.filter((c) => c.id !== 'call_cma_auction').map((c) => {
      const { kind: _k, ...rest } = c;
      return rest as OpenCall;
    });
    s.applications = s.applications.filter((a) => a.callId !== 'call_cma_auction');
    return s;
  }

  it('adds kind to every call, merges the seeded auction, and keeps the user’s rows', async () => {
    localStorage.clear();
    const v3 = v3State() as unknown as MockState;
    v3.openCalls.push({ ...v3.openCalls[0]!, id: 'call_user', title: 'A call Kofi made' });
    v3.artworks = v3.artworks.filter((a) => a.id !== 'aw_mara_2'); // deleted by Mara in v3
    v3.openCalls.find((c) => c.id === 'call_summer_open')!.title = 'Renamed by Kofi';
    localStorage.setItem('kofi.mock.state.v1', JSON.stringify(v3));
    const ds = new MockDataSource({ persist: true, now: () => new Date(T) });
    const calls = await ds.listOpenCalls(admin);
    expect(calls.every((c) => !!c.kind)).toBe(true);
    expect(calls.find((c) => c.id === 'call_user')!.kind).toBe('exhibition');
    // Seeded ids take the seed's kind (as apply/0009_live_patch.sql does on the live DB); user calls stay exhibitions.
    expect(calls.find((c) => c.id === 'call_night_weather')!.kind).toBe('award');
    expect(calls.find((c) => c.id === 'call_summer_open')!.title).toBe('Renamed by Kofi');
    expect(calls.find((c) => c.id === 'call_cma_auction')).toMatchObject({ kind: 'auction', organizerInstitutionId: 'inst_cma', terms: CMA_TERMS });
    const apps = await ds.listApplications(admin, 'call_cma_auction');
    expect(apps.find((a) => a.id === 'app_mara_cma')!.artworkIds).toEqual(['aw_mara_1']);
    expect((await ds.listLots(admin)).map((l) => l.id)).toEqual(['lot_cma_1', 'lot_cma_3']);
    expect((await ds.listPayouts(admin)).map((p) => p.id).sort()).toEqual(['payout_cma_1', 'payout_cma_3']);
    expect((await ds.listApplications(admin)).length).toBe(6);
    // Persisted on the next change; a reload does not merge twice.
    await ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'Bank transfer' });
    const reloaded = new MockDataSource({ persist: true, now: () => new Date(T) });
    expect((await reloaded.listPayouts(admin)).find((p) => p.id === 'payout_cma_1')!.status).toBe('paid');
    expect((await reloaded.listLots(admin)).length).toBe(2);
  });

  it('a v4 state whose auction Kofi removed is not reseeded; a v2 state gets the whole programme incl. sales', () => {
    const v4 = buildSeed();
    v4.lots = [];
    v4.payouts = [];
    v4.openCalls = v4.openCalls.filter((c) => c.id !== 'call_cma_auction');
    const out = migrateState(JSON.parse(JSON.stringify(v4)) as MockState);
    expect(out.lots).toEqual([]);
    expect(out.openCalls.map((c) => c.id)).not.toContain('call_cma_auction');

    const v2 = buildSeed() as unknown as Record<string, unknown>;
    for (const k of ['exhibitions', 'openCalls', 'applications', 'events', 'stories', 'buyerInquiries', 'lots', 'payouts']) delete v2[k];
    const fromV2 = migrateState(v2 as Partial<MockState>);
    expect(fromV2.openCalls.filter((c) => c.id === 'call_cma_auction')).toHaveLength(1);
    expect(fromV2.applications.filter((a) => a.callId === 'call_cma_auction')).toHaveLength(3);
    expect(fromV2.lots.map((l) => l.id)).toEqual(['lot_cma_1', 'lot_cma_2', 'lot_cma_3']);
    expect(fromV2.payouts.map((p) => p.id)).toEqual(['payout_cma_1', 'payout_cma_3']);
  });
});

describe('activity log wording for sales rows', () => {
  it('every new action reads as a sentence', async () => {
    const { describeAudit } = await import('@/features/admin/format');
    const { ds } = make();
    await ds.setLotStatus(lena, 'lot_cma_2', 'withdrawn');
    await ds.deleteLot(admin, 'lot_cma_2');
    const { id } = await ds.saveLot(admin, { callId: 'call_cma_auction', applicationId: 'app_mara_cma', artworkId: 'aw_mara_2', lotNumber: 2 });
    await ds.setLotStatus(admin, id, 'live');
    await ds.recordSale(admin, id, { hammerPrice: 100000, soldOn: '2026-10-20' });
    await ds.setLotStatus(admin, id, 'unsold');
    await ds.setPayoutStatus(admin, 'payout_cma_1', 'paid', { method: 'Bank transfer' });
    await ds.kofiReport(admin, { from: '2026-10-01', to: '2026-10-31' });
    const lines = (await ds.listAudit(admin, 9)).map((e) => describeAudit(e));
    expect(lines).toEqual([
      'ran a Kofi report',
      'marked an artist payout as paid',
      'voided a sale',
      'voided an artist payout',
      'recorded a sale',
      'opened a lot for bidding',
      'added a lot to an auction',
      'deleted a lot',
      'withdrew a lot',
    ]);
    expect(describeAudit({ action: 'lot.save', meta: { status: 'unsold' } })).toBe('marked a lot unsold');
    expect(describeAudit({ action: 'lot.save', meta: { status: 'planned' } })).toBe('moved a lot back to planned');
    expect(describeAudit({ action: 'lot.save', meta: {} })).toBe('edited a lot');
    expect(describeAudit({ action: 'payout.status', meta: { status: 'due' } })).toBe('reopened an artist payout');
  });
});
