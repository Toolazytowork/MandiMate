import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

/* Minimal DOM harness (react-dom + act) — no testing-library dependency needed. */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(ui: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(ui));
}

const byText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="tab"]')).find(
    (element) => element.textContent === text,
  ) as HTMLElement;

const press = (target: EventTarget, key: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

const click = (element: HTMLElement) =>
  act(() => {
    element.click();
  });

function DialogHarness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        title="Accept offer"
        description="Confirm the net amount before accepting."
      >
        <input aria-label="Note" />
        <button type="button">Confirm</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    mount(<DialogHarness />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('is labelled, moves focus inside and closes on Escape', () => {
    const onOpenChange = vi.fn();
    mount(<DialogHarness onOpenChange={onOpenChange} />);
    click(byText('Open'));

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Accept offer');
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toContain('net amount');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note');

    press(document, 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('DropdownMenu', () => {
  it('focuses items with arrow keys, runs onSelect and restores focus to the trigger', () => {
    const onSelect = vi.fn();
    mount(
      <DropdownMenu label="Lot actions" trigger={(props) => <button {...props}>Actions</button>}>
        <DropdownMenuItem>Open for offers</DropdownMenuItem>
        <DropdownMenuItem onSelect={onSelect}>Cancel lot</DropdownMenuItem>
      </DropdownMenu>,
    );
    const trigger = byText('Actions');
    click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Lot actions');
    expect(document.activeElement?.textContent).toBe('Open for offers');

    press(document.activeElement as Element, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Cancel lot');

    click(document.activeElement as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    mount(
      <DropdownMenu trigger={(props) => <button {...props}>Menu</button>}>
        <DropdownMenuItem>Only item</DropdownMenuItem>
      </DropdownMenu>,
    );
    const trigger = byText('Menu');
    click(trigger);
    press(document, 'Escape');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Tabs', () => {
  it('moves selection with arrow keys and shows the matching panel', () => {
    mount(
      <Tabs defaultValue="offers">
        <TabsList label="Harvest sections">
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="journey">Journey</TabsTrigger>
        </TabsList>
        <TabsContent value="offers">Offer list</TabsContent>
        <TabsContent value="journey">Timeline</TabsContent>
      </Tabs>,
    );
    const offers = byText('Offers');
    expect(offers.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Offer list');

    act(() => offers.focus());
    press(offers, 'ArrowRight');
    const journey = byText('Journey');
    expect(journey.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(journey);
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Timeline');
  });
});
