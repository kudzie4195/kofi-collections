import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ArtistView, ArtworkImage, ArtworkStatus, ArtworkView, Medium, Unit, Viewer, Visibility } from '@/domain/types';
import { ARTWORK_STATUSES, MEDIUMS, PUBLIC_VIEWER } from '@/domain/types';
import { canSee } from '@/domain/visibility';
import { formatDimensions } from '@/domain/units';
import type { ArtworkInput } from '@/data/DataSource';
import { prepareImage } from '@/native/images';
import { useQuery, useSession } from '@/state/session';
import { errorMessage, useToast } from '@/state/toast';
import {
  Button,
  Confirm,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  LinkButton,
  Notice,
  Panel,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Textarea,
  Toggle,
  TopBar,
  VisibilityPicker,
  WallLabel,
} from '@/ui';
import { ChipInput, Group, StudioVisibilityPicker, capitalize, fieldErrorFrom, focusFirstError, useUnsavedGuard } from './shared';

/* ---------- constants ---------- */

const MAX_IMAGES = 12;
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'];

const MATERIALS_BY_MEDIUM: Record<Medium, string[]> = {
  painting: ['oil on linen', 'oil on canvas', 'acrylic on canvas', 'oil on panel', 'gouache on paper', 'watercolor on paper'],
  drawing: ['charcoal on paper', 'graphite on paper', 'ink on paper', 'pastel', 'colored pencil', 'fixative'],
  printmaking: ['screen print', 'etching', 'lithograph', 'woodcut', 'relief print', 'Stonehenge paper'],
  sculpture: ['bronze', 'steel', 'wood', 'resin', 'stone', 'patina'],
  ceramics: ['stoneware', 'porcelain', 'earthenware', 'ash glaze', 'shino glaze', 'slip'],
  textile: ['wool', 'cotton', 'linen', 'silk', 'hand-dyed wool', 'reclaimed thread'],
  photography: ['archival pigment print', 'gelatin silver print', 'chromogenic print', 'Hahnemühle Photo Rag', 'dibond mount'],
  video: ['single-channel video', 'two-channel video', 'sound', '4K', 'loop'],
  installation: ['found objects', 'steel', 'wood', 'light', 'sound', 'mixed materials'],
  'mixed media': ['collage', 'found objects', 'acrylic', 'paper', 'wire', 'thread'],
  digital: ['digital file', 'inkjet print', 'screen', 'generative code', 'archival pigment print'],
  performance: ['live performance', 'documentation video', 'photographs', 'props'],
};
const ALL_MATERIALS = Array.from(new Set(Object.values(MATERIALS_BY_MEDIUM).flat()));

const RECORD_CAPTIONS: Partial<Record<Visibility, string>> = {
  public: 'Anyone browsing the gallery, once your profile is approved.',
  institutions: 'Only curators Kofi has verified.',
  kofi: 'Only Kofi staff — useful while a work is in review.',
  private: 'Draft — only you. Kofi admins can open it, and every open is logged.',
};

/* ---------- form model ---------- */

interface WorkForm {
  title: string;
  year: string;
  medium: Medium;
  materials: string[];
  height: string;
  width: string;
  depth: string;
  unit: Unit;
  description: string;
  status: ArtworkStatus;
  rightsNote: string;
  noPrice: boolean;
  amount: string;
  currency: string;
  priceVisibility: Visibility;
  visibility: Visibility;
  tags: string[];
  images: ArtworkImage[];
}

function fromView(w: ArtworkView): WorkForm {
  return {
    title: w.title,
    year: String(w.year),
    medium: w.medium,
    materials: [...w.materials],
    height: String(w.dimensions.height),
    width: String(w.dimensions.width),
    depth: w.dimensions.depth !== undefined ? String(w.dimensions.depth) : '',
    unit: w.dimensions.unit,
    description: w.description,
    status: w.status,
    rightsNote: w.rightsNote,
    noPrice: !w.price,
    amount: w.price ? String(w.price.amount) : '',
    currency: w.price?.currency ?? 'USD',
    priceVisibility: w.priceVisibility,
    visibility: w.visibility,
    tags: [...w.tags],
    images: w.images.map((i) => ({ ...i })),
  };
}

