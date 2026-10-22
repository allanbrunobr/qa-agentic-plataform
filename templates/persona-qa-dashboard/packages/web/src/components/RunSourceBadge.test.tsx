import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunSourceBadge } from './RunSourceBadge';

describe('RunSourceBadge', () => {
  it('renders "Dashboard" for dashboard source', () => {
    render(<RunSourceBadge source="dashboard" />);
    expect(screen.getByText('Dashboard')).toBeDefined();
  });

  it('renders "CLI" for cli source', () => {
    render(<RunSourceBadge source="cli" />);
    expect(screen.getByText('CLI')).toBeDefined();
  });

  it('renders "Clean Run" for clean-run source', () => {
    render(<RunSourceBadge source="clean-run" />);
    expect(screen.getByText('Clean Run')).toBeDefined();
  });

  it('renders "Unknown" for unknown source', () => {
    render(<RunSourceBadge source="unknown" />);
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('renders "Unknown" for null source', () => {
    render(<RunSourceBadge source={null} />);
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('renders "Unknown" for undefined source', () => {
    render(<RunSourceBadge source={undefined} />);
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('renders "Unknown" for unrecognized source string', () => {
    render(<RunSourceBadge source="something-else" />);
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('applies dashboard-specific blue styling', () => {
    const { container } = render(<RunSourceBadge source="dashboard" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('blue');
  });

  it('applies cli-specific green styling', () => {
    const { container } = render(<RunSourceBadge source="cli" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('green');
  });

  it('applies clean-run-specific orange styling', () => {
    const { container } = render(<RunSourceBadge source="clean-run" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('orange');
  });
});
