import type {
  Artist,
  ArtistView,
  Artwork,
  ArtworkView,
  Region,
  Viewer,
  Visibility,
} from './types';
import { NO_USES } from './types';
import { orientationOf } from './taxonomy';

/**
 * The single rule that decides whether a viewer may see something tagged with
 * a visibility level. Everything in the app funnels through here.
 *
 *  public        → anyone
 *  institutions  → verified curators, Kofi admins, the owner
 *  kofi          → Kofi admins, the owner
 *  private       → the owner, Kofi admins (access is audited by the data layer)
 */
export function canSee(level: Visibility, viewer: Viewer, ownerArtistId?: string): boolean {
  if (isOwner(viewer, ownerArtistId)) return true;
  if (viewer.role === 'admin') return true;
  switch (level) {
    case 'public':
      return true;
    case 'institutions':
      return viewer.role === 'curator' && viewer.curatorVerified === true;
    case 'kofi':
    case 'private':
      return false;
  }
}

export function isOwner(viewer: Viewer, ownerArtistId?: string): boolean {
  return viewer.role === 'artist' && !!ownerArtistId && viewer.artistId === ownerArtistId;
}

export function canEdit(viewer: Viewer, ownerArtistId: string): boolean {
  return isOwner(viewer, ownerArtistId) || viewer.role === 'admin';
}

/** Whether an artist profile is discoverable by this viewer at all. */
export function artistVisibleTo(artist: Artist, viewer: Viewer): boolean {
  if (canEdit(viewer, artist.id)) return true;
  if (artist.status !== 'approved') return false;
  return canSee(artist.visibility, viewer, artist.id);
}

/** Whether an artwork record is visible to this viewer at all. */
export function artworkVisibleTo(artwork: Artwork, artist: Artist | undefined, viewer: Viewer): boolean {
  if (canEdit(viewer, artwork.artistId)) return true;
  if (!artist) return false;
  if (!artistVisibleTo(artist, viewer)) return false;
  return canSee(artwork.visibility, viewer, artwork.artistId);
}

/** Reduce a region to the artist's chosen precision. */
export function regionLabel(region: Region): string {
  switch (region.precision) {
    case 'city':
      return [region.city, region.region].filter(Boolean).join(', ') || region.country;
    case 'region':
      return `${region.region}, ${region.country}`;
    case 'country':
      return region.country;
  }
}

/**
 * Project an artwork for a viewer. Returns undefined when the viewer may not
 * see the record at all. Price is removed (and flagged withheld) when the
 * viewer may not see it. Never leaks owner contact or documents.
 */
export function projectArtwork(
  artwork: Artwork,
  artist: Artist | undefined,
  viewer: Viewer,
): ArtworkView | undefined {
  if (!artworkVisibleTo(artwork, artist, viewer)) return undefined;
  const priceVisible = artwork.price !== undefined && canSee(artwork.priceVisibility, viewer, artwork.artistId);
  const view: ArtworkView = {
    id: artwork.id,
    artistId: artwork.artistId,
    artistWorkingName: artist?.workingName ?? 'Unknown artist',
    artistCareerStage: artist?.careerStage ?? 'emerging',
    artistExperience: artist?.experience ?? {
      commissions: false,
      publicArt: false,
      residencies: false,
      institutionalShows: false,
    },
    artistRegionLabel: artist ? regionLabel(artist.region) : '',
    title: artwork.title,
    year: artwork.year,
    medium: artwork.medium,
    materials: [...artwork.materials],
    dimensions: { ...artwork.dimensions },
    description: artwork.description,
    images: artwork.images.map((i) => ({ ...i })),
    status: artwork.status,
    rightsNote: artwork.rightsNote,
    priceWithheld: artwork.price !== undefined && !priceVisible,
    tags: [...artwork.tags],
    tagIds: [...(artwork.tagIds ?? [])],
    uses: { ...(artwork.uses ?? NO_USES) },
    orientation: orientationOf(artwork.dimensions, artwork.medium),
    // The work's own location (at the artist's chosen precision) when set, else the artist's region.
    locationLabel: artwork.location ? regionLabel({ ...artwork.location, precision: artist?.region.precision ?? artwork.location.precision }) : artist ? regionLabel(artist.region) : '',
    visibility: artwork.visibility,
    priceVisibility: artwork.priceVisibility,
    canEdit: canEdit(viewer, artwork.artistId),
    createdAt: artwork.createdAt,
    updatedAt: artwork.updatedAt,
  };
  if (artwork.edition) view.edition = { ...artwork.edition };
  if (artwork.location && canEdit(viewer, artwork.artistId)) view.location = { ...artwork.location };
  if (priceVisible && artwork.price) view.price = { ...artwork.price };
  if (artwork.reviewedAt) view.reviewedAt = artwork.reviewedAt;
  return view;
}

/** Project an artist for a viewer. Contact, legal name and staff notes are owner/admin only. */
export function projectArtist(artist: Artist, viewer: Viewer): ArtistView | undefined {
  if (!artistVisibleTo(artist, viewer)) return undefined;
  const owner = canEdit(viewer, artist.id);
  const view: ArtistView = {
    id: artist.id,
    workingName: artist.workingName,
    bio: artist.bio,
    regionLabel: regionLabel(artist.region),
    mediums: [...artist.mediums],
    careerStage: artist.careerStage,
    experience: { ...artist.experience },
    availability: { ...artist.availability },
    links: artist.links.map((l) => ({ ...l })),
    status: artist.status,
    visibility: artist.visibility,
    avatarColor: artist.avatarColor,
    canEdit: owner,
    createdAt: artist.createdAt,
    updatedAt: artist.updatedAt,
  };
  if (artist.pronouns) view.pronouns = artist.pronouns;
  if (artist.statement) view.statement = artist.statement;
  if (owner) {
    view.contact = { ...artist.contact };
    view.region = { ...artist.region };
    if (artist.legalName) view.legalName = artist.legalName;
    if (artist.consentVersion) view.consentVersion = artist.consentVersion;
    if (artist.consentAcceptedAt) view.consentAcceptedAt = artist.consentAcceptedAt;
  }
  if (viewer.role === 'admin' && artist.kofiNotes) view.kofiNotes = artist.kofiNotes;
  return view;
}

/** Keys that must never appear in any non-owner projection. Used by tests and the review gate. */
export const NEVER_LEAK_ARTIST_KEYS = ['contact', 'legalName', 'kofiNotes', 'userId'] as const;
export const NEVER_LEAK_ARTWORK_KEYS = ['documents', 'contact'] as const;
