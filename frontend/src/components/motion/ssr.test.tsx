import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CountUp } from './CountUp';
import { Reveal } from './Reveal';
import { StaggerGroup, StaggerItem } from './Stagger';

describe('motion helpers in prerendered HTML', () => {
  it('Reveal ships visible markup (hiding is left to html.js CSS)', () => {
    const html = renderToString(<Reveal delay={0.12}>Net earnings</Reveal>);
    expect(html).toContain('class="reveal"');
    expect(html).not.toContain('opacity');
    expect(html).toContain('--reveal-delay:120ms');
  });

  it('StaggerGroup renders no inline opacity on the server', () => {
    const html = renderToString(
      <StaggerGroup as="ul">
        <StaggerItem as="li">Farmer A · 200 kg</StaggerItem>
        <StaggerItem as="li">Farmer B · 350 kg</StaggerItem>
      </StaggerGroup>,
    );
    expect(html).toContain('data-stagger=""');
    expect(html).toContain('data-stagger-item=""');
    expect(html).not.toContain('style=');
  });

  it('CountUp renders its final value on the server', () => {
    expect(renderToString(<CountUp value={1240000} />)).toContain('12,40,000');
  });
});
