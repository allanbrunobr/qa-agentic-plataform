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
    render(<ArtifactsSection artifacts={{ customer_id: '123', order_id: '456' }} />);
    expect(screen.getByText('Artifacts (2)')).toBeDefined();
  });

  it('is collapsed by default', () => {
    render(<ArtifactsSection artifacts={{ customer_id: '123' }} />);
    expect(screen.queryByText('Customer ID')).toBeNull();
  });

  it('expands on click to show artifact keys and values', () => {
    render(<ArtifactsSection artifacts={{ customer_id: '123', order_id: '456' }} />);
    fireEvent.click(screen.getByText('Artifacts (2)'));
    expect(screen.getByText('Customer ID')).toBeDefined();
    expect(screen.getByText('123')).toBeDefined();
    expect(screen.getByText('Order ID')).toBeDefined();
    expect(screen.getByText('456')).toBeDefined();
  });

  it('shows tooltip icon for stub values like shipping-engine-managed', () => {
    render(<ArtifactsSection artifacts={{ shipment_id: 'shipping-engine-managed' }} />);
    fireEvent.click(screen.getByText('Artifacts (1)'));
    expect(screen.getByText('shipping-engine-managed')).toBeDefined();
    // The Info icon should be present (tooltip trigger)
    expect(screen.getByText('Value managed by the rules engine. Not a real system ID.')).toBeDefined();
  });

  it('uses raw key name when no label mapping exists', () => {
    render(<ArtifactsSection artifacts={{ custom_field: 'value' }} />);
    fireEvent.click(screen.getByText('Artifacts (1)'));
    expect(screen.getByText('custom_field')).toBeDefined();
  });
});
