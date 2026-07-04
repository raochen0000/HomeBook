import { useRouter } from 'expo-router';

import { SearchScreen } from '@/features/search/search-sheet';

export default function SearchRoute() {
  const router = useRouter();
  return <SearchScreen onClose={() => router.back()} />;
}
