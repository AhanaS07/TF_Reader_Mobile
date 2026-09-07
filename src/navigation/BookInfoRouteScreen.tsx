// The BookInfo route: reads `{ bookId }` from navigation params and renders
// AccessibilityInfoScreen — same route/presentational split ReaderRouteScreen.tsx and
// AudioPlayerRouteScreen.tsx use. This file owns the one navigation concern
// AccessibilityInfoScreen itself is ignorant of: dismissing back to whichever screen pushed it.

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AccessibilityInfoScreen } from '@/features/accessibility/AccessibilityInfoScreen';

import type { RootStackParamList } from './RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'BookInfo'>;

export function BookInfoRouteScreen({ route, navigation }: Props): React.JSX.Element {
  const { bookId } = route.params;

  return <AccessibilityInfoScreen bookId={bookId} onClose={() => navigation.goBack()} />;
}
