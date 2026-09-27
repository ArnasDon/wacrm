export function vibrate(pattern: number | number[] = 50) {
  if (
    typeof window !== 'undefined' &&
    'navigator' in window &&
    'vibrate' in navigator
  ) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // Ignore vibration errors
    }
  }
}
