import { fireEvent, render, screen } from '@testing-library/react-native';

import ElitePendingAccessCard from './ElitePendingAccessCard';

describe('ElitePendingAccessCard', () => {
  it('renders the title verbatim', async () => {
    await render(
      <ElitePendingAccessCard
        title="The Politics of Coalition in Korea"
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByTestId('elite-pending-access-title').props.children).toBe(
      'The Politics of Coalition in Korea',
    );
  });

  it('shows the expiry line only when one is supplied', async () => {
    await render(
      <ElitePendingAccessCard title="A Title" onAccept={() => {}} onReject={() => {}} />,
    );

    expect(screen.queryByTestId('elite-pending-access-expiry')).toBeNull();
  });

  it('renders the expiry label verbatim when supplied, inventing nothing', async () => {
    await render(
      <ElitePendingAccessCard
        title="A Title"
        expiryLabel="Expires in 23 minutes"
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByTestId('elite-pending-access-expiry').props.children).toBe(
      'Expires in 23 minutes',
    );
  });

  it('reports Accept through the handed callback', async () => {
    const onAccept = jest.fn();
    await render(
      <ElitePendingAccessCard title="A Title" onAccept={onAccept} onReject={() => {}} />,
    );

    fireEvent.press(screen.getByTestId('action-button-acceptOffer'));

    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('reports Reject through the handed callback', async () => {
    const onReject = jest.fn();
    await render(
      <ElitePendingAccessCard title="A Title" onAccept={() => {}} onReject={onReject} />,
    );

    fireEvent.press(screen.getByTestId('action-button-rejectOffer'));

    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('disables Reject while Accept is in flight, so a second tap cannot race it', async () => {
    await render(
      <ElitePendingAccessCard
        title="A Title"
        pending="accept"
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByTestId('action-button-rejectOffer').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('disables Accept while Reject is in flight', async () => {
    await render(
      <ElitePendingAccessCard
        title="A Title"
        pending="reject"
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(
      screen.getByTestId('action-button-acceptOffer').props.accessibilityState.disabled,
    ).toBe(true);
  });
});
