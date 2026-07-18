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
