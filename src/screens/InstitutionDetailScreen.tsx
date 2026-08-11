// Route wrapper for C2 — ~15 lines of wiring, view interior left for Khushi (K6).
// Reads institutionId from route params, will call adapter.getInstitution when
// MockAdapter lands (Prayas P0-4). Khushi's InstitutionDetailView slots in below.
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CatalogueStackParamList } from '../navigation/types';
import tokens from '../theme/tokens';

type Props = NativeStackScreenProps<CatalogueStackParamList, 'InstitutionDetail'>;

const { color } = tokens;
const typeScale = tokens.type;

export default function InstitutionDetailScreen({ route }: Props) {
  const { institutionId } = route.params;
  // TODO: replace stub with adapter call once MockAdapter lands (Prayas P0-4):
  //   const [institution, setInstitution] = useState<Institution | null>(null);
  //   useEffect(() => { adapter.getInstitution(institutionId).then(setInstitution); }, [institutionId]);

  return (
    <View style={styles.container}>
      {/* Khushi's InstitutionDetailView renders here (K6) */}
      <Text style={styles.stub}>Institution: {institutionId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  stub: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
});
