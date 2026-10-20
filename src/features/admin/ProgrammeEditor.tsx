import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApplicationRow, ArtworkView, EventKind, Exhibition, Medium, OpenCall, ProgrammeEvent, ProgrammeImage, Story, StoryKind, Venue } from '@/domain/types';
import { EVENT_KINDS, STORY_KINDS } from '@/domain/types';
import { callPhase, exhibitionPhase, kofiToday } from '@/domain/programme';
import type { AdminArtistRow, ProgrammeInput } from '@/data/DataSource';
import { ValidationError } from '@/data/DataSource';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import {
  CALL_PHASE_LABEL,
  deadlineLabel,
  EVENT_KIND_LABEL,
  EXHIBITION_PHASE_LABEL,
  formatDateRange,
  formatDay,
  formatEventTime,
  STORY_KIND_LABEL,
} from '@/features/programme/format';
import { Button, Confirm, EmptyState, ErrorState, Icon, Input, LinkButton, Notice, Select, Skeleton, Textarea, Toggle, TopBar } from '@/ui';
import { useUnsavedGuard, focusFirstError } from '@/features/studio/shared';
import { isoToLocalInput, kofiZoneLabel, localInputToIso } from './datetime';
import { ArtworkPicker, ImageField, MediumChips } from './ProgrammeFields';
import { Badge } from './AdminProgramme';
import { isProgrammeKind, KIND_LABEL, KIND_SINGULAR, publicPath, type AnyProgrammeItem, type ProgrammeKind } from './programmeShared';
import './admin.css';
import './programme.css';

/* ---------------- form model ---------------- */

interface Form {
  title: string;
  subtitle: string;
  summary: string;
  body: string;
  startsOn: string;
  endsOn: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  externalUrl: string;
  curatedBy: string;
  partner: string;
  eligibility: string;
  mediums: Medium[];
  opensOn: string;
  deadline: string;
  maxWorks: string;
  fee: string;
  award: string;
  exhibitionId: string;
  eventKind: EventKind;
  startsAt: string;
  endsAt: string;
  rsvpUrl: string;
  dek: string;
  storyKind: StoryKind;
  author: string;
  publishedOn: string;
  artistId: string;
  artworkIds: string[];
  image?: ProgrammeImage;
  published: boolean;
  sample: boolean;
}
type Errors = Record<string, string | undefined>;

const KOFI_VENUE = { venueName: 'Kofi Collections', venueAddress: '213 Smithfield St.', venueCity: 'Pittsburgh, PA' };

function blankForm(kind: ProgrammeKind): Form {
  const today = kofiToday();
  return {
    title: '',
    subtitle: '',
    summary: '',
    body: '',
    startsOn: '',
    endsOn: '',
    ...(kind === 'exhibitions' || kind === 'events' ? KOFI_VENUE : { venueName: '', venueAddress: '', venueCity: '' }),
    externalUrl: '',
    curatedBy: kind === 'exhibitions' ? 'Kofi Collections' : '',
    partner: kind === 'calls' ? 'Kofi Collections' : '',
    eligibility: '',
    mediums: [],
    opensOn: kind === 'calls' ? today : '',
    deadline: '',
    maxWorks: '3',
    fee: 'No entry fee',
    award: '',
    exhibitionId: '',
    eventKind: 'talk',
    startsAt: '',
    endsAt: '',
    rsvpUrl: '',
    dek: '',
    storyKind: 'news',
    author: 'Kofi Collections',
    publishedOn: today,
    artistId: '',
    artworkIds: [],
    published: false,
    sample: false,
  };
}

function venueFields(v: Venue | undefined) {
  return { venueName: v?.name ?? '', venueAddress: v?.address ?? '', venueCity: v?.city ?? '' };
}

