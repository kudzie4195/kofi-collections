import { useId, useState } from 'react';
import type { ArtworkView } from '@/domain/types';
import { Segmented, Sheet } from '@/ui';
import { useFocusReturn } from './CollectorInquirySheet';
import { roomCaption, roomLayout } from './room';

type Wall = 'white' | 'charcoal' | 'plaster';
const WALLS: Record<Wall, { label: string; wall: string; floor: string; ink: string; skirting: string }> = {
  white: { label: 'Gallery white', wall: '#ecebe7', floor: '#b9b3a8', ink: '#2b2a27', skirting: '#d8d6d0' },
  charcoal: { label: 'Charcoal', wall: '#2a2a2a', floor: '#151515', ink: '#8c877e', skirting: '#222' },
  plaster: { label: 'Plaster', wall: '#d9c8b4', floor: '#9c8a74', ink: '#3b3229', skirting: '#c9b7a1' },
};

/** True-scale preview: the work on a wall beside a 180 cm bench and a 170 cm standing figure. */
export function ViewInRoomSheet({ open, onClose, work }: { open: boolean; onClose: () => void; work: ArtworkView }) {
  useFocusReturn(open);
  const [wall, setWall] = useState<Wall>('white');
  const clipId = useId().replace(/:/g, '');
  const layout = roomLayout(work.dimensions);
  const img = work.images.find((i) => i.isPrimary) ?? work.images[0];
  const t = WALLS[wall];
  const { view, work: box, bench, figure } = layout;
  const FLOOR = 34; // cm of floor shown below the wall line
  const H = view.h + FLOOR;
  const Y = (cmFromFloor: number) => view.h - cmFromFloor; // SVG y for a height above the floor

  // Abstract standing figure: a head and a tapered body, no face.
  const fx = figure.x + figure.w / 2;
  const headR = 11;
  const figPath = [
    `M ${fx - 9} ${Y(0)}`,
    `L ${fx - 11} ${Y(86)}`,
    `L ${fx - 19} ${Y(138)}`,
    `Q ${fx - 19} ${Y(146)} ${fx - 10} ${Y(146)}`,
    `L ${fx + 10} ${Y(146)}`,
    `Q ${fx + 19} ${Y(146)} ${fx + 19} ${Y(138)}`,
    `L ${fx + 11} ${Y(86)}`,
    `L ${fx + 9} ${Y(0)}`,
    `L ${fx + 2} ${Y(0)}`,
    `L ${fx} ${Y(80)}`,
    `L ${fx - 2} ${Y(0)}`,
    'Z',
  ].join(' ');

  return (
    <Sheet open={open} onClose={onClose} title="View in a room">
      <div className="kp-room">
        <figure className="kp-room__fig">
          <svg viewBox={`0 0 ${view.w} ${H}`} className="kp-room__svg" role="img" aria-label={`${work.title} shown to scale on a wall: ${roomCaption(layout)}`}>
            <defs>
              <clipPath id={`room-${clipId}`}>
                <rect x={box.x} y={Y(box.y + box.h)} width={box.w} height={box.h} />
              </clipPath>
            </defs>
            <rect x={0} y={0} width={view.w} height={view.h} fill={t.wall} />
            <rect x={0} y={view.h - 8} width={view.w} height={8} fill={t.skirting} />
            <rect x={0} y={view.h} width={view.w} height={FLOOR} fill={t.floor} />
            {/* soft cast shadow so the work reads as hung, not pasted */}
            <rect x={box.x + 1.5} y={Y(box.y + box.h) + 2.5} width={box.w} height={box.h} fill="#000" opacity={wall === 'charcoal' ? 0.45 : 0.16} />
            {img ? (
              <image href={img.src} x={box.x} y={Y(box.y + box.h)} width={box.w} height={box.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#room-${clipId})`} />
            ) : (
              <rect x={box.x} y={Y(box.y + box.h)} width={box.w} height={box.h} fill="#777" />
            )}
            <rect x={box.x} y={Y(box.y + box.h)} width={box.w} height={box.h} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.6} />
            {/* bench: slab + two legs */}
            <rect x={bench.x} y={Y(bench.h)} width={bench.w} height={7} rx={1.5} fill={t.ink} />
            <rect x={bench.x + 10} y={Y(bench.h - 7)} width={6} height={bench.h - 7} fill={t.ink} />
            <rect x={bench.x + bench.w - 16} y={Y(bench.h - 7)} width={6} height={bench.h - 7} fill={t.ink} />
            {/* figure */}
            <circle cx={fx} cy={Y(figure.h - headR)} r={headR} fill={t.ink} />
            <path d={figPath} fill={t.ink} />
          </svg>
          <figcaption className="kp-room__caption">{roomCaption(layout)}</figcaption>
        </figure>
        {layout.zoomedOut && (
          <p className="kp-room__note" role="note">
            This work is larger than our standard wall view, so the room is zoomed out to fit it. Everything is still to scale.
          </p>
        )}
        <Segmented<Wall> label="Wall colour" value={wall} onChange={setWall} options={(Object.keys(WALLS) as Wall[]).map((w) => ({ value: w, label: WALLS[w].label }))} />
        <p className="tiny muted">
          Hung with its centre at 145 cm, the usual gallery height. {work.dimensions.depth !== undefined ? 'Shown by its front face (height × width). ' : ''}The photograph is cropped to the work’s listed size.
        </p>
      </div>
    </Sheet>
  );
}
