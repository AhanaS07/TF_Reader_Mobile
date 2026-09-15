// Dev-only route — never user-reachable in production.
import { StateGallery } from '@/gallery';

export default function GalleryScreen() {
  return <StateGallery />;
}