function fromItem(kind: ProgrammeKind, item: AnyProgrammeItem): Form {
  const base: Form = { ...blankForm(kind), venueName: '', venueAddress: '', venueCity: '', title: item.title, published: item.published, sample: item.sample };
  switch (kind) {
    case 'exhibitions': {
      const x = item as Exhibition;
      return { ...base, subtitle: x.subtitle ?? '', summary: x.summary, body: x.body, startsOn: x.startsOn, endsOn: x.endsOn ?? '', ...venueFields(x.venue), externalUrl: x.externalUrl ?? '', curatedBy: x.curatedBy ?? '', artworkIds: [...x.artworkIds], image: x.image };
    }
    case 'calls': {
      const c = item as OpenCall;
      return { ...base, partner: c.partner ?? '', summary: c.summary, body: c.body, eligibility: c.eligibility, mediums: [...c.mediums], opensOn: c.opensOn, deadline: c.deadline ?? '', maxWorks: String(c.maxWorks), fee: c.fee, award: c.award ?? '', image: c.image, externalUrl: c.externalUrl ?? '', exhibitionId: c.exhibitionId ?? '' };
    }
    case 'events': {
      const e = item as ProgrammeEvent;
      return { ...base, eventKind: e.kind, startsAt: isoToLocalInput(e.startsAt), endsAt: isoToLocalInput(e.endsAt), ...venueFields(e.venue), summary: e.summary, rsvpUrl: e.rsvpUrl ?? '', exhibitionId: e.exhibitionId ?? '' };
    }
    case 'stories': {
      const s = item as Story;
      return { ...base, dek: s.dek, storyKind: s.kind, body: s.body, author: s.author, publishedOn: s.publishedOn, artistId: s.artistId ?? '', artworkIds: [...s.artworkIds], image: s.image };
    }
  }
}

const opt = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

function venueOf(f: Form): Venue | undefined {
  if (!f.venueName.trim() && !f.venueAddress.trim() && !f.venueCity.trim()) return undefined;
  const v: Venue = { name: f.venueName.trim(), city: f.venueCity.trim() };
  if (f.venueAddress.trim()) v.address = f.venueAddress.trim();
  return v;
}

function imageOf(f: Form): ProgrammeImage | undefined {
  if (!f.image) return undefined;
  const im: ProgrammeImage = { src: f.image.src, alt: f.image.alt.trim() };
  if (f.image.credit?.trim()) im.credit = f.image.credit.trim();
  return im;
}

type Input<K extends ProgrammeKind> = K extends 'exhibitions'
  ? ProgrammeInput<Exhibition>
  : K extends 'calls'
    ? ProgrammeInput<OpenCall>
    : K extends 'events'
      ? ProgrammeInput<ProgrammeEvent>
      : ProgrammeInput<Story>;

/** Strip undefined keys so optional fields are really absent. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function toInput(kind: ProgrammeKind, f: Form, id: string | undefined): Input<ProgrammeKind> {
  const common = { id, title: f.title.trim(), published: f.published, sample: f.sample };
  switch (kind) {
    case 'exhibitions':
      return compact<ProgrammeInput<Exhibition>>({
        ...common,
        subtitle: opt(f.subtitle),
        startsOn: f.startsOn,
        endsOn: opt(f.endsOn),
        venue: venueOf(f),
        summary: f.summary.trim(),
        body: f.body.trim(),
        image: imageOf(f),
        artworkIds: f.artworkIds,
        externalUrl: opt(f.externalUrl),
        curatedBy: opt(f.curatedBy),
      });
    case 'calls':
      return compact<ProgrammeInput<OpenCall>>({
        ...common,
        partner: opt(f.partner),
        summary: f.summary.trim(),
        body: f.body.trim(),
        eligibility: f.eligibility.trim(),
        mediums: f.mediums,
        opensOn: f.opensOn,
        deadline: opt(f.deadline),
        maxWorks: Number(f.maxWorks),
        fee: f.fee.trim(),
        award: opt(f.award),
        image: imageOf(f),
        externalUrl: opt(f.externalUrl),
        exhibitionId: opt(f.exhibitionId),
      });
    case 'events':
      return compact<ProgrammeInput<ProgrammeEvent>>({
        ...common,
        kind: f.eventKind,
        startsAt: localInputToIso(f.startsAt) ?? f.startsAt,
        endsAt: f.endsAt ? (localInputToIso(f.endsAt) ?? f.endsAt) : undefined,
        venue: venueOf(f),
        summary: f.summary.trim(),
        rsvpUrl: opt(f.rsvpUrl),
        exhibitionId: opt(f.exhibitionId),
      });
    case 'stories':
      return compact<ProgrammeInput<Story>>({
        ...common,
        dek: f.dek.trim(),
        kind: f.storyKind,
        body: f.body.trim(),
        author: f.author.trim(),
        publishedOn: f.publishedOn,
        artistId: opt(f.artistId),
        artworkIds: f.artworkIds,
        image: imageOf(f),
      });
  }
}

/** Instant checks before the server's; the server's answer always wins. */
function clientErrors(kind: ProgrammeKind, f: Form): Errors {
  const e: Errors = {};
  if (!f.title.trim()) e.title = 'Give it a title.';
  if (f.image && !f.image.alt.trim()) e.image = 'Describe the image for people who can’t see it.';
  if (kind === 'exhibitions' && !f.startsOn) e.startsOn = 'Choose a start date.';
  if (kind === 'calls') {
    if (!f.opensOn) e.opensOn = 'Choose the day the call opens.';
    const n = Number(f.maxWorks);
    if (!Number.isInteger(n) || n < 1 || n > 10) e.maxWorks = 'Allow between 1 and 10 works.';
  }
  if (kind === 'events' && !localInputToIso(f.startsAt)) e.startsAt = 'Choose when the event starts.';
  if (kind === 'stories' && !f.publishedOn) e.publishedOn = 'Choose a publication date.';
  return e;
}

