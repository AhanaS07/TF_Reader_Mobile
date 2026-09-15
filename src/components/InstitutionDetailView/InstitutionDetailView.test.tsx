// src/components/InstitutionDetailView/InstitutionDetailView.test.tsx
// C2 renders one institution and reports two intentions. What is worth asserting
// is mostly what it REFUSES to do: interpret a model shape, or show a sign-in
// type. It takes primitives precisely so `authType` can never reach it.
//
// The initials path is not an edge case — two of the eight fixtures have no logo,
// so it is the common path for a quarter of the directory (W-17).
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { InstitutionDetailView } from '@components/InstitutionDetailView';

describe('InstitutionDetailView content', () => {
  it('renders the name and the country', async () => {
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('Imperial College London')).toBeTruthy();
    expect(screen.getByText('United Kingdom')).toBeTruthy();
  });

  it('renders the logo when a url is given', async () => {
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        logoUrl="https://cdn.tf/crests/inst_7f3.png"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByLabelText('Imperial College London logo')).toBeTruthy();
  });

  // A detail screen has room to wrap, unlike InstitutionRow which truncates.
  it('renders a long name in full', async () => {
    const long = 'The Royal Netherlands Institute for Southeast Asian and Caribbean Studies';
    await render(
      <InstitutionDetailView
        name={long}
        country="Netherlands"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText(long)).toBeTruthy();
  });

  it('renders a long country in full', async () => {
    const long = 'United Kingdom of Great Britain and Northern Ireland';
    await render(
      <InstitutionDetailView
        name="Trinity College Dublin"
        country={long}
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText(long)).toBeTruthy();
  });
});

describe('InstitutionDetailView logo fallback', () => {
  // W-17: wokay may supply no logo. Initials, not a broken image.
  it('falls back to initials when no logo url is given', async () => {
    await render(
      <InstitutionDetailView
        name="Kwame Nkrumah University of Science and Technology"
        country="Ghana"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('KN')).toBeTruthy();
    expect(
      screen.queryByLabelText('Kwame Nkrumah University of Science and Technology logo'),
    ).toBeNull();
  });

  it('takes the initial of each of the first two words', async () => {
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('IC')).toBeTruthy();
  });

  it('renders a single initial for a one-word name', async () => {
    await render(
      <InstitutionDetailView
        name="Sorbonne"
        country="France"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('S')).toBeTruthy();
  });

  it('shows no initials once a logo is supplied', async () => {
    const { rerender } = await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('IC')).toBeTruthy();

    await rerender(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        logoUrl="https://cdn.tf/crests/inst_7f3.png"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.queryByText('IC')).toBeNull();
  });
});

describe('InstitutionDetailView actions', () => {
  it('reports the selection through onSelect', async () => {
    const onSelect = jest.fn();
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={onSelect}
        onBack={() => {}}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Select this institution' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('reports back through onBack', async () => {
    const onBack = jest.fn();
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={onBack}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the two actions independent', async () => {
    const onSelect = jest.fn();
    const onBack = jest.fn();
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={onSelect}
        onBack={onBack}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Select this institution' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('exposes exactly two buttons', async () => {
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('InstitutionDetailView stays presentational', () => {
  // Sign-in is always SAML, so there is nothing to display and nothing to choose.
  // Taking primitives makes this structural: authType never reaches the component.
  it('renders no sign-in type', async () => {
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.queryByText(/saml/i)).toBeNull();
    expect(screen.queryByText(/sign.?in type/i)).toBeNull();
    expect(screen.queryByText(/oidc|email|unknown/i)).toBeNull();
  });

  it('renders with no provider, store, navigator or network', async () => {
    await render(
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('Imperial College London')).toBeTruthy();
  });
});
