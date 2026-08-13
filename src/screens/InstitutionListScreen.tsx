import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { InstitutionRow } from '@components/InstitutionRow';
import type { Institution } from '@model/institution';
import { useInstitutionStore } from '@store/institutionStore';
import { getCatalogueSource } from '../config/catalogue';
import type { CatalogueStackParamList } from '../navigation/types';
import { color, radius, space, type } from '@theme/tokens';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'InstitutionList'>;

// Prevents a network call on every keystroke without a dependency on a debounce
// library. Empty query fires instantly so the initial list appears without delay.
const DEBOUNCE_MS = 300;

export default function InstitutionListScreen() {
  const navigation = useNavigation<Nav>();

  const [query, setQuery] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const recentlyUsedIds = useInstitutionStore((s) => s.recentlyUsedIds);
  const setSelectedInstitution = useInstitutionStore((s) => s.setSelectedInstitution);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchInstitutions = useCallback((q: string) => {
    setLoading(true);
    setFetchError(false);
    getCatalogueSource()
      .getInstitutions(q.length > 0 ? { q } : undefined)
      .then(setInstitutions)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const delay = query.length === 0 ? 0 : DEBOUNCE_MS;
    timerRef.current = setTimeout(() => fetchInstitutions(query), delay);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [query, fetchInstitutions]);

  const handleSelect = useCallback(
    (institution: Institution) => {
      setSelectedInstitution(institution);
      navigation.goBack();
    },
    [setSelectedInstitution, navigation],
  );

  // Preserve recentlyUsedIds order (most recent first), only include institutions
  // that are present in the current result set (i.e. match the active query).
  const pinnedInstitutions = useMemo(
    () =>
      recentlyUsedIds
        .map((id) => institutions.find((i) => i.id === id))
        .filter((i): i is Institution => i !== undefined),
    [recentlyUsedIds, institutions],
  );

  // Everything not pinned goes into the "All Institutions" section.
  const mainInstitutions = useMemo(
    () => institutions.filter((i) => !recentlyUsedIds.includes(i.id)),
    [institutions, recentlyUsedIds],
  );

  const searchBar = (
    <View style={styles.searchBar}>
      <Ionicons name="search-outline" size={18} color={color.textSecondary} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search institutions..."
        placeholderTextColor={color.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search institutions"
      />
    </View>
  );

  // Full-screen spinner only on the very first load — subsequent query changes
  // show the previous results while the new fetch completes.
  if (loading && institutions.length === 0) {
    return (
      <View style={styles.screen}>
        {searchBar}
        <View style={styles.center}>
          <ActivityIndicator color={color.primary} />
        </View>
      </View>
    );
  }

  if (fetchError) {
    return (
      <View style={styles.screen}>
        {searchBar}
        <View style={styles.center}>
          <Text style={styles.statusText}>Couldn&apos;t load institutions.</Text>
        </View>
      </View>
    );
  }

  const listHeader = (
    <View>
      {searchBar}
      {pinnedInstitutions.length > 0 && (
        <View>
          <Text style={styles.sectionHeader}>Recently used</Text>
          {pinnedInstitutions.map((institution) => (
            <InstitutionRow
              key={institution.id}
              institution={institution}
              isSelected={institution.id === selectedInstitution?.id}
              isPinned
              onPress={() => handleSelect(institution)}
            />
          ))}
        </View>
      )}
      {mainInstitutions.length > 0 && (
        <Text style={styles.sectionHeader}>All Institutions</Text>
      )}
    </View>
  );

  const listEmpty =
    !loading && pinnedInstitutions.length === 0 ? (
      <View style={styles.center}>
        <Text style={styles.statusText}>No institutions match your search.</Text>
      </View>
    ) : null;

  return (
    <View style={styles.screen}>
      <FlatList
        data={mainInstitutions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InstitutionRow
            institution={item}
            isSelected={item.id === selectedInstitution?.id}
            onPress={() => handleSelect(item)}
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    gap: space.xs,
  },
  searchInput: {
    flex: 1,
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
    padding: 0,
  },
  sectionHeader: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
    backgroundColor: color.surface,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  statusText: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
});
