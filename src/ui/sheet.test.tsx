import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Button, Confirm, Sheet } from '@/ui';

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
});

afterEach(() => {
  cleanup();
  root.remove();
});

function Harness({ nested = false }: { nested?: boolean }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <button type="button">Behind</button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Test sheet"
        footer={
          <Button block onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <label>
          Name <input />
        </label>
        <label>
          Email <input type="email" />
        </label>
        {nested && (
          <button type="button" onClick={() => setInner(true)}>
            Open inner
          </button>
        )}
      </Sheet>
      {nested && (
        <Sheet open={inner} onClose={() => setInner(false)} title="Inner sheet">
          <button type="button">Inner action</button>
        </Sheet>
      )}
    </>
  );
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey });
const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

function openSheet() {
  const trigger = screen.getByRole('button', { name: 'Open sheet' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe('Sheet focus management', () => {
  it('renders in a portal outside #root and moves focus to the first field', () => {
    render(<Harness />, { container: root });
    openSheet();
    const dialog = screen.getByRole('dialog', { name: 'Test sheet' });
    expect(root.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    render(<Harness />, { container: root });
    openSheet();
    const close = screen.getByRole('button', { name: 'Close' });
    const done = screen.getByRole('button', { name: 'Done' });
    done.focus();
    tab();
    expect(document.activeElement).toBe(close);
    tab(true);
    expect(document.activeElement).toBe(done);
    // Mid-sheet Tab is left to the browser (no wrap).
    screen.getByLabelText('Name').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('Escape closes and focus returns to the trigger', () => {
    render(<Harness />, { container: root });
    const trigger = openSheet();
    expect(document.activeElement).not.toBe(trigger);
    esc();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('focus returns to the trigger after closing from a button', () => {
    render(<Harness />, { container: root });
    const trigger = openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('marks #root inert and aria-hidden while open, and clears both after close', () => {
    render(<Harness />, { container: root });
    expect(root.hasAttribute('inert')).toBe(false);
    openSheet();
    expect(root.hasAttribute('inert')).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    esc();
    expect(root.hasAttribute('inert')).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
  });

  it('pulls stray focus back into the open sheet', () => {
    render(<Harness />, { container: root });
    openSheet();
    act(() => screen.getByRole('button', { name: 'Behind', hidden: true }).focus());
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('nested sheets: only the top one traps and answers Escape', () => {
    render(<Harness nested />, { container: root });
    const trigger = openSheet();
    const opener = screen.getByRole('button', { name: 'Open inner' });
    opener.focus();
    fireEvent.click(opener);
    const inner = screen.getByRole('dialog', { name: 'Inner sheet' });
    expect(inner.contains(document.activeElement)).toBe(true);
    // The outer sheet's layer is inert while the inner one is open.
    const outer = screen.getByRole('dialog', { name: 'Test sheet', hidden: true });
    expect(outer.closest('[inert]')).not.toBeNull();
    // Tab from the last inner control wraps inside the inner sheet.
    screen.getByRole('button', { name: 'Inner action' }).focus();
    tab();
    expect(inner.contains(document.activeElement)).toBe(true);
    esc();
    expect(screen.queryByRole('dialog', { name: 'Inner sheet' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
    expect(root.hasAttribute('inert')).toBe(true);
    esc();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(root.hasAttribute('inert')).toBe(false);
  });

  it('Confirm focuses Cancel (the safe choice) first', () => {
    function C() {
      const [open, setOpen] = useState(true);
      return <Confirm open={open} onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} title="Delete?" body="Gone for good." confirmLabel="Delete" danger />;
    }
    render(<C />, { container: root });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });
});