/* ---------------- route ---------------- */

export function ProgrammeEditorRoute() {
  const { kind = '', id = '' } = useParams();
  if (!isProgrammeKind(kind)) {
    return (
      <div className="screen">
        <TopBar title="Programme" back="/admin/programme" />
        <main className="container ad-main">
          <EmptyState title="Unknown programme section" body="Choose exhibitions, open calls, events or the journal." actions={<LinkButton to="/admin/programme">Back to programme</LinkButton>} />
        </main>
      </div>
    );
  }
  return <ProgrammeEditor key={`${kind}/${id}`} kind={kind} id={id === 'new' ? undefined : id} />;
}

function ProgrammeEditor({ kind, id }: { kind: ProgrammeKind; id?: string }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const isNew = !id;

  const q = useQuery(
    async (ds, v) => {
      const [item, works, exhibitions, artists, apps] = await Promise.all([
        !id
          ? Promise.resolve(undefined)
          : kind === 'exhibitions'
            ? ds.getExhibition(v, id)
            : kind === 'calls'
              ? ds.getOpenCall(v, id)
              : kind === 'stories'
                ? ds.getStory(v, id)
                : ds.listEvents(v).then((l) => l.find((e) => e.id === id)),
        ds.listArtworks(v),
        kind === 'calls' || kind === 'events' ? ds.listExhibitions(v) : Promise.resolve([] as Exhibition[]),
        kind === 'stories' ? ds.listAllArtists(v) : Promise.resolve([] as AdminArtistRow[]),
        kind === 'calls' && id ? ds.listApplications(v, id) : Promise.resolve([] as ApplicationRow[]),
      ]);
      return { item: item as AnyProgrammeItem | undefined, works, exhibitions, artists, apps };
    },
    [kind, id],
  );

  const [form, setForm] = useState<Form>();
  const [baseline, setBaseline] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (form || !q.data) return;
    if (isNew) {
      const f = blankForm(kind);
      setForm(f);
      setBaseline(JSON.stringify(f));
    } else if (q.data.item) {
      const f = fromItem(kind, q.data.item);
      setForm(f);
      setBaseline(JSON.stringify(f));
    }
  }, [q.data, form, isNew, kind]);

  const dirty = !!form && JSON.stringify(form) !== baseline;
  const guard = useUnsavedGuard(dirty && !saving, `this ${KIND_SINGULAR[kind]}`);
  const title = `${isNew ? 'New' : 'Edit'} ${KIND_SINGULAR[kind]}`;

  const worksById = useMemo(() => new Map((q.data?.works ?? []).map((w) => [w.id, w])), [q.data?.works]);

  if (q.error && !form) {
    return (
      <Shell title={title} kind={kind}>
        <ErrorState error={q.error} retry={q.reload} />
      </Shell>
    );
  }
  if (q.data && !isNew && !q.data.item && !form) {
    return (
      <Shell title={title} kind={kind}>
        <EmptyState title={`We couldn’t find that ${KIND_SINGULAR[kind]}`} body="It may have been deleted." actions={<LinkButton to={`/admin/programme?tab=${kind}`}>Back to {KIND_LABEL[kind].toLowerCase()}</LinkButton>} />
      </Shell>
    );
  }
  if (!form || !q.data) {
    return (
      <Shell title={title} kind={kind}>
        <div className="pg-editor" aria-busy="true" aria-label="Loading">
          <div className="stack">
            <Skeleton h={56} />
            <Skeleton h={56} />
            <Skeleton h={160} />
          </div>
          <Skeleton h={360} />
        </div>
      </Shell>
    );
  }

  const f = form;
  const set = <K extends keyof Form>(k: K, v: Form[K], errKey: string = k as string) => {
    setForm((cur) => (cur ? { ...cur, [k]: v } : cur));
    if (errors[errKey] || errors.general) setErrors((e) => ({ ...e, [errKey]: undefined, general: undefined }));
  };
  const savedPublished = !isNew && q.data.item?.published;
  const appCount = q.data.apps.length;
  const attached = f.artworkIds.map((x) => worksById.get(x)).filter((w): w is ArtworkView => !!w);

  async function save() {
    const local = clientErrors(kind, f);
    if (Object.values(local).some(Boolean)) {
      setErrors(local);
      focusFirstError();
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const input = toInput(kind, f, id);
      const saved =
        kind === 'exhibitions'
          ? await data.saveExhibition(viewer, input as ProgrammeInput<Exhibition>)
          : kind === 'calls'
            ? await data.saveOpenCall(viewer, input as ProgrammeInput<OpenCall>)
            : kind === 'events'
              ? await data.saveEvent(viewer, input as ProgrammeInput<ProgrammeEvent>)
              : await data.saveStory(viewer, input as ProgrammeInput<Story>);
      const next = fromItem(kind, saved);
      setForm(next);
      setBaseline(JSON.stringify(next));
      toast.push(`${saved.published ? 'Published' : 'Saved draft of'} “${saved.title}”`, 'success');
      if (isNew) {
        guard.allowNext();
        nav(`/admin/programme/${kind}/${saved.id}`, { replace: true });
      }
    } catch (e) {
      if (e instanceof ValidationError) setErrors({ [e.field && e.field !== 'call' ? e.field : 'general']: e.message });
      else setErrors({ general: errorMessage(e) });
      focusFirstError();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    try {
      if (kind === 'exhibitions') await data.deleteExhibition(viewer, id);
      else if (kind === 'calls') await data.deleteOpenCall(viewer, id);
      else if (kind === 'events') await data.deleteEvent(viewer, id);
      else await data.deleteStory(viewer, id);
      toast.push(`Deleted “${f.title}”`, 'success');
      guard.allowNext();
      setConfirmDelete(false);
      nav(`/admin/programme?tab=${kind}`, { replace: true });
    } catch (e) {
      setConfirmDelete(false);
      setErrors({ general: errorMessage(e) });
      focusFirstError();
    }
  }

  const err = (k: string) => errors[k];

  return (
    <Shell title={title} kind={kind}>
      {guard.dialog}
      <div className="pg-editor">
        <form
          className="pg-editor__form stack--lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <header className="pg-editor__head">
            <p className="eyebrow eyebrow--gold">{KIND_LABEL[kind]}</p>
            <h2 className="h1 pg-editor__title">{isNew ? `New ${KIND_SINGULAR[kind]}` : f.title || 'Untitled'}</h2>
            <span className="rule" aria-hidden="true" />
          </header>

          {errors.general && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              <p className="strong" data-invalid="true" tabIndex={-1}>
                {errors.general}
              </p>
            </Notice>
          )}

          <Section title="Basics">
            <Input label="Title" value={f.title} error={err('title')} onChange={(e) => set('title', e.target.value)} />
            {kind === 'exhibitions' && <Input label="Subtitle" value={f.subtitle} error={err('subtitle')} onChange={(e) => set('subtitle', e.target.value)} />}
            {kind === 'events' && (
              <Select label="Kind of event" value={f.eventKind} error={err('kind')} onChange={(e) => set('eventKind', e.target.value as EventKind, 'kind')}>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EVENT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
            {kind === 'stories' && (
              <>
                <Select label="Kind of story" value={f.storyKind} error={err('kind')} onChange={(e) => set('storyKind', e.target.value as StoryKind, 'kind')}>
                  {STORY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {STORY_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
                <Textarea label="Standfirst" hint="One or two sentences under the headline." rows={2} value={f.dek} error={err('dek')} onChange={(e) => set('dek', e.target.value)} />
              </>
            )}
            {kind === 'calls' && <Input label="Partner organisation" value={f.partner} error={err('partner')} onChange={(e) => set('partner', e.target.value)} />}
            {kind !== 'stories' && (
              <Textarea label="Summary" hint="One or two sentences for cards and lists." rows={3} value={f.summary} error={err('summary')} onChange={(e) => set('summary', e.target.value)} />
            )}
          </Section>

          <Section title="Dates">
            {kind === 'exhibitions' && (
              <div className="pg-two">
                <Input label="Start date" type="date" value={f.startsOn} error={err('startsOn')} onChange={(e) => set('startsOn', e.target.value)} />
                <Input label="End date" type="date" hint="Leave empty for a single day." value={f.endsOn} error={err('endsOn')} onChange={(e) => set('endsOn', e.target.value)} />
              </div>
            )}
            {kind === 'calls' && (
              <div className="pg-two">
                <Input label="Opens on" type="date" value={f.opensOn} error={err('opensOn')} onChange={(e) => set('opensOn', e.target.value)} />
                <Input label="Deadline" type="date" hint="Last day to apply, Pittsburgh time. Empty = open until filled." value={f.deadline} error={err('deadline')} onChange={(e) => set('deadline', e.target.value)} />
              </div>
            )}
            {kind === 'events' && (
              <div className="pg-two">
                <Input label="Starts" type="datetime-local" hint={kofiZoneLabel(f.startsAt)} value={f.startsAt} error={err('startsAt')} onChange={(e) => set('startsAt', e.target.value)} />
                <Input label="Ends" type="datetime-local" hint={f.endsAt ? kofiZoneLabel(f.endsAt) : 'Optional.'} value={f.endsAt} error={err('endsAt')} onChange={(e) => set('endsAt', e.target.value)} />
              </div>
            )}
            {kind === 'stories' && (
              <div className="pg-two">
                <Input label="Publication date" type="date" value={f.publishedOn} error={err('publishedOn')} onChange={(e) => set('publishedOn', e.target.value)} />
                <Input label="Author" value={f.author} error={err('author')} onChange={(e) => set('author', e.target.value)} />
              </div>
            )}
          </Section>

          {kind === 'calls' && (
            <Section title="Who can apply">
              <Textarea label="Eligibility" rows={2} value={f.eligibility} error={err('eligibility')} onChange={(e) => set('eligibility', e.target.value)} />
              <MediumChips value={f.mediums} onChange={(v) => set('mediums', v)} error={err('mediums')} />
              <div className="pg-two">
                <Input label="Most works per application" type="number" inputMode="numeric" min={1} max={10} value={f.maxWorks} error={err('maxWorks')} onChange={(e) => set('maxWorks', e.target.value)} />
                <Input label="Fee" hint="Kofi calls never charge artists." value={f.fee} error={err('fee')} onChange={(e) => set('fee', e.target.value)} />
              </div>
              <Input label="Award" value={f.award} error={err('award')} onChange={(e) => set('award', e.target.value)} />
              <Input
                label="Partner application form"
                type="url"
                hint="Only when applications are taken outside Kofi. Leave empty to take them in the app."
                value={f.externalUrl}
                error={err('externalUrl')}
                onChange={(e) => set('externalUrl', e.target.value)}
              />
            </Section>
          )}

          {(kind === 'exhibitions' || kind === 'events') && (
            <Section title="Venue">
              <div className="pg-two" data-invalid={err('venue') ? 'true' : undefined}>
                <Input label="Venue name" value={f.venueName} error={err('venue')} onChange={(e) => set('venueName', e.target.value, 'venue')} />
                <Input label="City" value={f.venueCity} onChange={(e) => set('venueCity', e.target.value, 'venue')} />
              </div>
              <Input label="Street address" value={f.venueAddress} onChange={(e) => set('venueAddress', e.target.value, 'venue')} />
            </Section>
          )}

          <Section title={kind === 'events' ? 'Details' : 'Text'}>
            {kind !== 'events' && (
              <Textarea
                label="Body"
                rows={kind === 'stories' ? 14 : 8}
                hint={kind === 'stories' ? 'Leave a blank line between paragraphs. Start a paragraph with “> ” to make it a pull quote.' : 'Leave a blank line between paragraphs.'}
                value={f.body}
                error={err('body')}
                onChange={(e) => set('body', e.target.value)}
              />
            )}
            {kind === 'exhibitions' && (
              <div className="pg-two">
                <Input label="Curated by" value={f.curatedBy} error={err('curatedBy')} onChange={(e) => set('curatedBy', e.target.value)} />
                <Input label="External page" type="url" hint="e.g. the page on koficollections.org" value={f.externalUrl} error={err('externalUrl')} onChange={(e) => set('externalUrl', e.target.value)} />
              </div>
            )}
            {kind === 'events' && <Input label="RSVP link" type="url" value={f.rsvpUrl} error={err('rsvpUrl')} onChange={(e) => set('rsvpUrl', e.target.value)} />}
            {(kind === 'calls' || kind === 'events') && (
              <Select label="Exhibition" hint="Optional. Links this to an exhibition page." value={f.exhibitionId} error={err('exhibitionId')} onChange={(e) => set('exhibitionId', e.target.value)}>
                <option value="">None</option>
                {q.data.exhibitions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                    {x.published ? '' : ' (draft)'}
                  </option>
                ))}
              </Select>
            )}
            {kind === 'stories' && (
              <Select label="About an artist" hint="Optional. Links the story to the artist’s page." value={f.artistId} error={err('artistId')} onChange={(e) => set('artistId', e.target.value)}>
                <option value="">No artist</option>
                {q.data.artists.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.workingName}
                  </option>
                ))}
              </Select>
            )}
          </Section>

          {(kind === 'exhibitions' || kind === 'stories') && (
            <Section title="Works">
              <ArtworkPicker works={q.data.works} value={f.artworkIds} onChange={(v) => set('artworkIds', v)} error={err('artworkIds')} />
            </Section>
          )}

          {kind !== 'events' && (
            <Section title="Image">
              <ImageField value={f.image} onChange={(v) => set('image', v)} candidates={attached.length ? attached : q.data.works} error={err('image')} />
            </Section>
          )}

          <Section title="Publishing">
            <div className="pg-toggles">
              <Toggle
                checked={f.published}
                onChange={(v) => set('published', v)}
                label="Published"
                hint={f.published ? 'Visible to everyone once saved.' : 'Draft. Only Kofi staff can see it.'}
              />
              <Toggle checked={f.sample} onChange={(v) => set('sample', v)} label="Sample content" hint="Shows a visible “Sample” tag. Use for fictional demo items." />
            </div>
            {kind === 'calls' && !isNew && (
              <p className="small muted">
                {appCount === 0 ? 'No applications yet.' : `${appCount} ${appCount === 1 ? 'application' : 'applications'}. `}
                {appCount > 0 && <Link to={`/admin/applications?call=${id}`}>Review applications</Link>}
              </p>
            )}
          </Section>

          <div className="pg-actions">
            <Button type="submit" loading={saving} onClick={() => undefined}>
              {isNew ? (f.published ? 'Publish' : 'Save draft') : 'Save changes'}
            </Button>
            {savedPublished && id && (
              <Link className="btn btn--secondary" to={publicPath(kind, id)} target="_blank" rel="noopener">
                View public page <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            )}
            {!isNew && (
              <Button tone="ghost" className="pg-delete" icon={<Icon.Trash />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            {dirty && <span className="tiny muted pg-dirty">Unsaved changes</span>}
          </div>
        </form>

        <aside className="pg-editor__preview" aria-label="Live preview">
          <p className="pg-preview__caption">Live preview</p>
          <PreviewCard kind={kind} f={f} />
          <p className="tiny muted">How the card reads in lists on the public site.</p>
        </aside>
      </div>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Delete this ${KIND_SINGULAR[kind]}?`}
        body={
          kind === 'calls' && appCount > 0
            ? `“${f.title}” has ${appCount} ${appCount === 1 ? 'application' : 'applications'}. Kofi keeps calls that artists have applied to; unpublish it instead.`
            : `“${f.title}” will be removed from the programme for everyone. This can’t be undone.`
        }
        confirmLabel="Delete"
        danger
      />
    </Shell>
  );
}

function Shell({ title, kind, children }: { title: string; kind: ProgrammeKind; children: ReactNode }) {
  return (
    <div className="screen">
      <TopBar title={title} back={`/admin/programme${kind === 'exhibitions' ? '' : `?tab=${kind}`}`} />
      <main className="container container--wide ad-main">{children}</main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `pg-sec-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section className="pg-section" role="group" aria-labelledby={id}>
      <h3 className="pg-section__title" id={id}>
        {title}
      </h3>
      <div className="stack pg-section__body">{children}</div>
    </section>
  );
}

/* ---------------- preview ---------------- */

function PreviewCard({ kind, f }: { kind: ProgrammeKind; f: Form }) {
  const today = kofiToday();
  let eyebrow = '';
  let phase: { label: string; tone: 'now' | 'soon' | 'past' } | undefined;
  let when = '';
  let lede = f.summary;
  let sub = '';
  const venue = [f.venueName, f.venueCity].filter((s) => s.trim()).join(', ');
  switch (kind) {
    case 'exhibitions': {
      eyebrow = 'Exhibition';
      if (f.startsOn) {
        const p = exhibitionPhase({ startsOn: f.startsOn, endsOn: f.endsOn || undefined }, today);
        phase = { label: EXHIBITION_PHASE_LABEL[p], tone: p === 'current' ? 'now' : p === 'upcoming' ? 'soon' : 'past' };
        when = formatDateRange(f.startsOn, f.endsOn || undefined);
      }
      sub = f.subtitle;
      break;
    }
    case 'calls': {
      eyebrow = f.partner ? `Open call · ${f.partner}` : 'Open call';
      if (f.opensOn) {
        const c = { opensOn: f.opensOn, deadline: f.deadline || undefined };
        const p = callPhase(c, today);
        phase = { label: CALL_PHASE_LABEL[p], tone: p === 'open' ? 'now' : p === 'upcoming' ? 'soon' : 'past' };
        when = deadlineLabel(c, today);
      }
      break;
    }
    case 'events': {
      eyebrow = EVENT_KIND_LABEL[f.eventKind];
      const s = localInputToIso(f.startsAt);
      if (s) when = formatEventTime(s, localInputToIso(f.endsAt));
      break;
    }
    case 'stories': {
      eyebrow = STORY_KIND_LABEL[f.storyKind];
      lede = f.dek;
      when = [f.author, f.publishedOn ? formatDay(f.publishedOn) : ''].filter(Boolean).join(' · ');
      break;
    }
  }
  return (
    <article className="pg-card">
      {kind !== 'events' && (
        <div className="pg-card__img">
          {f.image ? <img src={f.image.src} alt={f.image.alt} /> : <span className="pg-card__noimg" aria-hidden="true" />}
        </div>
      )}
      <div className="pg-card__body">
        <div className="pg-row__badges">
          {phase && <Badge tone={phase.tone}>{phase.label}</Badge>}
          {!f.published && <Badge tone="draft">Draft</Badge>}
          {f.sample && <Badge tone="sample">Sample</Badge>}
        </div>
        <p className="pg-card__eyebrow">{eyebrow}</p>
        <h3 className="pg-card__title">{f.title.trim() || 'Untitled'}</h3>
        {sub && <p className="pg-card__sub">{sub}</p>}
        {lede && <p className="pg-card__lede">{lede}</p>}
        {when && <p className="pg-card__when">{when}</p>}
        {venue && (kind === 'exhibitions' || kind === 'events') && <p className="pg-card__venue">{venue}</p>}
        {kind === 'calls' && f.externalUrl && <p className="pg-card__venue">Apply on the partner’s form ↗</p>}
      </div>
    </article>
  );
}
