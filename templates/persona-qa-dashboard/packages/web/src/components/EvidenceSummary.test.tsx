import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceSummary } from './EvidenceSummary';

describe('EvidenceSummary', () => {
  it('renders nothing when no evidence exists', () => {
    const { container } = render(
      <EvidenceSummary findingsCount={0} screenshotsCount={0} artifactsCount={0} contextAvailable={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows findings count badge', () => {
    render(<EvidenceSummary findingsCount={5} />);
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByTitle('Findings')).toBeDefined();
  });

  it('shows screenshots count badge', () => {
    render(<EvidenceSummary findingsCount={0} screenshotsCount={3} />);
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByTitle('Screenshots')).toBeDefined();
  });

  it('shows artifacts count badge', () => {
    render(<EvidenceSummary findingsCount={0} artifactsCount={2} />);
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByTitle('Artefatos')).toBeDefined();
  });

  it('shows context available indicator', () => {
    render(<EvidenceSummary findingsCount={0} contextAvailable={true} />);
    expect(screen.getByTitle('Contexto disponível')).toBeDefined();
  });

  it('shows multiple badges simultaneously', () => {
    render(
      <EvidenceSummary
        findingsCount={3}
        screenshotsCount={2}
        artifactsCount={4}
        contextAvailable={true}
      />
    );
    expect(screen.getByTitle('Findings')).toBeDefined();
    expect(screen.getByTitle('Screenshots')).toBeDefined();
    expect(screen.getByTitle('Artefatos')).toBeDefined();
    expect(screen.getByTitle('Contexto disponível')).toBeDefined();
  });
});