function blankForm(artist: ArtistView | undefined): WorkForm {
  return {
    title: '',
    year: String(new Date().getFullYear()),
    medium: artist?.mediums[0] ?? 'painting',
    materials: [],
    height: '',
    width: '',
    depth: '',
    unit: artist?.region?.country === 'United States' ? 'in' : 'cm',
    description: '',
    status: 'available',
    rightsNote: artist ? `© ${artist.workingName}.` : '',
    noPrice: true,
    amount: '',
    currency: artist?.region?.country === 'Canada' ? 'CAD' : 'USD',
    priceVisibility: 'institutions',
    visibility: 'private',
    tags: [],
    images: [],
  };
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

function dimsOf(f: WorkForm) {
  const d = { height: num(f.height), width: num(f.width), unit: f.unit } as ArtworkInput['dimensions'];
  if (f.depth.trim() !== '') d.depth = num(f.depth);
  return d;
}

function toInput(f: WorkForm, id?: string): ArtworkInput {
  const input: ArtworkInput = {
    title: f.title.trim(),
    year: num(f.year),
    medium: f.medium,
    materials: f.materials,
    dimensions: dimsOf(f),
    description: f.description.trim(),
    images: f.images,
    status: f.status,
    rightsNote: f.rightsNote.trim(),
    priceVisibility: f.priceVisibility,
    visibility: f.visibility,
    tags: f.tags,
  };
  if (!f.noPrice) input.price = { amount: num(f.amount), currency: f.currency };
  if (id) input.id = id;
  return input;
}

type Errors = Record<string, string>;

function validate(f: WorkForm): Errors {
  const e: Errors = {};
  const maxYear = new Date().getFullYear() + 1;
  if (!f.title.trim()) e.title = 'Give the work a title. “Untitled” is fine.';
  const y = num(f.year);
  if (!Number.isInteger(y) || y < 1900 || y > maxYear) e.year = `Use a year between 1900 and ${maxYear}.`;
  const h = num(f.height);
  const w = num(f.width);
  const d = f.depth.trim() === '' ? 0 : num(f.depth);
  if (!(h > 0) || !(w > 0)) e.dimensions = 'Enter a height and width greater than zero.';
  else if (!(d >= 0)) e.dimensions = 'Depth can’t be negative. Leave it blank for flat work.';
  if (f.materials.length === 0) e.materials = 'List at least one material — type it and press Enter.';
  if (!f.noPrice) {
    const a = num(f.amount);
    if (!(a >= 0)) e.price = 'Enter a price, or turn on “No price”.';
  }
  if (f.visibility === 'public' && f.images.length === 0) e.images = 'Add at least one image before publishing.';
  return e;
}

function signature(f: WorkForm): string {
  return JSON.stringify({ ...f, images: f.images.map((i) => [i.id, i.alt, i.isPrimary]) });
}

/** A neutral image for the live label before any photo is added. */
const EMPTY_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="#e9e6f4"/><rect x="40" y="40" width="320" height="420" fill="none" stroke="#6b6684" stroke-width="4" stroke-dasharray="14 10"/><text x="200" y="258" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="700" fill="#6b6684">Your image here</text></svg>',
  );

type PreviewAs = 'you' | 'public' | 'curator';
const PREVIEW_VIEWERS: Record<Exclude<PreviewAs, 'you'>, Viewer> = {
  public: PUBLIC_VIEWER,
  curator: { role: 'curator', curatorVerified: true },
};

/* ---------- route wrapper ---------- */

export function WorkEditorRoute() {
  const { id } = useParams();
  return <WorkEditor key={id ?? 'new'} id={id} />;
}

