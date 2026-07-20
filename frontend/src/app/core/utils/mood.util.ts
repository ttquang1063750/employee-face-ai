const MOOD_LABELS: Record<string, string> = {
  happy: 'Vui vẻ 😊',
  sad: 'Buồn bã 😢',
  angry: 'Tức giận 😠',
  surprise: 'Ngạc nhiên 😲',
  fear: 'Lo sợ 😨',
  disgust: 'Khó chịu 😣',
  neutral: 'Bình thường 😐',
};

export function translateMood(mood: string): string {
  return MOOD_LABELS[mood.toLowerCase()] || mood;
}

export interface MoodBucketPercentages {
  happy: number;
  neutral: number;
  sad: number;
  stressed: number;
}

// Buckets raw mood strings into 4 broad categories and returns each as a
// whole-number percentage of the total — shared by the org-wide dashboard
// mood donut and the per-employee attendance-summary mood donut so the two
// views can never classify the same mood string differently.
export function bucketMoodPercentages(moods: string[]): MoodBucketPercentages {
  const stats = { happy: 0, neutral: 0, sad: 0, stressed: 0 };
  if (moods.length === 0) return stats;

  moods.forEach((mood) => {
    const m = mood.toLowerCase();
    if (m.includes('happy') || m.includes('vui')) stats.happy++;
    else if (m.includes('neutral') || m.includes('bình')) stats.neutral++;
    else if (m.includes('sad') || m.includes('buồn')) stats.sad++;
    else stats.stressed++;
  });

  const total = moods.length;
  return {
    happy: Math.round((stats.happy / total) * 100),
    neutral: Math.round((stats.neutral / total) * 100),
    sad: Math.round((stats.sad / total) * 100),
    stressed: Math.round((stats.stressed / total) * 100),
  };
}
