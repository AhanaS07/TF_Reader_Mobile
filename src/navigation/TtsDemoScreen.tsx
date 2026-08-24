// Route wrapper for TtsReadingScreen (Accessibility, Hruthik) — see its own header note for what
// it demonstrates. This file adds no behaviour; it exists only so the screen has a route name to
// navigate to and pop back from, replacing App.tsx's old `showTtsDemo` boolean swap.

import { TtsReadingScreen } from '@/features/accessibility/tts/TtsReadingScreen';

export function TtsDemoScreen(): React.JSX.Element {
  return <TtsReadingScreen />;
}