export function WorkEditor({ id }: { id?: string }) {
  const { viewer, data } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const isNew = !id;

  const q = useQuery(
    async (ds, v) => {
      const [artist, work, docs] = await Promise.all([
        ds.getMyArtist(v),
        id ? ds.getArtwork(v, id) : Promise.resolve(undefined),
        id ? ds.listMyDocuments(v, id).catch(() => []) : Promise.resolve([]),
      ]);
      return { artist, work, docCount: docs.length };
    },
    [id],
  );

  const [form, setForm] = useState<WorkForm>();
  const [baseline, setBaseline] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(0);
  const [intakeErrors, setIntakeErrors] = useState<string[]>([]);
  const [lastIntake, setLastIntake] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewAs, setPreviewAs] = useState<PreviewAs>('you');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (form || !q.data) return;
    if (isNew) {
      const f = blankForm(q.data.artist);
      setForm(f);
      setBaseline(signature(f));
    } else if (q.data.work?.canEdit) {
      const f = fromView(q.data.work);
      setForm(f);
      setBaseline(signature(f));
    }
  }, [q.data, form, isNew]);

  const dirty = !!form && signature(form) !== baseline;
  const guard = useUnsavedGuard(dirty && !saving, 'this work');

  const previewWork = useMemo<ArtworkView | undefined>(() => {
    if (!form) return undefined;
    const dims = dimsOf(form);
    const safeDims: ArtworkView['dimensions'] = {
      height: dims.height > 0 ? dims.height : 0,
      width: dims.width > 0 ? dims.width : 0,
      unit: dims.unit,
    };
    if (dims.depth !== undefined && dims.depth > 0) safeDims.depth = dims.depth;
    const price = !form.noPrice && num(form.amount) >= 0 ? { amount: num(form.amount), currency: form.currency } : undefined;
    const as = previewAs === 'you' ? undefined : PREVIEW_VIEWERS[previewAs];
    const priceVisible = !!price && (!as || canSee(form.priceVisibility, as));
    const artist = q.data?.artist;
    const view: ArtworkView = {
      id: id ?? 'preview',
      artistId: artist?.id ?? '',
      artistWorkingName: artist?.workingName ?? 'You',
      artistCareerStage: artist?.careerStage ?? 'emerging',
      artistExperience: artist?.experience ?? { commissions: false, publicArt: false, residencies: false, institutionalShows: false },
      artistRegionLabel: artist?.regionLabel ?? '',
      title: form.title.trim() || 'Untitled',
      year: Number.isFinite(num(form.year)) ? num(form.year) : new Date().getFullYear(),
      medium: form.medium,
      materials: form.materials,
      dimensions: safeDims,
      description: form.description,
      images: form.images.length ? form.images : [{ id: 'empty', src: EMPTY_IMAGE, alt: 'No image yet', isPrimary: true, metadataStripped: true }],
      status: form.status,
      rightsNote: form.rightsNote,
      priceWithheld: !!price && !priceVisible,
      tags: form.tags,
      visibility: form.visibility,
      priceVisibility: form.priceVisibility,
      canEdit: true,
      createdAt: '',
      updatedAt: '',
    };
    if (priceVisible && price) view.price = price;
    return view;
  }, [form, previewAs, q.data?.artist, id]);

  /* ----- early states ----- */
  const title = isNew ? 'New work' : 'Edit work';
  if (q.error && !form) {
    return (
      <Shell title={title}>
        <ErrorState error={q.error} retry={q.reload} />
      </Shell>
    );
  }
  if (q.data && !isNew && !q.data.work && !form) {
    return (
      <Shell title={title}>
        <EmptyState title="We couldn’t find that work" body="It may have been deleted. Your other works are in your studio." actions={<LinkButton to="/studio">Back to studio</LinkButton>} />
      </Shell>
    );
  }
  if (q.data && !isNew && q.data.work && !q.data.work.canEdit) {
    return (
      <Shell title={title}>
        <EmptyState title="This isn’t your work" body="You can only edit works in your own studio." actions={<LinkButton to="/studio">Back to studio</LinkButton>} />
      </Shell>
    );
  }
  if (!form || !previewWork) {
    return (
      <Shell title={title}>
        <div className="st-editor" aria-busy="true" aria-label="Loading the work">
          <Skeleton h={320} />
          <div className="stack">
            <Skeleton h={120} />
            <Skeleton h={48} />
            <Skeleton h={48} />
            <Skeleton h={112} />
          </div>
        </div>
      </Shell>
    );
  }

  const f = form;
  const set = <K extends keyof WorkForm>(k: K, v: WorkForm[K], errKey: string = k as string) => {
    setForm((cur) => (cur ? { ...cur, [k]: v } : cur));
    if (errors[errKey]) setErrors((e) => ({ ...e, [errKey]: '' }));
  };

  /* ----- images ----- */
  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    const room = MAX_IMAGES - (form?.images.length ?? 0);
    const accepted = files.slice(0, Math.max(0, room));
    const problems: string[] = [];
    if (files.length > accepted.length) problems.push(`You can add up to ${MAX_IMAGES} images per work. ${files.length - accepted.length} were left out.`);
    setProcessing(accepted.length);
    let added = 0;
    for (const file of accepted) {
      try {
        const prepared = await prepareImage(file);
        const image: ArtworkImage = {
          id: `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          src: prepared.dataUrl,
          alt: '',
          isPrimary: false,
          metadataStripped: prepared.metadataStripped,
        };
        setForm((cur) => {
          if (!cur) return cur;
          const hasPrimary = cur.images.some((i) => i.isPrimary);
          return { ...cur, images: [...cur.images, { ...image, isPrimary: !hasPrimary }] };
        });
        added++;
      } catch (e) {
        problems.push(`${file.name}: ${errorMessage(e)}`);
      } finally {
        setProcessing((n) => Math.max(0, n - 1));
      }
    }
    setIntakeErrors(problems);
    setLastIntake(added);
    if (added) setErrors((e) => ({ ...e, images: '' }));
  }

  function removeImage(imgId: string) {
    setForm((cur) => {
      if (!cur) return cur;
      const rest = cur.images.filter((i) => i.id !== imgId);
      if (rest.length && !rest.some((i) => i.isPrimary)) rest[0] = { ...rest[0]!, isPrimary: true };
      return { ...cur, images: rest };
    });
  }

  function makePrimary(imgId: string) {
    setForm((cur) => (cur ? { ...cur, images: cur.images.map((i) => ({ ...i, isPrimary: i.id === imgId })) } : cur));
  }

  function setAlt(imgId: string, alt: string) {
    setForm((cur) => (cur ? { ...cur, images: cur.images.map((i) => (i.id === imgId ? { ...i, alt } : i)) } : cur));
  }

  /* ----- save / delete ----- */
  async function save() {
    if (!form) return;
    const v = validate(form);
    if (Object.keys(v).length) {
      setErrors(v);
      toast.push('Check the highlighted fields.', 'error');
      focusFirstError();
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await data.saveArtwork(viewer, toInput(form, id));
      guard.allowNext();
      toast.push(`Saved “${saved.title}”`, 'success');
      nav('/studio');
    } catch (e) {
      const fe = fieldErrorFrom(e);
      if (fe) {
        setErrors(fe);
        focusFirstError();
      }
      toast.push(errorMessage(e), 'error');
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    try {
      await data.deleteArtwork(viewer, id);
      guard.allowNext();
      setConfirmDelete(false);
      toast.push('Work deleted', 'success');
      nav('/studio');
    } catch (e) {
      toast.push(errorMessage(e), 'error');
    }
  }

  const other: Unit = f.unit === 'cm' ? 'in' : 'cm';
  const dims = dimsOf(f);
  const conversion = dims.height > 0 && dims.width > 0 ? `= ${formatDimensions({ ...dims, ...(dims.depth !== undefined && !(dims.depth > 0) ? { depth: undefined } : {}) }, other)}` : '';
  const artist = q.data?.artist;
  const profileLive = artist?.status === 'approved' && artist.visibility === 'public';
  const recordVisibleToPreview = previewAs === 'you' || canSee(f.visibility, PREVIEW_VIEWERS[previewAs]);
  const docCount = q.data?.docCount ?? 0;

  return (
    <Shell title={title}>
      {guard.dialog}
      <div className="st-editor">
        <aside className="st-editor__preview" aria-label="Live wall label preview">
          <div className="st-wall" data-medium={f.medium}>
            <p className="tiny strong st-wall__caption">Live wall label</p>
            <div className="st-wall__pin">
              {recordVisibleToPreview ? (
                <WallLabel work={previewWork} unit={f.unit} />
              ) : (
                <div className="st-hidden-card" role="status">
                  <Icon.EyeOff aria-hidden="true" />
                  <p className="strong">{previewAs === 'public' ? 'Hidden from the public' : 'Hidden from curators'}</p>
                  <p className="small">Change “Who can see this work” to show it.</p>
                </div>
              )}
            </div>
          </div>
          <Group label="Preview as">
            <Segmented<PreviewAs>
              label="Preview as"
              value={previewAs}
              onChange={setPreviewAs}
              options={[
                { value: 'you', label: 'You' },
                { value: 'public', label: 'Public' },
                { value: 'curator', label: 'Curator' },
              ]}
            />
          </Group>
          <p className="tiny muted">
            {previewAs === 'you'
              ? 'You see everything. Switch to check what others see.'
              : previewAs === 'public'
                ? 'What a visitor to the gallery sees.'
                : 'What a curator Kofi has verified sees.'}
            {previewAs !== 'you' && !profileLive && ' Your profile isn’t public and approved yet, so in practice nobody outside Kofi sees this work today.'}
          </p>
        </aside>

        <form
          className="st-editor__form stack--lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Panel title="Images">
            <div className="stack">
              <div
                className="dropzone st-dropzone"
                data-invalid={errors.images ? 'true' : undefined}
                tabIndex={errors.images ? -1 : undefined}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void addFiles(e.dataTransfer.files);
                }}
              >
                <Icon.Gallery className="st-dropzone__icon" aria-hidden="true" />
                <p className="strong">Drop photos here, or choose them</p>
                <p className="tiny muted">JPG, PNG, WebP or HEIC, up to 20 MB each. Location and camera data are removed before anything is stored.</p>
                <Button tone="secondary" size="sm" icon={<Icon.Plus />} onClick={() => fileRef.current?.click()} disabled={f.images.length >= MAX_IMAGES}>
                  Choose images
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label="Add images"
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
              {errors.images && (
                <p className="field__error" role="alert">
                  {errors.images}
                </p>
              )}
              {intakeErrors.length > 0 && (
                <Notice tone="coral" icon={<Icon.Warn />}>
                  <ul className="stack--sm">
                    {intakeErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              {lastIntake > 0 && processing === 0 && (
                <p className="small st-ok" role="status">
                  <Icon.Check aria-hidden="true" /> {lastIntake === 1 ? 'Image added.' : `${lastIntake} images added.`} Metadata removed.
                </p>
              )}
              {(f.images.length > 0 || processing > 0) && (
                <ul className="upload-grid st-uploads" aria-label="Images for this work">
                  {f.images.map((im, i) => (
                    <li key={im.id} className="st-upload">
                      <div className={`upload-grid__item ${im.isPrimary ? 'upload-grid__item--primary' : ''}`}>
                        <img src={im.src} alt={im.alt || `Image ${i + 1}`} />
                        <button type="button" className="upload-grid__remove" aria-label={`Remove image ${i + 1}`} onClick={() => removeImage(im.id)}>
                          <Icon.Close width={14} height={14} />
                        </button>
                        {im.isPrimary && <span className="upload-grid__primary">Primary</span>}
                      </div>
                      <div className="row row--wrap st-upload__meta">
                        {im.metadataStripped && (
                          <Tag>
                            <Icon.Check width={12} height={12} /> Metadata removed
                          </Tag>
                        )}
                        {!im.isPrimary && (
                          <Button tone="ghost" size="sm" onClick={() => makePrimary(im.id)} aria-label={`Set image ${i + 1} as primary`}>
                            Set as primary
                          </Button>
                        )}
                      </div>
                      <Input
                        label={`Alt text, image ${i + 1}`}
                        value={im.alt}
                        placeholder="What’s in the picture"
                        onChange={(e) => setAlt(im.id, e.target.value)}
                      />
                    </li>
                  ))}
                  {Array.from({ length: processing }).map((_, i) => (
                    <li key={`p${i}`} className="st-upload" aria-label="Removing metadata">
                      <div className="upload-grid__item skeleton" />
                      <p className="tiny muted">Removing metadata…</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel title="The label">
            <div className="stack">
              <Input label="Title" value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
              <div className="grid-2">
                <Input label="Year" inputMode="numeric" value={f.year} onChange={(e) => set('year', e.target.value.replace(/[^\d]/g, '').slice(0, 4))} error={errors.year} />
                <Select label="Medium" value={f.medium} onChange={(e) => set('medium', e.target.value as Medium)}>
                  {MEDIUMS.map((m) => (
                    <option key={m} value={m}>
                      {capitalize(m)}
                    </option>
                  ))}
                </Select>
              </div>
              <ChipInput
                label="Materials"
                values={f.materials}
                onChange={(v) => set('materials', v)}
                suggestions={f.materials.length < 3 ? MATERIALS_BY_MEDIUM[f.medium] : ALL_MATERIALS}
                hint="Type a material and press Enter or comma. Tap one to remove it."
                error={errors.materials}
                placeholder="e.g. oil on linen"
                medium={f.medium}
              />
              <Group label="Dimensions" error={errors.dimensions} hint="Height first, the gallery convention. Leave depth blank for flat work.">
                <div className="st-dims">
                  <DimInput label="Height" value={f.height} onChange={(v) => set('height', v, 'dimensions')} invalid={!!errors.dimensions} />
                  <span aria-hidden="true" className="st-dims__x">
                    ×
                  </span>
                  <DimInput label="Width" value={f.width} onChange={(v) => set('width', v, 'dimensions')} invalid={!!errors.dimensions} />
                  <span aria-hidden="true" className="st-dims__x">
                    ×
                  </span>
                  <DimInput label="Depth" value={f.depth} onChange={(v) => set('depth', v, 'dimensions')} invalid={false} />
                </div>
                <div className="st-dims__unit">
                  <Segmented<Unit>
                    label="Unit"
                    value={f.unit}
                    onChange={(v) => set('unit', v)}
                    options={[
                      { value: 'cm', label: 'Centimeters' },
                      { value: 'in', label: 'Inches' },
                    ]}
                  />
                  <p className="small st-conversion" aria-live="polite">
                    <Icon.Ruler aria-hidden="true" /> {conversion || `Converted to ${other} as you type`}
                  </p>
                </div>
              </Group>
              <Textarea label="Description" value={f.description} onChange={(e) => set('description', e.target.value)} rows={4} hint="What it is, how it was made, anything a curator should know." />
              <Select label="Status" value={f.status} onChange={(e) => set('status', e.target.value as ArtworkStatus)}>
                {ARTWORK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {capitalize(s)}
                  </option>
                ))}
              </Select>
              <Input label="Rights note" value={f.rightsNote} onChange={(e) => set('rightsNote', e.target.value)} hint="Shown with the work. You keep copyright — say how it may be reproduced." />
              <ChipInput label="Tags" values={f.tags} onChange={(v) => set('tags', v)} hint="Optional. Themes curators might search for, like night or public art." placeholder="Add a tag" />
            </div>
          </Panel>

          <Panel title="Price">
            <div className="stack">
              <Toggle checked={f.noPrice} onChange={(v) => set('noPrice', v, 'price')} label="No price" hint="Not for sale, or you’d rather discuss it." />
              {!f.noPrice && (
                <Field label="Price" error={errors.price} hint="Whole amount in the currency you’d invoice in.">
                  {(fid, describedBy) => (
                    <div className="input-group">
                      <input
                        id={fid}
                        className="input"
                        inputMode="decimal"
                        value={f.amount}
                        aria-describedby={describedBy}
                        aria-invalid={errors.price ? true : undefined}
                        onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''), 'price')}
                      />
                      <select className="select st-currency" aria-label="Currency" value={f.currency} onChange={(e) => set('currency', e.target.value, 'price')}>
                        {Array.from(new Set([...CURRENCIES, f.currency])).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </Field>
              )}
              {!f.noPrice && <VisibilityPicker label="Who can see the price" value={f.priceVisibility} onChange={(v) => set('priceVisibility', v)} />}
            </div>
          </Panel>

          <Panel title="Visibility" accent>
            <div className="stack">
              <StudioVisibilityPicker label="Who can see this work" value={f.visibility} onChange={(v) => set('visibility', v, 'images')} captions={RECORD_CAPTIONS} />
              <Notice tone="cobalt" icon={<Icon.Info />}>
                Prices marked 'Verified institutions' are visible only to curators Kofi has verified. Nothing here is shown to the public until the work is Public and your profile is approved.
              </Notice>
            </div>
          </Panel>

          {Object.values(errors).some(Boolean) && (
            <Notice tone="coral" icon={<Icon.Warn />}>
              This work can’t be saved yet. Fix the fields marked in red.
            </Notice>
          )}

          <div className="sticky-actions st-savebar">
            <span className="small st-savebar__state" aria-live="polite">
              {saving ? 'Saving…' : processing ? 'Processing images…' : dirty ? 'Unsaved changes' : isNew ? 'New draft' : 'No changes'}
            </span>
            <Button type="submit" loading={saving} disabled={saving || processing > 0}>
              {isNew ? 'Save work' : 'Save changes'}
            </Button>
          </div>

          {!isNew && (
            <section className="st-danger" aria-label="Delete">
              <Button tone="danger" icon={<Icon.Trash />} onClick={() => setConfirmDelete(true)}>
                Delete this work
              </Button>
            </section>
          )}
        </form>
      </div>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Delete “${f.title || 'this work'}”?`}
        body={`It leaves your studio and the gallery, and it’s removed from any curator shortlists. ${
          docCount ? `The ${docCount === 1 ? 'document' : `${docCount} documents`} attached to it stay in your private vault, unattached.` : 'Any vault documents you attach to works are always kept.'
        } Kofi’s activity record keeps a note that it was deleted. This can’t be undone.`}
        confirmLabel="Delete work"
        danger
      />
    </Shell>
  );
}

function DimInput({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <label className="st-dim">
      <span className="tiny strong">{label}</span>
      <input className="input" inputMode="decimal" value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
    </label>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="screen">
      <TopBar title={title} back="/studio" />
      <main className="container container--wide section">{children}</main>
    </div>
  );
}
