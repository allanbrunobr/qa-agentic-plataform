import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactsSection } from './ArtifactsSection';

describe('ArtifactsSection', () => {
  it('renders nothing when artifacts is null', () => {
    const { container } = render(<ArtifactsSection artifacts={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when artifacts is empty object', () => {
    const { container } = render(<ArtifactsSection artifacts={{}} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows artifact count in header', () => {
    render(<ArtifactsSection artifacts={{ customer_id: '123', event_id: '456' }} />);
    expect(screen.getByText('Artefatos (2)')).toBeDefined();
  });

  it('is collapsed by default', () => {
    render(<ArtifactsSection artifacts={{ customer_id: '123' }} />);
    expect(screen.queryByText('ID Customer')).toBeNull();
  });

  it('expands on click to show artifact keys and values', () => {
    render(<ArtifactsSection artifacts={{ customer_id: '123', event_id: '456' }} />);
    fireEvent.click(screen.getByText('Artefatos (2)'));
    expect(screen.getByText('ID Customer')).toBeDefined();
    expect(screen.getByText('123')).toBeDefined();
    expect(screen.getByText('ID Evento')).toBeDefined();
    expect(screen.getByText('456')).toBeDefined();
  });

  it('shows tooltip icon for stub values like rx-engine-managed', () => {
    render(<ArtifactsSection artifacts={{ receipt_id: 'rx-engine-managed' }} />);
    fireEvent.click(screen.getByText('Artefatos (1)'));
    expect(screen.getByText('rx-engine-managed')).toBeDefined();
    // The Info icon should be present (tooltip trigger)
    expect(screen.getByText('Valor gerenciado pelo motor de regras. Não é um ID real do sistema.')).toBeDefined();
  });

  it('uses raw key name when no label mapping exists', () => {
    render(<ArtifactsSection artifacts={{ custom_field: 'value' }} />);
    fireEvent.click(screen.getByText('Artefatos (1)'));
    expect(screen.getByText('custom_field')).toBeDefined();
  });
});
